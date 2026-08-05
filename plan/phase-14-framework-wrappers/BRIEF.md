# Phase 14 brief: remaining framework wrappers (Vue, Nuxt, Svelte, Solid, Astro, Remix)

Read CLAUDE.md, `plan/VISION.md` ("Framework integrations" + "Examples —
mandatory, per-phase"), and `plan/ROADMAP.md` (Phase 14 section) first.
Then read `plan/phase-4-react-wrappers/001-003` in full (the precedent for
package scaffolding, testing approach, and issue granularity this phase
follows) and `plan/phase-13-runtime-agnostic/BRIEF.md` (the precedent for
this document's own structure, and for the "some examples are
tested-in-repo, some are source-plus-README-only, documented explicitly"
policy this phase reuses). Read the actual shipped code —
`packages/react/src/{AnalyticsProvider.tsx,useAnalytics.ts,index.ts}`,
`packages/next/src/{AnalyticsProvider.tsx,AnalyticsPageView.tsx,
buildPageViewArgs.ts,index.ts}`, `src/plugins/autoPage.ts` (the shared
`dispatchPageView()`/`PageViewArgs` helper every route-tracking piece in
this phase reuses), `src/providers/index.ts`, and `src/index.ts`'s
`Analytics`/`EventMap`/`createAnalytics` surface — before starting any
issue.

Angular is explicitly out of scope for this phase (and optional/last per
ROADMAP) — no issue here plans it.

## Why "React/Next" is the load-bearing precedent, and where this phase diverges from it

Every one of this phase's six packages repeats React/Next's core contract
exactly: the **application** constructs the `Analytics` instance (via
`createAnalytics()`), and the wrapper package's only job is to get that
instance to descendant code (`useAnalytics()`-shaped hook/composable) and,
where the framework has its own router, auto-fire `.page()` on navigation
(mirroring `AnalyticsPageView`). No wrapper in this phase ever constructs
an `Analytics` instance on the app's behalf, and no wrapper ever returns a
silent no-op when no provider/context is present — every `useAnalytics()`-
equivalent across all six packages throws a descriptive error, exactly
like `@typetrack/react`'s. This uniformity is deliberate and is called out
per-issue, not just here.

Two packages (Astro, and to a lesser extent Nuxt) cannot follow the
"app renders a component that holds context" shape directly, because
Astro ships zero client JS by default (no persistent component tree to
hold React/Vue-style context at all) and Nuxt/Astro's own plugin/
integration registration happens once, in Node, at build/dev-server
config time — a live `Analytics` object constructed there cannot be
smuggled across the Node-process/browser-bundle boundary into the
generated client runtime. Both issues 002 (Nuxt) and 005 (Astro) resolve
this the same way: the wrapper accepts a **module import specifier**
(`analyticsModule`) pointing at an app-authored file that itself
constructs and exports the `Analytics` instance, and the wrapper's
generated runtime code performs a static `import` of that path — the
live object is only ever constructed inside the browser/SSR runtime
bundle itself, never passed through config-time JS. This is a genuinely
new pattern this repo hasn't needed before (React/Next's App Router lets
the app author literally write and render the provider component
themselves — no build-time integration step exists in that world); flagged
here since it recurs identically in two issues rather than being
independently reinvented.

## Scope (from plan/ROADMAP.md), mapped to issues

- **Vue** → issue 001 (`@typetrack/vue`): plugin + `useAnalytics()`
  composable via typed `provide`/`inject`. No component/SFC involved.
