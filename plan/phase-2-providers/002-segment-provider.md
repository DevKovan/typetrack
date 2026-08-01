# 002 — Segment provider adapter (`@typetrack/provider-segment`)

## Context

Same phase and constraints as issue 001 (see that issue for the shared
background on the frozen Phase-1 core contracts and the "config via factory
function, not `init()`" rule). This issue covers Segment only. Do not
re-scaffold `packages/provider-segment/` — fill in its `src/index.ts`
placeholder.

Vendor: `@segment/analytics-node` (Twilio Segment's official Node SDK).
Latest published version at research time is `3.1.0` — install with
`bun add @segment/analytics-node` inside `packages/provider-segment` rather
than hand-copying that version number.

Relevant `@segment/analytics-node` API surface (verify exact field names
against the installed version's type declarations before relying on them):
- `new Analytics({ writeKey, host?, path?, maxEventsInBatch?, flushInterval?, disable? })`.
  `host` defaults to `https://api.segment.io`, `path` defaults to
  `/v1/batch` — the SDK POSTs batched events to `{host}{path}`.
- `analytics.track({ userId?, anonymousId?, event, properties })`.
- `analytics.identify({ userId, anonymousId?, traits })`.
- `analytics.page({ userId?, anonymousId?, name, properties })`.
- `analytics.closeAndFlush()` — flushes all queued events and **permanently
  stops** the client from collecting new events. No standalone,
  non-terminal `flush()` was found documented for this package version;
  treat `closeAndFlush()` as the only confirmed flush primitive.

**Design decision (identity state) — same rationale as issue 001, applied
to Segment's shape:** core's `AnalyticsProvider.track()` carries no user
identifier. This adapter must track identity internally:
- On creation, generate one random anonymous ID (`crypto.randomUUID()`) and
  hold it as `anonymousId`.
- Before any `identify()` call, `track()`/`page()` pass `{ anonymousId }`
  (no `userId`).
- `identify(userId, traits)` calls the vendor's `identify()` with
  `{ userId, anonymousId, traits }` (passing the original `anonymousId`
  alongside `userId` is Segment's documented identity-stitching pattern),
  and stores `userId` internally.
- After `identify()`, `track()`/`page()` pass both `{ userId, anonymousId }`
  (Segment's stitching pattern), not `anonymousId` alone.

**Design decision (flush is terminal for this adapter):** because only a
closing `closeAndFlush()` is confirmed to exist, this adapter's `flush()`
maps to it. This means, unlike the PostHog adapter, calling `flush()` on
this adapter is a one-shot, end-of-lifecycle operation — the adapter is not
expected to be usable for further `track()`/`identify()`/`page()` calls
after `flush()` resolves. This asymmetry with the PostHog adapter is
intentional and must not be "fixed" by inventing a non-terminal flush that
isn't documented for the installed SDK version.

## Acceptance criteria

- `packages/provider-segment/src/index.ts` exports
  `createSegmentProvider(config: SegmentProviderConfig): AnalyticsProvider`.
- `SegmentProviderConfig` is a local type with at least: `writeKey: string`
  (required), `host?: string`, `path?: string`, `maxEventsInBatch?: number`,
  `flushInterval?: number`.
- Calling `createSegmentProvider(config)` synchronously constructs exactly
  one `@segment/analytics-node` `Analytics` client from `config` and returns
  an object implementing `AnalyticsProvider` (imported as
  `import type { AnalyticsProvider } from "typetrack";`) with
  `name: "segment"`.
- `track(event, payload, meta)` calls the client's `track()` with `event`,
  `payload` folded into `properties`, and the current identity
  (`anonymousId` alone, or `userId` + `anonymousId` post-identify, per the
  Context design decision). `meta.timestamp` must be forwarded if the
  installed SDK version's `track()` type accepts a timestamp field;
  otherwise document in the commit why it's omitted.
- `identify(userId, traits)` calls the client's `identify()` with
  `userId`, `anonymousId`, and `traits`, and updates the adapter's stored
  `userId` so subsequent `track()`/`page()` calls use it.
- `page(name, props)` calls the client's `page()` with `name`, `props`
  folded into `properties`, and the current identity.
- `flush()` calls the client's `closeAndFlush()` and returns/awaits its
  promise.
- `packages/provider-segment/package.json` gains `@segment/analytics-node`
  as a runtime `dependency` (not `devDependency`), and `typetrack` as a
  `dependency` pinned via the workspace protocol
  (`"typetrack": "workspace:*"`).
- No changes to `src/` (core) or to any other package.

## Test requirements

Both unit and integration tests are required; neither alone satisfies this
issue.

**Unit tests** (`packages/provider-segment/src/index.test.ts`) — no real
network I/O. Construct the provider against a stubbed/mocked
`@segment/analytics-node` client and assert, in isolation:
- A `track()` call made before any `identify()` call passes
  `{ anonymousId: <generated id> }` (no `userId`) to the client's `track()`.
- A `track()` call made after `identify("user_1", { plan: "pro" })` passes
  both `userId: "user_1"` and the same `anonymousId` from before identify
  to the client's `track()`.
- `identify()` forwards `userId`/`anonymousId`/`traits` to the client's
  `identify()` with the correct field names.
- `page(name, props)` forwards to the client's `page()` correctly, folding
  `props` into `properties`.
- `flush()` calls the client's `closeAndFlush()`.

**Integration tests**
(`packages/provider-segment/src/index.integration.test.ts`) — a real HTTP
round-trip against a local server, never against real Segment
infrastructure or write keys. Start a local HTTP server (e.g.
`Bun.serve()`) that accepts `POST /v1/batch` and records the parsed JSON
request body. Construct
`createSegmentProvider({ writeKey: "test", host: <local server URL> })`,
call `track()` and `identify()`, then call `flush()` and await it, and
assert the local server received a request whose parsed body contains the
expected event name, user/anonymous IDs, and properties. Tear the local
server down at the end of the test.

## Out of scope

- Any browser/client-side Segment adapter (`@segment/analytics-next`
  browser build, or the legacy snippet) — explicitly deferred to a later
  phase.
- `group()` calls, or any other `@segment/analytics-node` capability beyond
  track/identify/page/flush mapped to `AnalyticsProvider`.
- Build/publish tooling for `packages/provider-segment` — unchanged from the
  current scaffold (raw TS via `main`/`types`).
- Retry/backoff logic beyond whatever `@segment/analytics-node` already does
  internally.
- A shared internal package for cross-adapter helpers — each provider
  package stays self-contained.
- Inventing/using a non-terminal `flush()` primitive if one is not actually
  present on the installed SDK version's public API — if the implementor's
  version-check turns up a genuine non-closing flush method, that's a scope
  change to flag, not to silently adopt.
