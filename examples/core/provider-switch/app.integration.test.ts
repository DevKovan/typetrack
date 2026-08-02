import { describe, expect, test } from "bun:test";
import { createGA4Provider } from "@typetrack/provider-ga4";
import { noopProvider, type AnalyticsProvider, type CanonicalEvent } from "typetrack";
import { runCheckoutFlow } from "./app";
import { startGA4Stub } from "./ga4-stub-server";

// Runs the example's actual shared `app.ts` logic -- the exact function
// every `run-with-*.ts` entry point calls -- end-to-end against three
// providers: the real `noopProvider`, a hand-written recording stub, and a
// real `createGA4Provider` pointed at a local `Bun.serve()` stub (never
// real Google infrastructure). This is what proves the "only the provider
// construction changes" claim in the README, not just documents it.

interface RecordedCall {
  type: "identify" | "track" | "flush" | "destroy";
  args: unknown[];
}

function createRecordingProvider(): { provider: AnalyticsProvider; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const provider: AnalyticsProvider = {
    name: "recording-stub",
    capabilities: {
      identify: true,
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
    track(event) {
      calls.push({ type: "track", args: [event] });
    },
    identify(userId, traits, anonymousId) {
      calls.push({ type: "identify", args: [userId, traits, anonymousId] });
    },
    async flush() {
      calls.push({ type: "flush", args: [] });
    },
    async destroy() {
      calls.push({ type: "destroy", args: [] });
    },
  };
  return { provider, calls };
}

describe("provider-switch example: run-with-noop.ts's provider", () => {
  test("runCheckoutFlow runs end-to-end against the real noopProvider without throwing", async () => {
    await expect(runCheckoutFlow(noopProvider)).resolves.toBeUndefined();
  });
});

describe("provider-switch example: app.ts's call sequence (recording stub)", () => {
  test("calls identify -> track -> track -> flush -> flush -> destroy, in that order", async () => {
    const { provider, calls } = createRecordingProvider();

    await runCheckoutFlow(provider);

    // Two `flush` calls: `app.ts`'s own explicit `analytics.flush()`, then a
    // second one core's `analytics.destroy()` issues internally (it drains
    // via `provider.flush?.()` before tearing down) -- see `src/index.ts`'s
    // `destroy()`.
    expect(calls.map((call) => call.type)).toEqual([
      "identify",
      "track",
      "track",
      "flush",
      "flush",
      "destroy",
    ]);
  });

  test("produces the documented Checkout Started / Purchase Completed CanonicalEvents", async () => {
    const { provider, calls } = createRecordingProvider();
    await runCheckoutFlow(provider);

    const [, checkoutStarted, purchaseCompleted] = calls;
    const checkoutEvent = checkoutStarted?.args[0] as CanonicalEvent;
    const purchaseEvent = purchaseCompleted?.args[0] as CanonicalEvent;

    expect(checkoutEvent.name).toBe("Checkout Started");
    expect(checkoutEvent.properties).toEqual({ cartValue: 119.98, itemCount: 2 });
    expect(checkoutEvent.userId).toBe("user_42");

    expect(purchaseEvent.name).toBe("Purchase Completed");
    expect(purchaseEvent.properties).toEqual({
      orderId: "order_9001",
      total: 119.98,
      items: [
        { id: "sku_1", name: "Wireless Mouse" },
        { id: "sku_2", name: "Mechanical Keyboard" },
      ],
    });
    expect(purchaseEvent.userId).toBe("user_42");
    expect(purchaseEvent.anonymousId).toBe(checkoutEvent.anonymousId);
  });
});

describe("provider-switch example: run-with-ga4.ts's provider (local stub, never real Google infrastructure)", () => {
  test("createGA4Provider translates the same app.ts calls into Measurement Protocol requests against a local Bun.serve() stub", async () => {
    const stub = startGA4Stub();
    try {
      const provider = createGA4Provider({
        measurementId: "G-TESTTEST",
        apiSecret: "test-secret",
        // The one override that keeps this test from ever reaching real
        // Google infrastructure -- see `run-with-ga4-local-stub.ts`.
        apiHost: stub.url,
      });

      await runCheckoutFlow(provider);

      expect(stub.requests).toHaveLength(2);

      const [checkoutRequest, purchaseRequest] = stub.requests;
      expect(checkoutRequest?.pathname).toBe("/mp/collect");
      expect(checkoutRequest?.searchParams).toEqual({
        measurement_id: "G-TESTTEST",
        api_secret: "test-secret",
      });
      expect(checkoutRequest?.body).toMatchObject({
        events: [{ name: "begin_checkout", params: { cartValue: 119.98, itemCount: 2 } }],
      });

      expect(purchaseRequest?.body).toMatchObject({
        events: [
          {
            name: "purchase",
            params: {
              transaction_id: "order_9001",
              value: 119.98,
              items: [
                { id: "sku_1", name: "Wireless Mouse" },
                { id: "sku_2", name: "Mechanical Keyboard" },
              ],
            },
          },
        ],
      });
    } finally {
      stub.stop();
    }
  });
});
