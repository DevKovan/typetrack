# 005 — Segment adapter canonical rewrite (mapping tables, capabilities, lifecycle change)

## Context

Depends on issues 001-002. Same breaking-rewrite framing as issues
003/004, applied to `packages/provider-segment/src/index.ts`:
`track()`/`page()` now take a single `CanonicalEvent`; the adapter
**stops generating its own `anonymousId`** — identity for every
`track()`/`page()`/`screen()` call now comes directly from
`event.anonymousId`/`event.userId`. Delete the old
`const anonymousId: string = crypto.randomUUID()` + `let userId` +
`identity()` helper entirely; this is intentional, not an oversight.

**This issue also changes `flush()`'s semantics — read carefully.** Per
the Phase 6 lifecycle contract (locked decision, `plan/phase-6-canonical/
BRIEF.md`): `flush()` must become **non-terminal** for this adapter (a
breaking behavior change from phase 2's `closeAndFlush()` mapping). The
existing adapter's own code comment (in the current, pre-rewrite
`packages/provider-segment/src/index.ts`) already asserts that "the
installed version, 3.1.0, does also expose a non-terminal `flush()` on the
vendor client." **Verify this directly against the currently-installed
`@segment/analytics-node` version's actual `.d.ts` type declarations
before implementing** — do not take the old comment's word for it without
checking, since the resolved version at implementation time may differ
from 3.1.0, and if the installed version genuinely has no separate
non-terminal `flush()` method, that is a blocking discrepancy with this
issue's design and must be flagged (do not silently invent a workaround —
e.g. do not fabricate a "flush" that's secretly `closeAndFlush()` under a
different name, and do not silently keep the old terminal mapping without
flagging it).

## Event-name mapping table (researched, cited)

Default `Record<string, string>`, per Segment's B2B SaaS spec
(https://segment.com/docs/connections/spec/b2b-saas/) and Ecommerce v2
spec (https://segment.com/docs/connections/spec/ecommerce/v2/):

```ts
const DEFAULT_EVENT_MAP: Record<string, string> = {
  "User Signed Up": "Signed Up",
  "User Logged In": "Signed In",
  "Checkout Started": "Checkout Started",
  "Purchase Completed": "Order Completed",
  "Product Viewed": "Product Viewed",
  "Search Performed": "Products Searched",
};
```

## Property-name mapping table (researched, cited)

Per Segment's Ecommerce v2 "Order Completed" (`order_id`, `revenue`,
`currency`) and "Product Viewed" (`product_id`, `name`, `price`) fields:

```ts
const DEFAULT_PROPERTY_MAP = {
  events: {
    "Purchase Completed": { orderId: "order_id", total: "revenue" },
    "Product Viewed": { productId: "product_id", name: "name" },
  },
} satisfies { global?: Record<string, string>; events?: Record<string, Record<string, string>> };
```

Merge algorithm identical to issue 003's "Config, merge, and warn-once
semantics" section (override-wins event-name map, global/per-event
property-map merge, warn-once-per-unmapped-name `Set`) — self-contained
per-package per phase-2 precedent, no shared helper.

## Identity rewrite

- Delete `const anonymousId`, `let userId`, and the `identity()` helper.
- Build the identity object per-call directly from the `CanonicalEvent`:
  `event.userId === undefined ? { anonymousId: event.anonymousId } :
  { userId: event.userId, anonymousId: event.anonymousId }` (Segment's
  documented stitching pattern, unchanged shape — now sourced from the
  event object instead of adapter state).
- `identify(userId, traits, anonymousId)` (new 3-arg signature):
  `client.identify({ userId, anonymousId, traits })` — forward only, no
  internal state kept.
- `group(groupId, traits, identity)`: `client.group({ ...( identity.userId
  === undefined ? { anonymousId: identity.anonymousId } : { userId:
  identity.userId, anonymousId: identity.anonymousId } ), groupId, traits
  })` — Segment's `group()` takes a single `groupId`, so (unlike PostHog)
  there is no identifier-shape mismatch to bridge here.
- `alias(newUserId, previousUserId, anonymousId)`: forward to the client's
  `alias()` method — **verify the exact field names (`userId`/`previousId`,
  or whatever the installed version's type declarations actually name
  them) before implementing.** `userId: newUserId, previousId:
  previousUserId ?? anonymousId`.