- **Nuxt** → issue 002 (`@typetrack/nuxt`): depends on issue 001. A real
  `defineNuxtModule` — registers issue 001's plugin via `@nuxt/kit`,
  SSR-safe, auto-imports `useAnalytics`, and ships automatic pageview
  tracking on route change (`vue-router`'s `afterEach`).
- **Svelte** → issue 003 (`@typetrack/svelte`): Svelte 5 runes-era
  `setContext`/`getContext` (not stores — see Design decision 3),
  `<AnalyticsProvider>` component + `useAnalytics()`. SvelteKit route
  tracking explicitly deferred (see Design decision 4).
- **Solid** → issue 004 (`@typetrack/solid`): `createContext`/
  `useContext`, JSX-based `<AnalyticsProvider>`. SolidStart deferred, same
  reasoning as SvelteKit.
- **Astro** → issue 005 (`@typetrack/astro`): structurally different —
  an Integration-API package (`astro:config:setup` + `injectScript`), not
  a context/hook pattern. See Design decision 6.
- **Remix** → issue 006 (`@typetrack/remix`): targets React Router v8
  framework mode (see Design decision 7 — Remix itself, as a distinct
  package, is EOL). Thin re-export of `@typetrack/react`'s
  `AnalyticsProvider`/`useAnalytics` (no `"use client"`-equivalent
  boundary needed — see decision 7) + an `AnalyticsPageView`-equivalent
  using `react-router`'s `useLocation()`.
- **Examples**: `examples/frameworks/{vue,nuxt,svelte,solid,astro,remix}/`
  → issue 007, a single trailing issue (see Design decision 8 for why,
  following — not deviating from — phase 13's issue-005 precedent).

## Design decisions locked for this phase

No interactive `grill-me` session was available when this plan was
written (mirrors phase 13's BRIEF — see that document's own note). These
decisions were resolved by direct research (WebSearch against each
framework's current, mid-2026 documentation — not pretrained defaults)
and by reading this repo's own established precedents. If the user
disagrees with any of these before/during implementation, they supersede
this document — flag and resolve via `grill-me` at that point.

1. **Version floors, researched, not assumed** (verified via WebSearch,
   August 2026): Vue 3 current stable is 3.5.x/3.6 — peer floor `^3.4.0`
   (the composable/`provide`/`inject` surface this phase uses has been
   stable since Vue 3.0; no version-specific feature is used, so a broad
   floor is correct, not a guess). Nuxt's current stable major is **4**
   (4.3.x; Nuxt 5 is pre-alpha as of this writing) — peer floor `^4.0.0`.
   Svelte's current stable major is **5** (runes are the established
   default, not a preview) — peer floor `^5.0.0`. SolidJS's current
   stable is **1.9.x** (2.0 is experimental/unreleased) — peer floor
   `^1.9.0`. Astro's current stable major is **7** (7.1.x; v6 — stable
   since March 2026 — is the prior still-supported major) — peer floor
   `^6.0.0 || ^7.0.0`. React Router's current stable major is **8**
   (GA'd June 17 2026) — peer floor `^8.0.0` (see decision 7 for why not
   a Remix-named package).
2. **No new `.vue`/`.svelte`/`.tsx`-JSX-adjacent typecheck-tool gap for
   Vue, Nuxt, or Astro — because none of their packages contain a `.vue`/
   `.svelte` SFC at all.** Vue's idiomatic singleton-service pattern is a
   **plugin (`app.use(plugin, { analytics })`) + composable
   (`inject()`)** — both are plain function calls against `vue`'s
   Composition API, with zero template/SFC syntax (confirmed via
   research: Vue's own docs and multiple current guides describe exactly
   this "wrap `provide`/`inject` in a plugin + composable" pattern for a
   non-reactive singleton service). Nuxt's module/plugin registration is
   equally template-free (`defineNuxtModule`/`defineNuxtPlugin` are plain
   `.ts`). Astro's package is a pure Node-side Integration-API object
   (`.ts`, no `.astro` component). This means `packages/vue`,
   `packages/nuxt`, and `packages/astro` need **zero** tsconfig/oxlint/
   vue-tsc changes — the existing shared root `tsconfig.json` and
   `.oxlintrc.json` already cover them as plain `.ts` under
   `packages/*/src`. This is a real, verified finding (see Solid/Svelte
   below for the two packages that genuinely do need tooling changes),
   not an assumption of convenience.
3. **Svelte: `setContext`/`getContext`, not stores (`writable`) — a
   non-reactive service handle needs no reactivity primitive.** Confirmed
   via research against Svelte's current (5.x) docs: the Context API
   (`setContext`/`getContext`) remains the correct, stable primitive for
   sharing a stable, non-reactive value scoped to a component subtree —
   runes (`$state`) exist for *reactive* state, which an `Analytics`
   instance is not (it's a stable object with methods, constructed once,
   never reassigned — exactly like every other framework's context value
   in this phase). `setContext`/`getContext` must be called during a
   component's own initialization (a Svelte runtime constraint, not
   optional), so `@typetrack/svelte` ships exactly one `.svelte` file
   (`AnalyticsProvider.svelte`) whose `<script>` block calls `setContext`
   — everything else (the `useAnalytics()`-equivalent throw-on-missing
   logic, types) is plain `.ts`. Svelte 5's children convention is
   **snippets**, not slots (`let { analytics, children } = $props();` +
   `{@render children?.()}`), confirmed current — the old `<slot/>` form
   is deprecated, not the current idiom.
