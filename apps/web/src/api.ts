import { createApiClient } from '@daily-loop/shared';

// Empty base URL = same origin. In development Vite proxies /api to the API server.
export const api = createApiClient(import.meta.env.VITE_API_URL ?? '');
