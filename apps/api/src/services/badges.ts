import { badgeRuleSchema, CARDS_PER_DAY, type Badge, type BadgeRule } from '@daily-loop/shared';
import type { Db } from '../lib/db-utils';

interface BadgeRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  rule: unknown;
  awarded_at: Date | null;
}

export interface BadgeStats {
  challengesCompleted: number;
  correctByType: Record<string, number>;
  currentStreak: number;
}

/** Whether a badge's rule is met. Unknown rule shapes never award (safe default). */
export function ruleMet(rule: unknown, stats: BadgeStats): boolean {
  const parsed = badgeRuleSchema.safeParse(rule);
  if (!parsed.success) return false;
  const r: BadgeRule = parsed.data;
  switch (r.type) {
    case 'challenges_completed':
      return stats.challengesCompleted >= r.count;
    case 'correct_count':
      return (stats.correctByType[r.task_type] ?? 0) >= r.count;
    case 'streak':
      return stats.currentStreak >= r.days;
  }
}

function toBadge(row: BadgeRow): Badge {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    awardedAt: row.awarded_at ? row.awarded_at.toISOString() : null,
  };
}

/** All badges, with when (or whether) this user earned each. */
export async function listBadges(db: Db, userId: string): Promise<Badge[]> {
  const { rows } = await db.query<BadgeRow>(
    `SELECT b.id, b.name, b.description, b.icon, b.rule, ub.awarded_at
     FROM badges b
     LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
     ORDER BY b.sort_order, b.id`,
    [userId],
  );
  return rows.map(toBadge);
}

async function loadStats(db: Db, userId: string, currentStreak: number): Promise<BadgeStats> {
  const { rows: typeRows } = await db.query<{ type: string; n: number }>(
    `SELECT t.type, count(*)::int AS n
     FROM submissions s JOIN tasks t ON t.id = s.task_id
     WHERE s.user_id = $1 AND s.is_correct
     GROUP BY t.type`,
    [userId],
  );
  const { rows: completedRows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (
       SELECT challenge_date FROM submissions WHERE user_id = $1
       GROUP BY challenge_date HAVING count(*) = $2
     ) days`,
    [userId, CARDS_PER_DAY],
  );
  return {
    challengesCompleted: completedRows[0]!.n,
    correctByType: Object.fromEntries(typeRows.map((r) => [r.type, r.n])),
    currentStreak,
  };
}

/** Awards every badge whose rule is now met and returns the newly earned ones. */
export async function awardBadges(
  db: Db,
  userId: string,
  currentStreak: number,
  now: Date,
): Promise<Badge[]> {
  const { rows: unearned } = await db.query<BadgeRow>(
    `SELECT b.id, b.name, b.description, b.icon, b.rule, NULL::timestamptz AS awarded_at
     FROM badges b
     WHERE NOT EXISTS (SELECT 1 FROM user_badges ub WHERE ub.badge_id = b.id AND ub.user_id = $1)
     ORDER BY b.sort_order, b.id`,
    [userId],
  );
  if (unearned.length === 0) return [];

  const stats = await loadStats(db, userId, currentStreak);
  const earned: Badge[] = [];
  for (const badge of unearned) {
    if (!ruleMet(badge.rule, stats)) continue;
    const { rowCount } = await db.query(
      `INSERT INTO user_badges (user_id, badge_id, awarded_at) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, badge.id, now],
    );
    if (rowCount) earned.push(toBadge({ ...badge, awarded_at: now }));
  }
  return earned;
}