4. **SvelteKit and SolidStart route-tracking are explicitly deferred, not
   folded into this phase's Svelte/Solid issues.** ROADMAP.md's Phase 14
   line lists "Svelte" and "Solid" — not "SvelteKit"/"SolidStart" — and
   both meta-frameworks are structurally closer to Nuxt/Remix (their own
   router/SSR/build pipeline) than to plain Svelte/Solid (a UI-library-
   level context wrapper, no router of its own). Building
   `packages/sveltekit`/`packages/solid-start` would double this phase's
   package count with no ROADMAP mandate to do so. `@typetrack/svelte`/
   `@typetrack/solid` work unmodified inside a SvelteKit/SolidStart app
   (they're plain component-tree context wrappers, framework-router-
   agnostic, same as `@typetrack/react` works unmodified inside Remix/
   React Router) — only *automatic router-driven pageview tracking* is
   deferred, exactly the same scope line Next.js draws between
   `@typetrack/react` (no router awareness) and `@typetrack/next`
   (router-aware). A future phase can add `packages/sveltekit`/
   `packages/solid-start` the same way Phase 4 added `@typetrack/next`
   on top of `@typetrack/react`, if ever prioritized.
5. **Nuxt and Astro cannot receive a live `Analytics` instance as a
   config-time option — both accept an `analyticsModule` import-specifier
   option instead, resolved into the generated client/server runtime via
   each framework's own template/alias/inject-script mechanism.** See the
   "Why React/Next is the load-bearing precedent" section above for the
   underlying constraint (config-time Node process vs. browser/SSR
   runtime bundle are different JS realms; a live object can't cross that
   boundary, only source code/references can). Nuxt: `addTemplate`/
   `addAlias` (`@nuxt/kit`) so the module's generated runtime plugin can
   statically `import analytics from` an aliased path pointing at the
   app's own file. Astro: `injectScript`'s injected script itself
   contains a static `import analytics from "<analyticsModule>"`
   (the literal specifier, JSON-stringified into the injected script
   text). Both options default-export (or the issue's implementor may
   choose a named `analytics` export — document whichever is chosen) a
   pre-constructed `Analytics` instance from that app-authored file. This
   mirrors, deliberately, this repo's pre-existing `typetrack.config.*`
   convention (`src/cli`/`src/devServer`, Phase 3) in spirit — an
   app-owned config file the tooling resolves a path to — without
   reusing that exact mechanism (which is Node-process/dev-server-only,
   not something a Nuxt/Astro build pipeline resolves the same way).
