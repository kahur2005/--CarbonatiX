import { expect, test } from "@playwright/test";

/**
 * Task 20 end-to-end spec: register -> onboarding -> twin -> dashboard ->
 * recommendation, plus the power-mix validation gate on the twin's commit
 * button.
 *
 * STATUS: WRITTEN, NEVER EXECUTED. This file has been verified to compile
 * (`npx tsc --noEmit`) and to be collectible by the Playwright test runner
 * (`npx playwright test --list`), but it has not been run against a live
 * stack, and it cannot be made to pass right now. Two blockers exist, both
 * outside this task's scope and both deferred by the human:
 *
 *   1. `app/auth.py` verifies access tokens as HS256 against a shared
 *      secret. The live Supabase project
 *      (https://rmofwjqqwxkmjbirqyvt.supabase.co) signs user access tokens
 *      with ES256, published via JWKS at
 *      `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Every genuine
 *      login is therefore rejected by the backend with a generic 401 --
 *      register("register through recommendation") would fail the moment
 *      it tries to call an authenticated endpoint (`PUT /company`).
 *   2. No `DATABASE_URL` password exists for that project's Postgres
 *      instance, so even if auth were fixed, the backend could not persist
 *      or read the company/run rows this flow depends on.
 *
 * Do not add a `test.skip`, a mock of the backend, or a relaxed assertion
 * to force a green run here. A passing E2E suite that doesn't exercise the
 * real system would hide exactly the failure this suite exists to catch.
 *
 * Once both blockers are resolved, running this suite for real also
 * requires:
 *   - `carbonatix/frontend/.env.local` with a working
 *     `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` pair and
 *     `NEXT_PUBLIC_API_URL` pointing at a running backend.
 *   - The backend itself running (`uvicorn app.main:app`) with a reachable
 *     `DATABASE_URL` and a valid Claude API key for the recommendation
 *     pipeline.
 *   - For the second test only: a pre-existing confirmed Supabase user
 *     with a completed company profile (onboarding already run once for
 *     that account), since Supabase's email-confirmation flow cannot be
 *     driven by a fresh `signUp` call inside the test itself. Provide its
 *     credentials via `E2E_EXISTING_USER_EMAIL` / `E2E_EXISTING_USER_PASSWORD`.
 *
 * Selectors below were taken from the real DOM (not guessed): onboarding's
 * inputs are `id`-only with no `name` attribute, so they are targeted by
 * id; the twin's operational fields are targeted by their real
 * `twin-<field>` ids from `components/twin/NodePanel.tsx`; the twin's
 * process-stage meshes are R3F/`three.js` canvas objects with no DOM
 * presence of their own, so they are clicked via the `Html`-overlay labels
 * `data-testid="node-label-<node>"` from `components/twin/Scene.tsx`,
 * which is what actually receives the click in the running app.
 */

test.describe.configure({ mode: "serial" });

test("register through recommendation", async ({ page }) => {
  const email = `demo+${Date.now()}@example.com`;
  const password = "demo-password-123";

  // --- Register -----------------------------------------------------
  await page.goto("/register");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/onboarding/);

  // --- Onboarding: site specification --------------------------------
  await page.fill("#name", "PT Demo Smelter");
  await page.fill("#technology", "RKEF");
  await page.fill("#efCaptivePltu", "1.0");
  await page.fill("#dryerThermalEfficiency", "55");
  await page.fill("#secEafKwhPerTAlloy", "2400");
  await page.fill("#alloyNickelGrade", "10");
  await page.fill("#kilnThermalEfficiency", "55");
  // Matches the demo operating point recorded in docs/DEMO_FIGURES.md:
  // 10,000 t wet ore at this site spec totals ~7,460.86 tCO2e, so 7,600
  // leaves it compliant with headroom to demonstrate a clean commit.
  await page.fill("#capTco2e", "7600");
  await page.click('button:has-text("Simpan dan lanjutkan")');

  await expect(page).toHaveURL(/\/twin/);

  // --- Twin: stockpile node (ore input) ------------------------------
  await page.click('[data-testid="node-label-stockpile"]');
  await page.fill("#twin-wetOreInputTons", "10000");
  await page.fill("#twin-moistureContentPercent", "32");
  await page.fill("#twin-nickelGradePercent", "1.8");

  // --- Twin: kiln node (reductant) ------------------------------------
  await page.click('[data-testid="node-label-kiln"]');
  await page.fill("#twin-reductantBiocokePercent", "0");

  // --- Twin: pltu node (power mix) ------------------------------------
  await page.click('[data-testid="node-label-pltu"]');
  await page.fill("#twin-powerMixCaptiveCoalPercent", "100");
  await page.fill("#twin-powerMixHydroGridPercent", "0");

  // Debounced live recompute (150ms, see app/twin/page.tsx) should
  // replace the placeholder "-- tCO2e" with a real figure.
  const totalEmissions = page.locator("footer p.font-mono");
  await expect(totalEmissions).not.toHaveText("-- tCO2e", { timeout: 10_000 });
  await expect(totalEmissions).toContainText("tCO2e");

  // --- Commit and follow to the dashboard -----------------------------
  await page.click('button:has-text("Simpan perhitungan")');
  await expect(page).toHaveURL(/\/dashboard/);

  // --- Dashboard: recommendation pipeline -----------------------------
  await expect(page.locator('[data-testid="node-retrieve"]')).toHaveAttribute(
    "data-status",
    "done",
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="recommendation-body"]')).not.toBeEmpty();
});

test("power mix that does not sum to 100 blocks commit", async ({ page }) => {
  const email = process.env.E2E_EXISTING_USER_EMAIL;
  const password = process.env.E2E_EXISTING_USER_PASSWORD;
  test.skip(
    !email || !password,
    "Requires E2E_EXISTING_USER_EMAIL / E2E_EXISTING_USER_PASSWORD for a " +
      "pre-seeded Supabase user with a completed onboarding profile -- see " +
      "the file-level comment for why a fresh signUp cannot stand in here.",
  );

  await page.goto("/login");
  await page.fill("#email", email!);
  await page.fill("#password", password!);
  await page.click('button[type="submit"]');

  // The login page always routes to /onboarding (app/(auth)/login/page.tsx);
  // an account with a completed profile is expected to bounce onward, but
  // either way /twin is reachable directly since the fixture account's
  // company profile already exists server-side.
  await page.goto("/twin");
  await expect(page).toHaveURL(/\/twin/);

  await page.click('[data-testid="node-label-pltu"]');
  await page.fill("#twin-powerMixCaptiveCoalPercent", "60");
  await page.fill("#twin-powerMixHydroGridPercent", "25");

  await expect(page.locator('button:has-text("Simpan perhitungan")')).toBeDisabled();
  await expect(page.getByText("harus berjumlah 100%")).toBeVisible();
});
