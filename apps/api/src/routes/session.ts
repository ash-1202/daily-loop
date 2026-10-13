import type { FastifyInstance } from 'fastify';
import { sessionRequestSchema, type SessionResponse } from '@daily-loop/shared';
import { setSessionCookie } from '../app';
import { parseBody } from '../lib/http-error';
import { startSession } from '../services/sessions';
import { getUser } from '../services/users';

export async function sessionRoutes(app: FastifyInstance) {
  /** Called when the app starts: finds or creates the guest user for this device. */
  app.post('/api/session', async (req, reply): Promise<SessionResponse> => {
    const { deviceToken } = parseBody(sessionRequestSchema, req.body);
    const { pool, clock } = app.deps;
    const result = await startSession(pool, deviceToken, req.userId, clock());

    if (result.sessionToken) setSessionCookie(reply, result.sessionToken);
    if (result.isNew) reply.code(201);
    return { user: await getUser(pool, result.userId), isNew: result.isNew };
  });
}
