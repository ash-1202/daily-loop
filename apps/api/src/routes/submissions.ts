import type { FastifyInstance } from 'fastify';
import { submitRequestSchema, type SubmitResponse } from '@daily-loop/shared';
import { requireUser } from '../app';
import { parseBody } from '../lib/http-error';
import { submitAnswer } from '../services/submissions';

export async function submissionRoutes(app: FastifyInstance) {
  /** Answer one card. Scoring and rewards happen here, on the server, never in the app. */
  app.post('/api/submissions', async (req): Promise<SubmitResponse> => {
    const userId = requireUser(req);
    const body = parseBody(submitRequestSchema, req.body);
    return submitAnswer(app.deps.pool, userId, body, app.deps.clock());
  });
}
