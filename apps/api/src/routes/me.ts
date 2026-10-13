import type { FastifyInstance } from 'fastify';
import { istDate, updateMeRequestSchema, type MeResponse } from '@daily-loop/shared';
import { requireUser } from '../app';
import { parseBody } from '../lib/http-error';
import { listBadges } from '../services/badges';
import { getStreakView, getUser, totalPoints } from '../services/users';

export async function meRoutes(app: FastifyInstance) {
  const loadMe = async (userId: string): Promise<MeResponse> => {
    const { pool, clock } = app.deps;
    const today = istDate(clock());
    const [user, points, streak, badges] = await Promise.all([
      getUser(pool, userId),
      totalPoints(pool, userId),
      getStreakView(pool, userId, today),
      listBadges(pool, userId),
    ]);
    return { user, points, streak, badges };
  };

  /** Points balance, streak and badges. */
  app.get('/api/me', async (req) => loadMe(requireUser(req)));

  /** Set the name shown on the leaderboard. */
  app.patch('/api/me', async (req) => {
    const userId = requireUser(req);
    const { displayName } = parseBody(updateMeRequestSchema, req.body);
    await app.deps.pool.query('UPDATE users SET display_name = $2 WHERE id = $1', [
      userId,
      displayName,
    ]);
    return loadMe(userId);
  });
}
