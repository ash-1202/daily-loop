import { createHash } from 'node:crypto';

/**
 * Shuffles a copy of `items` in a way that depends only on `seed`.
 * Used for answer options: everyone sees the same order for a card on a given day, and
 * reloading the page doesn't reshuffle, but the correct answer isn't always in the same place.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const digest = createHash('sha256').update(seed).digest();
  const result = [...items];
  // Fisher–Yates, taking one byte of the hash per swap (plenty for lists of 2–4 options).
  for (let i = result.length - 1; i > 0; i--) {
    const j = digest[i % digest.length]! % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
