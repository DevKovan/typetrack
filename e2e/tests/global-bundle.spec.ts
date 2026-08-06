import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Targets tsup.config.ts's third build entry -- the bundled browser global
// build (`dist/index.global.js`, `globalName: "Typetrack"`, IIFE, no build
// tooling required by the consuming page). Nothing else in this repo's test
// suite loads that artifact in an actual browser and confirms it works --
// see plan/phase-16-testing-infrastructure/BRIEF.md's research-grounding
// section.

test("loads the real built IIFE bundle and dispatches a real browser request via createAnalytics()", async ({
  page,
  request,
}) => {
  await page.goto("/global-bundle.html");

  // Confirm the actual `<script src="/dist/index.global.js">` tag loaded
  // and evaluated -- `window.Typetrack` is the `globalName` tsup.config.ts
  // configures for this build, and `createAnalytics` is this package's
  // primary export.
  const globalShape = await page.evaluate(() => {
    const typetrack = (window as unknown as { Typetrack?: { createAnalytics?: unknown } }).Typetrack;
    return {
      hasTypetrack: typeof typetrack !== "undefined",
      hasCreateAnalytics: typeof typetrack?.createAnalytics === "function",
    };
  });
  expect(globalShape.hasTypetrack).toBe(true);
  expect(globalShape.hasCreateAnalytics).toBe(true);

  const requestId = randomUUID();

  // Construct a real `Analytics` instance *inside the page*, with a custom
  // provider whose `track()` makes a real, same-origin, browser-dispatched
  // `fetch()` call this test can observe from the Node-side Playwright
  // `request` context (server.ts's `/log` endpoint).
  await page.evaluate(async (currentRequestId) => {
    const { createAnalytics } = (
      window as unknown as {
        Typetrack: { createAnalytics: (options: unknown) => { track: (name: string, payload: unknown) => unknown } };
      }
    ).Typetrack;

    const analytics = createAnalytics({
      provider: {
        name: "e2e-fixture-provider",
        capabilities: {
          identify: false,
          group: false,
          alias: false,
          page: false,
          screen: false,
          batching: false,
          offline: false,
          featureFlags: false,
          sessionReplay: false,
          heatmaps: false,
        },
        async track(event: { name: string; properties: Record<string, unknown> }) {
          await fetch("/log?kind=track", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ requestId: currentRequestId, name: event.name, properties: event.properties }),
          });
        },
      },
    });

    await analytics.track("checkout_completed", { amount: 42, currency: "usd" });
  }, requestId);

  await expect
    .poll(async () => {
      const res = await request.get(`/log?kind=track&requestId=${requestId}`);
      const entries = (await res.json()) as unknown[];
      return entries.length;
    })
    .toBeGreaterThan(0);

  const res = await request.get(`/log?kind=track&requestId=${requestId}`);
  const entries = (await res.json()) as Array<{
    kind: string;
    body: { requestId: string; name: string; properties: { amount: number; currency: string } };
  }>;

  expect(entries).toHaveLength(1);
  expect(entries[0]!.kind).toBe("track");
  expect(entries[0]!.body.name).toBe("checkout_completed");
  expect(entries[0]!.body.properties).toEqual({ amount: 42, currency: "usd" });
});
