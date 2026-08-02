import { describe, expect, test } from "bun:test";
import { buildCheckoutStartedPayload, buildPurchaseCompletedPayload, type CartItem } from "./app";

// Unit tests: isolated pure logic only -- no `Analytics`/provider/network
// involved. `runCheckoutFlow` itself is pure orchestration (construct
// `createAnalytics`, call `identify`/`track`/`flush`/`destroy` directly) with
// no non-trivial logic of its own beyond calling these two helpers, so it is
// covered by `app.integration.test.ts` instead, not duplicated here.

const items: CartItem[] = [
  { id: "sku_1", name: "Wireless Mouse", price: 29.99, quantity: 1 },
  { id: "sku_2", name: "Mechanical Keyboard", price: 89.99, quantity: 1 },
];

describe("buildCheckoutStartedPayload", () => {
  test("sums price * quantity across items into cartValue, and quantities into itemCount", () => {
    expect(buildCheckoutStartedPayload(items)).toEqual({ cartValue: 119.98, itemCount: 2 });
  });

  test("rounds cartValue to 2 decimal places to avoid floating point noise", () => {
    const messyItems: CartItem[] = [
      { id: "sku_1", name: "Item A", price: 0.1, quantity: 1 },
      { id: "sku_2", name: "Item B", price: 0.2, quantity: 1 },
    ];
    expect(buildCheckoutStartedPayload(messyItems)).toEqual({ cartValue: 0.3, itemCount: 2 });
  });

  test("multiplies price by quantity, not just summing prices", () => {
    const bulkItems: CartItem[] = [{ id: "sku_1", name: "Bulk Item", price: 10, quantity: 5 }];
    expect(buildCheckoutStartedPayload(bulkItems)).toEqual({ cartValue: 50, itemCount: 5 });
  });

  test("returns zeroed totals for an empty cart", () => {
    expect(buildCheckoutStartedPayload([])).toEqual({ cartValue: 0, itemCount: 0 });
  });
});

describe("buildPurchaseCompletedPayload", () => {
  test("produces orderId, rounded total, and a slimmed items list (id + name only)", () => {
    expect(buildPurchaseCompletedPayload("order_9001", items)).toEqual({
      orderId: "order_9001",
      total: 119.98,
      items: [
        { id: "sku_1", name: "Wireless Mouse" },
        { id: "sku_2", name: "Mechanical Keyboard" },
      ],
    });
  });

  test("never leaks price/quantity into the slimmed items list", () => {
    const payload = buildPurchaseCompletedPayload("order_1", items);
    for (const item of payload.items) {
      expect(item).not.toHaveProperty("price");
      expect(item).not.toHaveProperty("quantity");
    }
  });
});
