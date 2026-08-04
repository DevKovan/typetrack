# 002 — `createSegmentFetchProvider`: zero-dependency, fetch-based Segment adapter

## Context

Independent of issue 001 (same pattern, different package/vendor). Read
`packages/provider-segment/src/index.ts` in full — this issue lives in
the same package, adds a second factory alongside the existing
`createSegmentProvider`, and must produce byte-for-byte-equivalent
event/property translation for the same config (design decision 2,
BRIEF.md).

**Before writing any code**, use `WebFetch` to read Segment's published
HTTP Tracking API reference (https://segment.com/docs/connections/
sources/catalog/libraries/server/http-api/ — search Segment's docs site
if this exact path has moved) for the `/v1/track`, `/v1/page`,
`/v1/screen`, `/v1/identify`, `/v1/group`, `/v1/alias`, and `/v1/batch`
endpoint request shapes and authentication scheme (HTTP Basic Auth using
the write key as the username with an empty password — confirm this
against the current docs rather than assuming, and confirm the exact
request body field names, e.g. `userId`/`anonymousId`/`event`/
`properties`/`timestamp`/`context` for `/track`). Cite the exact URL(s)
read in a code comment, matching the existing adapter's own citation
style.

## Scope of this issue

- New `packages/provider-segment/src/mapping.ts`: extract
  `DEFAULT_EVENT_MAP`, the property-map type/merge/translate helpers, and
  the unmapped-event-name warn-once helper out of the existing
  `src/index.ts` into this shared file (same extraction pattern as issue
  001 for PostHog). Update `createSegmentProvider` to import from
  `mapping.ts` instead — **zero behavior change** to the existing
  SDK-based adapter (regression-tested).
- New `packages/provider-segment/src/fetch.ts`, exporting:
  - `SegmentFetchProviderConfig` — `{ writeKey: string; host?: string;
    eventMap?: Record<string, string>; propertyMap?: {...} }` (a
    deliberate subset of `SegmentProviderConfig` — no
    `path`/`maxEventsInBatch`/`flushInterval` client-batching options).
  - `createSegmentFetchProvider(config: SegmentFetchProviderConfig):
    AnalyticsProvider` — imports only from `./mapping` and `typetrack`
    (zero vendor dependency; do not import `@segment/analytics-node`).
    Authenticates every request via an `Authorization: Basic
    ${encodeBasicAuth(writeKey)}` header — implement the Base64 encoding
    with `btoa` (globally available across Node 18+, Bun, Deno, browsers,
    and Workers/Edge runtimes — do **not** use Node's `Buffer`, which is
    not universally available in edge/Workers environments and would
    silently defeat this adapter's whole purpose). Every method performs
    a plain `fetch()` POST to the corresponding endpoint (read
    `packages/provider-ga4/src/index.ts`'s exact `track()` implementation
    first and replicate its established fetch-error-propagation contract,
    same as issue 001).
  - `track`/`page`/`screen`/`identify`/`group`/`alias`: same event-name/
    property translation as the SDK-based adapter (via `mapping.ts`),
    each POSTed to its real, distinct Segment endpoint (unlike PostHog,
    Segment's HTTP API does have dedicated endpoints for each of these —
    confirm against the docs read above).
  - No `trackBatch` for this adapter in this issue — Segment's `/v1/batch`
    endpoint exists, but its request shape wraps a list of
    already-fully-formed per-call bodies (each with its own `type` field
    distinguishing track/page/identify/etc.), which is more involved than
    PostHog's simpler single-event-shape batch endpoint; **explicitly
    deferred**, not silently skipped — see Out of scope.
    `capabilities.batch` is therefore `false`/omitted for this adapter,
    honestly reflecting that `trackBatch` isn't implemented.
  - `flush()`/`destroy()`: both no-ops, same rationale as issue 001.
  - `reset()`: no-op, matching the SDK-based adapter's own no-op
    rationale.
  - `capabilities`: `identify: true, group: true, alias: true, page: true,
    screen: true, batching: false, offline: false, featureFlags: false,
    sessionReplay: false, heatmaps: false` (no `batch` key, or
    `batch: false` — implementor's choice consistent with how this
    codebase distinguishes "explicitly false" vs. "omitted," check
    `src/providers/index.ts`'s own comment on `batch` for the established
    convention and follow it).
- Export `createSegmentFetchProvider` and `SegmentFetchProviderConfig`
  from `packages/provider-segment/src/index.ts`'s barrel, alongside the
  existing `createSegmentProvider`/`SegmentProviderConfig` exports.

## Design decisions made in this issue

- **`btoa`, never `Buffer`, for Basic Auth encoding.** This is the single
  most important correctness detail in this issue — using `Buffer` would
  make the adapter silently fail (or fail to even load) in exactly the
  runtimes (Workers, Edge, browser) this phase exists to support, which
  would defeat the entire point while still technically compiling and
  passing Node-based tests. `writeKey` is expected to be ASCII (Segment
  write keys are alphanumeric), so `btoa(writeKey + ":")` is safe without
  needing a UTF-8-safe encoding shim.
- **`trackBatch` is deferred, not implemented with a naive shortcut.**
  Segment's batch endpoint requires each item to carry its own `type`
  discriminator and match that call's own endpoint-specific body shape —
  implementing it correctly is a real, separable unit of work; forcing it
  into this issue risks a rushed, subtly-wrong implementation. A
  follow-up issue/phase can add it once there's a concrete need.

## Acceptance criteria

- `packages/provider-segment/src/mapping.ts` exists; `createSegmentProvider`
  (existing SDK-based factory) is refactored to use it with zero behavior
  change (every existing test for that factory continues passing
  unmodified).
- `createSegmentFetchProvider` exists, has zero import from
  `@segment/analytics-node`, and produces the same translated event
  name/properties as `createSegmentProvider` for equivalent config
  (verified by a shared-fixture test comparing both adapters' outbound
  payloads for the same `CanonicalEvent`, minus transport-specific
  fields).
- Every request carries the correct `Authorization: Basic <...>` header,
  verified by decoding the stubbed `fetch` call's header and confirming
  it equals `writeKey + ":"` base64-encoded.
- `track()`/`page()`/`screen()`/`identify()`/`group()`/`alias()` each
  produce exactly one `fetch()` call to the correct, distinct endpoint
  and body shape (verified via a stubbed global `fetch`).
- `capabilities` matches the exact object specified above (no `batch:
  true`).
- `flush()`/`destroy()` resolve without making any network call.
- `host` config override is honored.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`packages/provider-segment/src/fetch.test.ts`): every
branch in Acceptance criteria above, via a stubbed global `fetch` spy —
including explicit Basic Auth header decoding/assertion.

**Integration tests**
(`packages/provider-segment/src/fetch.integration.test.ts`, or folded
into this package's existing integration test file convention — check
first): construct a `typetrack` `Analytics` instance with
`createSegmentFetchProvider` as its provider, exercise a realistic
`track`/`identify`/`flush`/`destroy` sequence end-to-end, assert on the
stubbed `fetch` calls produced.

## Out of scope

- `trackBatch`/`/v1/batch` support — explicitly deferred, see Design
  decisions.
- Any change to `createSegmentProvider`'s public behavior (only its
  internal implementation is refactored to share `mapping.ts`).
- `ProviderCapabilities.runtimes` — issue 003.
- SSR-safety test coverage — issue 004.
- `examples/runtimes/` — issue 005.
