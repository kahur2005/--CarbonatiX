import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// `@testing-library/react`'s automatic afterEach-cleanup only registers
// itself when it detects a *global* `afterEach` (i.e. `test.globals: true`
// in the vitest config). This project imports test globals explicitly
// instead, so that auto-detection never fires -- without this, a DOM tree
// rendered by one test is still mounted when the next test's `render()`
// runs, and an unscoped `document.querySelector`/`screen` query in the
// second test can silently match the first test's leftover nodes.
afterEach(() => {
  cleanup();
});
