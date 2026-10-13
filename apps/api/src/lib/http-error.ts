import { z } from 'zod/mini';

/** An error with an HTTP status and a stable code the client can react to. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Validates a request body against a shared schema, or throws a 400 with a readable message. */
export function parseBody<T>(schema: z.ZodMiniType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_request', z.prettifyError(parsed.error));
  }
  return parsed.data;
}
