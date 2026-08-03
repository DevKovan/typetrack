# 001 — `src/context.ts`: runtime detection, UA parsing, static + dynamic capture

## Context

New `src/context.ts` module — the Phase 9 analog of `src/routing.ts`
(Phase 7) and `src/middleware.ts` (Phase 8): a dedicated, standalone,
pure-functional module for this phase's own vocabulary. Depends on
nothing from `src/index.ts`; does not wire into `createAnalytics()`
yet — that's issue 002. Zero vendor deps (per `CLAUDE.md`'s "zero vendor
deps in core" rule) — no `ua-parser-js` or similar; UA parsing is a small
hand-rolled heuristic.

This issue implements the locked design from this phase's grill-me
interview exactly — do not relitigate:

- **Feature detection**: `typeof window !== "undefined" && typeof
  navigator !== "undefined"`. Browser-only fields (`browser`, `os`,
  `device`, `viewport`, `referrer`, `campaign`) are **omitted** (not
  present as keys, not explicit `undefined`) outside a browser
  environment. `locale`/`timezone` are captured everywhere (Node/Bun/edge
  included) via `Intl` — never gated behind the browser check.
- **Static vs. dynamic split**: `locale`, `timezone`, `browser`, `os`,
  `device` are captured **once**, at `createAnalytics()` construction
  time (issue 002 calls this module's static-capture function exactly
  once and caches the result in a closure variable). `viewport`,
  `referrer`, `campaign`, `featureFlags` are captured **fresh on every
  call** (issue 002 calls this module's dynamic-capture function inside
  `buildEvent()`/`track()`'s event construction, once per `track`/`page`/
  `screen` invocation).
- **UA parsing**: a small hand-rolled, regex-based, best-effort parser —
  not exhaustive, not a dependency. Covers Chrome/Firefox/Safari/Edge for
  `browser.name`/`browser.version`; Windows/macOS/Linux/iOS/Android for
  `os.name`/`os.version`; `device.type` (`"desktop" | "mobile" |
  "tablet"`) via UA substring heuristics (e.g. `Mobi`/`Tablet` tokens),
  falling back to `"desktop"` when nothing matches. Never throws on a
  malformed/unrecognized UA string — falls back to omitting the
  unparseable sub-field(s) rather than guessing wrong.
- **Feature flags**: typetrack does not implement a flag system — this is
  explicitly out of `plan/ROADMAP.md`'s "Explicitly out of scope"
  (feature flags/experiments/remote config as a *system*). This module
  only invokes an app-supplied getter and mirrors its return value
  verbatim into `context.featureFlags`. No evaluation, no caching beyond
  "call it fresh per event", no polling.
- **Campaign/referrer**: `campaign` is parsed from
  `window.location.search`'s standard UTM query params (`utm_source`,
  `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` →
  `campaign.source`/`campaign.medium`/`campaign.campaign`/
  `campaign.term`/`campaign.content`); a param that's absent from the URL
  is simply absent from the `campaign` object (not `undefined`). If
  **none** of the five UTM params are present, `campaign` itself is
  omitted entirely (not an empty object). `referrer` is
  `document.referrer` verbatim, but only included when it's a non-empty
  string (an empty-string `document.referrer`, e.g. direct navigation,
  means `referrer` is omitted).

## Scope of this issue

Pure, standalone module — no `createAnalytics()`/`src/index.ts` changes.

`src/context.ts` exports:

```ts
export interface CapturedContext {
  locale?: string;
  timezone?: string;
  browser?: { name: string; version?: string };
  os?: { name: string; version?: string };
  device?: { type: "desktop" | "mobile" | "tablet" };
  viewport?: { width: number; height: number };
  referrer?: string;
  campaign?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  featureFlags?: Record<string, unknown>;
}

// The public opt-in shape supplied to `createAnalytics({ context })`
// (issue 002 owns wiring this into `CreateAnalyticsOptions`; this issue
// only defines the type since `captureDynamicContext` takes it as a
// param).
export interface ContextOptions {
  autoCapture?: boolean;
  featureFlags?: () => Record<string, unknown>;
}

// `typeof window !== "undefined" && typeof navigator !== "undefined"`.
// Exported (not just used internally) so issue 002's tests and any
// future consumer can assert against it directly rather than
// re-deriving the same check.
export function isBrowserEnvironment(): boolean;

// Best-effort, hand-rolled, regex-based. Never throws. Returns an object
// with only the sub-fields it could confidently parse -- an unrecognized
// UA string returns `{}` (all three sub-fields omitted), not a thrown
// error and not guessed defaults.
export function parseUserAgent(userAgent: string): {
  browser?: { name: string; version?: string };
  os?: { name: string; version?: string };
  device?: { type: "desktop" | "mobile" | "tablet" };
};

// Captured once, meant to be called exactly once at `createAnalytics()`
// construction time and cached by the caller. Populates
// `locale`/`timezone` unconditionally (via `Intl`); populates
// `browser`/`os`/`device` only in a browser environment (delegates to
// `parseUserAgent(navigator.userAgent)`).
export function captureStaticContext(): Pick<
  CapturedContext,
  "locale" | "timezone" | "browser" | "os" | "device"
>;

// Called fresh on every `track`/`page`/`screen` invocation. `viewport`/
// `referrer`/`campaign` are populated only in a browser environment (read
// live from `window`/`document`/`location` at call time -- e.g. survives
// SPA navigation/resize between calls, unlike the static fields).
// `featureFlags` invokes `contextOptions?.featureFlags?.()` fresh every
// call (browser-environment-independent -- a Node-side app can supply a
// flag getter too) and mirrors its return value verbatim; omitted
// entirely if no getter was supplied.
export function captureDynamicContext(
  contextOptions: ContextOptions | undefined,
): Pick<CapturedContext, "viewport" | "referrer" | "campaign" | "featureFlags">;
```

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Module boundary**: `src/context.ts` owns environment capture only
  (UA parsing, browser globals, `Intl`, the app-supplied flags getter).
  It does **not** own session bookkeeping (`context.session` —
  `startedAt`/`eventCount`/`durationMs`) — that's core-owned mutable
  state tied to `createAnalytics()`'s lifecycle (construction + `reset()`
  reinitializes it) and belongs in `src/index.ts` (issue 002), not this
  stateless module.
