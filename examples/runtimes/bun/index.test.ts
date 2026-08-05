import { describe, expect, test } from "bun:test";
import { buildCheckoutStartedProperties, buildProductViewedProperties, type CartItem } from "./index";

// Unit tests for this example's pure, non-trivial logic -- no I/O, no
// `typetrack`/`@typetrack/provider-segment` involved at all, unlike
// `index.integration.test.ts`. `buildProductViewedProperties`/
// `buildCheckoutStartedProperties` are the one piece of this example's own
// logic worth isolating (real arithmetic + floating-point rounding), the
// same "isolated logic, no I/O" bar every other unit test in this repo is
// held to (e.g. `src/schema.test.ts`, `packages/provider-*/src/mapping
// .test.ts`).

describe("buildProductViewedProperties", () => {
  test("returns exactly {sku, price} for a cart item, dropping quantity", () => {
    expect(buildProductViewedProperties({ sku: "TT-HOODIE-CHARCOAL-L", price: 54.0 })).toEqual({
      sku: "TT-HOODIE-CHARCOAL-L",
      price: 54.0,
    });
  });

  test("passes price through unchanged, including a value with cents", () => {
    expect(buildProductViewedProperties({ sku: "TT-MUG-STEEL", price: 14.5 })).toEqual({
      sku: "TT-MUG-STEEL",
      price: 14.5,
    });
  });
});

describe("buildCheckoutStartedProperties", () => {
  test("sums price * quantity across every cart item for cartTotal, and quantity alone for itemCount", () => {
    const cart: CartItem[] = [
      { sku: "TT-HOODIE-CHARCOAL-L", price: 54.0, quantity: 1 },
      { sku: "TT-MUG-STEEL", price: 14.5, quantity: 2 },
    ];

    expect(buildCheckoutStartedProperties(cart)).toEqual({ cartTotal: 83.0, itemCount: 3 });
  });

  test("rounds cartTotal to 2 decimal places, avoiding floating-point artifacts", () => {
    // 0.1 + 0.2 famously isn't exactly 0.3 in IEEE 754 floating point --
    // this is a real, deliberately chosen regression case, not a contrived
    // one: without rounding, this would produce `cartTotal:
    // 0.30000000000000004`.
    const cart: CartItem[] = [
      { sku: "TT-STICKER-A", price: 0.1, quantity: 1 },
      { sku: "TT-STICKER-B", price: 0.2, quantity: 1 },
    ];

    expect(buildCheckoutStartedProperties(cart)).toEqual({ cartTotal: 0.3, itemCount: 2 });
  });

  test("an empty cart produces cartTotal 0 and itemCount 0, not NaN/undefined", () => {
    expect(buildCheckoutStartedProperties([])).toEqual({ cartTotal: 0, itemCount: 0 });
  });

  test("a single-item cart with quantity > 1 multiplies price by quantity for cartTotal", () => {
    const cart: CartItem[] = [{ sku: "TT-MUG-STEEL", price: 14.5, quantity: 3 }];

    expect(buildCheckoutStartedProperties(cart)).toEqual({ cartTotal: 43.5, itemCount: 3 });
  });
});
