# 001 — PostHog provider adapter (`@typetrack/provider-posthog`)

## Context

Phase 2 fills in the three server-side vendor provider adapters that were
scaffolded (but left as `export {}` placeholders) in `packages/provider-{posthog,segment,ga4}/`.
This issue covers PostHog only. Do not re-scaffold `packages/provider-posthog/`
(package.json name `@typetrack/provider-posthog`, `private: true`, `type: module`,
`main`/`types: src/index.ts` already exist) — fill in `src/index.ts`.

This depends on the frozen Phase-1 core contracts and must not modify them:
- `AnalyticsProvider` (`src/providers/index.ts`): `name`, optional `init`,
  `track(event, payload, meta)`, optional `identify(userId, traits?)`,
  optional `page(name?, props?)`, optional `flush()`.
- `EventMeta` (`src/schema.ts`): `{ timestamp: number }` (epoch ms).

Vendor: `posthog-node` (official PostHog Node SDK). Latest published version
at research time is `5.47.3` — install with `bun add posthog-node` inside
`packages/provider-posthog` rather than hand-copying that version number, so
the pin reflects whatever actually resolves at implementation time.

Relevant `posthog-node` API surface (verify exact field names against the
installed version's type declarations before relying on them):
- `new PostHog(apiKey: string, options?: PostHogOptions)`. Relevant options:
  `host` (ingestion host, default `https://us.i.posthog.com`), `flushAt`
  (batch size before auto-flush, default 20), `flushInterval` (ms, default
  10000), `requestTimeout`, `disableGeoip`.
- `client.capture({ distinctId, event, properties, ... })` — sends one event.
  Supports forwarding a timestamp for the event (confirm the exact option
  name/type on the installed version — e.g. a `Date`).
- `client.identify({ distinctId, properties })` — sets/updates person
  properties for a distinct ID. There is no separate "traits" naming in this
  SDK; it's `properties`.
- `client.flush()` — flushes the current queue **without** closing the
  client; safe to call repeatedly.
- `client.shutdown()` — flushes and **permanently closes** the client. Do
  **not** call this from the adapter — core's `Analytics.flush()` is not a
  terminal "close" operation, and this adapter must remain usable after
  `flush()` is called.
- Batched events are POSTed by the SDK to `{host}/batch/`.
- The Node SDK has no dedicated page-view call; the convention is a
  `capture()` with `event: "$pageview"`.

**Design decision (identity state) — read carefully, this is a real design
call made to bridge two APIs, not dictated by either:** core's
`AnalyticsProvider.track(event, payload, meta)` carries no user-identifier
argument; only `identify(userId, traits)` does, and it's called separately.
PostHog's `capture()` requires a `distinctId` on every call. This adapter
must therefore track "the current identity" internally:
- On creation, generate one random anonymous ID (`crypto.randomUUID()`) and
  hold it as the current distinct ID.
- Every `track()`/`page()` call uses the current distinct ID.
- `identify(userId, traits)` calls the vendor's `identify()` **and** updates
  the current distinct ID to `userId`, so all subsequent `track()`/`page()`
  calls in that provider instance's lifetime use the identified ID instead
  of the anonymous one.

Config is supplied once, synchronously, via a factory function — **not**
via `AnalyticsProvider.init()`. Core's `createAnalytics` never calls
`provider.init()` at all (verified in `src/index.ts`), so this adapter must
not rely on it being invoked.

## Acceptance criteria

- `packages/provider-posthog/src/index.ts` exports
  `createPostHogProvider(config: PostHogProviderConfig): AnalyticsProvider`.
- `PostHogProviderConfig` is a local type with at least: `apiKey: string`
  (required), `host?: string`, `flushAt?: number`, `flushInterval?: number`,
  `requestTimeout?: number`, `disableGeoip?: boolean`.
- Calling `createPostHogProvider(config)` synchronously constructs exactly
  one `posthog-node` `PostHog` client from `config` and returns an object
  implementing `AnalyticsProvider` (imported as
  `import type { AnalyticsProvider } from "typetrack";`) with
  `name: "posthog"`.
- `track(event, payload, meta)` calls the client's `capture()` with: the
  current distinct ID (per the identity-state design above), `event` as the
  event name, `payload` folded into `properties`, and `meta.timestamp`
  forwarded as the event's timestamp (not silently dropped).
- `identify(userId, traits)` calls the client's `identify()` with
  `distinctId: userId, properties: traits`, and updates the adapter's
  current distinct ID to `userId`.
- `page(name, props)` calls `capture()` with `event: "$pageview"`, using the
  current distinct ID, folding `name`/`props` into `properties`.
- `flush()` calls the client's `flush()` (never `shutdown()`) and
  returns/awaits its promise.
- `packages/provider-posthog/package.json` gains `posthog-node` as a runtime
  `dependency` (not `devDependency`), and `typetrack` as a `dependency`
  pinned via the workspace protocol (`"typetrack": "workspace:*"`) so the
  package can import the `AnalyticsProvider` type.
- No changes to `src/` (core) or to any other package.

## Test requirements

Both unit and integration tests are required; neither alone satisfies this
issue.

**Unit tests** (`packages/provider-posthog/src/index.test.ts`) — no real
network I/O. Construct the provider against a stubbed/mocked `posthog-node`
client (via dependency injection or `bun:test`'s `mock`/`mock.module` —
mechanism is the implementor's choice) and assert, in isolation:
- A `track()` call made before any `identify()` call passes a generated
  (non-empty, not a hardcoded constant) anonymous `distinctId` to
  `capture()`.
- A `track()` call made after `identify("user_1", { plan: "pro" })` passes
  `distinctId: "user_1"` to `capture()`, and the event name/payload are
  forwarded correctly into `properties`.
- `identify()` forwards `userId`/`traits` to the client's `identify()` with
  the correct field names (`distinctId`, `properties`).
- `page(name, props)` calls `capture()` with `event: "$pageview"` and folds
  `name`/`props` into `properties`.
- `flush()` calls the client's `flush()` method and never calls
  `shutdown()`.

**Integration tests**
(`packages/provider-posthog/src/index.integration.test.ts`) — a real HTTP
round-trip against a local server, never against real PostHog
infrastructure or credentials. Start a local HTTP server (e.g.
`Bun.serve()`) that accepts `POST /batch/` and records the parsed JSON
request body. Construct
`createPostHogProvider({ apiKey: "test", host: <local server URL>, flushAt: 1 })`,
call `track()` and `identify()` (forcing/awaiting a flush as needed so the
request is actually sent before assertions run), and assert the local
server received a request whose parsed body contains the expected event
name, distinct ID, and properties. Tear the local server down at the end of
the test.

## Out of scope

- Any browser/client-side PostHog adapter (`posthog-js`) — explicitly
  deferred to a later phase.
- Feature flags, group analytics (`groupIdentify`), session recording, or
  any other `posthog-node` capability beyond capture/identify/flush mapped
  to `AnalyticsProvider`.
- Build/publish tooling for `packages/provider-posthog` (tsup config,
  `exports` map, npm publish workflow) — the package continues to ship raw
  TS via `main`/`types` pointing at `src/index.ts`, unchanged from the
  current scaffold.
- Retry/backoff logic beyond whatever `posthog-node` already does
  internally.
- A shared internal package for cross-adapter helpers (e.g. anonymous-ID
  generation) — each provider package stays self-contained, since each is
  installed independently by consumers.
- Calling `shutdown()` or otherwise permanently closing the client from
  within this adapter.
