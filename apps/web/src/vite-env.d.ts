/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for production builds hosted separately from the API. Empty = same origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
