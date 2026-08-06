# Phase 15 brief: validation hardening

Read CLAUDE.md, plan/VISION.md ("Validation (partially built)" +
"Examples -- mandatory, per-phase"), and plan/ROADMAP.md (Phase 15
section) first. Read `src/schema.ts` in full (the Phase 6 canonical-event
validation module: `CanonicalEvent`, `SchemaMap`, `InferEvents`,
`EventValidationError` -- all built on Zod's *types only*, `import type {
z} from "zod"`, no Zod runtime dependency in core, per CLAUDE.md's "zero
vendor deps in core" rule) and `src/index.ts`'s `track()` implementation
(the `schema.safeParse()` call site, ~line 1119-1134) and its surrounding
`CreateAnalyticsOptions` fields (`schemas`, `onValidationError`) in full.
Also read `src/consent.ts` (Phase 11's pure-module-then-wiring split --
this phase's `src/deprecation.ts` follows the same shape) and
`src/index.ts`'s `warnedAnonymousMode`/`warnedCapabilities`
warn-once-per-key `Set<string>` closure pattern (reused here for
deprecated-event warnings).

This phase builds directly on top of Phases 6-14; do not re-litigate their
design.

## Research grounding (informed the design, not vendor deps in core)

Before planning, researched (WebSearch, August 2026) rather than assumed:

- **Production stripping of dev-only validation**: the established
  industry pattern (React, Redux Toolkit, Zustand, etc.) is an explicit
  `if (process.env.NODE_ENV !== "production")`-guarded branch that a
  consuming app's *own* bundler (Vite/webpack/esbuild) statically replaces
  and dead-code-eliminates at build time -- the stripping is a property of
  the app's build, never something a library can perform on itself at
  publish time (a library ships source/ESM either way; DCE only happens
  when something bundles it against a real `NODE_ENV`/`import.meta.env`
  value). A real, confirmed-current limitation from research: "it's
  currently not possible to strip developer-added validation imports in
  production without explicit configuration" -- i.e. removing a schema
  object (and the Zod runtime it pulls in) from a production bundle
  requires the *app* to guard the import/reference itself; no library-side
  trick makes this automatic. This matches, exactly, this repo's own
  pre-existing `devServer` design note (`src/index.ts` ~line 84-87): *"Core
  never inspects `NODE_ENV`/`import.meta.env` or reads any file on its own
  to decide this -- gating 'am I in dev' is entirely the caller's
  responsibility."* This phase's `validate` option (issue 003) follows that
  exact precedent rather than inventing a new policy: an explicit,
  caller-supplied boolean, resolved once at construction, never an
  internal env read.
- **Schema evolution/versioning**: current guidance (multiple
  2026 sources) converges on: distinguish additive changes (new optional
  fields -- safe, no version bump needed) from breaking changes (field
  removal/meaning change/rename -- needs a new event name or an explicit
  version bump, never an in-place mutation of what an existing field
  means); tag a tracking plan/schema with a version identifier so
  downstream consumers can filter/reason about which shape they're
  looking at; most orgs cut versions quarterly/annually, not per-commit.
  This phase implements the lightweight, non-breaking piece of that
  (a `schemaVersion` tag stamped onto every event's `metadata`, issue 004)
  and documents the additive-vs-breaking discipline as guidance (source
  comments + the issue-005 example's README) -- it deliberately does
  **not** build a multi-version-per-event runtime schema resolver (e.g.
  `schemas: { event: { 1: schemaV1, 2: schemaV2 } }`); no current
  ROADMAP/VISION line asks for that, Zod's own `.optional()`/union
  primitives already cover additive evolution within one schema, and
  CLAUDE.md's "don't design for hypothetical future requirements" applies
  directly -- see Design decision 3 below for the full reasoning.
- **Deprecated-event handling**: current guidance converges on "ship the
  new event alongside the old, warn, run both until the dashboards/call
  sites are migrated, then remove" -- deprecation is a *visible, timed*
  transition, not a silent rewrite. This phase's `deprecatedEvents` option
  (issues 001-002) implements exactly that: a warn-once console message
  naming the deprecated event, its replacement (if any), and an optional
  sunset date -- see Design decision 2 below for why it also supports an
  opt-in auto-redirect to the replacement name, which is a deliberate,
  narrow addition beyond "just warn," justified by this repo's own
  "Prisma for Analytics" vendor-abstraction ethos (VISION.md's Golden
  Rule): a `deprecatedEvents` config entry is itself a one-file rename
  migration, the same shape as a one-file provider swap.

Sources: [Schema Versioning for Analytics: Best Practices to Deprecate
Without Chaos](https://warpdriven.ai/en/blog/industry-1/schema-versioning-best-practices-analytics-deprecate-without-chaos-109),
[How to Implement Event Versioning
Strategies](https://oneuptime.com/blog/post/2026-01-30-event-driven-versioning-strategies/view),
[CDP Event Schema Versioning for Stable Analytics and
Activation](https://www.pathtoproject.com/blog/20260413-cdp-event-schema-versioning-without-breaking-activation),
[Schema Evolution Strategies](https://branchboston.com/schema-evolution-strategies-handling-data-structure-changes-without-breaking-pipelines/).

## Scope (from plan/ROADMAP.md), mapped to issues

- **Production stripping of runtime validation** -> issue 003 (`validate`
  option) + issue 005 (the recipe example showing how an app wires it to
  its own bundler's env replacement for real bundle-size stripping).
- **Schema evolution/versioning** -> issue 004 (`schemaVersion` stamp +
  additive-evolution guidance).
- **Deprecated-event handling** -> issues 001 (pure `src/deprecation.ts`
  module) and 002 (wiring into `track()`).
- **Examples**: `examples/validation/` -> issue 005.

## Design decisions locked for this phase

1. **`deprecatedEvents` is a plain `Record<string, DeprecatedEventInfo>`,
   not constrained by the `Events` generic.** Deliberate: the whole point
   of this map is to catch calls using a name that has *already been
   removed* from an app's current `Events` type (or a raw JS caller with
   no compile-time check at all) -- constraining its keys to `keyof
   Events` would make it impossible to name the exact strings it exists to
   catch. Mirrors `schemas`' generic constraint being the thing this
   *diverges* from, intentionally.
2. **A `deprecatedEvents` entry with a `replacement` auto-redirects the
   call to fire under the new name (schema lookup, `CanonicalEvent.name`,
   and provider dispatch all use the resolved name); an entry without one
   only warns.** This is a considered deviation from "just warn" (the
   research-grounded default): typetrack's core USP (VISION.md's Golden
   Rule) is that switching something vendor/naming-related is a one-file
   config change, not an application-code sweep. Redirecting lets an app
   rename an event across its entire tracking plan by editing one
   `deprecatedEvents` entry, exactly like swapping a provider -- every
   existing `track("old_name", payload)` call site keeps compiling and
   keeps working, but the event that actually reaches providers (and gets
   validated, if a schema exists) is the new one. The warning still fires
   every time (once per event name, not per call -- see the
   `warnedCapabilities`/`warnedAnonymousMode` precedent in `src/index.ts`)
   so the migration stays *visible*, never silent. An entry with no
   `replacement` (a pure retirement, nothing to redirect to) only warns --
   the event still fires under its original name, unchanged.
3. **`schemaVersion` is a single instance-level tag, not a per-event
   multi-version resolver.** `createAnalytics({ schemaVersion: "2026-08"
   })` stamps that value onto `metadata.schemaVersion` for every `track()`
   call (caller-supplied `trackOptions.metadata.schemaVersion`, if any,
   wins over the instance default -- same "explicit call-site value beats
   instance default" precedent as every other per-call override in this
   codebase). No per-event override, no multi-schema-version lookup table.
   Reasoning: (a) no ROADMAP/VISION line asks for concurrent multi-version
   validation of the *same* event name, (b) Zod's own `.optional()`/union
   primitives already handle *additive* evolution within a single schema
   with zero new typetrack API surface, (c) CLAUDE.md's "don't design for
   hypothetical future requirements" applies directly -- a heavier
   resolver can be added in a future phase if a real, concrete need
   surfaces. This phase's job is the tag (so downstream providers/
   warehouses can filter/route by tracking-plan version) plus documented
   guidance on the additive-vs-breaking discipline, not a new validation
   engine.
4. **`validate` is resolved once at construction, like `anonymousMode`/
   `cookieless`, not a per-call or runtime-togglable option.** Consistent
   with this repo's existing "construction-time-only policy" precedent
   for boolean behavior flags (see `anonymousMode`'s own doc comment: "An
   app that needs to switch ... at runtime should construct a new
   `Analytics` instance instead"). `validate?: boolean`, default `true`
   (exact current, pre-Phase-15 behavior -- zero change for every existing
   caller). `false` skips the `schema.safeParse()` call (and therefore the
   `EventValidationError`/`onValidationError` path) entirely for every
   event, every call -- the raw payload is forwarded exactly as it would
   be for an event with no `schemas[event]` entry at all. Core performs no
   `NODE_ENV`/`import.meta.env` read anywhere to decide this value itself
   -- see the research-grounding section above and the existing `devServer`
   precedent this repeats verbatim in spirit.
5. **No `tsup.config.ts`/build-system change anywhere in this phase.**
   `src/schema.ts` already imports `z` type-only (`import type { z } from
   "zod"`) -- core has zero Zod runtime dependency today, and nothing in
   this phase adds one. "Stripping" is entirely about what a *consuming
   app's own bundler* does with the schema objects/Zod runtime *it*
   installs -- issue 005's example demonstrates the recipe (guard the
   `schemas`/`validate` values behind the app's own `process.env.NODE_ENV`/
   `import.meta.env.DEV` check) but no code in `src/`/`tsup.config.ts`
   changes to support it, beyond issue 003's new option.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-15-validation-hardening/`. **Issue
   files are kept, never deleted** (standing policy -- see
   `plan/ROADMAP.md` "Policy changes").
