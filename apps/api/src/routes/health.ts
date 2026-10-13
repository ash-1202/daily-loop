import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@daily-loop/shared';
import { isDbUp } from '../db';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply): Promise<HealthResponse> => {
    const dbUp = await isDbUp();
    reply.code(dbUp ? 200 : 503);
    return {
      ok: dbUp,
      service: 'daily-loop-api',
      db: dbUp ? 'up' : 'down',
      time: new Date().toISOString(),
    };
  });
}
