import type { Streak, User } from '@daily-loop/shared';
import type { Db } from '../lib/db-utils';
import { EMPTY_STREAK, streakView, type StreakState } from './streaks';

interface StreakRow {
  current: number;
  longest: number;
  last_active_date: string | null;
  freezes_left: number;
  freeze_week: string | null;
}

export async function getUser(db: Db, userId: string): Promise<User> {
  const { rows } = await db.query<{
    id: string;
    display_name: string | null;
    email: string | null;
  }>(
    `SELECT u.id, u.display_name,
            (SELECT i.value FROM identities i
             WHERE i.user_id = u.id AND i.type = 'email' AND i.verified_at IS NOT NULL
             LIMIT 1) AS email
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0]!;
  return { id: row.id, displayName: row.display_name, email: row.email };
}

/** A user's total points: the sum of their ledger. */
export async function totalPoints(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    'SELECT coalesce(sum(delta), 0)::int AS total FROM points_ledger WHERE user_id = $1',
    [userId],
  );
  return rows[0]!.total;
}

/** Reads the stored streak; `forUpdate` locks the row for the rest of the transaction. */
export async function loadStreak(db: Db, userId: string, forUpdate = false): Promise<StreakState> {
  const { rows } = await db.query<StreakRow>(
    `SELECT current, longest, to_char(last_active_date, 'YYYY-MM-DD') AS last_active_date,
            freezes_left, to_char(freeze_week, 'YYYY-MM-DD') AS freeze_week
     FROM streaks WHERE user_id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId],
  );
  const row = rows[0];
  if (!row) return EMPTY_STREAK;
  return {
    current: row.current,
    longest: row.longest,
    lastActiveDate: row.last_active_date,
    freezesLeft: row.freezes_left,
    freezeWeek: row.freeze_week,
  };
}

export async function saveStreak(db: Db, userId: string, s: StreakState, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO streaks (user_id, current, longest, last_active_date, freezes_left, freeze_week, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       current = EXCLUDED.current, longest = EXCLUDED.longest,
       last_active_date = EXCLUDED.last_active_date, freezes_left = EXCLUDED.freezes_left,
       freeze_week = EXCLUDED.freeze_week, updated_at = EXCLUDED.updated_at`,
    [userId, s.current, s.longest, s.lastActiveDate, s.freezesLeft, s.freezeWeek, now],
  );
}

export async function getStreakView(db: Db, userId: string, today: string): Promise<Streak> {
  return streakView(await loadStreak(db, userId), today);
}

/** Name shown on the leaderboard for users who haven't picked one. */
export function fallbackDisplayName(userId: string): string {
  return `Player ${userId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}
