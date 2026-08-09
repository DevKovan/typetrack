# Cookbook

Short, task-oriented recipes. Each one links to a full runnable example
under `examples/` — this page is a fast lookup reference, not a
start-to-finish tutorial.

## Switch providers without touching application code

Write your business logic against `AnalyticsProvider` (or nothing at all —
`createAnalytics()`'s `provider` is optional), and construct the real
provider in exactly one place:

```ts
// app.ts — never imports a vendor SDK, never changes when the provider does
export async function runCheckoutFlow(provider: AnalyticsProvider): Promise<void> {
  const analytics = createAnalytics({ provider });
  await analytics.identify("user_42", { plan: "pro" });
  await analytics.track("Checkout Started", { /* ... */ });
  await analytics.flush();
  await analytics.destroy();
}
```

```ts
// entry-with-ga4.ts
import { createGA4Provider } from "@typetrack/provider-ga4";
await runCheckoutFlow(createGA4Provider({ measurementId, apiSecret }));
```

Full example: `examples/core/provider-switch`.

## Send events to more than one provider at once

Pass an array — every listed provider gets a fan-out `Promise.allSettled`
call per event, and a failure in one provider never blocks the others:

```ts
const analytics = createAnalytics({
  provider: [createGA4Provider({ /* ... */ }), createPostHogProvider({ /* ... */ })],
});
```

Full example: `examples/providers/multi-provider-routing`.

## Route different events to different providers

Wrap each provider in a `ProviderEntry` with `include`/`exclude`/
`predicate`:

```ts
const entries: ProviderEntry[] = [
  { provider: analyticsWarehouseProvider, include: ["Purchase Completed", "Checkout Started"], priority: 30 },
  { provider: debugLoggerProvider, predicate: (event) => event.name.startsWith("debug.") },
];
const analytics = createAnalytics({ provider: entries });
```

See `src/routing.ts`'s `shouldRouteToProvider()` for the exact evaluation
order (consent → `include`/`exclude` → `predicate` → `sampling`). Full
example: `examples/providers/multi-provider-routing`.

## Type your events at compile time

```ts
type Events = {
  "User Signed Up": { plan: "free" | "pro" };
  "Page Viewed": undefined;
};
const analytics = createAnalytics<Events>({ provider });
analytics.track("User Signed Up", { plan: "pro" }); // payload shape checked
```

Full example: `examples/core/canonical-event-shape`.

## Validate event payloads at runtime with Zod

```ts
import { z } from "zod";
import { createAnalytics, type InferEvents } from "typetrack";

const eventSchemas = {
  "Order Placed": z.object({ orderId: z.string(), total: z.number() }),
} satisfies Record<string, z.ZodType>;

type Events = InferEvents<typeof eventSchemas>;

const analytics = createAnalytics<Events>({ provider, schemas: eventSchemas });
```

A malformed payload throws `EventValidationError` synchronously (or, if
`onValidationError` is supplied, calls that handler instead and skips the
provider call). See `src/schema.ts`. Full example: `examples/validation/
production-stripping`.

## Redact or filter PII before it reaches a provider

```ts
analytics.use(redactMiddleware({ fields: ["email", "user.ssn"] }));
// or, to catch PII by key *name* anywhere in the event, including arrays:
analytics.use(piiFilterMiddleware());
```

See [`docs/middleware.md`](./middleware.md) for the full guide and the
distinction between the two.

## Sample a fraction of events globally, vs. per-provider

```ts
// Global: dropped events never reach any provider, and skip routing/dispatch entirely.
analytics.use(samplingMiddleware({ rate: 0.1 }));

// Per-provider: only excludes this one provider; every other provider still sees the event.
const entries: ProviderEntry[] = [
  { provider: warehouseProvider },
  { provider: costlyMlVendorProvider, sampling: 0.3 },
];
```

Full example: `examples/middleware/sampling-vs-routing`.

## Gate tracking behind user consent

```ts
const analytics = createAnalytics({
  provider: [
    { provider: analyticsProvider, requiresConsent: ["analytics"] },
    { provider: marketingPixelProvider, requiresConsent: ["marketing"] },
  ],
  consent: { categories: ["analytics", "marketing"], defaultState: "denied" },
});

analytics.consent.grant("analytics"); // now analyticsProvider receives events
```

Full example: `examples/recipes/consent-gated-tracking`.

## Track anonymously / go cookieless

```ts
const analytics = createAnalytics({
  provider,
  anonymousMode: true, // identify()/alias() become no-ops
  cookieless: true,    // autoUTM() and similar plugins skip persisting anything
});
```

Full example: `examples/recipes/anonymous-and-cookieless-tracking` (which
also carries an important "not legal advice" disclaimer worth reading in
full before using this as a compliance justification).

## Keep tracking working offline

```ts
const analytics = createAnalytics({
  provider,
  reliability: { storage: "auto", maxAttempts: 5, batch: { size: 10, intervalMs: 5000 } },
});

analytics.queue.size();   // entries currently queued
await analytics.queue.drain(); // force a drain attempt now
```

Storage falls back IndexedDB → localStorage → memory automatically. Full
example: `examples/advanced/offline-resilient-tracking`.

## Auto-capture browser/device/session context

```ts
const analytics = createAnalytics({ provider, context: true });
// every track()/page()/screen() call's `context` now includes locale,
// timezone, browser, os, device, viewport, referrer, campaign, session
```

Safe to enable in a non-browser environment too — it no-ops there rather
than throwing. Full example: `examples/core/context-capture`.

## Wire up automatic pageview tracking in a plain browser app

```ts
import { createAnalytics, autoPage } from "typetrack";
const analytics = createAnalytics({ provider, plugins: [autoPage()] });
```

Patches `history.pushState`/`replaceState` and listens for `popstate`. If
you're using a framework wrapper (Next.js, Remix), use that package's own
`<AnalyticsPageView />` instead — it's more accurate for that framework's
router. See [`docs/plugins.md`](./plugins.md).

## Rename or retire an event without breaking existing dashboards

```ts
const analytics = createAnalytics({
  provider,
  deprecatedEvents: {
    checkout_started: { replacement: "Checkout Started", sunsetDate: "2027-01-01" },
  },
});
// old call sites keep compiling and working; the event that actually
// reaches providers is the renamed one, and a one-time warning is logged
```

Full example: `examples/validation/deprecated-event-rename`.

## Strip validation from a production bundle

```ts
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const analytics = createAnalytics<Events>({
  provider,
  schemas: eventSchemas,
  validate: !IS_PRODUCTION,
});
```

Your bundler's dead-code elimination removes the `schema.safeParse()` call
path once `validate` is statically `false` — see `examples/validation/
production-stripping` for the full recipe, including how to also guard the
`schemas` import itself.

## Run `typetrack dev` to inspect events locally

```sh
bunx typetrack dev --port 4318
```

```ts
const analytics = createAnalytics({ provider, devServer: true });
```

Every `track()` call is mirrored to the local dev server, validated against
your real schemas if a `typetrack.config.ts` is found, and viewable live.
Routes: `POST/GET /events`, `GET /events/stream` (SSE), `GET /schema`,
`GET /health` — see `src/devServer/server.ts`.
