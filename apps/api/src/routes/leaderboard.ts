import type { FastifyInstance } from 'fastify';
import {
  addDays,
  istDate,
  istDayStart,
  weekStart,
  type LeaderboardResponse,
} from '@daily-loop/shared';
import { requireUser } from '../app';
import { fallbackDisplayName } from '../services/users';

export const LEADERBOARD_SIZE = 10;

export async function leaderboardRoutes(app: FastifyInstance) {
  /** This week's (Monday to Sunday, IST) top players by points, plus the caller's own rank. */
  app.get('/api/leaderboard', async (req): Promise<LeaderboardResponse> => {
    const userId = requireUser(req);
    const { pool, clock } = app.deps;
    const week = weekStart(istDate(clock()));

    const { rows } = await pool.query<{
      user_id: string;
      display_name: string | null;
      points: number;
      rank: number;
    }>(
      `WITH weekly AS (
         SELECT user_id, sum(delta)::int AS points
         FROM points_ledger
         WHERE created_at >= $1 AND created_at < $2
         GROUP BY user_id
       ), ranked AS (
         SELECT w.user_id, u.display_name, w.points,
                rank() OVER (ORDER BY w.points DESC)::int AS rank
         FROM weekly w JOIN users u ON u.id = w.user_id
       )
       SELECT * FROM ranked
       WHERE rank <= $3 OR user_id = $4
       ORDER BY rank, user_id`,
      [istDayStart(week), istDayStart(addDays(week, 7)), LEADERBOARD_SIZE, userId],
    );

    const mine = rows.find((r) => r.user_id === userId);
    return {
      weekStart: week,
      entries: rows
        .filter((r) => r.rank <= LEADERBOARD_SIZE)
        .map((r) => ({
          rank: r.rank,
          displayName: r.display_name ?? fallbackDisplayName(r.user_id),
          points: r.points,
          isMe: r.user_id === userId,
        })),
      me: { rank: mine?.rank ?? null, points: mine?.points ?? 0 },
    };
  });
}
