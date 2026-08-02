import { createAnalytics, type AnalyticsProvider, type CanonicalEvent } from "typetrack";

// A hand-written provider is all it takes to see exactly what core sends:
// every `AnalyticsProvider` -- console logger, GA4, PostHog, Segment, or
// anything else -- receives the same `CanonicalEvent` shape. This one just
// logs it, so the shape is visible without needing any real vendor account.
export const loggingProvider: AnalyticsProvider = {
  name: "console-logger",
  capabilities: {
    identify: true,
    group: true,
    alias: false,
    page: false,
    screen: false,
    batching: false,
    offline: false,
    featureFlags: false,
    sessionReplay: false,
    heatmaps: false,
  },
  track(event: CanonicalEvent) {
    console.log(`track ->\n${JSON.stringify(event, null, 2)}`);
  },
  identify(userId, traits, anonymousId) {
    console.log(
      `identify -> userId=${userId} anonymousId=${anonymousId} traits=${JSON.stringify(traits)}`,
    );
  },
  group(groupId, traits, identity) {
    console.log(
      `group -> groupId=${groupId} identity=${JSON.stringify(identity)} traits=${JSON.stringify(traits)}`,
    );
  },
};

// The realistic "app" logic: a new user signs up, we identify them and
// attach them to their company's account (group), then they start a
// checkout. Exported (rather than only run inline) so the integration test
// below can run the exact same sequence against a recording stub instead of
// the real console-logging provider.
export async function runSignupFlow(provider: AnalyticsProvider): Promise<void> {
  const analytics = createAnalytics({ provider });

  // Awaited throughout -- providers may issue real (async) network calls,
  // so awaiting each call is what guarantees delivery before moving on.
  await analytics.track(
    "User Signed Up",
    { plan: "pro" },
    {
      context: { locale: "en-US" },
      metadata: { source: "web" },
    },
  );

  await analytics.identify("user_42", { email: "ada@example.com", plan: "pro" });

  await analytics.group("acme-inc", { name: "Acme Inc", tier: "enterprise" });

  await analytics.track("Checkout Started", { cartValue: 129.99, itemCount: 3 });

  await analytics.flush();
  await analytics.destroy();
}

// Only runs against the real console-logging provider when this file is
// executed directly (`bun run index.ts`) -- not when imported by
// `index.integration.test.ts`.
if (import.meta.main) {
  await runSignupFlow(loggingProvider);
}
