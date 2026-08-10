// Shared Playwright helpers for the cross-library comparison specs (issues
// 004-005). Factored out of `cold-start-memory.spec.ts` (issue 004's
// original home for this logic) once `throughput.spec.ts` (issue 005)
// needed the exact same "navigate to a fixture, wait for its own real ready
// callback/promise to fire" step -- kept here so neither spec file
// duplicates it (issue 005's acceptance criteria calls this out explicitly).

import type { Page } from "@playwright/test";

// Not exported -- only used as this module's own default `timeoutMs`
// below; both specs call `gotoFixtureAndWaitForReady()` without overriding
// it, so there's no real caller for a standalone export (confirmed by knip
// flagging it as an unused export when it was exported).
const READY_TIMEOUT_MS = 15_000;

// The same four fixtures both specs measure -- typetrack plus the three
// vendor SDKs, see `../fixtures/*.html`.
export const FIXTURES = ["typetrack", "posthog", "segment", "rudderstack"] as const;

export type FixtureName = (typeof FIXTURES)[number];

declare global {
  interface Window {
    __ready?: boolean;
    __readyAt?: number;
  }
}

// Navigates to `/${fixture}.html` and waits for that fixture's own script to
// set `window.__ready = true` -- every fixture (issue 004) sets this at
// the exact moment its SDK's real init callback/promise fires, so this is
// the one, shared definition of "ready" both specs rely on.
export async function gotoFixtureAndWaitForReady(
  page: Page,
  fixture: FixtureName,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  await page.goto(`/${fixture}.html`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: timeoutMs });
}
