import Fastify from 'fastify';
import { config } from './config';
import { healthRoutes } from './routes/health';

export function buildApp() {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'silent' : 'info' },
  });

  app.register(healthRoutes);

  return app;
}
