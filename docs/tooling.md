# Tooling

Phase 18 added four pieces of developer tooling on top of `typetrack dev`
(Phase 3): a schema export CLI command, an event catalog CLI command, an
in-browser event inspector UI, and an opt-in visual debug overlay
middleware. This guide covers all four, plus what was deliberately not
built.

## Schema export

`typetrack schema` writes the current `typetrack.config.ts` event schemas
to disk as JSON Schema — a versionable, CI/tooling-usable artifact, unlike
the dev server's live `GET /schema` endpoint (`docs/architecture.md`'s
[Extension points](./architecture.md#extension-points) covers that
endpoint; both share the same extraction function under the hood, see
below).

Flags:

- `--config <path>` — override the config file path. Defaults to the same
  search `typetrack dev` already uses.
- `--out <path>` — write the JSON to this file instead of stdout.

```sh
typetrack schema --config typetrack.config.ts --out schema.json
```

With no `--out`, the JSON is printed to stdout instead:

```sh
typetrack schema
```

```json
{
  "events": {
    "checkout_started": {
      "type": "object",
      "properties": { "cartValue": { "type": "number" } },
      "required": ["cartValue"]
    }
  }
}
```

(`src/cli/schema.ts`'s `runSchemaCommand` — the shape above matches
`buildEventJsonSchemas`'s `EventJsonSchemas` return type, `src/devServer/
schemaExport.ts`.)

Every recognized failure (bad flags, no config found, a config that throws
while loading) prints a `✗`-prefixed message and exits non-zero rather than
throwing a raw stack trace.

## Event catalog

`typetrack docs` renders the same schema data as a human-readable Markdown
event catalog — one `## <event name>` section per event, with a property
table (name, type, required, description) or `_No payload._` for events
with no properties (`src/devServer/eventCatalog.ts`'s `renderEventCatalog`,
fed by the same `buildEventJsonSchemas` extraction `typetrack schema`
uses).

Flags:

- `--config <path>` — same as `typetrack schema`.
- `--out <path>` — write here instead of the default `EVENTS.md` in the
  current directory. `--out -` writes to stdout instead.

```sh
typetrack docs
```

```
✓ event catalog written to EVENTS.md
```

Unlike `typetrack schema`'s output, `EVENTS.md` is meant to be **committed
and reviewed**, not regenerated-and-discarded on every run — treat it the
same way you'd treat a hand-maintained tracking plan: check the diff when
you add or change an event's schema, so reviewers see the human-readable
change alongside the code change. (`src/cli/docs.ts`'s `runDocsCommand`.)

## Event inspector UI

`typetrack dev` now serves a live event inspector at `GET /` — previously
an unhandled route (`src/devServer/server.ts`'s `routes` object had no `"/"`
entry before this phase). It's a single dependency-free HTML page
(`src/devServer/inspectorPage.ts`'s `renderInspectorPage`) with no build
step or frontend framework — vanilla HTML/CSS and browser JS against the
dev server's already-existing endpoints:

- `GET /events` — fetched once on page load to backfill history so the
  page isn't empty if opened after events have already fired.
- `GET /events/stream` — an SSE feed (via the browser's native
  `EventSource`) the page switches to afterward for live updates.
- `GET /schema` — linked from the page's header for quick reference to the
  currently-loaded schemas.

The page shows a live, most-recent-first event list. Each row has the
event name, a timestamp, and a `valid`/`invalid` badge (driven by the same
`valid`/`issues` fields `POST /events` already records per event); an
invalid row also lists its validation issues (path + message). Each row has
a collapsible payload viewer (a `<details>` element) with the pretty-printed
JSON payload. A name filter input hides rows that don't match, without
re-fetching anything.

No screenshot is included — this repo has no screenshot-generation tooling
(see "Out of scope" below).

## Debug overlay

`debugOverlayMiddleware()` (`src/middleware/debugOverlay.ts`) is a new
built-in, opt-in middleware that renders a small fixed-position panel of
the most recently dispatched events directly on the page — an in-page
visual debug view in the spirit of PostHog's Toolbar, not a second console
logger (`loggingMiddleware`, Phase 8, already covers console-based
observability).

Like every built-in middleware, it's never auto-registered — register it
explicitly:

```ts
// citing src/middleware/debugOverlay.ts's exported debugOverlayMiddleware
import { debugOverlayMiddleware } from "typetrack";

analytics.use(debugOverlayMiddleware());
```

Options (`DebugOverlayOptions`, `src/middleware/debugOverlay.ts`):

- `maxEvents` — maximum number of most-recent events retained/rendered;
  older entries are evicted oldest-first once exceeded. Default: `20`.
- `position` — one of `"bottom-right"` (default), `"bottom-left"`,
  `"top-right"`, `"top-left"`.
- `startCollapsed` — starts collapsed to a small toggle rather than an
  always-open panel. Default: `true`.

```ts
analytics.use(
  debugOverlayMiddleware({ maxEvents: 50, position: "top-left", startCollapsed: false }),
);
```

It's a pure observer — it only implements `after(event)`, never `before`,
so registering it can never transform or drop an event. It's **browser-only**
(a no-op outside a browser environment, per `isBrowserEnvironment()`,
`src/context.ts`) and **has no `destroy()`-triggered teardown** — once
mounted, the panel persists for the page's lifetime, the same way
`loggingMiddleware`'s console output is never "un-logged". This is a
documented, accepted limitation, not a bug — see `debugOverlay.ts`'s header
comment and `plan/phase-18-tooling-extras/BRIEF.md`'s Design decision 4.

See also [Middleware](./middleware.md#built-in-middlewares) for how it sits
alongside the other seven built-in middlewares in the `.use()` chain.

## Not built (yet)

A VSCode extension for schema/event-name autocomplete was considered for
this phase and deliberately deferred, not forgotten (see
`plan/phase-18-tooling-extras/BRIEF.md`'s Design decision 1). The primary
need such an extension would serve — autocomplete/type-checking against
tracked event names and payloads — is already fully met by TypeScript's own
language service against `createAnalytics<Events>()`'s generic parameter,
with zero extra tooling. It remains a longer-term possibility; see
`plan/VISION.md`'s "Tooling (target)" list, which still carries it as a
target.
