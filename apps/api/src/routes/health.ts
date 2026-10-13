import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@daily-loop/shared';
import { config } from '../config';
import { isDbUp } from '../lib/db-utils';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply): Promise<HealthResponse> => {
    const dbUp = await isDbUp(app.deps.pool);
    reply.code(dbUp ? 200 : 503);
    return {
      ok: dbUp,
      service: 'daily-loop-api',
      db: dbUp ? 'up' : 'down',
      time: app.deps.clock().toISOString(),
      version: config.APP_VERSION,
    };
  });
}
