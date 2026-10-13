import cookie from '@fastify/cookie';
import Fastify, { type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { config } from './config';
import { HttpError } from './lib/http-error';
import { healthRoutes } from './routes/health';
import { leaderboardRoutes } from './routes/leaderboard';
import { meRoutes } from './routes/me';
import { sessionRoutes } from './routes/session';
import { submissionRoutes } from './routes/submissions';
import { todayRoutes } from './routes/today';
import { userIdForSession } from './services/sessions';

/** What the app needs from the outside world. Tests pass a test database and a fake clock. */
export interface AppDeps {
  pool: pg.Pool;
  /** Current time. Every date and timestamp in the app comes from here. */
  clock: () => Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
  interface FastifyRequest {
    /** Set when the request carries a valid session cookie. */
    userId: string | null;
  }
}

export const SESSION_COOKIE = 'dl_session';

/** Returns the signed-in user's id, or throws 401. */
export function requireUser(req: FastifyRequest): string {
  if (!req.userId) throw new HttpError(401, 'not_signed_in', 'Start a session first.');
  return req.userId;
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'silent' : 'info' },
  });

  app.decorate('deps', deps);
  app.decorateRequest('userId', null);
  app.register(cookie);

  // Resolve the session cookie (if any) to a user before every handler.
  app.addHook('preHandler', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.userId = token ? await userIdForSession(deps.pool, token, deps.clock()) : null;
  });

  // One error format for every failure: { error: { code, message } }.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      // Fastify's own client errors, e.g. malformed JSON or wrong content type.
      return reply
        .status(status)
        .send({ error: { code: 'bad_request', message: (err as Error).message } });
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
  });

  app.register(healthRoutes);
  app.register(sessionRoutes);
  app.register(todayRoutes);
  app.register(submissionRoutes);
  app.register(meRoutes);
  app.register(leaderboardRoutes);

  return app;
}
