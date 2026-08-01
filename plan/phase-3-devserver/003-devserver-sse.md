# 003 — SSE live event stream (`GET /events/stream`)

## Context

Depends on 002's `subscribe(listener)` hook and `DevServerEvent` shape.
Adds a live Server-Sent-Events route so a terminal UI/browser dashboard
can watch events arrive in real time without polling `GET /events`.

Uses `Bun.serve()`'s native `ReadableStream` response body (confirmed
current pattern: `Content-Type: text/event-stream`, `Cache-Control:
no-cache`, and `server.timeout(req, 0)` to disable Bun's default ~10s idle
connection timeout, since an SSE connection is expected to sit open and
otherwise-idle for long periods). The stream's `cancel()` callback is
invoked automatically by Bun when the client disconnects — this is the
only reliable place to release the subscription and any interval timer,
and is the main thing this issue must prove doesn't leak.

## Acceptance criteria

- `GET /events/stream` returns a `text/event-stream` response.
- On connect, subscribes to 002's `subscribe()`; each subsequently
  received event is serialized as one SSE frame: `data: <JSON>\n\n` where
  the JSON is the same `DevServerEvent` shape returned by `GET /events`.
- Does **not** replay buffered history on connect — only events received
  after the stream opened (see Out of scope).
- Sends a periodic comment-only keepalive frame (e.g. `:ping\n\n`) on an
  interval (implementor picks a reasonable default, document it) to guard
  against idle-connection timeouts from any intermediary.
- On disconnect (the stream's `cancel()` firing), unsubscribes from 002's
  event feed and clears the keepalive interval — no timer or listener may
  remain registered after a client disconnects.
- Supports multiple simultaneous SSE clients, each with an independent
  subscription and keepalive timer; all events are broadcast to every
  currently-connected client.

## Test requirements

**Unit**
- Construct the stream's `start`/`cancel` handlers directly against a
  fake/stub event-emitter standing in for 002's `subscribe()` (no real
  network layer): assert enqueued frames match the exact `data: ...\n\n`
  SSE format for a given input event; assert the keepalive frame's format;
  assert calling `cancel()` invokes the unsubscribe function returned by
  the fake `subscribe()` exactly once and clears the keepalive interval
  (e.g. via a spy on `clearInterval`, or Bun's fake-timer facilities).

**Integration**
- Start a real `startDevServer()`. Open a real `fetch()` to
  `/events/stream` and read its `response.body` via a reader. From a
  second `fetch()` on the same running server, `POST` a couple of events
  to `/events`. Assert the SSE client observes them live, in order, with
  matching payloads.
- Abort the SSE client's request (e.g. via `AbortController`) and assert
  the server actually released the subscription — either via an exposed
  testing hook (e.g. a subscriber-count getter on the devServer handle)
  returning to its pre-connection count, or by asserting a subsequent
  `POST /events` doesn't hang/throw and no further frames are attempted
  against the closed connection.
- A test with 2+ concurrent SSE clients connected simultaneously, both
  receiving the same broadcast events independently and in order.

## Out of scope

- Replaying buffered history to newly-connected clients (a `?since=`-style
  replay could be layered on later; not required here).
- Client-side reconnection/backoff (standard `EventSource` behavior, not
  a server concern).
- Authentication/authorization on the stream.
