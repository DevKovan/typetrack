# examples/frameworks

Demonstrates the six framework-wrapper packages built by Phase 14: `@typetrack/vue`,
`@typetrack/nuxt`, `@typetrack/svelte`, `@typetrack/solid`, `@typetrack/astro`,
and `@typetrack/remix`. React/Next already shipped their own examples in an
earlier phase and are not part of this directory (per this phase's own
explicit task framing).

## Tested-in-repo vs. source-only: read this first

This directory's shape mirrors `examples/runtimes/`'s own tested-vs-source-only
split exactly (see that directory's README for the precedent this one
follows) -- deliberately, not by coincidence:

- **[`vue/`](./vue), [`svelte/`](./svelte), and [`solid/`](./solid) are
  genuinely runnable and tested in this repo.** Each follows the
  established runnable `examples/*` shape (`package.json`, source, an
  integration test, `expected-output.txt`), and their tests are part of
  this repo's own `bun test` run. Each demonstrates Install/CSR (via that
  framework's own official testing-library + happy-dom, asserting
  `track()`/`identify()` calls against a hand-written stub
  `AnalyticsProvider` -- never live vendor infrastructure)/SSR (via that
  framework's own lightweight `renderToString`-equivalent, called directly
  as a plain function, no dev server)/Hydration (README prose)/Production
  (README notes).
- **[`nuxt/`](./nuxt), [`astro/`](./astro), and [`remix/`](./remix) are
  source-plus-README only.** Per `plan/phase-14-framework-wrappers/
  BRIEF.md`'s Design decision 8 (extending `plan/phase-13-runtime-agnostic/
  BRIEF.md`'s decision 5's own "no new heavy per-framework dev/build CLI"
  reasoning to this phase's meta-frameworks), this repo does not add
  `nuxi`, `astro`, or a React-Router-framework-mode Vite dev server as a
  devDependency anywhere in the monorepo (`CLAUDE.md`: "toolchain is
  devDependencies only: Bun/tsgo/typescript/oxlint/Knip/tsup"). These three
  subdirectories are realistic, correct, copy-into-your-own-project entry
  points a reader would run via that framework's own real CLI (`nuxi dev`,
  `astro dev`, `react-router dev`) -- **none of it is exercised by `bun
  test` at the repo root.** Each of their own `README.md` files repeats
  this explicitly, so a passing `bun test` at the repo root should never be
  mistaken for validating these three.

## The six examples

- **[`vue/`](./vue)** -- `@typetrack/vue`'s `typetrackPlugin` +
  `useAnalytics()` composable, demonstrated with a small `SignUpForm`
  component (Vue's plain `h()` render-function API, no SFC needed -- the
  package itself needs none either). CSR via `@vue/test-utils` + happy-dom;
  SSR via `@vue/server-renderer`'s `renderToString()`.
- **[`nuxt/`](./nuxt)** -- `@typetrack/nuxt`'s module: registers
  `@typetrack/vue`'s plugin via `@nuxt/kit`, SSR-safe, plus automatic
  route-change pageview tracking (`vue-router`'s `afterEach`). Source-only.
- **[`svelte/`](./svelte)** -- `@typetrack/svelte`'s `<AnalyticsProvider>`
  component + `useAnalytics()` (Svelte 5 Context API, runes-era). CSR via
  `@testing-library/svelte` + happy-dom; SSR demonstrated via
  `svelte/compiler`'s real server-target compilation -- see that
  directory's own README for two real, current, verified-by-hand
  limitations of the shipped `@typetrack/svelte` package this example's SSR
  story works around (out of scope for this examples-only issue to fix).
- **[`solid/`](./solid)** -- `@typetrack/solid`'s `<AnalyticsProvider>` +
  `useAnalytics()` (Solid's Context API). CSR via `@solidjs/testing-library`
  + happy-dom; SSR via `solid-js/web`'s `renderToString()`, using a
  server-targeted `babel-preset-solid` recompilation of this example's own
  `SignUpForm.tsx` source (mirroring what a real SolidStart/Vite build does
  automatically via `vite-plugin-solid`).
- **[`astro/`](./astro)** -- `@typetrack/astro`'s Integration-API package
  (`astro:config:setup` + `injectScript`): automatic pageview tracking on
  `astro:page-load`, plus a plain client `<script>` for a custom sign-up
  event (Astro ships zero client JS by default -- no context/hook pattern
  applies). Source-only.
- **[`remix/`](./remix)** -- `@typetrack/remix`'s thin re-export of
  `@typetrack/react`'s `AnalyticsProvider`/`useAnalytics`, plus a
  router-aware `AnalyticsPageView` for React Router v8 framework mode (the
  "Remix" successor -- see that directory's own README for why this
  package targets `react-router: ^8.0.0`, never `@remix-run/*`).
  Source-only.

Every example uses realistic event/property names (`"User Signed Up"`,
never `test`/`foo`/`bar`), consistent with every other `examples/*`
category in this repo.