6. **`@typetrack/astro` is an Integration-API package, not a context/hook
   package — because Astro ships zero client JS by default (islands
   architecture), there is no persistent app-wide component tree to hold
   context in the first place.** Confirmed via research: Astro's own
   `astro:config:setup` hook + `injectScript(stage, content)` is the
   correct, current (Astro 6/7) primitive for "run this script on every
   page," and real-world precedent (Vercel Analytics' Astro guide, GA4/
   Astro View-Transitions guides) confirms the idiomatic pattern is a
   client-side script listening for the `astro:page-load` DOM event
   (fires on Astro's initial load **and** every subsequent View-
   Transitions/ClientRouter navigation — covering both Astro's default
   full-MPA-reload mode, where it fires once per real navigation
   naturally, and View-Transitions-enabled SPA-style navigation), not a
   component/context system Astro has no persistent-tree concept to
   support. The injected script delegates to core's own
   `dispatchPageView()` (imported from `typetrack`, bundled through
   Astro's own Vite pipeline at build time) — same dedup helper every
   other framework's route-tracking piece in this phase reuses.
7. **`@typetrack/remix` targets React Router v8 framework mode, not
   legacy Remix APIs — because Remix v2 (and React Router v6, its
   contemporaneous base) reached EOL in June 2026, and "Remix" the
   framework has, per Remix's own blog, been merged into React Router
   itself.** Verified via research (not assumed): React Router v7 (Nov
   2024) absorbed Remix; React Router v8 GA'd June 17 2026 with
   `react-router-dom` removed entirely (ESM-only, `react-router` is now
   the only package) and is the actively-maintained, currently-installable
   target — building against dead APIs would ship a package nobody could
   actually install into a real, current app. The package **name** stays
   `@typetrack/remix` per this phase's explicit instruction (and because
   "Remix" is still the docs/brand vernacular for React Router's
   full-stack/framework mode), but its `peerDependencies` are on
   `react-router: ^8.0.0` (never `@remix-run/*`), and its route-tracking
   piece imports `useLocation` from `"react-router"` (confirmed:
   `react-router-dom` is gone in v8 — importing from it would be a dead
   import). A second, load-bearing research finding: React Router v8's
   **default** framework mode (what `react-router dev`/`react-router
   build` produce without opting into the experimental
   `unstable_reactRouterRSC` Vite plugin) is traditional SSR + client
   hydration with **no** React Server Components / Server-Client
   Component split — RSC support exists but is explicitly documented as
   experimental/unstable as of v8. This means, unlike `@typetrack/next`
   (whose App Router *default* requires a `"use client"` boundary because
   Server Components are the default there), `@typetrack/remix` needs
   **no** client-boundary-marking file at all — a plain React Context
   provider works directly, identical to using `@typetrack/react` in any
   non-RSC React app. `@typetrack/remix` is therefore a genuinely thin
   package: a re-export of `@typetrack/react`'s `AnalyticsProvider`/
   `useAnalytics` (documented explicitly as a re-export, mirroring how
   `@typetrack/next`'s `useAnalytics` is already a plain, undecorated
   re-export) plus the router-aware `AnalyticsPageView`-equivalent.
