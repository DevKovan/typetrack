# 004 — PostHog adapter canonical rewrite (mapping tables, capabilities, lifecycle)

## Context

Depends on issues 001-002. Same breaking-rewrite framing as issue 003,
applied to `packages/provider-posthog/src/index.ts`: `track()`/`page()`
now take a single `CanonicalEvent`; the adapter **stops generating its own
anonymous `distinctId`** — `distinctId` for every `track()`/`page()`/
`screen()` call is now derived per-call as `event.userId ?? event.anonymousId`,
since core (issue 002) already stamps identity onto every `CanonicalEvent`.
Delete the old `let distinctId: string = crypto.randomUUID()` +
"promote on identify" logic entirely; this is intentional, not an
oversight.

Merge algorithm (event-name map override-wins, property-map global/
per-event merge, warn-once-per-unmapped-name Set) is identical to issue
003's — see that issue's "Config, merge, and warn-once semantics" section
for the exact rules; this issue applies the same rules to this adapter's
own local `DEFAULT_EVENT_MAP`/`DEFAULT_PROPERTY_MAP`/config fields (each
adapter package is self-contained per phase-2 precedent — no shared
mapping-merge helper package).

## Event-name mapping table (researched, cited)

PostHog publishes only an **optional, non-enforced** ecommerce-naming
recommendation (https://posthog.com/docs/data/event-spec/ecommerce-events
— the page itself says "we recommend implementing this spec," not that it
is required; `capture()` accepts any string as an event name). Per the
Phase 6 locked design, this adapter's default table is therefore
**identity/passthrough** for the same six canonical names used in issues
003/005, so overriding still works but no spurious "unmapped name" warning
fires for the shipped default canonical set:

```ts
const DEFAULT_EVENT_MAP: Record<string, string> = {
  "User Signed Up": "User Signed Up",
  "User Logged In": "User Logged In",
  "Checkout Started": "Checkout Started",
  "Purchase Completed": "Purchase Completed",
  "Product Viewed": "Product Viewed",
  "Search Performed": "Search Performed",
};
```

## Property-name mapping table

`DEFAULT_PROPERTY_MAP = {}` (no global or per-event entries) — pure
passthrough, for the same reason (no vendor-mandated property naming).
`config.propertyMap` override still works via the same merge rules as
issue 003, it's simply empty by default.

## Identity rewrite

- Delete `let distinctId: string = crypto.randomUUID()` and the
  "`identify()` promotes `distinctId`" logic entirely.
- `track(event: CanonicalEvent)`: `client.capture({ distinctId: event.userId
  ?? event.anonymousId, event: <translated name>, properties: <translated
  properties>, timestamp: new Date(event.timestamp) })`.
- `identify(userId, traits, anonymousId)` (new 3-arg signature):
  `client.identify({ distinctId: userId, properties: traits })` — forward
  only, no internal state kept (there is nothing left to promote, since
  `track()`/`page()`/`screen()` already derive `distinctId` per-call from
  the event object).
- `group(groupId, traits, identity)`: **Design decision** — PostHog's
  `groupIdentify()` requires both a `groupType` and a `groupKey`, but
  core's `group(groupId, traits)` verb supplies only one identifier. This
  adapter uses a fixed constant `groupType: "group"` for every call, with
  `groupKey: groupId`: `client.groupIdentify({ groupType: "group",
  groupKey: groupId, groupProperties: traits })`. Document this constant
  and the reason for it in a code comment; it's a real, if narrow, design
  choice bridging a shape mismatch between core's single-identifier verb
  and PostHog's two-identifier group model.
- `alias(newUserId, previousUserId, anonymousId)`: forward to the client's
  `alias()` method — **verify the exact field names
  (`distinctId`/`alias`, or whatever the installed `posthog-node` version's
  type declarations actually name them) before implementing**; do not
  guess. `distinctId: newUserId, alias: previousUserId ?? anonymousId`.
