// Imported by integration tests that need a real TEST_DATABASE_URL (a database
// separate from DATABASE_URL, so tests never collide with real onboarded data — see
// .env.example). Loads the repo root .env (CWD when `npm test` runs) via Node's
// built-in loader. Safe to import even when no .env exists (e.g. CI without local
// secrets) — those tests will then skip, which is the expected signal that
// TEST_DATABASE_URL isn't configured.
try {
  process.loadEnvFile();
} catch {
  // no .env file present — nothing to do.
}
