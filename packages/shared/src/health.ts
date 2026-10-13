import { z } from 'zod/mini';

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal('daily-loop-api'),
  db: z.enum(['up', 'down']),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
