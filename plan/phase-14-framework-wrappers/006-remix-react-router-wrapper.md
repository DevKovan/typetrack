# 006 — `@typetrack/remix`: React Router v8 framework-mode wrapper (re-export + route tracking)

## Context

Depends on `@typetrack/react` (Phase 4, already shipped) — this package
is a thin layer on top of it, not a parallel reimplementation, mirroring
how `@typetrack/next` (Phase 4 issue 002) is a thin layer on top of
`@typetrack/react` too.

**Package-naming and target-API decision, researched carefully per this
phase's own explicit instruction not to assume**: "Remix" as a
separately-distributed framework is effectively dead — Remix v2 (and its
contemporaneous React Router v6 base) reached **end-of-life in June
2026** (no further security updates), and Remix's own team blog
("Merging Remix and React Router") confirms Remix was absorbed into
React Router itself starting with React Router v7. **React Router v8
GA'd June 17 2026** and is the current, actively-maintained, actually-
installable target — it removed `react-router-dom` entirely (the
package is now ESM-only, `react-router` is the sole package for both
routing-only and full framework-mode use) and made middleware a default-
on baseline feature. Building this package against classic
`@remix-run/*`/React Router v6 APIs would ship dead code nobody could
install into a current project. Per this task's explicit instruction,
the package **name** stays `@typetrack/remix` (still the recognizable,
documented vernacular for React Router's full-stack/"framework mode"),
but its `peerDependencies` target `react-router: ^8.0.0` exclusively,
and every import in this package's source comes from `"react-router"` —
**never** `"react-router-dom"` (confirmed gone in v8; importing from it
would be a dead import that fails to resolve) and never any
`@remix-run/*` package.

**Why this package needs no `"use client"`-equivalent boundary (unlike
`@typetrack/next`), researched, not assumed**: `@typetrack/next` needs a
`"use client"`-marked boundary file because the Next.js App Router's
*default* rendering mode is React Server Components, where Context can
only be instantiated from an explicitly client-marked component. React
Router v8's **default** framework mode (`react-router dev`/`react-router
build`, with no opt-in to the experimental `unstable_reactRouterRSC`
Vite plugin) is traditional SSR + client hydration — there is **no**
Server/Client Component split in that default mode at all; every
component in the tree, including a root layout rendering an
`AnalyticsProvider`, behaves exactly like plain pre-RSC-era React.
(React Router v8 does have an RSC surface, confirmed via research, but
its own documentation explicitly labels it experimental/unstable as of
v8 — out of scope here, see BRIEF.md's "Out of scope for this whole
phase".) This means a plain React Context provider — `@typetrack/react`'s
own `AnalyticsProvider`, completely unmodified — works directly in a
React Router v8 framework-mode app with zero boundary-marking needed.

**Route-change tracking decision**: `react-router`'s `useLocation()`
hook (confirmed current, stable API — `pathname`/`search`/`hash`/
`state`/`key`, unchanged in shape across v6/v7/v8) is the equivalent of
Next's `usePathname()`/`useSearchParams()` pair, but simpler: a single
hook already exposes both `pathname` and `search` together, with no
`<Suspense>`-boundary requirement of the kind Next's `useSearchParams()`
carries (React Router's own routing context has no comparable
static-generation/Suspense constraint) — confirmed via research, so this
package's `AnalyticsPageView`-equivalent needs no internal `<Suspense>`
wrapping, unlike `@typetrack/next`'s issue 003.

## Acceptance criteria

- `packages/remix/package.json`:
  - `"name": "@typetrack/remix"`, `"private": false`, `"type":
    "module"`.
  - `"main"`/`"module"`/`"types"`/`"exports"` shaped identically to
    `packages/next/package.json`.
  - `"scripts"`: same set as `packages/next/package.json`'s.
  - `"peerDependencies"`: `"react": "^19.0.0"`, `"react-dom":
    "^19.0.0"`, `"react-router": "^8.0.0"` (all required).
  - `"dependencies"`: `"@typetrack/react": "workspace:*"`,
    `"typetrack": "file:../.."`.
  - `"devDependencies"`: adds `"react-router"` (current stable, `8.x`),
    plus the same React/testing-library/happy-dom/toolchain set as
    `packages/next`.
- `packages/remix/tsup.config.ts`: same shape as
  `packages/react/tsup.config.ts` — **no `banner`** (no `"use client"`
  directive needed, per Context; this is a deliberate, documented
  difference from `packages/next/tsup.config.ts`, not an oversight).
- `packages/remix/src/index.ts`:
  - Re-exports `AnalyticsProvider`/`AnalyticsProviderProps`/
    `useAnalytics`/`Analytics`/`EventMap` from `@typetrack/react`,
    unmodified — documented explicitly (code comment) as a plain
    re-export, mirroring how `@typetrack/next`'s own `useAnalytics`
    re-export is already documented.
  - Exports `AnalyticsPageView` (this package's own genuinely new code
    — the router-aware piece).
- A pure, directly unit-testable function building the `.page()` args
  from `useLocation()`'s `pathname`/`search` fields — mirrors
  `buildPageViewArgs.ts`'s exact shape/reasoning (same `name`/
  `props.search`-when-non-empty contract, for cross-framework
  consistency with `@typetrack/next`/`@typetrack/nuxt`).
- `packages/remix/src/AnalyticsPageView.tsx`:
  - Exports a component taking no required props, usable as
    `<AnalyticsPageView />` inside (a descendant of) an
    `AnalyticsProvider`.
  - On mount and on every subsequent `pathname`/`search` change (via
    `useLocation()` + `useEffect`, dependency array on the derived
    `pathname`/`search` values, not the `location` object itself —
    mirrors `@typetrack/next`'s issue 003 reasoning for why the derived
    string, not the object reference, is the correct dependency),
    calls `useAnalytics().page(...)`/`dispatchPageView(...)` (whichever
    delegation the implementor chooses — document it; reusing
    `dispatchPageView` from `typetrack`, matching every other
    framework's route-tracking piece in this phase, is preferred for
    consistency) using the pure args-building function above, exactly
    once per actual change.
  - Renders no visible DOM output of its own.

## Test requirements

Both unit and integration tests are required; neither substitutes for
the other.

**Unit:**
- The pure `.page()`-args-building function: given a pathname and empty
  search string, returns `{ name: pathname }` with no `props` key (or
  `props: undefined`, document which); given a pathname and non-empty
  search string, returns `{ name: pathname, props: { search: "..." } }`.
- Assert `@typetrack/remix`'s re-exported `AnalyticsProvider`/
  `useAnalytics` are the same underlying implementation as
  `@typetrack/react`'s (reference equality, since this is a pure
  re-export) — proving this package genuinely is thin, not a
  reimplementation, mirroring `@typetrack/next`'s issue 002 precedent.

**Integration** (real rendering via `@testing-library/react`, with
`react-router`'s routing context provided via its own testing-oriented
`MemoryRouter`/`createMemoryRouter` + `RouterProvider` — implementor
verifies and uses whichever is current/correct for exercising
`useLocation()` under React Router v8's Data/Framework-mode
implementation, not the older Declarative-mode-only APIs):
- Render `<AnalyticsProvider analytics={fakeAnalytics}>` **imported
  from `@typetrack/remix`** wrapping a consumer using `useAnalytics()`
  (also imported from `@typetrack/remix`), asserting `track`/
  `identify`/`page`/`flush` calls reach `fakeAnalytics` exactly as in
  `@typetrack/react`'s own integration test — proving the re-exported
  component genuinely functions as a working context provider at
  runtime.
- Render `<AnalyticsProvider analytics={fakeAnalytics}>
  <AnalyticsPageView /></AnalyticsProvider>` inside a test router at a
  given initial route; assert `fakeAnalytics.page` was called once on
  mount with the expected `name`/`props`.
- Trigger a client-side navigation within the test router (via
  `useNavigate()`/the router's own navigation API) to a different
  route; assert a second `.page()` call fires with the new route's
  args.
- Navigate again to the same route/search (simulating an unrelated
  parent re-render, if the test harness allows constructing this
  scenario); assert `.page()` is *not* called again (dedup via the
  effect's dependency array).
- Full `bun test` from the repo root still passes, including
  `@typetrack/react`'s own test suite and all pre-existing tests.

## Out of scope

- React Server Components / `unstable_reactRouterRSC` support (see
  BRIEF.md's Design decision 7 and "Out of scope for this whole phase")
  — deferred until React Router's own RSC surface stabilizes.
- Classic Remix (`@remix-run/*`) API support — this package targets
  React Router v8 exclusively, per Context.
- Server-loader/action-based tracking, or any server-side data-layer
  integration.
- Any change to `@typetrack/react`'s own source.
- Pages that opt out of framework mode entirely (React Router's
  "declarative mode"/"data mode" without the Vite framework-mode
  compiler) — this package assumes framework mode, matching the task's
  own framing.
