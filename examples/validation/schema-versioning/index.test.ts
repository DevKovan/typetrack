import { describe, expect, test } from "bun:test";
import { classifyPurchasePayload } from "./index";

// Unit test for `classifyPurchasePayload`'s pure classification logic --
// exercised directly against the real, current (2026.1) Zod schema, no
// `createAnalytics()`, no provider, no I/O. This is the one piece of
// genuinely non-trivial pure logic this example's `index.ts` defines:
// everything else is direct `typetrack`/Zod API calls or provider-stub
// construction, which belongs in `index.integration.test.ts` instead.

describe("classifyPurchasePayload", () => {
  test("the original 2026.1 shape (no currency) -> valid-without-currency", () => {
    expect(classifyPurchasePayload({ orderId: "ord_1", total: 49.99 })).toBe("valid-without-currency");
  });

  test("the additive shape (with currency) -> valid-with-currency", () => {
    expect(classifyPurchasePayload({ orderId: "ord_2", total: 79.5, currency: "USD" })).toBe("valid-with-currency");
  });

  test("missing a required field (orderId) -> invalid", () => {
    expect(classifyPurchasePayload({ total: 10 })).toBe("invalid");
  });

  test("wrong type for total -> invalid", () => {
    expect(classifyPurchasePayload({ orderId: "ord_3", total: "ten dollars" })).toBe("invalid");
  });

  test("an unrelated shape entirely (e.g. the V2 amountCents shape) -> invalid against the current (V1) schema", () => {
    expect(classifyPurchasePayload({ orderId: "ord_4", amountCents: 1000 })).toBe("invalid");
  });

  test("null/undefined -> invalid", () => {
    expect(classifyPurchasePayload(null)).toBe("invalid");
    expect(classifyPurchasePayload(undefined)).toBe("invalid");
  });
});
