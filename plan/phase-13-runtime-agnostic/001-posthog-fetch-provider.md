# 001 — `createPostHogFetchProvider`: zero-dependency, fetch-based PostHog adapter

## Context

Depends on nothing from other Phase 13 issues (independent of issue 002;
issue 003 will later add the `runtimes` capability field this issue's
`capabilities` object should already anticipate/leave room for, but does
not need to add itself). Read `packages/provider-posthog/src/index.ts` in
full — this issue lives in the same package, adds a second factory
alongside the existing `createPostHogProvider`, and must produce
byte-for-byte-equivalent event/property translation for the same config
(design decision 2, BRIEF.md).

**Before writing any code**, use `WebFetch` to read PostHog's published
HTTP API reference (https://posthog.com/docs/api/post-only-endpoints and
https://posthog.com/docs/api/capture — search PostHog's docs site if
these exact paths have moved) for the `/capture/` and `/batch/` endpoint
request shapes, and for how `identify`/`group`/`alias` are represented as
special events over that same HTTP API (PostHog's HTTP capture API has no
separate identify/group/alias endpoints — they are conventionally
represented as specially-named events, `$identify`/`$groupidentify`/
`$create_alias`, sent through `/capture/` — confirm the exact property key
names for each against the current docs rather than assuming). Cite the
exact URL(s) read in a code comment, matching the existing adapter's own
citation style (see its GA4 sibling's Google-docs citations).

## Scope of this issue

- New `packages/provider-posthog/src/mapping.ts`: extract
  `DEFAULT_EVENT_MAP`, `PostHogPropertyMap`, `DEFAULT_PROPERTY_MAP`,
  `mergePropertyMap`, `translateProperties`, and the unmapped-event-name
  warn-once helper (`translateEventName`'s core logic, parameterized by a
  `Set<string>` the caller owns, since each provider instance needs its
  own independent warn-once bookkeeping) out of the existing
  `src/index.ts` into this new shared file. Update `createPostHogProvider`
  in `src/index.ts` to import from `mapping.ts` instead of defining these
  inline — **zero behavior change** to the existing SDK-based adapter
  (regression-tested).
- New `packages/provider-posthog/src/fetch.ts`, exporting:
  - `PostHogFetchProviderConfig` — `{ apiKey: string; host?: string;
    eventMap?: Record<string, string>; propertyMap?: PostHogPropertyMap
    }` (a deliberate subset of `PostHogProviderConfig` — no
    `flushAt`/`flushInterval`/`requestTimeout`/`disableGeoip` client-batching
    options, since there is no client to configure; `host` defaults to
    PostHog's real capture endpoint host, matching whatever the SDK-based
    adapter's own default resolves to).
  - `createPostHogFetchProvider(config: PostHogFetchProviderConfig):
    AnalyticsProvider` — imports only from `./mapping` and `typetrack`
    (zero vendor dependency; do not import `posthog-node`). Every method
    performs a plain `fetch(`${host}/capture/`, { method: "POST", headers:
    { "content-type": "application/json" }, body: JSON.stringify(...) })`
    (or `/batch/` for `trackBatch`, see below) and does **not** await the
    response body — mirrors the existing GA4 adapter's fire-and-forget
    `fetch()` pattern (read `packages/provider-ga4/src/index.ts`'s exact
    `track()` implementation and match its error-propagation contract:
    does it await the fetch call itself, check `response.ok`, and how
    does a rejected fetch propagate — replicate whatever that established
    contract is here, for consistency across adapters, rather than
    inventing a new one).
  - `track`/`page`/`screen`: same event-name/property translation as the
    SDK-based adapter (via `mapping.ts`), POSTed as a single-event
    `/capture/` body.
  - `identify`/`group`/`alias`: represented as the special PostHog events
    researched above, POSTed through `/capture/` (not real distinct
    endpoints, since none exist in PostHog's HTTP API).
  - `trackBatch(events: CanonicalEvent[])` (Phase 12's optional
    batch-drain method): POSTs once to `/batch/` with every event
    translated and included, per the researched batch body shape.
    `capabilities.batch: true` is set on this adapter specifically because
    it implements `trackBatch` — this is a **different** flag from
    `batching` (see BRIEF.md decision 3): `batching: false` (no
    client-internal batching happens on its own without Phase 12's queue
    driving it), `batch: true` (opts into receiving Phase 12's
    drain-loop-coalesced calls when the app also enables
    `reliability`).
  - `flush()`/`destroy()`: both no-ops (a `fetch()`-based adapter has
    nothing to flush or tear down) — document why explicitly rather than
    omitting the methods silently (omitting them is also valid per
    `AnalyticsProvider`'s optional-method contract; implementor's choice,
    document whichever is taken).
  - `reset()`: no-op, matching the SDK-based adapter's own no-op
    rationale (no adapter-owned identity state).
  - `capabilities`: `identify: true, group: true, alias: true, page: true,
    screen: true, batching: false, offline: false, featureFlags: false,
    sessionReplay: false, heatmaps: false, batch: true` — `featureFlags:
    false` here (vs. `true` on the SDK-based adapter) because there is no
    `getFeatureFlag`/`getAllFlags`-equivalent HTTP endpoint this adapter
    implements; do not add feature-flag support as part of this issue.
- Export `createPostHogFetchProvider` and `PostHogFetchProviderConfig`
  from `packages/provider-posthog/src/index.ts`'s barrel, alongside the
  existing `createPostHogProvider`/`PostHogProviderConfig` exports.

## Design decisions made in this issue

- **`identify`/`group`/`alias` still take zero *separate* network calls
  beyond the one `/capture/` POST each** — consistent with the SDK-based
  adapter's existing "forward only, no adapter-owned identity state"
  design; this issue does not introduce any new identity-caching
  behavior.
- **`trackBatch` posts to `/batch/` in one request, not N parallel
  `/capture/` requests** — the whole reason PostHog's batch endpoint
  exists is to avoid N round trips; using it here is the entire point of
  this adapter also declaring `batch: true`.
- **No retry/backoff logic inside this adapter.** A failed `fetch()`
  simply propagates (or resolves-with-a-non-ok-status, matching whatever
  the GA4 adapter's own established contract is) — Phase 12's core
  reliability queue is the intended retry mechanism for this adapter,
  not adapter-internal logic (BRIEF.md's stated synergy).

## Acceptance criteria

- `packages/provider-posthog/src/mapping.ts` exists; `createPostHogProvider`
  (existing SDK-based factory) is refactored to use it with zero behavior
  change (every existing test for that factory continues passing
  unmodified).
- `createPostHogFetchProvider` exists, has zero import from
  `posthog-node`, and produces the same translated event
  name/properties as `createPostHogProvider` for equivalent config
  (verified by a shared-fixture test comparing both adapters' outbound
  payloads for the same `CanonicalEvent`, minus transport-specific
  fields).
- `track()`/`page()`/`screen()`/`identify()`/`group()`/`alias()` each
  produce exactly one `fetch()` call to the correct endpoint/body shape
  (verified via a stubbed global `fetch`).
- `trackBatch()` with 3 events produces exactly one `fetch()` call to
  `/batch/` containing all 3 translated events.
- `capabilities` matches the exact object specified above.
- `flush()`/`destroy()` resolve without making any network call.
- `host` config override is honored (custom host is used in the POSTed
  URL instead of the default).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`packages/provider-posthog/src/fetch.test.ts`): every
branch in Acceptance criteria above, via a stubbed global `fetch` spy —
mirror the existing SDK-based adapter's own test file's structure/
conventions where applicable.

**Integration tests**
(`packages/provider-posthog/src/fetch.integration.test.ts`, or folded
into the existing integration test file if that's this package's
established convention — check first): construct a `typetrack`
`Analytics` instance with `createPostHogFetchProvider` as its provider,
exercise a realistic `track`/`identify`/`flush`/`destroy` sequence
end-to-end, assert on the stubbed `fetch` calls produced.

## Out of scope

- Feature-flag support (`getFeatureFlag`/`getAllFlags`-equivalent).
- Any change to `createPostHogProvider`'s public behavior (only its
  internal implementation is refactored to share `mapping.ts`).
- `ProviderCapabilities.runtimes` — issue 003.
- SSR-safety test coverage — issue 004.
- `examples/runtimes/` — issue 005.
