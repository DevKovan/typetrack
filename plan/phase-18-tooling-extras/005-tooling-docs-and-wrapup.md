# 005 -- `docs/tooling.md`, cross-links, and Phase 18 changelog entry

## Context

Depends on issues 001-004 all landing on the isolation branch first --
this issue documents and cross-links all of them, and its citation policy
(below) requires the cited code/commands to actually exist and pass.

Read `plan/phase-17-documentation/BRIEF.md`'s Design decision 3 (the
code-sample-accuracy policy: every non-trivial sample is either copied
verbatim from a real, currently-passing source with an inline citation
comment, or clearly-labeled illustrative pseudo-code) -- this issue follows
that same policy exactly, since it's adding to the same `docs/` tree Phase
17 established.

## Scope of this issue

### 1. `docs/tooling.md` (new file)

One new guide, added to `docs/`'s existing flat layout (sibling of
`architecture.md`, `plugins.md`, `middleware.md`, etc.). Sections:

- **Schema export** (`typetrack schema`) -- what it does, its flags
  (`--config`, `--out`), a real invocation example and what its output
  looks like (cite `src/cli/schema.ts`, issue 001).
- **Event catalog** (`typetrack docs`) -- ditto for issue 002's
  `typetrack docs` command, including a short note that its output
  (`EVENTS.md` by default) is meant to be committed/reviewed, not
  regenerated-and-discarded.
- **Event inspector UI** -- what `typetrack dev` now serves at `/` (issue
  003), a screenshot is not required (no screenshot-generation tooling in
  this repo) but describe what's shown (live event list, valid/invalid
  badges, payload viewer, name filter) and which existing endpoints power
  it (`/events`, `/events/stream`, `/schema`).
- **Debug overlay** (`debugOverlayMiddleware()`) -- issue 004's middleware:
  a real, cited usage sample (`analytics.use(debugOverlayMiddleware())`,
  citing `src/middleware/debugOverlay.ts`'s actual exported signature),
  its options (`maxEvents`, `position`, `startCollapsed`), and an explicit
  note that it's browser-only and has no `destroy()`-triggered teardown
  (per that issue's "Out of scope").
- **A short "Not built (yet)" subsection** -- one paragraph, citing
  `plan/phase-18-tooling-extras/BRIEF.md`'s Design decision 1, stating a
  VSCode extension was considered and deliberately deferred (not
  forgotten), with the one-sentence reason (TypeScript's own language
  service already covers the main autocomplete/type-checking need against
  `createAnalytics<Events>()`) and a pointer to VISION.md's "Tooling
  (target)" list as where it remains a longer-term possibility.

### 2. `docs/README.md`: cross-link

Add `**[Tooling](./tooling.md)**` to the `## Guides` list (after
`Comparison`, before `FAQ` -- matches this phase's ROADMAP position after
Phase 17's documentation phase and before Phase 19's performance-
benchmarking phase). One line, same bullet style as the existing entries.

### 3. `docs/middleware.md`: update the built-in count

This file's existing text says "the six built-in middlewares (redaction,
PII filtering, sampling, logging, enrichment, timing)" (`docs/README.md`
line 28-30 quotes it, and the guide itself will have the same or a similar
count somewhere in its body -- grep `docs/middleware.md` for "six" and
update every occurrence). Update to seven, adding `debugOverlayMiddleware`
to whatever enumeration exists, with a short description and a link to the
new `docs/tooling.md#debug-overlay` section for the full writeup (keep
`docs/middleware.md` itself focused on the `.use()` chain/execution-order
material it already covers, per Phase 17's own scope for that file -- the
overlay's *tooling* framing belongs in `docs/tooling.md`, not a full
rewrite of `docs/middleware.md`). Also update `docs/README.md`'s own
"[Middleware](./middleware.md)" bullet text (currently says "six") to
"seven" for consistency.

### 4. Citation verification pass

For every fenced code sample added in `docs/tooling.md`, confirm (by hand,
same as Phase 17 issue 011) that the cited file/export/command actually
exists and behaves as described, on the branch, after issues 001-004 have
landed. Also re-grep the rest of `docs/*.md` for the string `"six built-in"`
or similar stale counts this phase's addition might have made incorrect
beyond `docs/middleware.md` itself (e.g. `docs/README.md`, `docs/faq.md`,
`docs/architecture.md` if any of them independently states a middleware
count).

### 5. `plan/CHANGELOG.md`: one-line Phase 18 entry

Follow the existing format (see the Phase 6-17 entries for current style/
length -- read the most recent 2-3 entries first). Summarize: `typetrack
schema`/`typetrack docs` CLI commands (shared JSON-Schema extraction), the
dev server's new `/` event inspector page, `debugOverlayMiddleware()`, and
that a VSCode extension was deliberately scoped out with rationale (per
BRIEF.md Design decision 1) rather than silently dropped.

## Testing

No new `src/`/`packages/*/src` code in this issue -- the "testing" is: the
citation-verification pass above (manual), plus this repo's standing
`qa.yml` checks (`build:all`, `size`, `e2e`, `lint`, `typecheck`,
`typecheck:svelte`, `test`, `knip`) run unchanged and green, confirming
nothing about the Markdown-only changes here regressed Knip's unreferenced-
file detection or any link/anchor.

## Out of scope

Any further `src/` change -- issues 001-004 already implemented every
production-code piece this issue documents. Screenshot/GIF generation for
the event inspector UI or debug overlay -- no such tooling exists in this
repo today and adding one is out of this phase's scope (BRIEF.md's Out-of-
scope list).