- `screen(event: CanonicalEvent)`: for consistency with this adapter's
  existing `page()` convention (folding an optional name into `properties`
  under the key `name`, not inventing a PostHog-specific `$screen_name`
  convention that isn't already established in this codebase),
  `client.capture({ distinctId: event.userId ?? event.anonymousId, event:
  "$screen", properties: { ...event.properties, ...(event.name === "" ? {}
  : { name: event.name }) } })`.
- `page(event: CanonicalEvent)`: same fold pattern, `event: "$pageview"`.
- `reset()`: no-op (`reset() {}`) — there is no adapter-owned identity
  state left to clear after this rewrite (state the reason in a code
  comment; the interface's `reset?()` hook remains legal to call, it's
  just a legitimate no-op for this adapter's design).

## Capabilities (researched, truthfully declared)

```ts
capabilities: {
  identify: true, group: true, alias: true, page: true, screen: true,
  batching: true, offline: false, featureFlags: true,
  sessionReplay: false, heatmaps: false,
}
```
Rationale: `groupIdentify()`/`alias()` are real posthog-node methods
(group/alias `true`); `flushAt`/`flushInterval` batch client-side
(`batching: true`); no persistent offline queue across restarts
(`offline: false`); `getFeatureFlag`/`getAllFlags` are real methods
(`featureFlags: true`, declarative-only this phase, no core verb calls it);
session replay and heatmaps are `posthog-js` (browser) capture-time
features with no server-SDK equivalent — this is a server-side (Node)
adapter, so both are `false`.

## Lifecycle

- `flush()`: unchanged — `client.flush()`, never `shutdown()`, non-terminal.
- `destroy()` (new): flush first, then close. **Verify against the
  installed `posthog-node` version's type declarations** that `shutdown()`
  is the correct terminal method before implementing:
  `async destroy() { await client.flush(); await client.shutdown(); }`.

## Acceptance criteria

- `track`/`page`/`screen` derive `distinctId` from `event.userId ??
  event.anonymousId` on every call — no adapter-owned identity variable
  remains anywhere in the file.
- `eventMap`/`propertyMap` config overrides merge over the (identity /
  empty) defaults per issue 003's merge rules; unmapped names still warn
  once per unique name (even though the default table already covers the
  six canonical names — a genuinely custom event name not in the merged
  map still warns).
- `group()` uses the fixed `groupType: "group"` constant as documented.
- `identify()`/`alias()` forward correctly with the new 3-arg signatures.
- `capabilities` matches the table above exactly.
- `flush()` never calls `shutdown()`; `destroy()` calls `flush()` then
  `shutdown()`, in that order.
- No changes to `src/` (core) or any other package.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `packages/provider-posthog/src/index.test.ts`):
- `track()` with `event.userId` set uses it as `distinctId`; with
  `event.userId` undefined, uses `event.anonymousId` — verified across two
  calls with different `anonymousId`s and no adapter-side caching (proving
  the old "promote on identify" logic is gone).
- Unmapped-name warn-once behavior (same shape as issue 003's tests).
- `eventMap`/`propertyMap` merge-override tests (same shape as issue 003's).
- `group("acme", { plan: "pro" }, { anonymousId: "a1" })` calls
  `client.groupIdentify()` with `groupType: "group"`, `groupKey: "acme"`,
  `groupProperties: { plan: "pro" }`.
- `alias()` forwards to the client's alias method with the correct field
  names for the installed SDK version.
- `screen()` calls `client.capture()` with `event: "$screen"` and folds
  a non-empty `name` into properties; an empty-string name is not folded.
- `capabilities` object matches exactly.
- `flush()` calls `client.flush()` and never `client.shutdown()`.
- `destroy()` calls `client.flush()` then `client.shutdown()`, in that
  order (assert call order via mock call sequencing).
- `reset()` does not throw and (since it's a no-op) does not call any
  client method.

**Integration tests** (extend
`packages/provider-posthog/src/index.integration.test.ts`): local HTTP
server standing in for `{host}/batch/`, exercising `track()` before/after
a simulated identity change (`event.userId` set on the `CanonicalEvent`
passed directly, since identity now lives in the event, not adapter
state), `group()`, `alias()`, `screen()`, and a full `destroy()` call,
asserting the server received the expected distinct IDs/group
type-and-key/alias fields, and that no further requests arrive after
`destroy()` resolves.

## Out of scope

- Any browser/client-side PostHog adapter (`posthog-js`) — unchanged, still
  deferred.
- Any real feature-flag-consuming core verb — `featureFlags: true` is
  declarative only this phase.
- Any session-replay/heatmaps capture mechanism — both `false`, and no
  code should attempt to enable them.
- Expanding the default event-name table beyond the six shared canonical
  names — the identity mapping is deliberately minimal.
