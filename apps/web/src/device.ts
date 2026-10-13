// Random IDs and the device token that identifies this phone's guest account.

/**
 * A random, URL-safe ID. Uses crypto.getRandomValues, which (unlike crypto.randomUUID) also works
 * on plain http:// pages, e.g. when testing on a phone over the local network.
 */
export function randomId(bytes = 16): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const DEVICE_KEY = 'dl_device_token';
let memoryToken: string | null = null;

/**
 * The device token, created once and kept in localStorage. If storage is unavailable (private mode,
 * blocked site data), a token is kept in memory for this visit; the session cookie still works.
 */
export function getDeviceToken(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const token = randomId(32);
    localStorage.setItem(DEVICE_KEY, token);
    return token;
  } catch {
    memoryToken ??= randomId(32);
    return memoryToken;
  }
}
