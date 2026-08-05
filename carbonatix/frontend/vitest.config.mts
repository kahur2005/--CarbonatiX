import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `jsdom` (not `node`) so component tests (render, fireEvent, userEvent) work
// project-wide -- see `vitest.setup.ts` for the matcher extension this
// environment pairs with. Pure-helper tests (lib/units.test.ts,
// lib/onboarding.test.ts) run unaffected: they touch no DOM API and jsdom is
// a strict superset of the node globals they already relied on.
//
// `resolve.tsconfigPaths` resolves the `@/*` alias from tsconfig.json at
// test time. It was never needed before this task: every prior runtime
// `@/...` import in a tested file was `import type`-only, which esbuild
// elides before module resolution runs. Task 17's components use
// `@/lib/api` etc. as real (non-type) imports, so resolution has to
// actually happen.
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Task 20's Playwright suite lives in e2e/ and matches vitest's default
    // *.spec.ts glob. It must never run under vitest -- it uses Playwright's
    // own `test`/`expect`, not this project's jsdom-based unit test setup.
    exclude: ["**/node_modules/**", "e2e/**"],
  },
});