- **Locale source**: prefer `navigator.language` when in a browser
  environment (more accurate for the user's actual browser-language
  preference); fall back to
  `Intl.DateTimeFormat().resolvedOptions().locale` everywhere else
  (Node/Bun/edge, or a browser without `navigator.language` for some
  reason). `timezone` is always
  `Intl.DateTimeFormat().resolvedOptions().timeZone` — no browser-specific
  source exists for this.
- **`browser`/`os` version parsing**: `version` is the best-effort
  leading version-number token that follows the browser/OS name in the
  UA string (e.g. `Chrome/120.0.0.0` → `"120.0.0.0"`); if the parser
  matches the name but can't extract a version substring, `version` is
  omitted from that sub-object rather than left as an empty string.

## Acceptance criteria

- `src/context.ts` exists, exports exactly the surface above, zero
  runtime dependencies beyond built-ins (`Intl`, `window`/`navigator`/
  `document`/`location` where applicable).
- `isBrowserEnvironment()` returns `false` in the Bun test runner's
  default (non-DOM) environment; a test that stubs global `window`/
  `navigator` (e.g. via `Object.defineProperty(globalThis, ...)` or a
  `happy-dom`/similar test environment, implementor's choice — check
  what's already available in the repo's test setup before introducing a
  new dependency) confirms it returns `true` when both are present.
- `parseUserAgent` correctly identifies browser name+version, OS
  name+version, and device type for realistic UA strings covering: Chrome
  on Windows desktop, Safari on macOS desktop, Safari on iOS (mobile),
  Chrome on Android (mobile), Firefox on Linux desktop, an iPad UA
  (tablet). Also covers a garbage/empty-string UA input — returns `{}`,
  never throws.
- `captureStaticContext()` always includes `locale`/`timezone` (both
  populated via `Intl`, asserted to be non-empty strings, not asserted
  against a specific hardcoded value since it depends on the test
  runner's environment); `browser`/`os`/`device` present only when
  `isBrowserEnvironment()` is stubbed `true`, absent otherwise.
- `captureDynamicContext(undefined)` (no `ContextOptions` supplied) never
  throws and returns an object with no `featureFlags` key.
- `captureDynamicContext({ featureFlags: () => ({ foo: true }) })` returns
  `featureFlags: { foo: true }` regardless of browser environment.
- `captureDynamicContext` in a stubbed browser environment with
  `location.search = "?utm_source=newsletter&utm_medium=email"` returns
  `campaign: { source: "newsletter", medium: "email" }` (no `campaign`
  keys, `term`/`content` omitted); with no UTM params at all, `campaign`
  is omitted entirely from the returned object.
- `captureDynamicContext` reads `document.referrer` when non-empty;
  omits `referrer` entirely when `document.referrer === ""`.
- `captureDynamicContext` reads live `window.innerWidth`/`innerHeight`
  into `viewport: { width, height }` when in a browser environment; omits
  `viewport` otherwise.
- None of this module's exported functions ever throw synchronously,
  including with malformed/missing globals.

## Test requirements

Unit tests only (`src/context.test.ts`) — this module has no I/O, no
provider interaction, nothing meaningful to integration-test in isolation
(issue 002's integration tests cover the wired-in behavior).

- `isBrowserEnvironment()` — both branches, via stubbed globals.
- `parseUserAgent()` — one test per realistic UA string listed above,
  plus the garbage-input case.
- `captureStaticContext()` — both branches (browser env stubbed
  true/false), asserting the conditional presence/absence of
  `browser`/`os`/`device` and unconditional presence of
  `locale`/`timezone`.
- `captureDynamicContext()` — no options, flags-only, full UTM string,
  partial UTM string, no UTM params, referrer present/absent, viewport
  present/absent (browser env true/false crossed with each field).

## Out of scope

- Any change to `src/index.ts`, `CreateAnalyticsOptions`, or
  `CanonicalEvent`/`buildEvent()` — issue 002.
- Session bookkeeping (`context.session`) — issue 002.
- Merge/precedence with caller-supplied `TrackOptions.context` — issue
  002.
- `examples/` — issue 003.
