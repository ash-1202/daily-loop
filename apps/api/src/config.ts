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
  // Email login (OTP). 'console' prints codes to the log (development); 'resend' sends real email;
  // 'none' hides the feature. Default: console in development, none in production.
  EMAIL_PROVIDER: z.enum(['console', 'resend', 'none']).optional(),
  RESEND_API_KEY: z.string().min(10).optional(),
  EMAIL_FROM: z.string().default('Market Daily 5 <no-reply@mail.tradertrix.com>'),
  // Key for hashing OTP codes (HMAC), so a database leak doesn't expose usable codes.
  OTP_SECRET: z.string().min(32).optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables. Copy .env.example to .env and check the values.');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

const { API_PORT, PORT, EMAIL_PROVIDER, OTP_SECRET, ...rest } = parsed.data;
const isProduction = rest.NODE_ENV === 'production';
const emailProvider = EMAIL_PROVIDER ?? (isProduction ? 'none' : 'console');

if (emailProvider === 'resend' && !rest.RESEND_API_KEY) {
  console.error('EMAIL_PROVIDER=resend needs RESEND_API_KEY.');
  process.exit(1);
}
if (emailProvider !== 'none' && isProduction && !OTP_SECRET) {
  console.error('Email login in production needs OTP_SECRET (32+ random characters).');
  process.exit(1);
}

export const config = {
  ...rest,
  PORT: API_PORT ?? PORT ?? 3000,
  EMAIL_PROVIDER: emailProvider,
  // A fixed key is fine outside production: codes there are printed to the console anyway.
  OTP_SECRET: OTP_SECRET ?? 'development-only-otp-secret-not-for-production',
};
