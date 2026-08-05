# frameworks/remix

A minimal, realistic React Router v8 framework-mode app layout using
`@typetrack/remix` (issue 006's package -- targets `react-router: ^8.0.0`,
never `@remix-run/*`; see `plan/phase-14-framework-wrappers/BRIEF.md`'s
Design decision 7 for why this package, still named `@typetrack/remix`,
targets React Router v8 rather than legacy Remix APIs): wraps the app root
in `<AnalyticsProvider>` + `<AnalyticsPageView>` (automatic route-change
pageview tracking via `react-router`'s `useLocation()`), plus a
`signup.tsx` route demonstrating a custom event (`identify()` +
`track("User Signed Up", ...)`).

## Testing

**Not exercised by this repo's own CI/`bun test` suite.** Per
`plan/phase-14-framework-wrappers/BRIEF.md`'s Design decision 8 (extending
`plan/phase-13-runtime-agnostic/BRIEF.md`'s decision 5's own "no new heavy
per-framework dev/build CLI" reasoning to this phase's meta-frameworks),
this repo does not add a React-Router-framework-mode Vite dev server (or
any other React-Router-specific tooling) as a devDependency anywhere in the
monorepo (`CLAUDE.md`: "toolchain is devDependencies only:
Bun/tsgo/typescript/oxlint/Knip/tsup"). Nothing in this directory is
installed, type-checked, or run by `bun install`/`bun test`/`bun run
typecheck` at the repo root -- a passing `bun test` at the repo root proves
nothing about whether this app actually runs. See
[`../README.md`](../README.md) for the full tested-vs-source-only split
this directory is part of (contrast with [`../vue`](../vue),
[`../svelte`](../svelte), [`../solid`](../solid), which genuinely are
tested here). Note also that `@typetrack/remix` itself *is* tested in this
repo, thoroughly, at the *package* level (`packages/remix/src/*.test.tsx`)
-- it's only this particular full-app layout, requiring a real
React-Router-framework-mode dev/build pipeline to actually run end to end,
that isn't.

## Prerequisites

- Node.js and a real React Router v8 framework-mode project, set up by
  *you*, in *your own* project -- not by this repo (`npx create-react-router@latest`,
  or add React Router's framework mode to an existing Vite + React project).
- `@typetrack/remix`, `@typetrack/react`, `typetrack`, and
  `@typetrack/provider-ga4` installed as dependencies (`npm install
  @typetrack/remix @typetrack/react typetrack @typetrack/provider-ga4`).
- A real GA4 property's Measurement ID and API secret (Google Analytics
  Admin -> Data Streams -> your stream -> Measurement Protocol API secrets),
  set as `VITE_GA4_MEASUREMENT_ID`/`VITE_GA4_API_SECRET`.

## How to run

Copy `react-router.config.ts`, `app/analytics.ts`, `app/root.tsx`, and
`app/routes/signup.tsx` into your own React Router v8 framework-mode
project, then:

```sh
# Local dev server (Vite-based):
react-router dev

# Production build + start:
react-router build
react-router-serve ./build/server/index.js
```

## Source

`app/analytics.ts` constructs a plain module-level `Analytics` singleton --
unlike `../nuxt`/`../astro`, React Router v8's default framework mode has no
Server/Client Component split, so there's no config-time/browser-bundle
boundary to cross:

```ts
export const analytics = createAnalytics({
  provider: createGA4Provider({
    measurementId: import.meta.env.VITE_GA4_MEASUREMENT_ID,
    apiSecret: import.meta.env.VITE_GA4_API_SECRET,
  }),
});
```

`app/root.tsx` wraps `<Outlet />` in `<AnalyticsProvider>` once, at the app
root, with `<AnalyticsPageView />` alongside it for automatic route-change
tracking:

```tsx
export default function Root() {
  return (
    <html lang="en">
      <head>{/* ... */}</head>
      <body>
        <AnalyticsProvider analytics={analytics}>
          <AnalyticsPageView />
          <Outlet />
        </AnalyticsProvider>
        <Scripts />
      </body>
    </html>
  );
}
```

`app/routes/signup.tsx` reads `useAnalytics()` (re-exported, unmodified,
from `@typetrack/react`) like any other React component.

## Explanation

- **Install**: both `AnalyticsProvider`/`useAnalytics` are plain,
  unmodified re-exports of `@typetrack/react`'s own -- no
  Remix/React-Router-specific behavior at all for those two. No
  `"use client"`-equivalent boundary file is needed either (unlike
  `@typetrack/next`'s App Router integration): React Router v8's *default*
  framework mode (what `react-router dev`/`react-router build` produce
  without opting into the experimental `unstable_reactRouterRSC` Vite
  plugin) has no Server/Client Component split, so a plain React Context
  provider works directly.
- **SSR**: `react-router.config.ts`'s `ssr: true` is React Router v8's
  default framework-mode SSR setting -- `<AnalyticsProvider>` renders
  correctly server-side with no special handling, the same as any other
  plain React Context provider.
- **CSR + route-change tracking**: `<AnalyticsPageView />` uses
  `react-router`'s `useLocation()` (which already exposes both `pathname`
  and `search` from one hook, unlike `@typetrack/next`'s two-hook,
  Suspense-wrapped equivalent) inside a `useEffect` keyed on
  `[pathname, search, analytics]`, delegating to core's own
  `dispatchPageView()` -- the same dedup-aware helper every other
  framework's route-tracking piece in this phase reuses.
- **Hydration**: `app/analytics.ts`'s module-level singleton is imported by
  `app/root.tsx` on both the server render and the client hydration render
  -- the same module, therefore (module-caching semantics aside) a
  consistent instance shape across both, matching `@typetrack/next`'s own
  established singleton convention.

## Production notes

- **A module-level singleton is the correct choice for a long-lived Node
  server process** (a typical React-Router-framework-mode deployment target,
  unlike `examples/runtimes/vercel-edge`'s per-request Edge Function
  instance) -- constructed once per server process, reused across requests.
- **GA4 credentials are public** (Vite's `VITE_`-prefix convention exposes
  them to the client bundle) -- the same public/scoped-secret consideration
  `../nuxt`'s own Production notes call out applies here too.
- **`@typetrack/remix`'s own peer dependencies are `react-router: ^8.0.0`
  only** -- never `@remix-run/*` or `react-router-dom` (removed entirely in
  v8) -- installing a pre-v8 React Router or legacy `@remix-run/react`
  project will not satisfy this package's peer dependency.
