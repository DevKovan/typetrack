# Phase 18 brief: tooling extras

Read CLAUDE.md, `plan/VISION.md` ("Tooling (target)") and `plan/ROADMAP.md`
(Phase 18 section) first. Then read `plan/phase-17-documentation/BRIEF.md`
and `plan/phase-16-testing-infrastructure/BRIEF.md` (precedent for this
document's structure, and for the "narrow scope with rationale" pattern
Phase 16 used for its bundle-size-tool choice).

Before writing anything, this phase's own planning read the current public
API surface first-hand: `src/index.ts` (`createAnalytics`, `Analytics`,
verbs), `src/schema.ts` (`CanonicalEvent`, `EventMap`, `SchemaMap`),
`src/devServer/server.ts` (the existing `GET /schema` dump this phase
extends, plus `/events`, `/events/stream`, `/health`), `src/devServer/
config.ts` (`loadConfig`/`resolveConfigPath`/`watchConfig`), `src/cli/
index.ts`, `src/cli/dev.ts`, `src/cli/args.ts` (today's single-command `dev`
dispatcher), `src/middleware.ts` + `src/middleware/logging.ts` (the
`before`/`after`/`onError` hook shape and a built-in middleware precedent),
`src/plugins.ts` + `src/plugins/autoErrors.ts` (the `Plugin` shape and the
"minimal ad-hoc DOM types, no `dom` in `tsconfig.json` `lib`" convention),
and `src/plugins/domInteraction.integration.test.ts` (the hand-stubbed
`Object.defineProperty(globalThis, "document", ...)` DOM-testing technique
used repo-wide instead of a real browser/happy-dom dependency). Also read
the docs written in Phase 17 (`docs/README.md`, `docs/architecture.md`) so
this phase's one new guide stays consistent with what's already documented,
and `examples/middleware/README.md` + one existing example package
(`examples/middleware/pipeline-basics/`) to confirm the `examples/`
directory shape (task-oriented composed demos, not one-package-per-
middleware) before deciding whether the new middleware needs its own
`examples/` entry.

This phase builds directly on top of Phases 6-17; do not re-litigate their
design.

## Research grounding (informed the design, not assumed)

Before planning, researched (WebSearch, August 2026) rather than assumed:

- **What a "debug overlay" looks like for a browser analytics SDK today**:
  PostHog ships a "Toolbar" (posthog.com/docs/toolbar) described as
  "Inspect Element, but for PostHog" — an in-page, opt-in, visual panel
  showing live product-analytics activity, not a console-log-only tool.
  Vercel Analytics and Segment's Analytics.js both lean on browser-
  extension-based debuggers (e.g. the standalone "Analytics Debugger"
  Chrome extension) rather than shipping their own in-SDK visual overlay.
  This repo already has `loggingMiddleware` (Phase 8) for console-based
  observability — a debug overlay's differentiated value is a lightweight,
  in-page **visual** panel of recent events, in the PostHog-Toolbar spirit,
  not a second logger. That shape is buildable as a `before`/`after`-hook
  middleware with no new dependency (see Design decision 3).
