# 003 — `@typetrack/next`: automatic pageview tracking on route change

## Context

Depends on issue 002.

Research into comparable published packages (PostHog's official Next.js
App Router integration guide, which ships a `PostHogPageView`-style
component; the general pattern used across Next.js analytics
integrations) confirms automatic pageview tracking on client-side route
change is a standard, expected feature of a Next.js analytics wrapper —
not an invented abstraction. The App Router has no built-in "route
changed" event for Client Components; the established pattern is a
Client Component that reads `usePathname()`/`useSearchParams()` from
`next/navigation` and fires on change via `useEffect`.

**Known gotcha, confirmed by research**: `useSearchParams()` requires a
`<Suspense>` boundary in the App Router, or Next.js's static-generation
build fails. Most published examples require the *consumer* to wrap the
tracking component in their own `<Suspense>`. This issue improves on that
by wrapping the internal `usePathname`/`useSearchParams`-consuming logic
in its **own** internal `<Suspense fallback={null}>` boundary, so
consumers drop in the exported component with zero additional Suspense
setup of their own — a deliberate, small ergonomic improvement over the
raw researched precedent, still consistent with "as thin as the real
requirement" (one extra wrapping component, not a new abstraction layer).

**`.page()` argument shape decision** (no existing core convention to
defer to, decided here rather than left ambiguous for the implementor):
on every pathname/searchParams change, call `analytics.page(name, props)`
with `name` = the current pathname, and `props` = `{ search: <query
string> }` only when the search string is non-empty (omit `props`
entirely otherwise). This keeps `name` a clean route identifier and
surfaces query params as structured, optional data, matching core's
existing `page(name?: string, props?: Record<string, unknown>)` signature.

**Testability decision**: the pure logic that computes the `.page()` call
arguments from a pathname + search-params-like input must be extracted
into a plain, non-component, directly unit-testable function (e.g.
exported from its own module), separate from the `useEffect`/hook glue —
so it has a true unit test that doesn't require rendering anything.

**Honest limitation, documented rather than silently ignored**: the actual
Next.js static-generation build failure that an unguarded
`useSearchParams()` triggers cannot be reproduced by rendering under
Bun + happy-dom (that environment has no server-side/static-generation
phase). This issue's automated tests instead verify (a) that the
implementation's internal Suspense boundary is structurally present, and
(b) the component's client-side runtime behavior (calls `.page()`
correctly on mount and on simulated navigation changes); full confidence
that the internal Suspense boundary actually prevents a real Next.js build
failure is deferred to manual verification in a real Next.js app.

## Acceptance criteria

- A pure, directly unit-testable function (e.g.
  `buildPageViewArgs(pathname: string, searchParams: URLSearchParams |
  { toString(): string }): { name: string; props?: Record<string,
  unknown> }` or equivalent — implementor may adjust the exact signature,
  document whatever is chosen) implementing the `name`/`props` shape
  decided above.
- `packages/next/src/AnalyticsPageView.tsx`:
  - First line `"use client";`.
  - Exports a component (e.g. `AnalyticsPageView`) taking no required
    props, usable as `<AnalyticsPageView />` inside (a descendant of) an
    `AnalyticsProvider`.
  - Internally wraps its `usePathname`/`useSearchParams`-consuming logic
    in its own `<Suspense fallback={null}>` boundary — consumers need no
    Suspense boundary of their own.
  - On mount and on every subsequent pathname/searchParams change, calls
    `useAnalytics().page(...)` using the pure function above, exactly
    once per actual change (no duplicate calls on unrelated re-renders —
    achieved via the effect's dependency array).
  - Renders no visible DOM output of its own (a tracking-only component).
- `packages/next/src/index.ts` updated to also export `AnalyticsPageView`
  (and the pure args-building function, if useful to re-export for
  consumer testing/customization — implementor's call, document the
  decision either way).

## Test requirements

**Unit:**
- The pure `.page()`-args-building function: given a pathname and empty
  search params, returns `{ name: pathname }` with no `props` key (or
  `props: undefined` — document which); given a pathname and non-empty
  search params, returns `{ name: pathname, props: { search: "..." } }`
  with the exact query string.

**Integration** (real rendering via `@testing-library/react`, with
`next/navigation`'s `usePathname`/`useSearchParams` mocked via
`mock.module`, following this repo's existing `mock.module` convention
from `packages/provider-posthog/src/index.test.ts`):
- Render `<AnalyticsProvider analytics={fakeAnalytics}><AnalyticsPageView
  /></AnalyticsProvider>` with mocked navigation hooks returning a given
  pathname/searchParams; assert `fakeAnalytics.page` was called once on
  mount with the expected `name`/`props`.
- Update the mocked hooks' return values and force a re-render (e.g. via
  `rerender()`); assert a second `.page()` call fires with the new
  pathname's args.
- Re-render with the **same** mocked pathname/searchParams (simulating an
  unrelated parent re-render); assert `.page()` is *not* called again
  (dedup via the effect dependency array).
- Assert the component renders (mounts) successfully without the
  consumer providing any external `<Suspense>` boundary — proving the
  internal Suspense wrapper is sufficient for the component to mount at
  all under `@testing-library/react`'s render (acknowledging, per Context
  above, that this does not reproduce Next's real static-generation
  build-failure scenario).
- Full `bun test` from the repo root still passes, including issues
  001/002's test suites and all pre-existing tests.

## Out of scope

- Hash-change (`window.location.hash`) tracking.
- Any configurability of the event name (always calls `.page()`, never a
  custom/renamed event).
- Debouncing/throttling beyond one `.page()` call per actual navigation
  change.
- Per-route opt-out/allowlist/denylist configuration — the component is
  all-or-nothing (render it, or don't).
- Server Action / Route Handler / middleware-based navigation tracking.
- Scaffolding a real Next.js app in CI to reproduce the actual
  static-generation Suspense-boundary build failure (see Context/Test
  requirements above — deferred to manual verification).
- Pages Router support.
