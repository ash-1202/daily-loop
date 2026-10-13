import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const notFoundBody = { error: { code: 'not_found', message: 'Not found.' } };

/**
 * Not-found handling for the whole app. With `staticDir` (production), also serves the built web
 * app, so the web app and /api share one domain: no CORS, and the session cookie stays a simple
 * first-party cookie.
 *
 * - Files under /assets have a content hash in their name, so they can be cached for a year.
 * - index.html must never be cached, or phones would keep loading an old version of the app.
 * - Unknown non-API GET paths return index.html (single-page app); unknown /api paths get JSON 404.
 *
 * Called on the root instance (not registered as a plugin), because Fastify scopes the not-found
 * handler to the plugin that sets it.
 */
export function setupWebAndNotFound(app: FastifyInstance, staticDir: string | undefined) {
  if (!staticDir) {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send(notFoundBody));
    return;
  }
  if (!existsSync(join(staticDir, 'index.html'))) {
    throw new Error(`STATIC_DIR has no index.html: ${staticDir}`);
  }

  app.register(fastifyStatic, {
    root: staticDir,
    wildcard: false, // one route per file at startup; unknown paths reach the not-found handler
    setHeaders(res, path) {
      const hashed = path.includes(`${sep}assets${sep}`);
      res.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/')) {
      return reply.status(404).send(notFoundBody);
    }
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
}
