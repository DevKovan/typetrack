# 003 — GA4 adapter canonical rewrite (mapping tables, capabilities, lifecycle)

## Context

Depends on issues 001-002. This is a **breaking** rewrite of
`packages/provider-ga4/src/index.ts`'s internals: `track()`/`page()` now
receive a single `CanonicalEvent` (not positional `event, payload, meta` /
`name, props`); the adapter **stops generating its own `client_id`**
(today's `crypto.randomUUID()` call) — `client_id` now comes directly from
`event.anonymousId`/`event.userId` on each `CanonicalEvent`, since core
(issue 002) already stamps those on every event. Do not preserve the old
signatures or the adapter's own identity generation for back-compat — this
is intentional, not an oversight.

## Event-name mapping table (researched, cited)

Default `Record<string, string>`, canonical → GA4 recommended event name,
per Google's official recommended-events reference
(https://developers.google.com/analytics/devguides/collection/ga4/reference/events)
and support page (https://support.google.com/analytics/answer/9267735):

```ts
const DEFAULT_EVENT_MAP: Record<string, string> = {
  "User Signed Up": "sign_up",
  "User Logged In": "login",
  "Checkout Started": "begin_checkout",
  "Purchase Completed": "purchase",
  "Product Viewed": "view_item",
  "Search Performed": "search",
};
```

## Property-name mapping table (researched, cited)

Shape: `{ global?: Record<string,string>; events?: Record<string,
Record<string,string>> }`. Per GA4's `purchase` params
(`transaction_id`, `currency`, `value`) and `view_item` params (`item_id`/
`item_name`, `price`, `currency`, `value`), both documented at the same
Google reference URL above:

```ts
const DEFAULT_PROPERTY_MAP = {
  events: {
    "Purchase Completed": { orderId: "transaction_id", total: "value" },
    "Product Viewed": { productId: "item_id", name: "item_name" },
  },
} satisfies { global?: Record<string, string>; events?: Record<string, Record<string, string>> };
```

## Config, merge, and warn-once semantics

- `GA4ProviderConfig` gains two new optional fields:
  `eventMap?: Record<string, string>` and
  `propertyMap?: { global?: Record<string,string>; events?: Record<string, Record<string,string>> }`.
- Merge on construction: `eventMap = { ...DEFAULT_EVENT_MAP, ...config.eventMap }`
  (override wins on key collision; can introduce brand-new canonical event
  names the default table doesn't know about). `propertyMap.global =
  { ...DEFAULT_PROPERTY_MAP.global, ...config.propertyMap?.global }`;
  `propertyMap.events` merges **per event key**: for every event key present
  in either the default or the override, the merged per-event map is
  `{ ...defaultEvents[key], ...overrideEvents[key] }` (override wins within
  that event's map; an event key present only in the override is included
  as-is).
- `track()` translation: look up `eventMap[event.name]`; if present, use it
  as the GA4 event name; if absent, pass `event.name` through unchanged
  **and** `console.warn` exactly once per unique unmapped canonical name
  for this provider instance (track a closure-scoped `Set<string>` of
  already-warned names; never warn twice for the same name on the same
  instance).
- Property translation (applied to `event.properties` only, for `track()`
  — **not** for `page()`, whose params are built directly from
  `event.properties` with no event-name-keyed lookup, since `page()` always
  maps to the fixed `page_view` GA4 event, never through `eventMap`): for
  each key in `event.properties`, look up
  `propertyMap.events[event.name]?.[key]` first, then
  `propertyMap.global?.[key]`, else pass the key through unchanged.
- `page()`'s params use `propertyMap.global` only (no per-event lookup,
  since there's no "current event name" concept for a page view beyond the
  fixed `page_view` GA4 event name).

## Identity rewrite

- Delete the adapter's own `crypto.randomUUID()` `clientId` generation
  entirely. `send()`'s `client_id` now comes from `event.anonymousId`;
  `user_id` comes from `event.userId` (included only when defined, exactly
  as today).
- `identify(userId, traits, anonymousId)` (new three-arg signature, per
  issue 001's `AnalyticsProvider`): makes zero network calls, exactly as
  today. It only updates `currentUserProperties` (mapped from `traits` into
  GA4's `user_properties` shape, unchanged logic) — the `userId` argument
  itself is **not** stored by this adapter anymore (since every subsequent
  `track()`/`page()` call already carries the correct `event.userId`
  directly from core); do not add a redundant `currentUserId` field.
- `reset()`: clears `currentUserProperties` back to `undefined`. Nothing
  else to reset (no adapter-owned identity IDs remain after this rewrite).

## Capabilities (researched, truthfully declared)

```ts
capabilities: {
  identify: true, group: false, alias: false, page: true, screen: false,
  batching: false, offline: false, featureFlags: false,
  sessionReplay: false, heatmaps: false,
}
```
Rationale: GA4 Measurement Protocol has no group/alias/screen concept
(web-stream only, app-stream/`firebase_app_id` out of scope per the
existing adapter's Out-of-scope); each `track()`/`page()` call issues its
own immediate request (no batching); no offline queue, feature flags,
session replay, or heatmaps exist in this HTTP-only adapter. `group?`/
`alias?`/`screen?` are simply not implemented on the returned object
(`undefined`), matching their `false` capabilities.

## Lifecycle

- `flush()`: unchanged — no-op, resolves immediately, zero `fetch` calls.
- `destroy()`: no persistent connection/timer exists to close; implement
  as `async destroy() {}` (a no-op that resolves) — document in a code
  comment that this is intentional, not a missing implementation.

## Acceptance criteria

- `track(event: CanonicalEvent)` sends `POST {apiHost}/mp/collect?...`
  with `events: [{ name: <translated event name>, params: <translated
  properties> }]`, `client_id: event.anonymousId`, `user_id: event.userId`
  (when defined), `timestamp_micros: event.timestamp * 1000`.
- `page(event: CanonicalEvent)` sends a `page_view` event with
  `page_title: event.name === "" ? undefined : event.name` (per issue
  002's name-sentinel convention) folded with the globally-translated
  `event.properties`.
- Unmapped event names pass through unchanged with exactly one
  `console.warn` per unique name per adapter instance.
- `eventMap`/`propertyMap` overrides merge over defaults per the rules
  above, verified by tests.
- `capabilities` matches the table above exactly; `group`/`alias`/`screen`
  are not present on the returned object.
- `identify()` makes zero `fetch` calls and no longer stores a `userId`
  internally.
- `reset()` clears `currentUserProperties`.
- No changes to `src/` (core) or any other package.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `packages/provider-ga4/src/index.test.ts`):
- A canonical event name present in the default map is translated
  correctly (e.g. `"Purchase Completed"` → `purchase`).
- An unmapped canonical event name passes through unchanged and triggers
  exactly one `console.warn` (spy it); a second `track()` call with the
  same unmapped name does not warn again; a different unmapped name does.
- An `eventMap` override in config wins over the default for a colliding
  key, and a brand-new custom key not in the default table is honored.
- `propertyMap` per-event override beats global, global is used as
  fallback, unmapped property keys pass through unchanged — cover all
  three lookup orders with `"Purchase Completed"` (`orderId`/`total`) as
  the worked example.
- `track()`'s `client_id`/`user_id` come from `event.anonymousId`/
  `event.userId`, not from any adapter-generated ID (assert two different
  `track()` calls with different `event.anonymousId` values produce
  different `client_id`s in the request body — proving no adapter-side
  caching).
- `identify()` triggers zero `fetch` calls (unchanged assertion from
  phase 2, re-verified against the new 3-arg signature).
- `reset()` clears `currentUserProperties` such that a subsequent
  `track()`'s request body has no `user_properties` field.
- `capabilities` object matches exactly (identify/page `true`; the rest
  `false`).
- `destroy()` resolves and makes zero `fetch` calls.

**Integration tests** (extend
`packages/provider-ga4/src/index.integration.test.ts`): local HTTP server
(never real Google infrastructure), asserting a full `track()` with an
unmapped-then-mapped event name sequence produces the correct translated
`events[0].name` and `params` in the received request body, and that
`destroy()` resolves cleanly with the local server receiving no further
requests after.

## Out of scope

- Everything already out of scope per the original phase-2 GA4 issue
  (browser adapter, batching multiple events per request, enforcing GA4's
  own limits, `/debug/mp/collect`, app-stream mode, region-specific
  endpoints, retry/backoff) — unchanged, still out of scope.
- `group()`/`alias()`/`screen()` implementations — capabilities are all
  `false`; do not implement these methods even as stubs.
- Expanding the default event-name/property-name tables beyond the six
  events and two property examples specified above — a reasonably useful,
  cited starting set, not an exhaustive GA4 ecommerce/lifecycle catalogue.
