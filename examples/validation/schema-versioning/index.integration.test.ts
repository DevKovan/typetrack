import { describe, expect, test } from "bun:test";
import { EventValidationError } from "typetrack";
import { createCurrentPurchaseScenario, createV2PurchaseScenario } from "./index";

// Runs the example's actual `createAnalytics()` scenario factories -- the
// exact functions `bun run index.ts` calls -- end-to-end against the real
// `typetrack` package and real Zod schemas, so these assertions can never
// silently drift out of sync with what README.md/expected-output.txt
// document.

describe("schema-versioning example", () => {
  describe("Section 1-2: current version (2026.1) + additive change, same schema/instance", () => {
    test("the original shape (no currency) validates and is stamped with schemaVersion 2026.1", async () => {
      const { analytics, callLog } = createCurrentPurchaseScenario();

      await analytics.track("Purchase Completed", { orderId: "ord_1", total: 49.99 });

      expect(callLog).toHaveLength(1);
      expect(callLog[0]!.payload).toEqual({ orderId: "ord_1", total: 49.99 });
      expect(callLog[0]!.metadata).toEqual({ schemaVersion: "2026.1" });
    });

    test("the additive shape (with currency) validates against the SAME schema, no version bump", async () => {
      const { analytics, callLog } = createCurrentPurchaseScenario();

      await analytics.track("Purchase Completed", { orderId: "ord_2", total: 79.5, currency: "USD" });

      expect(callLog).toHaveLength(1);
      expect(callLog[0]!.payload).toEqual({ orderId: "ord_2", total: 79.5, currency: "USD" });
      expect(callLog[0]!.metadata).toEqual({ schemaVersion: "2026.1" });
    });

    test("both shapes coexist through the same instance, both delivered, both tagged with the same schemaVersion", async () => {
      const { analytics, callLog } = createCurrentPurchaseScenario();

      await analytics.track("Purchase Completed", { orderId: "ord_1", total: 49.99 });
      await analytics.track("Purchase Completed", { orderId: "ord_2", total: 79.5, currency: "USD" });

      expect(callLog).toHaveLength(2);
      expect(callLog.every((entry) => entry.metadata?.["schemaVersion"] === "2026.1")).toBe(true);
    });

    test("a payload missing a required field still throws EventValidationError (the schema still enforces required fields)", async () => {
      const { analytics, callLog } = createCurrentPurchaseScenario();

      let caught: unknown;
      try {
        await analytics.track("Purchase Completed", { total: 10 } as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(EventValidationError);
      expect(callLog).toHaveLength(0);
    });
  });

  describe("Section 3: breaking change, done correctly (V2, schemaVersion 2027.1)", () => {
    test("an old-shaped payload via the old event name is redirected to the new name, but still fails validation (payload shape wasn't updated)", async () => {
      const { analytics, callLog } = createV2PurchaseScenario();

      let caught: unknown;
      try {
        await analytics.track("Purchase Completed", { orderId: "ord_3", total: 99.0 } as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(EventValidationError);
      // The error carries the RESOLVED (redirected) event name, proving the
      // deprecatedEvents redirect ran before validation.
      expect((caught as EventValidationError).event).toBe("Purchase Completed V2");
      expect(callLog).toHaveLength(0);
    });

    test("the updated call site (new shape, new event name) validates and is stamped with schemaVersion 2027.1", async () => {
      const { analytics, callLog } = createV2PurchaseScenario();

      await analytics.track("Purchase Completed V2", { orderId: "ord_3", amountCents: 9900, currency: "USD" });

      expect(callLog).toHaveLength(1);
      expect(callLog[0]!.eventName).toBe("Purchase Completed V2");
      expect(callLog[0]!.payload).toEqual({ orderId: "ord_3", amountCents: 9900, currency: "USD" });
      expect(callLog[0]!.metadata).toEqual({ schemaVersion: "2027.1" });
    });

    test("calling the new event name directly (no old call site involved) behaves identically", async () => {
      const { analytics, callLog } = createV2PurchaseScenario();

      await analytics.track("Purchase Completed V2", { orderId: "ord_4", amountCents: 500 });

      expect(callLog).toHaveLength(1);
      expect(callLog[0]!.eventName).toBe("Purchase Completed V2");
    });
  });
});
