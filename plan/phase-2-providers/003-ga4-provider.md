# 003 — GA4 Measurement Protocol provider adapter (`@typetrack/provider-ga4`)

## Context

Same phase and constraints as issues 001/002. This issue covers Google
Analytics 4 via the Measurement Protocol only. Do not re-scaffold
`packages/provider-ga4/` — fill in its `src/index.ts` placeholder.

Unlike PostHog and Segment, GA4 is implemented with **no vendor SDK
dependency** — this adapter talks directly to the Measurement Protocol
HTTP API using the runtime's native `fetch` (available natively in Bun, no
polyfill/dependency needed).

Measurement Protocol shape (verified against Google's current docs):
- Endpoint (web-stream form, the only form this issue implements):
  `POST https://www.google-analytics.com/mp/collect?measurement_id=<MEASUREMENT_ID>&api_secret=<API_SECRET>`
- JSON request body:
  ```json
  {
    "client_id": "<persistent per-instance id>",
    "user_id": "<optional, set after identify()>",
    "timestamp_micros": 1690000000000000,
    "events": [
      { "name": "some_event", "params": { "...": "..." } }
    ],
    "user_properties": {
      "some_prop": { "value": "..." }
    }
  }
  ```
- Limits (informational, not enforced by this adapter — see Out of scope):
  max 25 events/request, max 25 params/event, max 25 user properties/
  request, event/param names ≤ 40 chars (alphanumeric + underscore, must
  start with a letter), param values ≤ 100 chars, user property name ≤ 24
  chars / value ≤ 36 chars, request body < 130 kB.
- A separate validation endpoint exists at `/debug/mp/collect` (same query
  params) which returns `{"validationMessages": [...]}` and never writes
  data — **not used by this adapter** (see Out of scope).
- **Important gotcha to encode in tests:** the production `/mp/collect`
  endpoint returns HTTP 204 for any syntactically well-formed request
  regardless of whether the event content is semantically valid per GA4's
  rules. This adapter can therefore only detect transport-level failures
  (network errors, non-2xx status) — it has no way to detect "GA4 silently
  ignored this event because a param name was too long," and must not
  claim to.

**Design decisions specific to this adapter:**
- `client_id` is generated once (`crypto.randomUUID()`) when the provider
  is created and reused for every request from that instance (there is no
  browser cookie to source it from server-side).
- `identify(userId, traits)` performs **no network call by itself** — GA4
  Measurement Protocol has no standalone "set user" endpoint. It only
  updates internal state (`currentUserId`, and `traits` mapped into GA4's
  `user_properties` shape, i.e. each `traits[key]` becomes
  `user_properties[key] = { value: traits[key] }`), which is then attached
  to the body of subsequent `track()`/`page()` requests.
- `track(event, payload, meta)` builds one `events: [{ name: event, params: payload }]`
  entry and POSTs it immediately — one HTTP request per `track()` call, no
  batching (GA4 supports up to 25 events/request, but batching is out of
  scope here; see below). `meta.timestamp` (epoch ms) is forwarded as
  `timestamp_micros` (epoch µs, i.e. `meta.timestamp * 1000`).
- `page(name, props)` posts a `page_view` event: `{ name: "page_view", params: { page_title: name, ...props } }`.
- `flush()` is a no-op that resolves immediately — there is no client-side
  queue to drain, since every `track()`/`page()` call already dispatches
  its own request.

## Acceptance criteria

- `packages/provider-ga4/src/index.ts` exports
  `createGA4Provider(config: GA4ProviderConfig): AnalyticsProvider`.
- `GA4ProviderConfig` is a local type: `{ measurementId: string; apiSecret: string; apiHost?: string }`,
  with `apiHost` defaulting to `"https://www.google-analytics.com"`
  (overridable so tests never hit real Google infrastructure).
- The returned object implements `AnalyticsProvider` (imported as
  `import type { AnalyticsProvider } from "typetrack";`) with
  `name: "ga4"`.
- `track()` sends `POST {apiHost}/mp/collect?measurement_id=...&api_secret=...`
  with a JSON body per the Context shape (`client_id`, optional `user_id`,
  `timestamp_micros`, `events`, optional `user_properties`), with
  `Content-Type: application/json`.
- `identify()` makes zero `fetch` calls; it only updates state consumed by
  later `track()`/`page()` calls.
- `page()` sends a `page_view` event as described in Context.
- `flush()` resolves immediately, synchronously making zero `fetch` calls.
- `track()`/`page()` return promises that reject when the underlying
  `fetch` call itself rejects (network error), and also reject when the
  response status is not in the 2xx range.
- `packages/provider-ga4/package.json` gains **no new runtime SDK
  dependency** beyond `typetrack` as a `dependency` pinned via the
  workspace protocol (`"typetrack": "workspace:*"`), confirming the
  "GA4 via fetch, no vendor SDK" decision.
- No changes to `src/` (core) or to any other package.

## Test requirements

Both unit and integration tests are required; neither alone satisfies this
issue.

**Unit tests** (`packages/provider-ga4/src/index.test.ts`) — no real
network I/O. Stub `globalThis.fetch` (e.g. via `mock()`, restoring the
original after each test) and assert, in isolation:
- `track()` calls `fetch` with a URL containing the correct
  `measurement_id`/`api_secret` query params, `POST` method, and a JSON
  body whose `client_id` is present and whose `events[0]` has the correct
  `name`/`params`.
- `identify()` triggers zero `fetch` calls.
- A `track()` call made after `identify("user_1", { plan: "pro" })`
  includes `user_id: "user_1"` and a correctly-shaped `user_properties` in
  the request body.
- `page(name, props)` sends `events: [{ name: "page_view", params: { page_title: name, ...props } }]`.
- `flush()` resolves without calling `fetch`.
- `track()` rejects when the mocked `fetch` resolves with a non-2xx
  `Response`.
- `track()` rejects when the mocked `fetch` itself rejects (simulated
  network failure).

**Integration tests**
(`packages/provider-ga4/src/index.integration.test.ts`) — a real HTTP
round-trip against a local server, never against real Google endpoints or
credentials. Start a local HTTP server (e.g. `Bun.serve()`) implementing a
`POST /mp/collect` route that parses and records the request's query
string and JSON body. Construct
`createGA4Provider({ measurementId: "test", apiSecret: "test", apiHost: <local server URL> })`,
call `track()`, `identify()`, and `page()`, and assert the local server
actually received requests with the correct query params and JSON bodies.
Include a separate test where the local server responds with HTTP 500 and
assert the promise returned by `track()` rejects. Tear the local server
down at the end of the tests.

## Out of scope

- Any browser-side GA4 adapter (`gtag.js`) — explicitly deferred to a later
  phase along with the other browser adapters.
- Batching multiple events into a single Measurement Protocol request (GA4
  supports up to 25) — each `track()`/`page()` call issues its own request.
- Enforcing GA4's own limits locally (event/param name length and
  character rules, 25 events/params per request, 130 kB body size, etc.) —
  payloads are passed through as given; this adapter does not validate or
  truncate them.
- Using the `/debug/mp/collect` validation endpoint, or exposing any
  "debug mode" toggle.
- App-stream mode (`firebase_app_id`/`app_instance_id`) — only the
  web-stream shape (`measurement_id`/`client_id`) is implemented.
- Region-specific endpoints (e.g. `region1.google-analytics.com` for EU
  data collection) — only the default host, overridable via `apiHost` for
  tests, is in scope.
- Any retry/backoff logic on request failure.