- `screen(event: CanonicalEvent)`: Segment's `analytics-node` has a real,
  documented `screen()` method (added per community request; Segment's
  Screen spec, https://segment.com/docs/connections/spec/screen/) —
  `client.screen({ ...identityFrom(event), name: event.name === "" ?
  undefined : event.name, properties: <translated properties> })`.
- `page(event: CanonicalEvent)`: same identity-object pattern,
  `client.page({ ...identityFrom(event), name: event.name === "" ?
  undefined : event.name, properties: <translated properties> })`.
- `reset()`: no-op (`reset() {}`) — no adapter-owned identity state
  remains after this rewrite; document the reason in a code comment, same
  as issue 004.

## Capabilities (researched, truthfully declared)

```ts
capabilities: {
  identify: true, group: true, alias: true, page: true, screen: true,
  batching: true, offline: false, featureFlags: false,
  sessionReplay: false, heatmaps: false,
}
```
Rationale: `group()`/`alias()`/`screen()` are all real, documented
`@segment/analytics-node` methods (all `true`); `maxEventsInBatch`/
`flushInterval` batch client-side (`batching: true`); no persistent
offline queue across restarts (`offline: false`); no feature-flag API,
session replay, or heatmaps capability exists on this SDK (`false`).

## Lifecycle (the breaking change)

- `flush()`: **no longer** maps to `closeAndFlush()`. Maps to the SDK's
  confirmed non-terminal `flush()` method (per the verification above).
  Adapter remains fully usable after `flush()` resolves.
- `destroy()` (new): flush first, then close —
  `async destroy() { await client.flush(); await client.closeAndFlush(); }`
  (or whichever combination the verified SDK surface actually supports for
  "drain then permanently close" — if `closeAndFlush()` alone already
  drains-then-closes such that calling `flush()` immediately before it is
  redundant, that's fine, keep both calls anyway for symmetry with the
  documented contract unless the verified types make the first call
  actively harmful, in which case document why it was dropped).

## Acceptance criteria

- `track`/`page`/`screen` derive identity from
  `event.anonymousId`/`event.userId` — no adapter-owned identity variable
  remains anywhere in the file.
- `eventMap`/`propertyMap` merge-override behavior matches issue 003's
  rules, applied to this adapter's own default tables above.
- `group()`/`alias()`/`screen()` are implemented and forward correctly.
- `capabilities` matches the table above exactly.
- `flush()` is verified non-terminal (adapter usable after) — this is the
  headline breaking change of this issue; `destroy()` is the new terminal
  operation.
- No changes to `src/` (core) or any other package.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `packages/provider-segment/src/index.test.ts`):
- Identity-object derivation from `event.userId`/`event.anonymousId`
  across pre- and post-identify-shaped `CanonicalEvent`s (no adapter-side
  caching — two calls with different `event.anonymousId` values produce
  different identity objects).
- Unmapped-name warn-once behavior (same shape as issue 003's tests).
- `eventMap`/`propertyMap` merge-override tests (same shape as issue 003's).
- `group()`, `alias()`, `screen()` forward to the correct client methods
  with the correct field names.
- `capabilities` object matches exactly.
- **`flush()` calls the SDK's non-terminal method (not `closeAndFlush()`)
  and the adapter remains usable for a subsequent `track()` call after
  `flush()` resolves** (assert a `track()` call after `flush()` succeeds
  without error) — this is the critical regression test for the breaking
  lifecycle change.
- `destroy()` calls `closeAndFlush()` (or the verified terminal-close
  method) and, after it resolves, a subsequent `track()` call either
  rejects or the test documents the SDK's actual post-close behavior
  (whichever the verified installed SDK version actually does — assert
  that behavior explicitly rather than assuming).

**Integration tests** (extend
`packages/provider-segment/src/index.integration.test.ts`): local HTTP
server standing in for `POST /v1/batch`, exercising: `track()` →
`flush()` → assert the local server received the batch → `track()` again
(proving the adapter is still usable post-`flush()`, the core regression
test for this issue) → `group()` → `alias()` → `screen()` → `destroy()`,
asserting the server received all expected requests and that `destroy()`
is the true end-of-lifecycle operation.

## Out of scope

- Any browser/client-side Segment adapter — unchanged, still deferred.
- Expanding the default event-name/property-name tables beyond the six
  events and two property examples specified above.
- Retry/backoff logic beyond whatever the SDK already does internally.
