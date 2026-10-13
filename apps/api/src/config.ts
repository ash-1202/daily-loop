import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the repo-root .env when present (from src/ under tsx, or dist/ after a build).
// In production, variables come from the host instead.
dotenv.config({
  path: ['../../../.env', '../../.env'].map((p) => fileURLToPath(new URL(p, import.meta.url))),
  quiet: true,
});

const port = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // API_PORT wins so a PORT meant for another process (e.g. the Vite dev server) is not picked up.
  // Hosts such as Render only set PORT, which is the fallback.
  API_PORT: port.optional(),
  PORT: port.optional(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Production only: folder with the built web app, served by the API so web and /api share one
  // domain. Unset in development, where Vite serves the web app.
  STATIC_DIR: z.string().optional(),
  // Set when running behind a reverse proxy (Caddy), so request IPs and protocol come from it.
  TRUST_PROXY: z.stringbool().default(false),
  // The git commit this build came from (set at docker build time); shown by /api/health so a
  // deploy can confirm the new version is live.
  APP_VERSION: z.string().default('dev'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables. Copy .env.example to .env and check the values.');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

const { API_PORT, PORT, ...rest } = parsed.data;

export const config = { ...rest, PORT: API_PORT ?? PORT ?? 3000 };
