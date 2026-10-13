import { defineConfig } from 'tsup';

export default defineConfig({
  // Flat output (dist/server.js, dist/migrate.js, dist/seed.js) keeps every file at the same depth,
  // so paths relative to the repo root (repoPath, the .env lookup) work the same as in src/.
  entry: {
    server: 'src/server.ts',
    migrate: 'src/scripts/migrate.ts',
    seed: 'src/scripts/seed.ts',
    generate: 'src/scripts/generate.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  // packages/shared ships TypeScript source, so bundle it into the API build.
  noExternal: ['@daily-loop/shared'],
});
