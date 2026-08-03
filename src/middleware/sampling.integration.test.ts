// Integration test for `samplingMiddleware` (Phase 8 issue 004): constructs
// real `createAnalytics({ provider: [...] })` instances with hand-written
// `AnalyticsProvider` stubs (no mocks), registers `samplingMiddleware` via a
// real `.use()` call, and drives realistic `track()` calls -- asserting on
// what the providers actually did/didn't receive. `anonymousId` isn't
// settable post-construction, so distinct simulated users are modeled as
// distinct `createAnalytics()` instances (mirrors Phase 7's
// `examples/providers/multi-provider-routing` test pattern).
import { describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { samplingMiddleware } from "./sampling";
import type { AnalyticsProvider } from "../providers";
import { allCapabilities } from "../test-support";

interface CountingProvider {
  provider: AnalyticsProvider;
  readonly calls: number;
}

function makeCountingProvider(name: string): CountingProvider {
  let calls = 0;
  const provider: AnalyticsProvider = {
    name,
    capabilities: allCapabilities,
    track() {
      calls += 1;
    },
  };
  // Exposed via a getter (not a snapshot) so callers see live updates as
  // more `track()` calls come through the same instance.
  return {
    provider,
    get calls() {
      return calls;
    },
  };
}

describe("samplingMiddleware integration", () => {
  it("rate: 0 always drops every track() call, across ~50 distinct createAnalytics() instances", async () => {
    for (let i = 0; i < 50; i++) {
      const stub = makeCountingProvider(`zero-rate-${i}`);
      const analytics = createAnalytics({ provider: stub.provider });
      analytics.use(samplingMiddleware({ rate: 0 }));

      await analytics.track("checkout_started", { cartValue: 10 });

      expect(stub.calls).toBe(0);
    }
  });

  it("rate: 1 always keeps every track() call, across ~50 distinct createAnalytics() instances", async () => {
    for (let i = 0; i < 50; i++) {
      const stub = makeCountingProvider(`one-rate-${i}`);
      const analytics = createAnalytics({ provider: stub.provider });
      analytics.use(samplingMiddleware({ rate: 1 }));

      await analytics.track("checkout_started", { cartValue: 10 });

      expect(stub.calls).toBe(1);
    }
  });

  it("rate: 0.5 lands roughly half of many distinct anonymousIds \"in\" over many trials", async () => {
    const trials = 300;
    let sampledIn = 0;

    for (let i = 0; i < trials; i++) {
      const stub = makeCountingProvider(`trial-${i}`);
      // A fresh instance per trial -- each generates its own independently
      // random `anonymousId`, simulating a distinct user/device.
      const analytics = createAnalytics({ provider: stub.provider });
      analytics.use(samplingMiddleware({ rate: 0.5 }));

      await analytics.track("checkout_started", { cartValue: 10 });
      if (stub.calls > 0) sampledIn++;
    }

    // Same generous statistical tolerance as the Phase 7 routing example
    // (expected ~150/300, stddev ~8.7; window 90-210 fails by chance with
    // probability on the order of 1e-8).
    expect(sampledIn).toBeGreaterThan(90);
    expect(sampledIn).toBeLessThan(210);
  });

  it("a given instance's in/out decision is consistent across many repeated track() calls on the same instance", async () => {
    const stub = makeCountingProvider("repeat-stub");
    const analytics = createAnalytics({ provider: stub.provider });
    analytics.use(samplingMiddleware({ rate: 0.5 }));

    for (let i = 0; i < 10; i++) {
      await analytics.track("checkout_started", { cartValue: 10 });
    }

    // Same anonymousId throughout one instance -> either every call landed
    // or none did, never some.
    expect([0, 10]).toContain(stub.calls);
  });

  it("finds a sampled-in and a sampled-out instance at rate 0.5, and each stays consistent across repeated calls", async () => {
    let sampledInAnalytics: ReturnType<typeof createAnalytics> | undefined;
    let sampledInStub: ReturnType<typeof makeCountingProvider> | undefined;
    let sampledOutAnalytics: ReturnType<typeof createAnalytics> | undefined;
    let sampledOutStub: ReturnType<typeof makeCountingProvider> | undefined;

    for (let i = 0; i < 200 && (!sampledInAnalytics || !sampledOutAnalytics); i++) {
      const stub = makeCountingProvider(`search-${i}`);
      const analytics = createAnalytics({ provider: stub.provider });
      analytics.use(samplingMiddleware({ rate: 0.5 }));
      await analytics.track("checkout_started", { cartValue: 10 });

      if (stub.calls > 0 && !sampledInAnalytics) {
        sampledInAnalytics = analytics;
        sampledInStub = stub;
      } else if (stub.calls === 0 && !sampledOutAnalytics) {
        sampledOutAnalytics = analytics;
        sampledOutStub = stub;
      }
    }

    expect(sampledInAnalytics).toBeDefined();
    expect(sampledOutAnalytics).toBeDefined();

    // Drive several more calls through each and assert the decision holds.
    for (let i = 0; i < 5; i++) {
      await sampledInAnalytics!.track("checkout_started", { cartValue: 10 });
      await sampledOutAnalytics!.track("checkout_started", { cartValue: 10 });
    }

    expect(sampledInStub!.calls).toBe(6); // 1 (found) + 5 more
    expect(sampledOutStub!.calls).toBe(0); // never received any call
  });

  it("composes with a per-provider ProviderEntry.sampling gate: an event surviving samplingMiddleware can still be excluded from one specific provider", async () => {
    const alwaysStub = makeCountingProvider("always-provider");
    const gatedStub = makeCountingProvider("gated-provider");

    // Global gate keeps everything (rate: 1); per-provider gate on
    // `gatedStub` drops everything (sampling: 0) -- demonstrates the two
    // layers are independent and both apply.
    const analytics = createAnalytics({
      provider: [{ provider: alwaysStub.provider }, { provider: gatedStub.provider, sampling: 0 }],
    });
    analytics.use(samplingMiddleware({ rate: 1 }));

    await analytics.track("checkout_started", { cartValue: 10 });

    expect(alwaysStub.calls).toBe(1);
    expect(gatedStub.calls).toBe(0);
  });

  it("an event dropped by samplingMiddleware never reaches routing evaluation for any provider", async () => {
    const providerA = makeCountingProvider("provider-a");
    const providerB = makeCountingProvider("provider-b");

    // Global gate drops everything (rate: 0); per-provider sampling on
    // providerB would otherwise keep it (sampling: 1) -- but it never gets
    // the chance to be evaluated, since the event never reaches dispatch.
    const analytics = createAnalytics({
      provider: [{ provider: providerA.provider }, { provider: providerB.provider, sampling: 1 }],
    });
    analytics.use(samplingMiddleware({ rate: 0 }));

    await analytics.track("checkout_started", { cartValue: 10 });

    expect(providerA.calls).toBe(0);
    expect(providerB.calls).toBe(0);
  });
});