- **Whether a VSCode extension is worth building here**: no evidence found
  of a broadly-adopted pattern of small (pre-1.0, not-yet-npm-published)
  TypeScript SDK libraries shipping their own VSCode extension for schema/
  event-name autocomplete — that need is already met, for this repo's exact
  design, by TypeScript's own language service against the compile-time
  `Events`/`SchemaMap` generic parameters (`createAnalytics<Events>()`
  gives real autocomplete/type-checking on every `.track()` call today,
  with zero extension). A custom extension would only add value for a
  narrower case (inline JSON-Schema-shaped hints while *authoring* a
  `typetrack.config.ts`'s runtime schemas) that doesn't clearly justify a
  second packaging/publishing/versioning surface (VSCode Marketplace
  account, its own release cadence, its own test harness) for a library
  that (per Phase 17's finding) has no npm-published version and no
  external users yet. See Design decision 1 for the resulting scope call.
- **Documentation generator options**: TypeDoc (`typedoc`, plus the
  `typedoc-plugin-markdown` companion) is the dominant TypeScript API-doc
  generator, and `@jackdbd/zod-to-doc` exists specifically for rendering
  Zod schemas to docs. Both generate documentation *of this library's own
  source code/schema-definition API* — but Phase 17 already hand-wrote that
  (architecture guide, provider guides, etc.) and CLAUDE.md's "minimal
  dependencies" principle plus Phase 16's Design decision 1 precedent (kit
  only builds what's genuinely new, not a second tool duplicating existing
  coverage) argue against adding a second, largely-redundant API-reference
  pipeline. Reread against `plan/ROADMAP.md`'s actual Phase 18 wording —
  "documentation generator" sits directly alongside "schema generator
  beyond the raw `/schema` dump" in the same sentence — this phase reads
  the two as one connected capability: generate a human-readable *event
  catalog* (not a source-code API reference) from a real app's
  `typetrack.config.ts` schemas, the same input the schema generator
  already parses. See Design decision 2.

## Scope (from plan/ROADMAP.md), mapped to issues

- **Schema generator beyond the raw `/schema` dump** → issue 001. A
  `typetrack schema` CLI command producing a versionable JSON Schema file
  on disk (CI/tooling-usable without a running dev server), built on a
  shared extraction function also used to deduplicate `server.ts`'s
  existing `GET /schema` handler.
- **Documentation generator** → issue 002. A `typetrack docs` CLI command
  rendering the same schema data (issue 001's extraction function) as a
  Markdown event catalog — the human-readable artifact a team keeps next to
  its tracking plan.
- **Event inspector UI** → issue 003. A minimal static page the dev server
  serves at `/`, using the dev server's already-shipped `/events/stream`
  SSE feed, `/events` buffer, and `/schema` dump — a live, in-browser view
  of what `typetrack dev`'s console output already prints, with no new
  runtime dependency.
- **Debug overlay** → issue 004. `debugOverlayMiddleware()`, a new built-in,
  opt-in, browser-only middleware (mirrors `loggingMiddleware`'s "never
  auto-registered, explicit `.use()`" contract) rendering a small fixed-
  position panel of the most recent dispatched events directly in the page.
- **VSCode extension** → explicitly out of scope for this phase. See
  Design decision 1.
- Wrap-up (new `docs/tooling.md` guide, cross-linked from `docs/README.md`,
  plus `plan/CHANGELOG.md` entry) → issue 005, last.

## Design decisions locked for this phase

1. **No VSCode extension this phase.** Rationale (see "Research grounding"
   above): the primary DX need a schema-aware extension would serve —
   autocomplete/type-checking on tracked event names and payloads — is
   already fully met by TypeScript's own language service against
   `createAnalytics<Events>()`'s generic parameter, with zero extra
   tooling. The narrower remaining need (hints while hand-authoring a
   `typetrack.config.ts`'s Zod schemas) is speculative, has no confirmed
   demand signal (library not yet published to npm, per Phase 17's
   finding), and would add a second packaging/publishing/versioning
   surface with real ongoing maintenance cost for unclear ROI. Revisit
   post-npm-publish (Phase 21) if real user demand appears — VISION.md's
   own "Tooling (target)" list keeps it as a target, not a rejection; this
   phase just declines to build it now, same posture as the "Future
   investigation" list ROADMAP.md already carries for other deferred
   features.
2. **"Schema generator" and "documentation generator" share one
   extraction function, `buildEventJsonSchemas()`, but ship as two
   distinct CLI commands with two distinct output shapes** (raw JSON
   Schema for `schema`; a rendered Markdown event catalog for `docs`) —
   not one command with a `--format` flag. Two separate, single-purpose
   commands read more clearly from `--help` output and match how
   `ROADMAP.md` lists them as two separate bullets with two separate
   audiences (`schema`: machine-consumable, CI/tooling-facing;
   `docs`: human-readable, checked-into-the-repo-facing).
3. **Debug overlay is a middleware, not a plugin.** A `Plugin` (`src/
   plugins.ts`) only observes events *it itself* generates by calling
   `analytics.track()` — it has no hook into events dispatched by
   application code elsewhere. A `Middleware`'s `after(event)` hook (`src/
   middleware.ts`), by contrast, fires for every event dispatched through
   `track()`/`page()`/`screen()` regardless of origin — the only existing
   extension point wide enough to observe "everything the app just sent,"
   which is the whole point of a debug overlay. It is a pure observer
   (`before()` always returns the event unchanged, mirrors
   `loggingMiddleware`'s contract) so it can never alter dispatch behavior
   just by being enabled.
4. **Debug overlay gets no dedicated `examples/middleware/*` package.**
   `examples/middleware/`'s existing packages (`pipeline-basics`,
   `sampling-vs-routing`) are `bun test`-driven, server-side-evaluable
   demonstrations — none of them mount real DOM. A debug overlay's entire
   value is a rendered visual panel, which is not meaningfully
   demonstrable through that pattern (same class of "real browser needed,
   not just a DOM-shaped stub" reasoning Phase 16 used to place
   `flushOnUnload` coverage in `e2e/` rather than `examples/`, see that
   phase's BRIEF.md Design decision 4/Research grounding). Its usage is
   instead documented with a real, cited code sample in issue 005's
   `docs/tooling.md` guide (per Phase 17's "copied verbatim from a real,
   currently-passing file, cited by path" policy), and its logic is unit-
   and integration-tested in `src/middleware/debugOverlay.test.ts` /
   `.integration.test.ts` using this repo's existing hand-stubbed-DOM
   technique (`src/plugins/domInteraction.integration.test.ts`'s
   `Object.defineProperty(globalThis, "document", ...)` pattern) — full
   coverage of the panel's mount/update/render logic, just not a runnable
   `examples/` package.
5. **Event inspector UI ships as one dependency-free static page, embedded
   as a template-literal string served by the dev server itself — no new
   frontend framework, build step, or workspace package.** The dev server
   (`src/devServer/server.ts`) is a plain `Bun.serve()` JSON/SSE API with
   zero existing HTML-serving code and zero frontend-build tooling in this
   repo's toolchain (CLAUDE.md's toolchain list: Bun, `tsgo`/`tsc`,
   `oxlint`, Knip, `tsup` — no bundler for a UI). Introducing React/Vite
   purely to render "a live list of JSON events with a validity badge"
   would be a large, unjustified new dependency surface for a genuinely
   small UI; vanilla HTML/CSS/JS in one served string, consuming the
   already-JSON `/events`, already-SSE `/events/stream`, and already-JSON
   `/schema` endpoints via the browser's native `EventSource`/`fetch`, is
   sufficient and keeps the "minimal dependencies" engineering principle
   (VISION.md) intact. Served at `GET /` (currently unhandled — `server.ts`
   has no route for it, confirmed by reading its `routes` object — so this
   is a genuinely new, non-breaking route, not a change to any existing
   response).
6. **`typetrack schema`/`typetrack docs` reuse `src/devServer/config.ts`'s
   existing `resolveConfigPath`/`loadConfig`**, the same config-loading
   path `typetrack dev` already uses — no second config-file convention,
   no new `typetrack.config.*` search order. Both new commands accept the
   same `--config <path>` override flag `typetrack dev` already supports,
   for consistency.
7. **`src/cli/index.ts`'s single-command `if (command !== "dev")` dispatch
   is generalized into a small command table** as part of issue 001, since
   two more commands (`schema`, `docs`) are added across issues 001-002 —
   this is the minimal refactor needed to add a second command at all, not
   a speculative abstraction; see issue 001 for the exact before/after
   shape.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-18-tooling-extras/`. **Issue files
   are kept, never deleted** (standing policy — see `plan/ROADMAP.md`
   "Policy changes").
2. For each issue, in order (001 → 005, respecting the dependency chain —
   002 depends on 001's `buildEventJsonSchemas()` and generalized CLI
   dispatch; 003 and 004 are independent of 001/002 and of each other; 005
   depends on 001-004 all landing, since it documents and cross-links all
   of them): the `implementor` subagent implements with unit+integration
   tests, the `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

Run the full `.github/workflows/qa.yml` step sequence locally before every
push, exactly as every prior phase has (build:all, size, e2e, lint,
typecheck, typecheck:svelte, test, knip).

## Branching / landing

Branch `phase-18-tooling-extras` for isolation (this phase touches `src/
cli`, `src/devServer`, `src/middleware`, and `docs/` across five issues —
multi-file production code, same shape as Phase 16, not Phase 17's
docs-only diff). Once all issues pass QA: push commits to `origin/main`
directly (no PR, no force-push — if `origin/main` has moved, rebase
cleanly on top). Delete the `phase-18-tooling-extras` branch (local, and
remote only if pushed there). Do **not** delete
`plan/phase-18-tooling-extras/` issue files. Add a one-line Phase 18 entry
to `plan/CHANGELOG.md`, following the existing format (see the Phase 6-17
entries for current style/length) — issue 005 owns this.

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on `main` and
cleanup is done.

## Out of scope for this whole phase

- A VSCode extension — see Design decision 1.
- A TypeDoc/`zod-to-doc`-style generated API-reference site — Phase 17
  already hand-writes that coverage; see "Research grounding" above.
- Any comparative/quantitative performance numbers for the new tooling —
  not asked for by `plan/ROADMAP.md`'s Phase 18 line; Phase 19 owns
  performance benchmarking generally.
- A build step/bundler/frontend framework for the event inspector UI — see
  Design decision 5.
- Changing `typetrack dev`'s existing config-file search convention — see
  Design decision 6.
