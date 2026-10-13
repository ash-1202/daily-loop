import { daysBetween, STREAK_FREEZES_PER_WEEK, weekStart, type Streak } from '@daily-loop/shared';

// Pure streak rules: no database, no clock. Dates are IST 'YYYY-MM-DD' strings.
//
// - A streak day = a day on which the user answered all 5 cards.
// - Completing the day after your last streak day adds 1.
// - Missing exactly one day is forgiven by a streak freeze (1 per week, Monday to Sunday).
// - Anything longer resets the streak to 1 on the next completed day.

export interface StreakState {
  current: number;
  longest: number;
  lastActiveDate: string | null;
  freezesLeft: number;
  /** Monday of the week `freezesLeft` belongs to; a new week refills the freeze. */
  freezeWeek: string | null;
}

export const EMPTY_STREAK: StreakState = {
  current: 0,
  longest: 0,
  lastActiveDate: null,
  freezesLeft: STREAK_FREEZES_PER_WEEK,
  freezeWeek: null,
};

function withWeeklyFreeze(state: StreakState, date: string): StreakState {
  const week = weekStart(date);
  return state.freezeWeek === week
    ? state
    : { ...state, freezesLeft: STREAK_FREEZES_PER_WEEK, freezeWeek: week };
}

/** The new streak state after the user completes the challenge for `date`. */
export function recordCompletion(
  state: StreakState,
  date: string,
): StreakState & { usedFreeze: boolean } {
  const s = withWeeklyFreeze(state, date);
  if (s.lastActiveDate === date) return { ...s, usedFreeze: false };

  const gap = s.lastActiveDate === null ? null : daysBetween(s.lastActiveDate, date);
  let current = 1;
  let freezesLeft = s.freezesLeft;
  let usedFreeze = false;

  if (gap === 1) {
    current = s.current + 1;
  } else if (gap === 2 && freezesLeft > 0) {
    current = s.current + 1;
    freezesLeft -= 1;
    usedFreeze = true;
  }

  return {
    ...s,
    current,
    longest: Math.max(s.longest, current),
    lastActiveDate: date,
    freezesLeft,
    usedFreeze,
  };
}

/** What the user should see on `today`: a streak that can no longer be saved shows as 0. */
export function streakView(state: StreakState, today: string): Streak {
  const s = withWeeklyFreeze(state, today);
  const gap = s.lastActiveDate === null ? null : daysBetween(s.lastActiveDate, today);

  const alive = gap !== null && (gap <= 1 || (gap === 2 && s.freezesLeft > 0));
  return {
    current: alive ? s.current : 0,
    longest: s.longest,
    freezesLeft: s.freezesLeft,
    completedToday: gap === 0,
    // Yesterday was missed: finish today (using the freeze) or the streak is lost.
    atRisk: alive && gap === 2,
  };
}
