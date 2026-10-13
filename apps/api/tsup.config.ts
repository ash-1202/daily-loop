import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  // packages/shared ships TypeScript source, so bundle it into the API build.
  noExternal: ['@daily-loop/shared'],
});
