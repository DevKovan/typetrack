import { afterEach, describe, expect, test } from "bun:test";
import { clearBrowserGlobals, runContextCaptureFlow } from "./index";

// Runs the example's actual entry-point logic (`runContextCaptureFlow`, the
// exact function `bun run index.ts` calls) end-to-end against a hand-written
// recording stub, so the asserted `CanonicalEvent.context` shapes below can
// never silently drift out of sync with what the README documents.
//
// No colocated `index.test.ts` (unit test) exists for this module: `index.ts`
// contains no non-trivial pure logic of its own beyond direct `typetrack` API
// calls, provider-stub construction, and global stubbing (the UTM query
// string passed to `stubBrowserGlobals` is a literal, not a constructed
// fixture worth isolating) -- per the issue's "Test requirements", a unit
// test is only warranted when there's non-trivial pure logic to cover, and
// there isn't any here. That same ground (the exact `context` shape
// produced, for both the browser-stubbed and plain-Node cases) is covered by
// this integration test instead.

// `runContextCaptureFlow` always ends by clearing browser globals (the
// "safe-no-op" scenario is the last thing it does), but this belt-and-suspenders
// cleanup keeps this file's assertions independent of any future reordering
// inside `index.ts`, and guarantees no stubbed globals leak into any other
// test file in the same `bun test` process.
afterEach(() => {
  clearBrowserGlobals();
});

describe("context-capture example", () => {
  test("a real page load in a stubbed browser produces the full auto-captured context shape", async () => {
    const { browserPageLoad } = await runContextCaptureFlow();

    expect(browserPageLoad.name).toBe("Home");
    const context = browserPageLoad.context as Record<string, unknown>;

    expect(typeof context.locale).toBe("string");
    expect((context.locale as string).length).toBeGreaterThan(0);
    expect(typeof context.timezone).toBe("string");
    expect((context.timezone as string).length).toBeGreaterThan(0);

    expect(context.browser).toEqual({ name: "Chrome", version: "124.0.0.0" });
    expect(context.os).toEqual({ name: "macOS", version: "10.15.7" });
    expect(context.device).toEqual({ type: "desktop" });
    expect(context.viewport).toEqual({ width: 1440, height: 900 });
    expect(context.referrer).toBe("https://www.google.com/search?q=typetrack+analytics");
    expect(context.campaign).toEqual({ source: "newsletter", medium: "email", campaign: "spring-sale" });

    expect(context.session).toMatchObject({ eventCount: 1 });
    const session = context.session as { startedAt: number; eventCount: number; durationMs: number };
    expect(typeof session.startedAt).toBe("number");
    expect(typeof session.durationMs).toBe("number");
    expect(session.durationMs).toBeGreaterThanOrEqual(0);

    // No app-owned featureFlags getter was supplied to this instance.
    expect("featureFlags" in context).toBe(false);
  });

  test("session.eventCount increments across track()/page() calls on the same instance", async () => {
    const { browserPageLoad, browserCheckoutStarted } = await runContextCaptureFlow();

    expect(browserCheckoutStarted.name).toBe("Checkout Started");

    const firstSession = (browserPageLoad.context as Record<string, unknown>).session as { eventCount: number };
    const secondSession = (browserCheckoutStarted.context as Record<string, unknown>).session as {
      eventCount: number;
    };

    expect(firstSession.eventCount).toBe(1);
    expect(secondSession.eventCount).toBe(2);

    // Same session throughout (same instance) -- `sessionId` is shared, only
    // `session.eventCount` (a `context` sub-field) increments.
    expect(browserCheckoutStarted.sessionId).toBe(browserPageLoad.sessionId);
  });

  test("caller-supplied TrackOptions.context wins on key collision (shallow merge, not deep)", async () => {
    const { browserPageLoad, browserSignupOverride } = await runContextCaptureFlow();

    const overrideContext = browserSignupOverride.context as Record<string, unknown>;

    // The caller's explicit `locale: "fr-FR"` wins over the auto-captured
    // `"en-US"`.
    expect(overrideContext.locale).toBe("fr-FR");

    // Every other auto-captured field is still present, untouched by the
    // caller's partial `context` override.
    expect(typeof overrideContext.timezone).toBe("string");
    expect(overrideContext.browser).toEqual({ name: "Chrome", version: "124.0.0.0" });
    expect(overrideContext.os).toEqual({ name: "macOS", version: "10.15.7" });
    expect(overrideContext.viewport).toEqual({ width: 1440, height: 900 });
    expect(overrideContext.referrer).toBe("https://www.google.com/search?q=typetrack+analytics");
    expect(overrideContext.campaign).toEqual({ source: "newsletter", medium: "email", campaign: "spring-sale" });

    const session = overrideContext.session as { eventCount: number };
    expect(session.eventCount).toBe(3);

    // Sanity check that the pre-override event's locale really was the
    // auto-captured one, confirming this is a genuine override, not a
    // coincidence.
    expect((browserPageLoad.context as Record<string, unknown>).locale).toBe("en-US");
  });

  test("the featureFlags getter's return value is mirrored verbatim into context.featureFlags", async () => {
    const { featureFlagsPage } = await runContextCaptureFlow();

    expect(featureFlagsPage.name).toBe("Pricing");
    const context = featureFlagsPage.context as Record<string, unknown>;

    expect(context.featureFlags).toEqual({ betaCheckout: true, newPricing: "variant-b" });
    // The instance that supplied the getter is still browser-stubbed, so the
    // rest of the auto-captured shape is unaffected by featureFlags being
    // configured.
    expect(context.browser).toEqual({ name: "Chrome", version: "124.0.0.0" });
  });

  test("the safe-no-op guarantee: outside a browser, locale/timezone/session still populate, browser/os/device/viewport/referrer/campaign are absent entirely", async () => {
    const { nodeFallbackTrack } = await runContextCaptureFlow();

    expect(nodeFallbackTrack.name).toBe("Checkout Started");
    const context = nodeFallbackTrack.context as Record<string, unknown>;

    expect(typeof context.locale).toBe("string");
    expect((context.locale as string).length).toBeGreaterThan(0);
    expect(typeof context.timezone).toBe("string");
    expect((context.timezone as string).length).toBeGreaterThan(0);
    expect(context.session).toMatchObject({ eventCount: 1 });

    // Absent entirely (not present as `undefined`-valued keys) -- the whole
    // safe-no-op guarantee this feature depends on.
    for (const key of ["browser", "os", "device", "viewport", "referrer", "campaign", "featureFlags"] as const) {
      expect(key in context).toBe(false);
    }
  });

  test("runContextCaptureFlow resolves cleanly end-to-end", async () => {
    await expect(runContextCaptureFlow()).resolves.toBeDefined();
  });
});
