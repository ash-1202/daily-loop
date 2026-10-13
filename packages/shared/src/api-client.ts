import { healthResponseSchema, type HealthResponse } from './health';

/**
 * Typed client for the daily-loop API. Uses only `fetch`, so the same code runs in the
 * browser, in Node and in React Native.
 *
 * @param baseUrl API origin, e.g. '' (same origin, web) or 'https://api.example.com' (mobile).
 */
export function createApiClient(baseUrl = '') {
  /** `okStatuses` lists non-2xx statuses whose body is still a valid, typed response. */
  async function get<T>(
    path: string,
    parse: (data: unknown) => T,
    okStatuses: number[] = [],
  ): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { credentials: 'include' });
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new Error(`GET ${path} failed with ${res.status}`);
    }
    return parse(await res.json());
  }

  return {
    // 503 still carries a health body (e.g. API up, database down).
    health: (): Promise<HealthResponse> =>
      get('/api/health', (data) => healthResponseSchema.parse(data), [503]),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
