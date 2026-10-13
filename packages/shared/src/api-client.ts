import {
  apiErrorSchema,
  leaderboardResponseSchema,
  meResponseSchema,
  sessionResponseSchema,
  submitResponseSchema,
  todayResponseSchema,
  type LeaderboardResponse,
  type MeResponse,
  type SessionRequest,
  type SessionResponse,
  type SubmitRequest,
  type SubmitResponse,
  type TodayResponse,
  type UpdateMeRequest,
} from './api';
import { healthResponseSchema, type HealthResponse } from './health';

/** An error response from the API, with its HTTP status and machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Typed client for the daily-loop API. Uses only `fetch`, so the same code runs in the
 * browser, in Node and in React Native. Every response is validated against the shared schemas.
 *
 * @param baseUrl API origin, e.g. '' (same origin, web) or 'https://api.example.com' (mobile).
 */
export function createApiClient(baseUrl = '') {
  /** `okStatuses` lists non-2xx statuses whose body is still a valid, typed response. */
  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    parse: (data: unknown) => T,
    body?: unknown,
    okStatuses: number[] = [],
  ): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok && !okStatuses.includes(res.status)) {
      const parsed = apiErrorSchema.safeParse(data);
      throw parsed.success
        ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message)
        : new ApiError(res.status, 'http_error', `${method} ${path} failed with ${res.status}`);
    }
    return parse(data);
  }

  return {
    // 503 still carries a health body (e.g. API up, database down).
    health: (): Promise<HealthResponse> =>
      request('GET', '/api/health', (d) => healthResponseSchema.parse(d), undefined, [503]),

    createSession: (body: SessionRequest): Promise<SessionResponse> =>
      request('POST', '/api/session', (d) => sessionResponseSchema.parse(d), body),

    today: (): Promise<TodayResponse> =>
      request('GET', '/api/today', (d) => todayResponseSchema.parse(d)),

    submit: (body: SubmitRequest): Promise<SubmitResponse> =>
      request('POST', '/api/submissions', (d) => submitResponseSchema.parse(d), body),

    me: (): Promise<MeResponse> => request('GET', '/api/me', (d) => meResponseSchema.parse(d)),

    updateMe: (body: UpdateMeRequest): Promise<MeResponse> =>
      request('PATCH', '/api/me', (d) => meResponseSchema.parse(d), body),

    leaderboard: (): Promise<LeaderboardResponse> =>
      request('GET', '/api/leaderboard', (d) => leaderboardResponseSchema.parse(d)),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
