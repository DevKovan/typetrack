import { describe, expect, test } from "bun:test";
import { runLandingPageEngagementFlow } from "./index";

// Runs the example's actual entry-point logic (`runLandingPageEngagementFlow`,
// the exact function `bun run index.ts` calls) end-to-end against the real
// `typetrack` package, so every assertion below can never silently drift out
// of sync with what `README.md`/`expected-output.txt` document. Mirrors
// `examples/middleware/pipeline-basics/index.integration.test.ts`'s
// convention of asserting against the flow's own recorded call log rather
// than re-implementing the scenario.

describe("landing-page-engagement example", () => {
  test("setup: autoPage()'s initial page view fires before autoUTM()'s Campaign Landing event, both at construction time", async () => {
    const { callLog } = await runLandingPageEngagementFlow();

    expect(callLog[0]).toEqual({
      verb: "page",
      name: "/landing",
      properties: { search: "?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale" },
    });
    expect(callLog[1]).toEqual({
      verb: "track",
      name: "Campaign Landing",
      properties: { source: "newsletter", medium: "email", campaign: "spring-sale" },
    });
  });

  test("autoUTM() persists the first-touch campaign to sessionStorage under its default key", async () => {
    const { sessionStorageData } = await runLandingPageEngagementFlow();

    expect(JSON.parse(sessionStorageData["typetrack_first_touch_campaign"]!)).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "spring-sale",
    });
  });

  test("autoClicks({ selector: \"[data-cta]\" }): a click on a nested element resolves to the CTA via closest(), a non-matching click is ignored", async () => {
    const { callLog } = await runLandingPageEngagementFlow();

    const clickEvents = callLog.filter((entry) => entry.name === "Element Clicked");
    expect(clickEvents.length).toBe(1);
    expect(clickEvents[0]!.properties).toEqual({
      tag: "a",
      id: undefined,
      classes: "btn btn-primary",
      text: "Start Free Trial",
      href: "/signup",
    });
  });

  test("autoScroll({ thresholds: [25, 50, 100] }): each configured threshold fires exactly once, in ascending order", async () => {
    const { callLog } = await runLandingPageEngagementFlow();

    const scrollEvents = callLog.filter((entry) => entry.name === "Scroll Depth Reached");
    expect(scrollEvents.map((entry) => entry.properties.percent)).toEqual([25, 50, 100]);
  });

  test("autoVisibility(): a visibilitychange to \"hidden\" is tracked", async () => {
    const { callLog } = await runLandingPageEngagementFlow();

    const visibilityEvents = callLog.filter((entry) => entry.name === "Page Visibility Changed");
    expect(visibilityEvents.length).toBe(1);
    expect(visibilityEvents[0]!.properties).toEqual({ state: "hidden" });
  });

  test("a client-side navigation to a second route with no UTM params: autoPage() fires a second page view, autoUTM() does not re-fire", async () => {
    const { callLog } = await runLandingPageEngagementFlow();

    const pageEvents = callLog.filter((entry) => entry.verb === "page");
    expect(pageEvents.length).toBe(2);
    expect(pageEvents[1]).toEqual({ verb: "page", name: "/pricing", properties: {} });

    const landingEvents = callLog.filter((entry) => entry.name === "Campaign Landing");
    expect(landingEvents.length).toBe(1);
  });

  test("exactly 8 provider calls happen before destroy(), matching one call per scenario step", async () => {
    const { callLog } = await runLandingPageEngagementFlow();
    expect(callLog.length).toBe(8);
  });

  test("destroy(): a further simulated scroll/click/pushState produces no further provider calls", async () => {
    const { sink } = await runLandingPageEngagementFlow();
    expect(sink).toContain("[flow] 0 provider call(s) after destroy() (expected: 0, was 8 before)");
  });

  test("runLandingPageEngagementFlow resolves without throwing", async () => {
    await expect(runLandingPageEngagementFlow()).resolves.toBeDefined();
  });
});
