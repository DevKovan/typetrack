import { defineConfig, devices } from "@playwright/test";

// Hand-written, not generated via `create-playwright`/`npm init playwright`
// -- that scaffold hardcodes `npm` internally regardless of the invoking
// package manager (confirmed via microsoft/playwright#29301), a real
// friction point in this Bun-workspace monorepo. See
// plan/phase-16-testing-infrastructure/BRIEF.md's research-grounding
// section.
//
// `bun run build` (repo root) must have already produced
// `dist/index.global.js` before running these specs -- see this package's
// own README.md.
const PORT = 4319;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // Chromium only -- plan/phase-16-testing-infrastructure/BRIEF.md Design
  // decision 5: both of this package's real targets (`sendBeacon`/
  // `pagehide`, and a `<script>`-tag IIFE load) are standard, non-engine-
  // specific web platform behavior with no known cross-engine divergence
  // relevant to what's being tested here.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Playwright-managed lifecycle (started before the suite, stopped after)
  // -- see `server.ts`'s header comment for what it serves (fixture HTML +
  // the real built `dist/index.global.js`, plus a tiny request log the
  // specs poll via `request`/`page.request`).
  webServer: {
    command: "bun run server.ts",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
