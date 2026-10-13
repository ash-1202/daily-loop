import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, istDate, istDayStart, weekStart } from '@daily-loop/shared';
import { seededShuffle } from '../src/lib/shuffle';
import { ruleMet } from '../src/services/badges';
import { EMPTY_STREAK, recordCompletion, streakView } from '../src/services/streaks';
import { openChallengeDates } from '../src/services/submissions';

// Pure rules: no database needed.

describe('IST dates', () => {
  it('switch day at midnight IST (18:30 UTC), not midnight UTC', () => {
    expect(istDate(new Date('2026-10-13T18:29:59Z'))).toBe('2026-10-13');
    expect(istDate(new Date('2026-10-13T18:30:00Z'))).toBe('2026-10-14');
  });

  it('istDayStart is 00:00 IST', () => {
    expect(istDayStart('2026-10-14').toISOString()).toBe('2026-10-13T18:30:00.000Z');
  });

  it('add days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-14')).toBe('2026-10-12'); // Wednesday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekStart('2026-10-19')).toBe('2026-10-19'); // next Monday
  });
});

describe('answer window', () => {
  it('is today only during the day', () => {
    expect(openChallengeDates(new Date('2026-10-14T06:30:00Z'))).toEqual(['2026-10-14']);
  });

  it('also accepts yesterday for 15 minutes after midnight IST', () => {
    expect(openChallengeDates(new Date('2026-10-13T18:40:00Z'))).toEqual([
      '2026-10-14',
      '2026-10-13',
    ]);
    expect(openChallengeDates(new Date('2026-10-13T18:45:00Z'))).toEqual(['2026-10-14']);
  });
});

describe('streaks', () => {
  const complete = (dates: string[]) =>
    dates.reduce(recordCompletion, { ...EMPTY_STREAK, usedFreeze: false });

  it('count consecutive days', () => {
    expect(complete(['2026-10-12', '2026-10-13', '2026-10-14']).current).toBe(3);
  });

  it('do not change when the same day completes twice', () => {
    const s = complete(['2026-10-12', '2026-10-12']);
    expect(s.current).toBe(1);
  });

  it('use the weekly freeze to forgive one missed day', () => {
    const s = complete(['2026-10-12', '2026-10-13', '2026-10-15']); // missed Wed 14th
    expect(s.current).toBe(3);
    expect(s.freezesLeft).toBe(0);
    expect(s.usedFreeze).toBe(true);
  });

  it('reset when a second day is missed in the same week', () => {
    const s = complete(['2026-10-12', '2026-10-14', '2026-10-16']); // missed 13th, then 15th
    expect(s.current).toBe(1);
    expect(s.longest).toBe(2);
  });

  it('refill the freeze each Monday', () => {
    // Freeze used Wed 14th; next week a missed day is forgiven again.
    const s = complete([
      '2026-10-13',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-21',
    ]);
    expect(s.current).toBe(7);
    expect(s.freezesLeft).toBe(0);
  });

  it('reset after missing two days in a row', () => {
    expect(complete(['2026-10-12', '2026-10-15']).current).toBe(1);
  });

  it('show 0 once the streak can no longer be saved', () => {
    const s = complete(['2026-10-12', '2026-10-13']);
    expect(streakView(s, '2026-10-13')).toMatchObject({
      current: 2,
      completedToday: true,
      atRisk: false,
    });
    expect(streakView(s, '2026-10-14')).toMatchObject({
      current: 2,
      completedToday: false,
      atRisk: false,
    });
    expect(streakView(s, '2026-10-15')).toMatchObject({ current: 2, atRisk: true }); // freeze can save it
    expect(streakView(s, '2026-10-16')).toMatchObject({ current: 0, atRisk: false });
  });
});

describe('seededShuffle', () => {
  const options = ['A', 'B', 'C', 'D'];

  it('is a permutation and does not change the input', () => {
    const out = seededShuffle(options, 'seed');
    expect([...out].sort()).toEqual(options);
    expect(options).toEqual(['A', 'B', 'C', 'D']);
  });

  it('is stable for the same seed', () => {
    expect(seededShuffle(options, '2026-10-14:term_0001')).toEqual(
      seededShuffle(options, '2026-10-14:term_0001'),
    );
  });

  it('does not always keep the first option first', () => {
    const firstPlaces = new Set(
      Array.from({ length: 40 }, (_, i) => seededShuffle(options, `seed-${i}`)[0]),
    );
    expect(firstPlaces.size).toBeGreaterThan(1);
  });
});

describe('badge rules', () => {
  const stats = { challengesCompleted: 1, correctByType: { scam: 9 }, currentStreak: 7 };

  it('evaluate each rule type', () => {
    expect(ruleMet({ type: 'challenges_completed', count: 1 }, stats)).toBe(true);
    expect(ruleMet({ type: 'correct_count', task_type: 'scam', count: 10 }, stats)).toBe(false);
    expect(ruleMet({ type: 'correct_count', task_type: 'chart', count: 1 }, stats)).toBe(false);
    expect(ruleMet({ type: 'streak', days: 7 }, stats)).toBe(true);
  });

  it('never award an unknown rule', () => {
    expect(ruleMet({ type: 'something_new', count: 0 }, stats)).toBe(false);
  });
});