8. **Examples ship as one trailing issue (007), not folded into each
   package's own issue — following, not deviating from, phase 13 issue
   005's precedent.** Reasoning, same as phase 13's: writing all six
   frameworks' examples together, after every package exists, lets issue
   007 review cross-framework consistency (identical `dispatchPageView`
   usage, identical README section shape, identical realistic event
   names) in one pass, rather than risking six independently-drifting
   conventions if each package's own issue improvised its own example
   shape. Also mirrors phase 13's **tested-vs-source-only split**: Vue,
   Svelte, and Solid examples are genuinely tested-in-this-repo (`bun
   test` + happy-dom + each framework's own official testing-library —
   `@vue/test-utils`, `@testing-library/svelte`, `@solidjs/testing-
   library` — plus each framework's lightweight, dependency-free
   `renderToString`-equivalent for the SSR section, since none of the
   three require a bundler/dev-server to exercise either CSR or SSR as
   plain function calls). Nuxt, Astro, and Remix examples are
   source-plus-README-only, **not** wired into this repo's own `bun
   test`, explicitly documented as such per subdirectory README (mirrors
   phase 13's Cloudflare Worker/Vercel Edge/Deno precedent) — because
   genuinely exercising their SSR/CSR/hydration/production story requires
   each framework's own heavier dev/build CLI (`nuxi`, `astro`, a
   Vite-based `react-router` framework-mode dev server), which this repo
   does not want as a permanent devDependency purely to run one example,
   per the same "no new toolchain dependencies" reasoning phase 13
   already established for wrangler/vercel/Deno (this phase extends that
   same reasoning to these three meta-frameworks' own CLIs, rather than
   re-deriving new reasoning from scratch).
9. **Consistent public naming across all six packages: every wrapper
   exports something callable `useAnalytics()`, even where a framework's
   own convention would suggest a different name** (e.g. Svelte's
   `get`/`set` naming convention would suggest `getAnalyticsContext`).
   Deliberate, minor, cross-framework DX consistency call: an app author
   switching frameworks (or reading this repo's docs) sees the same
   public hook/composable name everywhere. Every one of these functions
   also shares the identical throw-on-missing-provider contract (Design
   note in "Why React/Next is the load-bearing precedent" above) — no
   exceptions, no silent no-op anywhere in this phase.

## Toolchain gaps found by research (not assumed) — full detail per package in each issue, summarized here

- **Solid needs a per-file `/** @jsxImportSource solid-js *​/` pragma
  comment**, not a global tsconfig change: the shared root
  `tsconfig.json`'s `"jsx": "react-jsx"` stays untouched (every other
  package, including this phase's Remix package, needs React's JSX
  runtime) — TypeScript's per-file `jsxImportSource` pragma (stable since
  TS 4.1, and specifically improved for exactly this "mixed JSX libraries
  in one project" case by TS 5.1's decoupled JSX-namespace resolution;
  this repo runs `typescript` 6.0.3, well past that fix) redirects only
  `packages/solid/src`'s own `.tsx` files to `solid-js/jsx-runtime`'s
  types for type-checking purposes. **This is a type-checking-only fix.**
  The **build** (actually compiling Solid JSX into Solid's fine-grained
  reactive DOM calls, which `esbuild`'s own built-in JSX transform cannot
  do correctly — it would silently compile Solid JSX as if it were
  React's) requires wiring `tsup-preset-solid` (a tsup-native community
  preset built specifically for this — confirmed current/maintained via
  research) or an equivalent `esbuild-plugin-solid` config into
  `packages/solid/tsup.config.ts`, and `package.json`'s `exports["."]"`
  needs a `"solid"` condition ahead of `"import"`/`"require"` (confirmed
  research finding: SolidJS-aware tooling — SolidStart, Vite's
  `vite-plugin-solid` — resolves via that condition). This is a
  genuinely new devDependency (`tsup-preset-solid`), narrowly scoped to
  `packages/solid` only — not a violation of CLAUDE.md's toolchain
  decision, which lists Bun/tsgo/typescript/oxlint/Knip/tsup as the
  *shared monorepo* toolchain; this is a package-local build-plugin
  dependency, the same category as `packages/react`'s own
  `@testing-library/react`/`@happy-dom/global-registrator` additions.
- **Svelte needs `.svelte` compilation wired into its own
  `tsup.config.ts` via the `esbuild-svelte` esbuild plugin** (confirmed
  current via research), narrowly scoped to `packages/svelte` — same
  reasoning as Solid's `tsup-preset-solid` addition above. Separately:
  `.svelte` files are **never** matched by the shared root
  `tsconfig.json`'s `include` glob (`tsc`/`tsgo` only understand `.ts`/
  `.tsx`, and don't parse `.svelte` syntax at all under any `include`
  pattern) — meaning `AnalyticsProvider.svelte`'s own `<script>` block
  gets **zero** type-checking from this repo's existing `bun run
  typecheck`/`typecheck:tsc` today, a real, silent gap if left
  undocumented. Fix: `packages/svelte` adds `svelte-check` (Svelte's
  own official type-checking tool, wraps `svelte2tsx`) as a
  package-scoped devDependency with its own **additional**
  `"typecheck:svelte": "svelte-check"` script (additive — does not
  replace `tsgo --noEmit`/`tsc --noEmit`, which still correctly
  typecheck this package's plain `.ts` files) — and `.github/workflows/
  qa.yml`'s Typecheck step gains one additional targeted invocation
  (`cd packages/svelte && bun run typecheck:svelte`), mirroring exactly
  how the Build step already runs targeted per-package commands for
  `packages/react`/`packages/next`.
- **`.oxlintrc.json` needs no change for any of the six packages.**
  Confirmed via research: oxlint already lints the `<script>` block of
  `.vue`/`.svelte`/`.astro` files with **no additional configuration**
  (this is oxlint's own current, out-of-the-box behavior, not something
  this phase enables) — but oxlint has **no** template/markup linting for
  any of these frameworks today (an active RFC exists, not shipped), a
  real, accepted limitation this phase does not attempt to work around
  (adding `eslint-plugin-vue`/`eslint-plugin-svelte` alongside oxlint
  would reintroduce the dual-linter complexity oxlint's own adoption in
  this repo was meant to avoid — out of scope, noted as an accepted gap
  in each relevant issue). No `"vue"`/`"svelte"`/`"solid"` oxlint plugin
  category exists to enable (unlike `"react"`, which phase 4 enabled) —
  Solid's/Remix's `.tsx` files are linted by the existing generic
  TS/JS + already-enabled `"react"` category rules (harmless for Solid —
  no Solid-specific false-positive was found in research; the `"react"`
  category's rules are Hooks-naming-convention rules that don't fire
  incorrectly against Solid's own `create*`/non-`use`-prefixed
  primitives).
- **`knip.json` needs no change** — `"packages/*": {}"`'s wildcard already
  covers all six new package directories automatically (reconfirmed, same
  finding phase 4 issue 001 already established for `packages/react`).
  One accepted, documented limitation: knip's static analysis is
  TS/JS-AST-based and does not meaningfully analyze `.vue`/`.svelte`/
  `.astro` template markup for unused-export detection — a pre-existing,
  general knip limitation, not something this phase introduces or
  attempts to fix.
- **Root `tsconfig.json`'s `"paths"` map gains one new entry**:
  `"@typetrack/vue": ["./packages/vue/src/index.ts"]` — needed because
  `packages/nuxt` (issue 002) depends on `@typetrack/vue` via
  `workspace:*`, and this repo's existing `paths` entries exist
  specifically so a sibling package's types resolve against source
  *before* that sibling has ever been built (see the existing
  `"@typetrack/react"` entry, added by phase 4 issue 001 for the exact
  same reason ahead of `packages/next`). No other new package in this
  phase needs a `paths` entry (Svelte/Solid/Astro have no in-phase
  sibling dependents; Remix depends on `@typetrack/react`, whose `paths`
  entry already exists).
- **`.github/workflows/qa.yml`'s Build step gains six new per-package
  `cd packages/X && bun run build` invocations, in dependency order**:
  root → `react` → `next` (unchanged, already there) → `vue` → `nuxt`
  (must follow `vue` — depends on it via `workspace:*`) → `svelte` →
  `solid` → `astro` → `remix` (must follow `react`, already guaranteed by
  position). No additional `bun install` re-run is needed beyond the one
  that already exists immediately after the root build: every new
  sibling-to-sibling dependency in this phase (`nuxt`→`vue`,
  `remix`→`react`) is a true `packages/*` member using `workspace:*`,
  which — per CLAUDE.md's own established finding — materializes as a
  live symlink that survives `dist/` recreation, exactly like the
  existing `next`→`react` dependency already does.
- **Root `package.json`'s `"workspaces"` array and root `tsconfig.json`'s
  `"include"` array** get `"examples/frameworks/vue"`,
  `"examples/frameworks/svelte"`, `"examples/frameworks/solid"` added
  (issue 007) — following the **more recent** `examples/runtimes/bun`-
  style precedent (explicit per-directory entries, only for the
  tested-in-repo ones — `examples/runtimes/{cloudflare-worker,vercel-
  edge,deno}` are conspicuously **absent** from both arrays today, and
  this phase's `nuxt`/`astro`/`remix` examples follow that same,
  more-recent pattern deliberately, not the earlier phase 6-11 examples
  categories' broader `"examples/core/*"`-style wildcard entries — this
  divergence between older and newer phases' conventions is a
  pre-existing repo inconsistency, not something issue 007 is
  responsible for reconciling).

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-14-framework-wrappers/`. **Issue
   files are kept, never deleted** (standing policy — see
   `plan/ROADMAP.md` "Policy changes").
2. For each issue, in order (001 → 007, respecting the dependency chain
   noted per-issue — 002 depends on 001, 007 depends on 001-006): the
   `implementor` subagent implements with unit+integration tests, the
   `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-14-framework-wrappers` for isolation. Once all issues pass
QA: push commits to `origin/main` directly (no PR, no force-push — if
`origin/main` has moved, rebase cleanly on top). Delete the
`phase-14-framework-wrappers` branch (local, and remote only if pushed
there). Do **not** delete `plan/phase-14-framework-wrappers/` issue
files. Add a one-line Phase 14 entry to `plan/CHANGELOG.md`, following
the existing format (see the Phase 6-13 entries for current style/
length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick
new work. Report back and go idle once this phase's commits are on main
and cleanup is done.

## Out of scope for this whole phase

- Angular, per ROADMAP.md ("optional, last") and this task's explicit
  instruction.
- `packages/sveltekit`, `packages/solid-start` — see Design decision 4.
  SvelteKit/SolidStart route-change auto-tracking is not shipped by any
  issue in this phase.
- Any change to `src/`, `packages/react`, `packages/next`, or any
  `packages/provider-*` beyond the one new `tsconfig.json` `"paths"`
  entry noted above and the `qa.yml` Build/Typecheck step additions —
  this phase is additive, new-packages-only.
- Adding `eslint-plugin-vue`/`eslint-plugin-svelte`/a second linter
  alongside oxlint, to work around oxlint's template-linting gap (see
  the toolchain-gaps section above) — accepted, documented limitation.
- Real Cloudflare/Vercel/npm-registry/CDN deployment of any example.
- Adding `nuxi`/`astro`/a full React-Router-framework-mode Vite dev
  server as a repo devDependency purely to wire the Nuxt/Astro/Remix
  examples into `bun test` — explicitly not done, per Design decision 8.
- React Server Components support for `@typetrack/remix` (React Router
  v8's RSC surface is experimental/unstable — out of scope until it
  stabilizes; revisit in a future phase if/when it does).
- Any generic "framework detection" utility in core — each wrapper
  package independently declares its own peer dependency; core `src/`
  gains no new framework-awareness of any kind in this phase.

## Done criteria

Before declaring done, verify from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist examples/frameworks/*/node_modules
2>/dev/null; rm -rf packages/*/node_modules 2>/dev/null`, `bun install`,
`bun run build:all`, `bun run lint`, `bun run typecheck` (root, plus the
targeted `packages/solid`/`packages/svelte` additions), `bun test`,
`bunx knip` — all must pass. Report back: issues completed, the final
package shapes landed for all six frameworks, the researched version
floors/toolchain additions per package (and why), files changed, and
clean-checkout verification results.
