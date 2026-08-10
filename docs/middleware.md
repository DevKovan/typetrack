# Middleware

## What middleware is

A linear (not onion/wrap) `before`/`after`/`onError` chain a
`CanonicalEvent` runs through for `track`/`page`/`screen` only —
`identify`/`group`/`alias`/`reset`/`flush`/`destroy` have no
`CanonicalEvent` and never run through the chain:

```ts
export interface Middleware {
  name: string;
  before?(event: CanonicalEvent): CanonicalEvent | null | undefined | Promise<CanonicalEvent | null | undefined>;
  after?(event: CanonicalEvent): void | Promise<void>;
  onError?(error: unknown, event: CanonicalEvent, ctx: { source: "middleware" | "provider"; providerName?: string }): void | Promise<void>;
}
```

Register with `.use(middleware)` — accumulates in registration order, no
dedup by `name`.

## Execution order, precisely

1. `before` runs for every registered middleware, in registration order,
   each one's return value threading into the next.
2. A `before()` returning `null`/`undefined` **drops** the event — no
   dispatch, no `after` chain, `track()`/`page()`/`screen()` resolves
   normally as if the call never happened.
3. Dispatch runs against the post-`before`-chain event (routing/capability/
   provider calls all see the possibly-transformed event).
4. `after` runs for every registered middleware, **in registration order
   (not reversed)**, against that same dispatched event — pure observation,
   no further transformation possible.

**Errors**: a `before()`/`after()` that throws is reported to the throwing
middleware and every middleware *before* it in the chain (never later
ones) via `onError` — the chain then stops (treated like a drop for
`before`; for `after`, dispatch has already happened, so this isn't a
drop, just a truncated `after` pass). A provider-dispatch failure is
reported to every registered middleware's `onError`, with
`ctx.source: "provider"` and `ctx.providerName` set.

## Built-in middlewares

All six live under `src/middleware/`. None are auto-registered — every one
requires an explicit `.use(...)` call.

### `redactMiddleware({ fields, replacement?, targets? })`

Redacts exact (possibly dotted) field paths, e.g. `["email", "user.ssn"]`.
**Replaces the value, never removes the key** — a field's value becomes
`"[REDACTED]"` (or your custom `replacement`) but downstream consumers that
pattern-match on a field's presence keep seeing the same shape. `targets`
defaults to `["properties"]` only — opt into `"context"`/`"metadata"`
explicitly.

### `piiFilterMiddleware(options?)`

**Complementary to `redactMiddleware`, not a replacement.** Recursively
walks every plain object/array in the targeted fields (default
`["properties"]`) and redacts any key whose *name* matches a pattern — a
built-in default list (`email`, `phone`, `ssn`, `password`, `creditCard`,
`address`, `dob`, and more) plus your own `patterns`, catching PII in
shapes you didn't enumerate up front (e.g. `attendees: [{ email }, {
email }]`). `redactMiddleware` targets exact paths you list in advance and
doesn't descend into arrays; `piiFilterMiddleware` targets key *names*
anywhere, including inside arrays. Use either or both.

### `samplingMiddleware({ rate })`

A **global, pre-dispatch, one-time-per-event** gate — the drop decision
happens once, in `before()`, before *any* provider's routing/capability
gating is evaluated. If this drops an event, no provider in the list ever
sees it, regardless of that provider's own `include`/`exclude`/`predicate`/
`sampling`.

This is distinct from `ProviderEntry.sampling` (per-provider routing,
evaluated later, once per provider) — an event that passes
`samplingMiddleware` can still be excluded from one specific provider by
that provider's own `sampling`, while being delivered to every other
provider in the same list. See [`docs/cookbook.md`](./cookbook.md#sample-a-fraction-of-events-globally-vs-per-provider)
for a side-by-side example. Both layers hash on `event.anonymousId` using
the same function, so a given user's in/out decision is consistent across
layers for the same rate.

### `loggingMiddleware(options?)`

Logs `before`/`after`/`onError` activity for every event. The one built-in
exercising all three hook types — a good reference shape to copy when
writing your own full-coverage middleware. `log` overrides the sink
(defaults to `console.log`/`console.warn`).

### `enrichmentMiddleware({ properties?, context? })`

Merges a static object (or a per-event function) into `properties`/
`context`. **Enrichment overrides on key collision** — a computed
enrichment key always wins over a key already present on the event. Use
this for "always attach this computed value" (app version, environment,
feature-flag state), not "fill in only if absent".

### `versionMiddleware({ appVersion?, buildId? })`

A narrower, named specialization of `enrichmentMiddleware` targeting
`event.metadata` specifically (app version/build id is infrastructure
metadata, not application-domain event data). Non-clobbering merge —
existing `metadata` keys survive; the configured value wins only on a
literal name collision (`appVersion`/`buildId`).

### `timingMiddleware({ onTiming, now? })`

Measures `before()`-to-`after()` wall-clock duration per event (a
per-event `WeakMap` pairing, not a single shared "last start" variable —
so concurrent/interleaved `track()` calls never cross-contaminate each
other's measured duration), reported via `onTiming(event, durationMs)`.

**Registration-order caveat**: register `timingMiddleware` *after* any
event-*transforming* middleware in the chain (e.g. `redactMiddleware`/
`enrichmentMiddleware`/`versionMiddleware`, which all return a new event
object). If a later middleware replaces the event reference,
`timingMiddleware`'s `after()` won't match the object it recorded a start
time for in `before()`, and the duration silently won't be reported.
Pure observers (like `loggingMiddleware`) are safe to register either
side, since they never replace the event object.

```ts
analytics.use(redactMiddleware({ fields: ["email"] }));      // transforms — register first
analytics.use(timingMiddleware({ onTiming: (e, ms) => console.log(e.name, ms) })); // register after
```

## Writing custom middleware

```ts
const myMiddleware: Middleware = {
  name: "my-middleware",
  before(event) {
    return { ...event, properties: { ...event.properties, enriched: true } };
  },
};
analytics.use(myMiddleware);
```

Registration order matters — see `timingMiddleware`'s caveat above for a
concrete example of why. See `examples/middleware/pipeline-basics` for a
full runnable composition of multiple built-ins together.
