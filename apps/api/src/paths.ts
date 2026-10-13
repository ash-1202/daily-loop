import { fileURLToPath } from 'node:url';

// apps/api/src/paths.ts → repository root is three levels up.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Absolute path to a file or folder, given relative to the repository root. */
export function repoPath(relative: string): string {
  return `${repoRoot}${relative}`;
}
