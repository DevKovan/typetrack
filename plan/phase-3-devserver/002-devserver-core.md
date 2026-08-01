# 002 — Dev server core (Bun.serve, routes except SSE)

## Context

Depends on 001 (free-port scan + health-poll + port-file helpers) and
`src/schema.ts` (`SchemaMap`-shaped Zod schemas, `.safeParse()`). This
issue builds the actual HTTP server: `POST /events`, `GET /events`,
`GET /schema`, `GET /health`. `GET /events/stream` (SSE) is 003; loading
schemas from a real config file + hot reload is 004 — this issue exposes
an in-process `setSchemas()` hook that 004 will drive, and is fully
testable by injecting schemas directly, with no file I/O or chokidar
involved.

**Why `Bun.serve()` over a Node-style `http` server:** this repo's runtime
posture is Bun-first (Bun workspaces, `bun test`). `Bun.serve()`'s
`routes` object (method-keyed handlers, available since Bun 1.2.3 — already
satisfied by this repo's pinned `@types/bun@1.3.14`) gives method-based
routing for every route in this phase, including 003's SSE route (native
`ReadableStream` response bodies), without adding an Express/Fastify-style
HTTP framework dependency. One server primitive covers the whole phase.

## Acceptance criteria

- Exposes a `startDevServer(options?)` function returning (async, since it
  performs the real bind + health-check) a handle exposing at least:
  - `port` / `url` (the actually-bound port/base URL, after 001's
    scan-then-bind-with-retry — the real bind may itself hit the
    probe/bind race from 001; this issue's own bind attempt must retry a
    small number of times, e.g. up to 3, on a bind failure, re-scanning
    for a new candidate port each time)
  - `setSchemas(schemas: Record<string, z.ZodType> | undefined)` —
    replaces the currently-active schema map used by `POST /events`
    validation and `GET /schema`; safe to call at any time, including
    before any client has connected (starts as `undefined` = "no schemas
    loaded yet", meaning every event is treated as unvalidated/passthrough)
  - `getEvents()` — returns the current in-memory event buffer
  - `subscribe(listener)` — registers a listener called once per received
    event (used by 003's SSE route; returns an unsubscribe function)
  - `stop()` — releases the port; a subsequent bind on the same port must
    succeed immediately after `stop()` resolves
  - `options.startPort` (default 4318), `options.hostname` (default
    `127.0.0.1`), `options.bufferSize` (default 500)
- `POST /events`: body is JSON `{ event: string; payload?: unknown }`.
  - Malformed JSON or missing/non-string `event` → `400` with a JSON error
    body; nothing is recorded.
  - Otherwise, always responds `200` with `{ accepted: true, valid: boolean }`
    — a dev tool should never refuse to *observe* a bad event, only report
    it as bad. If `schemas[event]` is unset, `valid: true` (matches core
    SDK's own "unvalidated passthrough" behavior for schema-less events).
    If set, call `.safeParse(payload)`; on success `valid: true`, on
    failure `valid: false` and the event record carries the failing
    `.error.issues` (`z.ZodIssue[]`, matching `EventValidationError.issues`'s
    existing shape in `src/schema.ts`).
  - Every accepted event (valid or not) is appended to the in-memory
    buffer and broadcast to any `subscribe()` listeners (feeds 003).
  - On a failed validation, prints a **field-by-field diff** to stdout
    derived from `.error.issues` — for each issue, at minimum its path
    (dotted, or `(root)` if empty) and its `message` — explicitly NOT a
    raw `String(result.error)`/stringified `ZodError` dump. This
    formatting logic must live in a small, pure, independently-importable
    function (no server/socket dependency) so it's unit-testable directly.
  - On success, prints exactly one short line per event (must be visibly
    shorter/different in shape from the failure output).
- `GET /events`: returns the buffered events as JSON, oldest-first,
  capped at `bufferSize` — once full, the oldest event is evicted (FIFO)
  as new ones arrive.
- `GET /schema`: returns `{ events: { [eventName]: <JSON Schema> } }` built
  via `z.toJSONSchema()` per currently-loaded schema entry; `{ events: {} }`
  if no schemas are loaded yet. Never errors due to "not loaded yet".
- `GET /health`: always `200 { ok: true }`, independent of schema state.
- `startDevServer()` performs 001's health-poll against its own
  `/health` before resolving, and writes `.typetrack/port` via 001's
  helper only after that health-poll succeeds.

## Test requirements

**Unit**
- Pure diff-formatting function: given representative `ZodIssue[]` shapes
  (missing required field, wrong primitive type, invalid enum value,
  nested object path), produces output containing the path and message
  for each issue, and is asserted to NOT equal/contain a raw
  `ZodError`-style stringification.
- Pure success-line function: produces a single line, distinct from the
  failure formatter's output shape.
- Ring buffer eviction: construct a server with `bufferSize: 3`
  (dependency-injected or via `startDevServer({ bufferSize: 3 })`), push 5
  events via the route handler directly or via `fetch`, assert
  `getEvents()`/`GET /events` returns exactly the last 3, oldest-first.
- Route behavior in isolation (via `fetch()` against a real bound
  instance, or via directly invoking exported handler functions if the
  implementor factors it that way): valid POST, schema-mismatched POST,
  malformed-JSON POST (400), event with no schema entry (valid:true
  passthrough), `GET /schema` reflecting `setSchemas()`, `GET /health`
  always 200 regardless of schema state.

**Integration**
- Start a real `startDevServer()` (ephemeral/auto-discovered port), do
  real `fetch()` round trips: POST a mix of valid/invalid/schema-less
  events → `GET /events` reflects all of them, correctly ordered and
  flagged → call `setSchemas()` with a new map → `GET /schema` reflects
  the change → `stop()` → assert a fresh `startDevServer()` (or a raw
  bind attempt) can immediately reclaim the same port.
- Capture stdout/console output around a POST that fails validation and
  assert the printed text contains the offending field's path and message
  (not a raw `[object Object]`/stringified-ZodError dump), and around a
  successful POST assert exactly one line was printed.
- Confirm `.typetrack/port` is written on the filesystem after
  `startDevServer()` resolves, containing the handle's actual `port`.

## Out of scope

- `GET /events/stream` (SSE) — 003.
- Loading schemas from a real file on disk, or chokidar/hot reload — 004
  (this issue only provides `setSchemas()` as the seam).
- CLI process/argument handling, `.typetrack/port` staleness detection,
  SIGINT lifecycle — 005.
- The SDK-side `POST /events` client integration — 006.
- Auth, CORS, rate limiting (loopback-only dev tool).
- Persisting events across a restart (in-memory only; lost on `stop()`).
