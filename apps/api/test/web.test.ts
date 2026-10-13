import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createTestPool } from './test-db';

// Production mode: the API also serves the built web app from STATIC_DIR.

let pool: pg.Pool;
let dir: string;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  pool = createTestPool();
  dir = mkdtempSync(join(tmpdir(), 'daily-loop-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Market Daily 5</title>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  app = buildApp({ pool, clock: () => new Date(), staticDir: dir });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  rmSync(dir, { recursive: true, force: true });
});

describe('serving the web app', () => {
  it('serves index.html at / and never lets it be cached', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Market Daily 5');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('caches hashed assets for a year', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('does not cache other files such as the manifest', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('returns index.html for unknown app paths (single-page app)', async () => {
    const res = await app.inject({ method: 'GET', url: '/leaders' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Market Daily 5');
  });

  it('keeps unknown API paths and non-GET requests as JSON 404s', async () => {
    for (const req of [
      { method: 'GET' as const, url: '/api/nope' },
      { method: 'POST' as const, url: '/somewhere' },
    ]) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    }
  });

  it('still answers the API, including the build version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: 'up', version: 'dev' });
  });

  it('refuses to start without an index.html', () => {
    expect(() =>
      buildApp({ pool, clock: () => new Date(), staticDir: tmpdir() + '/missing' }),
    ).toThrow(/no index.html/);
  });
});
