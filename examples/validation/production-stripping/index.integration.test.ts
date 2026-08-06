import { describe, expect, test } from "bun:test";
import { EventValidationError, type AnalyticsProvider, type CanonicalEvent } from "typetrack";
import {
  createGuardedAnalytics,
  createNonValidatingAnalytics,
  createValidatingAnalytics,
  MALFORMED_ORDER_PAYLOAD,
  type Events,
} from "./index";

// Runs the example's actual `createAnalytics()` factory functions -- the
// exact functions `bun run index.ts` calls -- end-to-end against the real
// `typetrack` package and a real Zod schema (`eventSchemas["Order Placed"]`,
// via `InferEvents`), so these assertions can never silently drift out of
// sync with what README.md/expected-output.txt document.

function makeRecordingProvider(): { provider: AnalyticsProvider; calls: CanonicalEvent[] } {
  const calls: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name: "order-warehouse",
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
    track(event) {
      calls.push(event);
    },
  };
  return { provider, calls };
}

describe("production-stripping example", () => {
  test("createValidatingAnalytics: a valid payload is validated and delivered", async () => {
    const { provider, calls } = makeRecordingProvider();
    const analytics = createValidatingAnalytics(provider);

    await analytics.track("Order Placed", { orderId: "ord_1", amount: 49.99 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.properties).toEqual({ orderId: "ord_1", amount: 49.99 });
  });

  test("createValidatingAnalytics: the malformed payload throws EventValidationError and never reaches the provider", async () => {
    const { provider, calls } = makeRecordingProvider();
    const analytics = createValidatingAnalytics(provider);

    let caught: unknown;
    try {
      await analytics.track("Order Placed", MALFORMED_ORDER_PAYLOAD as Events["Order Placed"]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as EventValidationError).event).toBe("Order Placed");
    expect(calls).toHaveLength(0);
  });

  test("createNonValidatingAnalytics: the same malformed payload is forwarded raw, no throw", async () => {
    const { provider, calls } = makeRecordingProvider();
    const analytics = createNonValidatingAnalytics(provider);

    await analytics.track("Order Placed", MALFORMED_ORDER_PAYLOAD as Events["Order Placed"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.properties).toEqual(MALFORMED_ORDER_PAYLOAD);
  });

  test("createNonValidatingAnalytics: a well-formed payload still passes through unchanged (validate:false never mutates a payload)", async () => {
    const { provider, calls } = makeRecordingProvider();
    const analytics = createNonValidatingAnalytics(provider);

    await analytics.track("Order Placed", { orderId: "ord_2", amount: 12.5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.properties).toEqual({ orderId: "ord_2", amount: 12.5 });
  });

  test("createGuardedAnalytics: in this test process (NODE_ENV !== production), behaves exactly like createValidatingAnalytics", async () => {
    const { provider, calls } = makeRecordingProvider();
    const analytics = createGuardedAnalytics(provider);

    let caught: unknown;
    try {
      await analytics.track("Order Placed", MALFORMED_ORDER_PAYLOAD as Events["Order Placed"]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EventValidationError);
    expect(calls).toHaveLength(0);
  });

  test("createGuardedAnalytics: a valid payload still validates and delivers normally in a non-production run", async () => {
    const { provider, calls } = makeRecordingProvider();
    const analytics = createGuardedAnalytics(provider);

    await analytics.track("Order Placed", { orderId: "ord_3", amount: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.properties).toEqual({ orderId: "ord_3", amount: 5 });
  });
});
