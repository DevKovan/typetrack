# 005 — `autoUTM()` plugin: first-touch campaign persistence + landing event

## Context

Depends on issue 001 (`Plugin` type/registration). Independent of issues
002-004. Resolves this phase's flagged overlap with Phase 9's existing
`context: true` auto-capture, which already annotates every `track`/`page`/
`screen` event's `context.campaign` live from `location.search` (see
`src/context.ts`'s `parseCampaign`/`captureDynamicContext`) — **do not
relitigate that overlap, the split below is locked from this phase's
grill-me interview**:

- Phase 9's `context.campaign` is a **live, per-event, read-from-current-URL**
  annotation — present only on events fired while the current URL still
  carries UTM query params, and gone again once the app navigates away from
  that URL (e.g. after an SPA route change strips the query string).
- `autoUTM()` serves a **distinct** purpose: capturing the UTM params
  present on the very first page load of a session (first touch),
  **persisting** them (`sessionStorage`) so campaign attribution survives
  past that first URL, and firing exactly **one** dedicated landing event
  at that moment. It does not annotate every subsequent event's `context`
  — that remains Phase 9's job, unchanged and untouched by this issue.
- The two are complementary, not duplicative: an app can use Phase 9's
  `context: true` for live per-event campaign context on the landing page
  itself, and `autoUTM()` for durable first-touch attribution that
  survives navigation. Using one does not require the other.

`src/context.ts`'s `parseCampaign` function (the 5-UTM-param-to-`CampaignParams`
mapping) is not currently exported. This issue exports it and reuses it
here, rather than re-implementing the same param mapping a second time in
`src/plugins/autoUTM.ts`.

## Scope of this issue

1. In `src/context.ts`: change `function parseCampaign` to `export
   function parseCampaign` (no signature/behavior change — purely widening
   the export surface for reuse). Note in a comment that this is now
   reused by `src/plugins/autoUTM.ts`, not just internal to this module.
2. New `src/plugins/autoUTM.ts`:

```ts
import type { Plugin } from "../plugins";
import { isBrowserEnvironment, parseCampaign } from "../context";

export interface AutoUTMOptions {
  // sessionStorage key used to persist the first-touch campaign params.
  // Defaults to "typetrack_first_touch_campaign".
  storageKey?: string;
}

// Browser-only, one-shot (no listeners, no teardown -- setup returns
// undefined). On setup:
//   - Parses UTM params from the current location.search via
//     parseCampaign() (src/context.ts, Phase 9).
//   - If present: persists them to sessionStorage under storageKey (JSON,
//     guarded by try/catch -- sessionStorage can throw in some private-
//     browsing modes) and fires exactly one
//     analytics.track("Campaign Landing", campaign) call.
//   - If absent from the current URL: checks sessionStorage for a
//     previously-persisted value from an earlier page load THIS SESSION.
//     If found, does nothing further (the landing event already fired
//     earlier in this session for the real first touch -- this is not a
//     new landing, just a later page in the same session with no UTM
//     params of its own). If nothing is persisted either, does nothing
//     (this is a session with no campaign attribution at all).
// Never throws, regardless of sessionStorage availability or malformed
// stored data.
export function autoUTM(options?: AutoUTMOptions): Plugin;
```

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Event name**: `"Campaign Landing"` (Title Case, per `plan/VISION.md`'s
  Examples policy convention already used across this phase's other
  plugins), payload is the `CampaignParams` object as-is (`source`/
  `medium`/`campaign`/`term`/`content`, whichever subset were present in
  the URL) — matches Phase 9's `context.campaign` shape exactly, so a
  reader who already knows that shape recognizes this payload immediately.
- **Fires at most once per browser session** (not once per plugin
  registration, not once per navigation): a second `createAnalytics()`
  call within the same tab session (e.g. after a full page reload, since
  `sessionStorage` survives reloads within a tab) — with the same UTM
  params still in the URL — is a judgment call left to the implementor:
  either re-fires (treating a URL that still has UTM params as
  "genuinely landing again") or is suppressed by the same persisted-value
  check used for the no-UTM-params case. Recommended default:
  **re-fires** when UTM params are actually present in the current URL
  (the persisted-value check only guards the *no-params-in-URL* branch) —
  document whichever behavior is implemented clearly in the plugin's JSDoc
  and in issue 007's example.
- **No integration with Phase 9's `context` pipeline**: `autoUTM()` does
  not reach into `resolveEventContext`/`captureDynamicContext` and does
  not modify any other event's `context` — apps wanting the persisted
  first-touch value merged into later events' context must read
  `sessionStorage[storageKey]` themselves (e.g. via Phase 9's
  `context.featureFlags`-style app-owned getter pattern, passed as a
  caller-supplied `TrackOptions.context` value) — explicitly out of scope
  for this issue, per the locked grill-me decision that these two features
  stay decoupled.

## Acceptance criteria

- `src/context.ts`'s `parseCampaign` is exported; no behavior change to
  any existing Phase 9 caller.
- `src/plugins/autoUTM.ts` exists, exporting `AutoUTMOptions`, `autoUTM`.
- `src/index.ts` re-exports `autoUTM` and `AutoUTMOptions`.
- With UTM params in `location.search` and a working `sessionStorage`:
  fires exactly one `"Campaign Landing"` track call with the correctly
  parsed campaign object, and persists the same object to
  `sessionStorage[storageKey]` (default key verified, plus a custom
  `storageKey` override).
- With no UTM params in `location.search` and no prior persisted value:
  zero track calls, nothing written to storage.
- With no UTM params in `location.search` but a prior persisted value
  present (simulating a later page in the same session): zero track calls
  (no re-fire), existing persisted value left untouched.
- `sessionStorage` throwing on read or write (simulate via a stub that
  throws) never crashes plugin setup, and results in the plugin behaving
  as if no persisted value existed (still fires the landing event if UTM
  params are present in the URL; the storage failure only affects
  persistence, not the event itself).
- No-op (no throw, no track call) with no `window`/`location` present.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/plugins/autoUTM.test.ts`): the UTM-presence branch
logic against hand-constructed stub `location`/`sessionStorage` objects,
independent of a full `createAnalytics()` round-trip. Also extend
`src/context.test.ts` minimally if needed to cover `parseCampaign`'s newly
public export (likely already covered indirectly by existing Phase 9
tests — do not duplicate coverage that already exists there).

**Integration tests** (`src/plugins/autoUTM.integration.test.ts`):
construct `createAnalytics({ plugins: [autoUTM()] })` against a stubbed
browser environment with a real (or realistic stub) `sessionStorage`,
covering the UTM-present, UTM-absent-with-persisted-value, and
UTM-absent-with-nothing-persisted scenarios, asserting delivered events via
a recording stub provider and the resulting `sessionStorage` contents.

## Out of scope

- Any change to Phase 9's `src/context.ts` capture pipeline beyond
  exporting `parseCampaign` — explicitly locked as decoupled from this
  plugin.
- `autoPage`, `autoClicks`, `autoScroll`, `autoVisibility`, `autoErrors`,
  `autoWebVitals`, `autoPerformance` — issues 002-004.
- `examples/plugins/` — issue 007.