2. For each issue, in order (001 -> 005, respecting the dependency chain --
   002 depends on 001; 003/004 are independent of 001/002 and of each
   other; 005 depends on 001-004 all existing): the `implementor` subagent
   implements with unit+integration tests, the `qa` subagent checks it,
   loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly -- plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-15-validation-hardening` for isolation. Once all issues pass
QA: push commits to `origin/main` directly (no PR, no force-push -- if
`origin/main` has moved, rebase cleanly on top). Delete the
`phase-15-validation-hardening` branch (local, and remote only if pushed
there). Do **not** delete `plan/phase-15-validation-hardening/` issue
files. Add a one-line Phase 15 entry to `plan/CHANGELOG.md`, following the
existing format (see the Phase 6-14 entries for current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Out of scope for this whole phase

- Any per-event multi-version schema resolver -- see Design decision 3.
- Any `tsup.config.ts`/build-system change -- see Design decision 5.
- Any core-side `NODE_ENV`/`import.meta.env` read -- see Design decision 4.
- Any change to `packages/*` (framework wrappers/provider adapters) --
  this phase is `src/` (core) + `examples/validation/` only.
- A CLI/lint rule that scans an app's source for deprecated-event string
  literals (Phase 18 "Tooling extras" territory, not this phase).
