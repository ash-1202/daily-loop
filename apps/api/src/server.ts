import { config } from './config';
import { pool } from './db';
import { buildApp } from './app';
import { ConsoleEmailSender, ResendEmailSender, type EmailSender } from './email/sender';

function emailSender(): EmailSender | null {
  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailSender(config.RESEND_API_KEY!, config.EMAIL_FROM);
    case 'console':
      return new ConsoleEmailSender();
    case 'none':
      return null;
  }
}

const app = buildApp({
  pool,
  clock: () => new Date(),
  staticDir: config.STATIC_DIR,
  email: emailSender(),
});
app.log.info(`email login: ${config.EMAIL_PROVIDER}`);

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
