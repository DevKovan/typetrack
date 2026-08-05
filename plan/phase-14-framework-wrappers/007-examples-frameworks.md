# 007 — `examples/frameworks/{vue,nuxt,svelte,solid,astro,remix}/`

## Context

Depends on issues 001-006 (every package this issue demonstrates must
already exist). Per `plan/VISION.md`'s Examples policy — every feature
ships its `examples/` entries in the same phase that built it — this
closes out Phase 14. `examples/frameworks/` is the exact directory name
ROADMAP.md's Phase 14 line specifies. React/Next already shipped their
own examples in an earlier phase and are **not** part of this issue's
scope (per this phase's own task framing) — this issue covers exactly
the six frameworks built by issues 001-006.

Read `examples/runtimes/README.md` (Phase 13) first — this issue reuses
that directory's **tested-vs-source-only split structure** exactly (see
BRIEF.md's Design decision 8 for the full reasoning): three of these six
subdirectories are genuinely runnable/tested in this repo's own `bun
test`; the other three are realistic, correct, copy-into-your-own-
project entry points that a reader would run via that framework's own
heavier dev/build tooling, not exercised by this repo's CI.

## Scope of this issue

`examples/frameworks/README.md` — index explaining the tested-vs-
source-only split up front (mirroring `examples/runtimes/README.md`'s
own opening section structure), linking all six subdirectories with a
one-paragraph description each.

### Tested-in-repo: `vue/`, `svelte/`, `solid/`

Each follows the established runnable `examples/*` shape (`package.json`
with a `file:../../../..` dependency on the relevant `@typetrack/*`
package plus `typetrack` itself, `index.ts`/component source, an
integration test, `expected-output.txt`, a README with the standard
Prerequisites/How to run/Source/Expected output/Explanation/Production
notes sections). Each demonstrates, using that framework's own official
testing-library (`@vue/test-utils`, `@testing-library/svelte`,
`@solidjs/testing-library`) plus happy-dom — no bundler/dev server
required for what's actually tested:
- **Install**: README section showing the real `npm install`/`bun add`
  invocation an app would run (`@typetrack/vue vue typetrack`, etc.).
- **CSR**: mounting/rendering the framework's `AnalyticsProvider`-
  equivalent wrapping a small realistic component (e.g. a "sign up"
  form firing a `"User Signed Up"` event on submit) via that framework's
  testing-library, asserting the expected `track()`/`identify()` calls
  against a hand-written stub provider (never live vendor
  infrastructure) — genuinely exercised by this repo's own `bun test`.
- **SSR**: each of Vue/Svelte/Solid ships its own lightweight,
  dependency-free `renderToString`-equivalent (Vue: `@vue/server-
  renderer`'s `renderToString`; Svelte: a component compiled/imported
  with SSR output; Solid: `solid-js/web`'s `renderToString`) — this
  issue's example calls that directly (a plain function call, no dev
  server) to demonstrate the same `AnalyticsProvider`-wrapped component
  rendering successfully server-side with no browser-global crash
  (leaning on Phase 9/13's already-verified `createAnalytics()`
  SSR-safety) — also genuinely exercised by `bun test`.
- **Hydration**: README explanation (prose, not a literal browser
  hydration test — this repo's `bun test`/happy-dom environment has no
  genuine hydration-mismatch-detection phase to exercise) of what a real
  app's hydration entry point looks like (constructing the same
  `Analytics` instance on both the SSR and CSR/hydration code paths) and
  why a stable `Analytics` instance across both is required.
- **Production**: README "Production notes" section (real-world provider
  swap, bundling notes specific to that package's build shape — e.g.
  Solid's `"solid"` export condition, Svelte's `esbuild-svelte`-produced
  output).

### Source-plus-README-only: `nuxt/`, `astro/`, `remix/`

Each contains realistic, correct, copy-into-your-own-project source
(a minimal Nuxt module-consuming app layout + `nuxt.config.ts`
excerpt for `nuxt/`; a minimal Astro layout + `astro.config.mjs`
integration registration for `astro/`; a minimal React-Router-v8-
framework-mode `app/root.tsx` + `react-router.config.ts` excerpt for
`remix/`) plus a README covering the full Prerequisites/How to run
(that framework's own real CLI — `nuxi dev`/`nuxi build`,
`astro dev`/`astro build`, a Vite-based `react-router dev`/`react-router
build`)/Source/Explanation/Production notes sections, each explicitly
and clearly stating it is **not** exercised by this repo's own `bun
test`/CI, and why (per BRIEF.md's Design decision 8 — no new heavy
per-framework dev/build CLI added as a repo devDependency purely to run
one example, mirroring Phase 13's Cloudflare Worker/Vercel Edge/Deno
precedent exactly). Each still demonstrates realistic install/SSR/CSR/
hydration/production content in its README's prose + real source code —
the mandatory VISION.md content requirement is about what the example
*documents and shows*, not that every example must carry an automated
test proving it (Phase 13 already established this distinction; this
issue applies it identically, not as a new deviation).

## Acceptance criteria

- `examples/frameworks/README.md` exists, explains the tested-vs-
  source-only split up front, links all six subdirectories.
- All six subdirectories contain correct, realistic, runnable-if-a-
  reader-followed-the-README code — not pseudocode. Realistic event/
  property names only (e.g. `"User Signed Up"`, `"Checkout Started"` —
  never `test`/`foo`/`bar`), consistent with every other `examples/*`
  category in this repo.
- `vue/`, `svelte/`, `solid/` each follow the full established example
  shape (`package.json`, integration test, `expected-output.txt`) and
  each one's test passes under this repo's own `bun test`.
- `nuxt/`, `astro/`, `remix/` READMEs each explicitly and clearly state
  they are not exercised by this repo's own CI/test suite, and why — a
  reader should never be confused into thinking `bun test` at the repo
  root somehow validates them.
- Every one of the six subdirectories' route-change-tracking source (for
  `nuxt`/`astro`/`remix`, whose issues shipped one; `vue`/`svelte`/
  `solid` have none, per BRIEF.md's Design decision 4 — their examples
  correspondingly do not fabricate route-tracking usage that package
  doesn't actually ship) correctly reflects that package's real, shipped
  API — no invented API surface.
- Root `package.json`'s `"workspaces"` array gains explicit entries
  `"examples/frameworks/vue"`, `"examples/frameworks/svelte"`,
  `"examples/frameworks/solid"` (not a wildcard, and not entries for
  `nuxt`/`astro`/`remix` — see BRIEF.md's toolchain-gaps section for why
  this follows the more recent `examples/runtimes/bun`-only precedent).
- Root `tsconfig.json`'s `"include"` array gains the same three explicit
  entries, for the same reason.

## Test requirements

- `examples/frameworks/vue/`, `svelte/`, `solid/` each require genuine
  unit **and** integration tests, per the established example
  convention (CSR via testing-library + happy-dom; SSR via the
  framework's own `renderToString`-equivalent function call — both
  genuinely exercised, not stubbed).
- `examples/frameworks/nuxt/`, `astro/`, `remix/` require no automated
  test in this repo (explicitly, per Scope/Acceptance criteria above) —
  do not attempt to fake one (e.g. do not add `nuxi`/`astro`/a
  React-Router-framework-mode Vite dev-server devDependency just to make
  a test pass in CI; that directly contradicts BRIEF.md's Design
  decision 8).

## Out of scope

- Any change to `src/` or any `packages/*` — this issue is
  examples-only.
- Adding `nuxi`/`astro`/a React-Router-framework-mode Vite dev-server
  CLI as a repo devDependency, or CI wiring for `nuxt/`/`astro/`/
  `remix/`.
- Live deployment of any example to real hosting infrastructure.
- React/Next examples — already shipped in an earlier phase, not this
  issue's concern (per this phase's own explicit task framing).
