# 003 -- event inspector UI (`GET /` on the dev server)

## Context

Read `plan/phase-18-tooling-extras/BRIEF.md`'s Design decision 5 first.
Independent of issues 001/002 -- may be implemented in either order
relative to them.

`src/devServer/server.ts` already exposes everything this UI needs:
`GET /events` (buffered history, `DevServerEvent[]`), `GET /events/stream`
(live SSE feed, one `data: <json DevServerEvent>\n\n` frame per event plus
periodic `:ping` keepalive comments -- see `src/devServer/sse.ts`),
`GET /schema` (`{ events: { [name]: JSONSchema } }`), `GET /health`. Its
`routes` object has no handler for `GET /` today (confirmed by reading the
full `routes` object in `startDevServer()`) -- this issue adds one, a
genuinely new, additive route.

## Scope of this issue

### 1. `src/devServer/inspectorPage.ts` (new file)

```ts
export function renderInspectorPage(): string;
```

Pure function (no request/server access) returning a complete, self-
contained `<!doctype html>` document as a single template-literal string:
inline `<style>` and inline `<script>` only, zero external requests (no
CDN scripts, no external stylesheets/fonts) -- the page must render
correctly even if the machine running `typetrack dev` has no internet
access. No build step, no JSX, no framework: hand-written HTML/CSS and
vanilla browser JS using `EventSource`/`fetch`, matching this repo's
existing devServer code style (small, direct, commented only where the
"why" isn't obvious).

Required behavior, implemented in the inline `<script>`:

- On load: `fetch("/events")` to render the already-buffered history
  first (so a page opened after some events have already fired isn't
  empty), then open `new EventSource("/events/stream")` for everything
  from that point forward. Prepend new live events to the top of the list
  (most-recent-first), matching how `typetrack dev`'s own console output
  reads top-to-bottom-newest already (`formatSuccessLine`/
  `formatValidationDiff`, `src/devServer/format.ts`).
- Each rendered event row shows: the event name, a relative or short
  timestamp, a valid/invalid badge (`DevServerEvent.valid`), and the
  payload rendered as pretty-printed JSON (`JSON.stringify(payload, null,
  2)` in a `<pre>` or `<details>`, collapsed by default for a large
  payload so the list stays scannable). When `valid` is `false`, also
  render `issues` (the `z.ZodIssue[]`) -- at minimum each issue's `path`
  joined with `.` and its `message`.
- A text `<input>` that filters the rendered list to events whose `event`
  name contains the typed substring (case-insensitive, client-side only,
  no new server endpoint/query param).
- A visible connection-status indicator reflecting the `EventSource`'s
  `onopen`/`onerror` callbacks (e.g. "● live" / "○ reconnecting..." --
  `EventSource` auto-reconnects on its own; this only needs to reflect
  that state, not implement reconnection logic itself).
- No fetch/`EventSource` call may throw an uncaught error that breaks page
  rendering -- wrap the initial `fetch("/events")` in a `.catch()` that
  degrades to "no history available" rather than a blank page (the dev
  server itself is always up when this page is being served *by* it, but
  handle it defensively regardless, matching this repo's "never throws"
  bar for user-facing surfaces).

### 2. `src/devServer/server.ts`: wire the route

Add a `"/"` entry to the `routes` object:

```ts
"/": {
  GET: () =>
    new Response(renderInspectorPage(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
},
```

Import `renderInspectorPage` from `./inspectorPage`. This is additive only
-- every other route's behavior is unchanged. The existing catch-all
`fetch()` handler (404 JSON for anything unmatched) is untouched; `/` was
previously falling through to it and now has its own handler instead.

### 3. `src/devServer/index.ts`: export

Add `export { renderInspectorPage } from "./inspectorPage";` (mirrors how
`formatSuccessLine`/`formatValidationDiff` are already re-exported)
-- useful for the unit test below, and for issue 005's docs guide to cite
a real exported symbol rather than an internal implementation detail.

## Testing

- `src/devServer/inspectorPage.test.ts`: `renderInspectorPage()` returns a
  string starting with `<!doctype html>`, contains no external
  `<script src="http...">`/`<link href="http...">` references (grep the
  returned string for `"http://"`/`"https://"` and assert none are
  found -- proves the "zero external requests" requirement structurally,
  not just by inspection), references `/events`, `/events/stream`, and
  `/schema` somewhere in the inline script.
- `src/devServer/server.integration.test.ts`: add a case asserting a real
  `GET /` against a running `startDevServer()` instance returns status 200
  with `content-type` starting `text/html`, and that the body is
  non-empty and contains `<!doctype html>` -- confirms the route is
  actually wired, not just that the pure renderer works in isolation.

## Out of scope

Any new server-side query/filter endpoint (filtering is client-side only,
per the Scope section above). Persisting inspector UI state (filter text,
scroll position) across page reloads. Any framework/build-step dependency
-- see BRIEF.md Design decision 5.
