import type { FastifyInstance } from 'fastify';
import { sessionRequestSchema, type SessionResponse } from '@daily-loop/shared';
import { SESSION_COOKIE } from '../app';
import { config } from '../config';
import { parseBody } from '../lib/http-error';
import { SESSION_TTL_DAYS, startSession } from '../services/sessions';
import { getUser } from '../services/users';

export async function sessionRoutes(app: FastifyInstance) {
  /** Called when the app starts: finds or creates the guest user for this device. */
  app.post('/api/session', async (req, reply): Promise<SessionResponse> => {
    const { deviceToken } = parseBody(sessionRequestSchema, req.body);
    const { pool, clock } = app.deps;
    const result = await startSession(pool, deviceToken, req.userId, clock());

    if (result.sessionToken) {
      reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true, // not readable from JavaScript, so an XSS bug can't steal it
        secure: config.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_DAYS * 86_400,
      });
    }
    if (result.isNew) reply.code(201);
    return { user: await getUser(pool, result.userId), isNew: result.isNew };
  });
}
