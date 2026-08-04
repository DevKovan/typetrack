# 006 — Cookieless mode: `analytics.cookieless`, locking core's no-storage contract, `autoUTM` update

## Context

Independent of issues 002-005 (no dependency on consent/enable/anonymous
mode) but depends on issue 001 only insofar as it lives in the same phase
— no actual code dependency. Read `src/plugins/autoUTM.ts` in full before
starting; it is the **only** place in `src/` that currently touches any
client-side storage API (`sessionStorage`, for first-touch UTM
persistence) — everywhere else (`anonymousId`/`sessionId`, per Phase 6) is
already in-memory-only, confirmed by grep, with zero cookie/localStorage/
sessionStorage usage.

"Cookie-less mode" in this phase means: an explicit, documented, opt-in
contract that typetrack core never persists any client-side identifier,
plus a mechanism for plugins (starting with `autoUTM`) to respect that
same contract instead of writing to storage on their own.

## Scope of this issue

- Add `cookieless?: boolean` to `CreateAnalyticsOptions<Events>`, default
  `false`.
- Add a readonly `cookieless: boolean` field to the `Analytics` interface,
  mirroring the option verbatim (`analytics.cookieless === (options.cookieless ?? false)`)
  — a plain property, not a method, since it never changes after
  construction (no `reset()`/runtime-toggle interaction to define).
- Add a regression test (`src/index.test.ts`) that locks in core's
  existing (unchanged by this issue) contract: constructing
  `createAnalytics()` with `cookieless: true` **and** `cookieless: false`/
  omitted, then exercising every verb, and asserting that
  `localStorage`/`sessionStorage`/`document.cookie` (stubbed spies) are
  never touched by core itself in either case — this is not a new
  behavior, it's a written-down, tested guarantee of the status quo, so a
  future regression is caught.
- Update `src/plugins/autoUTM.ts`: inside `autoUTMSetup`, read
  `analytics.cookieless` (the plugin already receives the live `Analytics`
  instance as its sole parameter — no new mechanism needed). When `true`,
  skip the `persistCampaign(...)` call entirely in the
  UTM-params-present branch (the "Campaign Landing" `track()` call still
  fires exactly as before — only the `sessionStorage.setItem` write is
  skipped). The UTM-params-absent branch's `readPersistedCampaign(...)`
  call may also be skipped when `cookieless` is `true` (its result is
  already unused either way today per the existing code's own comment —
  confirm this while making the change, don't silently leave a dead
  storage read in place under `cookieless: true`).
- Update `autoUTM`'s module-level doc comment to state the new
  `cookieless`-mode behavior explicitly (no persistence, no first-touch
  dedup across page loads — every page load with UTM params in its URL
  fires its own "Campaign Landing" event; a later page load in the same
  session with no UTM params of its own simply doesn't fire the event,
  same as today's "nothing persisted" case).

## Design decisions made in this issue

- **No new registration/plumbing mechanism.** Plugins already receive the
  live `Analytics` instance (Phase 10); exposing `cookieless` as a plain
  readonly field on that instance is sufficient — no new `Plugin`
  signature change, no new context object.
- **Providers are not wired to `cookieless` in this issue.** A provider
  adapter (`packages/provider-*`) has no access to the `Analytics`
  instance or this flag today, and giving it one would be a real,
  adapter-specific, vendor-facing change (e.g. telling GA4 to skip its own
  cookie) — explicitly out of scope, see BRIEF.md's phase-wide "Out of
  scope".
- **This issue does not change `anonymousId`/`sessionId` behavior at
  all** — they are already in-memory-only regardless of `cookieless`; this
  issue's regression test simply asserts that fact under test, it doesn't
  introduce new logic to achieve it.

## Acceptance criteria

- `CreateAnalyticsOptions<Events>.cookieless?: boolean`, default `false`.
- `Analytics.cookieless` reflects the constructor option exactly, readonly
  from the app's perspective (TypeScript-level readonly on the interface
  is sufficient — no runtime `Object.freeze` requirement).
- Regression test passes for both `cookieless: true` and `cookieless:
  false`/omitted: no storage API call from core itself, across `track`/
  `page`/`screen`/`identify`/`group`/`alias`/`reset`/`flush`/`destroy`.
- `autoUTM()` with `cookieless: true`: a page load with UTM params in
  `location.search` still fires exactly one "Campaign Landing" `track()`
  call with the parsed campaign properties; `sessionStorage.setItem` is
  never called (spy assertion).
- `autoUTM()` with `cookieless: false`/omitted: zero behavior change from
  pre-issue-006 (regression-tested against the existing Phase 10 tests
  for this plugin — they must continue passing unmodified).
- `autoUTM()` with `cookieless: true` and no UTM params in the current
  URL: no "Campaign Landing" event fires, and `sessionStorage.getItem` is
  never called (if the dead-read-removal decision above is taken) or is
  called but its result provably has no effect (if left in place) —
  implementor's call per the Design decisions above, document whichever is
  chosen.

## Test requirements

**Unit tests**: extend `src/plugins/autoUTM.test.ts` with the
`cookieless: true`/`false` branches described above.

**Integration tests**:
- `src/index.test.ts`: the core no-storage-API regression test across all
  nine verbs, for both `cookieless` values.
- `src/plugins/autoUTM.integration.test.ts`: extend the existing
  end-to-end flow with a `cookieless: true` scenario alongside the
  existing `cookieless: false` (implicit, pre-issue-006) scenario.

## Out of scope

- Any change to `anonymousId`/`sessionId` generation or lifecycle.
- Wiring `cookieless` into any provider adapter (`packages/provider-*`).
- Ephemeral/rotating identifiers — see BRIEF.md's phase-wide "Out of
  scope".
- Any plugin other than `autoUTM` — no other shipped plugin (Phase 10)
  touches storage, so none of them need a change here (confirm this via a
  grep pass as part of this issue's implementation, don't just assume).
