import { createAnalytics, type AnalyticsProvider } from "typetrack";

// Deliberately never imports from `@typetrack/provider-ga4` (or any other
// provider package) -- that is the entire point of this example. See the
// README's "Explanation" section and the Golden Rule in `plan/VISION.md`.

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

// Pure helpers -- no `analytics`/provider/network involved -- that shape a
// cart into the payload each event carries. Covered by `app.test.ts`.
export function buildCheckoutStartedPayload(items: CartItem[]): {
  cartValue: number;
  itemCount: number;
} {
  const cartValue = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  return { cartValue: Math.round(cartValue * 100) / 100, itemCount };
}

export function buildPurchaseCompletedPayload(
  orderId: string,
  items: CartItem[],
): { orderId: string; total: number; items: Array<{ id: string; name: string }> } {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    orderId,
    total: Math.round(total * 100) / 100,
    items: items.map((item) => ({ id: item.id, name: item.name })),
  };
}

// The realistic, provider-agnostic "app" logic: identify the shopper, start
// a checkout, complete a purchase. Written once, called by each
// `run-with-*.ts` entry point with a different `AnalyticsProvider` -- this
// function's body never changes based on which provider it's given.
export async function runCheckoutFlow(provider: AnalyticsProvider): Promise<void> {
  const analytics = createAnalytics({ provider });

  const items: CartItem[] = [
    { id: "sku_1", name: "Wireless Mouse", price: 29.99, quantity: 1 },
    { id: "sku_2", name: "Mechanical Keyboard", price: 89.99, quantity: 1 },
  ];

  // Awaited -- some providers (e.g. GA4's Measurement Protocol adapter)
  // issue a real network request per call with no internal queue, so
  // awaiting each call (rather than firing-and-forgetting) is what
  // guarantees every event is actually sent before `flush()`/`destroy()`
  // tear the app down below.
  await analytics.identify("user_42", { email: "ada@example.com", plan: "pro" });

  await analytics.track("Checkout Started", buildCheckoutStartedPayload(items));

  await analytics.track("Purchase Completed", buildPurchaseCompletedPayload("order_9001", items));

  await analytics.flush();
  await analytics.destroy();
}
