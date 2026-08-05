import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the full-flow E2E spec (Task 20).
 *
 * This suite has never been run against a live stack. Two blockers outside
 * this task's scope prevent it:
 *
 *   1. `app/auth.py` verifies HS256 against a shared secret, but the live
 *      Supabase project signs user access tokens with ES256 published via
 *      JWKS. Every real login is rejected with a generic 401 until that is
 *      fixed.
 *   2. No `DATABASE_URL` password exists for the Supabase Postgres
 *      instance, so the backend cannot reach the database at all.
 *
 * `webServer` is configured so a human with working credentials can run
 * `npx playwright test` directly once both blockers are resolved, but no
 * command in this task invoked it -- only `npx playwright test --list`,
 * which parses and collects the spec without starting a browser or server.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
