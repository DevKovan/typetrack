# 006 — SDK-side dev-mode fire-and-forget POST integration

## Context

Depends conceptually on 002 (it's the "other end of the wire" from
`POST /events`) but has no code dependency on 003/004/005 — it can be
built and unit-tested with a stubbed `fetch`, and integration-tested
against a bare `startDevServer()` from 002. This issue modifies the core
`track()` path in `src/index.ts`/`CreateAnalyticsOptions`.

**Design decision — dev-mode detection mechanism (flagged as a judgment
call, not a research-settled fact):** add `devServer?: boolean |
{ url?: string }` to `CreateAnalyticsOptions`. A truthy boolean POSTs to
the fixed default `http://127.0.0.1:4318/events` (matching the dev
server's own default start port). An object with `url` POSTs to that
exact URL instead — this covers the case where the auto-discovered port
drifted from 4318 (already taken) and the app developer wants to point at
the real running instance; they read `.typetrack/port` themselves (e.g.
in their own dev bootstrap script) and pass the resulting URL in. The core
SDK deliberately never reads `.typetrack/port` or any file, and never
inspects `NODE_ENV`/`import.meta.env` on the caller's behalf from
`track()`'s hot path — gating "am I in dev" is entirely the calling
application's responsibility, since core must stay isomorphic and work
unmodified in a browser bundle (where synchronous file/env access isn't
available or meaningful), consistent with this repo's existing preference
for explicit configuration (e.g. a single `provider`, not an array) over
implicit/magic detection.

## Acceptance criteria

- `CreateAnalyticsOptions` gains `devServer?: boolean | { url?: string }`.
- When set (truthy), every `track(event, payload)` call also dispatches a
  fire-and-forget `POST` (JSON body containing at least the event name and
  the **raw, unvalidated** payload) to the resolved URL (default
  `http://127.0.0.1:4318/events`, or the given `url`).
- The dev-mode POST is dispatched using the **raw** payload, **before**
  schema validation runs — it must fire regardless of whether
  `schemas[event]` exists, regardless of whether validation
  succeeds/fails, and regardless of whether `onValidationError` is set
  (swallowing) or unset (`track()` throwing `EventValidationError`). The
  point of the dev server is to surface validation problems the app
  itself may be suppressing or throwing past.
- The dev-mode POST is genuinely fire-and-forget: its promise is never
  returned from `track()`, never awaited, and any error (network failure,
  nothing listening, non-2xx response) is silently swallowed — no
  `console.error`/logging by default (must not be noisy in a production
  environment where the flag was left on by mistake). `track()`'s
  existing return type (`void | Promise<void>`) and synchronous-throw
  behavior for validation failures are otherwise unchanged.
- `track()` must return before the dev-mode fetch settles — it must never
  delay or block the caller's control flow waiting on the dev server.
- When `devServer` is unset (the default), there is no behavior change
  whatsoever from the current implementation (no fetch attempted, no new
  overhead).

## Test requirements

**Unit**
- With `devServer` unset: no fetch call happens for any `track()` call.
- With `devServer: true`: fetch is called with the default URL and a body
  containing the event name and raw payload.
- With `devServer: { url }`: fetch is called with exactly that URL.
- `track()` returns synchronously without awaiting the dev POST, even
  when a stubbed fetch is made to hang or reject (assert via a fetch stub
  that returns a never-resolving/rejecting promise and confirming
  `track()`'s own return value/timing is unaffected).
- The dev POST still fires when schema validation fails and
  `onValidationError` swallows the error, and also when no
  `onValidationError` is set and `track()` throws — assert the stub was
  called in both cases even though `track()` subsequently throws in the
  latter.
- A rejected/erroring stubbed fetch never propagates out of `track()` and
  produces no default logging output.

**Integration**
- Start a real `startDevServer()` (002) on an ephemeral/auto-discovered
  port. Construct `createAnalytics({ devServer: { url: `${handle.url}/events` },
  schemas })` using **the same `schemas` object** passed to both
  `createAnalytics` and the dev server's `setSchemas()`. Call `track()`
  once for an event that passes validation and once for one that fails.
  Poll/await `GET /events` on the real running server and assert both
  arrivals show up with the correct `valid` flag — the true end-to-end
  proof that the SDK integration and dev server agree using one shared
  schema definition, with no drift between the two sides.

## Out of scope

- `identify()`/`page()` dev-mode forwarding (only `track()` is specified
  by this phase; not extending parity to the other calls automatically).
- Any built-in `NODE_ENV`/`import.meta.env` auto-detection (rejected by
  design — see Context).
- Retrying failed dev-mode POSTs, or batching multiple events into one
  request.
