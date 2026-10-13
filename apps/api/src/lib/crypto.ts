import { createHash, randomBytes } from 'node:crypto';

/** A random, URL-safe token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens (session cookies, device tokens) are stored only as SHA-256 hashes, so a leaked
 * database does not leak working tokens. A fast hash is fine here because the tokens are long
 * and random, not guessable passwords.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
