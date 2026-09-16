/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set at build time for a deployed (non-local-dev) build — see api/client.ts.
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
