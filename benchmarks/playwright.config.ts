import { defineConfig, devices } from "@playwright/test";

// Mirrors `e2e/playwright.config.ts` exactly (Chromium only, hand-written
// rather than `create-playwright`-scaffolded, same `webServer.command`
// shape) -- see that file's own header comment for the reasoning this
// config doesn't repeat. Phase 19 issue 004
// (`plan/phase-19-performance-benchmarking/004-cross-library-cold-start-
// memory.md`).
//
// `bun run build` (repo root) must have already produced
// `dist/index.global.js` before running these specs -- `typetrack.html`
// loads it via `stub-server.ts`'s `/dist/*` route, same as `e2e/`'s own
// `global-bundle.html`.
const PORT = 4320;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // `--enable-precise-memory-info` is what makes
    // `performance.memory.usedJSHeapSize` return a real, non-quantized
    // number in Chromium instead of a coarse, rounded-for-fingerprinting
    // value -- see `tests/cold-start-memory.spec.ts`'s own header comment
    // for how this was confirmed by hand (with vs. without the flag) rather
    // than assumed.
    launchOptions: {
      args: ["--enable-precise-memory-info"],
    },
  },
  // Chromium only -- plan/phase-19-performance-benchmarking/BRIEF.md "Out of
  // scope" section: no known engine-specific divergence relevant to what's
  // measured here, and Firefox/WebKit don't expose an equivalent of
  // Chromium's `performance.memory`/CDP heap metrics this harness relies on
  // anyway.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Playwright-managed lifecycle, same shape as `e2e/playwright.config.ts`
  // -- see `stub-server.ts`'s own header comment for what it serves (the
  // four fixture HTML pages, typetrack's real built `dist/index.global.js`,
  // each vendor SDK's real installed browser bundle, and the vendor-specific
  // config-fetch stub routes issue 004 added).
  webServer: {
    command: "bun run stub-server.ts",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
