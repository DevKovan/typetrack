# 002 — `@typetrack/nuxt`: module registration, SSR-safe plugin, automatic route-change tracking

## Context

Depends on issue 001 (`@typetrack/vue`) being complete — this package
reuses that package's `analyticsKey`/`typetrackPlugin`/`useAnalytics`
rather than reimplementing the provide/inject machinery.

**Researched module system decision**: Nuxt's current stable major is
**4** (4.3.x as of this writing; Nuxt 5 is pre-alpha, not a target).
Nuxt modules are authored via `defineNuxtModule` (from `@nuxt/kit`),
whose `setup(options, nuxt)` function is where a module wires plugins/
templates/imports into the app being built — confirmed current via
research against Nuxt's own docs. A module registers a runtime plugin
via `addPlugin(resolve('./runtime/plugin'))`, where the referenced file
is itself authored with `defineNuxtPlugin(...)` — this is the
established, current, two-part convention (`defineNuxtModule` for the
build-time module definition, `defineNuxtPlugin` for the actual runtime
code it installs).

**The config-time/runtime-boundary problem (see BRIEF.md's Design
decision 5 for the full reasoning)**: this module's `setup()` runs once,
in Node, at Nuxt build/dev-server config time — it cannot hold a live
`Analytics` instance and hand it to the generated client/server runtime
bundle directly (different JS realms). This issue's module therefore
accepts a required option `analyticsModule: string` — a Nuxt-alias-
resolvable path (e.g. `"~/app/analytics"`) to an app-authored file that
itself constructs `createAnalytics(...)` and exports the resulting
instance (default export, or a named `analytics` export — implementor's
call, document whichever is chosen and require it consistently). The
module wires that path into the generated runtime plugin via `@nuxt/
kit`'s `addTemplate`/`addAlias` (a real, established Nuxt-module
technique for exactly this "let a generated runtime file statically
`import` an app-supplied path" case), so the runtime plugin's own source
contains a static `import analytics from "<resolved-alias>"` — the live
object is constructed only once the actual client/server runtime bundle
executes that import, never inside `setup()` itself.

**SSR-safety**: `createAnalytics()` itself is already SSR-safe (Phase 9/
13's `isBrowserEnvironment()`/try-catch-never-throw guards) — this
issue's job is to not *introduce* a new server-unsafe path of its own,
not to re-verify core's existing guarantee. The `provide`-registration
plugin (reusing issue 001's `typetrackPlugin`/`analyticsKey`) runs
identically on server and client (Nuxt runs plugins in both contexts by
design) with no special guard needed — `app.provide()` itself is not
browser-dependent. The **route-change-tracking** plugin, however, is
genuinely client-only (a server-rendered request has no "route change"
concept — it renders exactly once per request) and must be registered
using Nuxt's `.client.ts` filename-suffix convention (Nuxt's own
build-time mechanism for excluding a file from the server bundle
entirely — not a runtime `if` check, an actual build-time exclusion),
confirmed current via research.

**Route-change tracking decision**: Vue Router's `router.afterEach()`
(accessed via Nuxt's `useRouter()`, since Nuxt wraps `vue-router`
directly) fires on every completed navigation — the client-only plugin
registers one `afterEach` listener, and additionally fires one dispatch
immediately for the current route (mirroring `@typetrack/next`'s
`AnalyticsPageView`'s "on mount and on every subsequent change"
contract, achieved there via `useEffect`'s dependency array; achieved
here via one direct call at plugin-setup time before the listener is
attached). Both the initial call and every `afterEach` call delegate to
core's own `dispatchPageView()` (from `typetrack`, Phase 10) — the exact
same dedup helper `@typetrack/next`'s `AnalyticsPageView` and the
built-in `autoPage()` plugin already share — for genuine cross-package
code reuse, not a parallel reimplementation. Gated behind a module
option `autoPageViews?: boolean` (default `true`).

**`useAnalytics` auto-import**: Nuxt's convention is that composables
are usable with no explicit `import` statement in app code (Nuxt's
build-time auto-import scanning). This module registers issue 001's
`useAnalytics` (re-exported, not reimplemented) as an auto-import via
`@nuxt/kit`'s `addImports`/`addImportsDir`, so `useAnalytics()` "just
works" in any Nuxt app component with zero import line — the idiomatic
Nuxt DX, confirmed current via research.

**Honest, documented testing limitation**: fully exercising a real Nuxt
build/SSR pass would require `@nuxt/test-utils` (Nuxt's own official
integration-testing tool) or an actual `nuxi build`/`nuxi dev` — both
meaningfully heavier than this repo's existing `bun test`-only toolchain
and not added here (see BRIEF.md's Design decision 8 — the real,
running-Nuxt-app verification is deferred to `examples/frameworks/
nuxt/`'s own source-plus-README-only shape, issue 007, plus manual
verification, mirroring `@typetrack/next`'s own issue 002/003 documented
gaps exactly). This issue's own test suite instead verifies: (a) the
module definition object's shape and that its `setup()` calls the
expected `@nuxt/kit` functions (`addPlugin`/`addImports`/`addTemplate`
or whichever subset is actually used) with the expected arguments, via
directly calling `setup(options, mockNuxt)` with `@nuxt/kit`'s functions
spied/mocked (not calling into a real Nuxt build pipeline); and (b) the
pure route-args-building logic (mirroring `buildPageViewArgs.ts`'s own
precedent) as a fully isolated, real unit test.

## Acceptance criteria

- `packages/nuxt/package.json`:
  - `"name": "@typetrack/nuxt"`, `"private": false`, `"type": "module"`.
  - `"main"`/`"module"`/`"types"`/`"exports"` shaped identically to
    `packages/react/package.json`.
  - `"scripts"`: same set as issue 001's package.
  - `"peerDependencies"`: `"nuxt": "^4.0.0"` (required).
  - `"dependencies"`: `"@typetrack/vue": "workspace:*"`,
    `"typetrack": "file:../.."`.
  - `"devDependencies"`: adds `"nuxt"` (current stable, e.g. `4.3.x`),
    `"@nuxt/kit"` (if not already transitively sufficient — implementor
    verifies whether a direct devDependency is needed for the module's
    own type imports), plus the same toolchain set as issue 001's
    package (Vue/happy-dom/testing-library equivalents as needed for
    this package's own unit tests).
- `packages/nuxt/tsup.config.ts`: same shape as issue 001's (no
  `banner` needed — Nuxt modules have no `"use client"`-equivalent
  boundary requirement).
- `packages/nuxt/src/module.ts`:
  - `export interface ModuleOptions { analyticsModule: string;
    autoPageViews?: boolean; }` (exact field set may extend this if the
    implementor finds a genuine need — document any addition).
  - `export default defineNuxtModule<ModuleOptions>({ meta: { name:
    "@typetrack/nuxt", configKey: "typetrack" }, setup(options, nuxt)
    {...} })`.
  - `setup()`: resolves `options.analyticsModule` into an alias/template
    the runtime plugin can statically import (via `addTemplate`/
    `addAlias`), registers the provide-registration runtime plugin via
    `addPlugin`, registers the pageview-tracking client-only runtime
    plugin via `addPlugin` (gated on `options.autoPageViews ?? true`),
    and registers `useAnalytics` as an auto-import via `addImports`/
    `addImportsDir`.
  - Throws a clear, descriptive error at `setup()` time if
    `options.analyticsModule` is missing/empty (a required option, not
    optional — mirrors `AnalyticsProvider`'s required `analytics` prop
    across every other package in this phase).
- `packages/nuxt/src/runtime/plugin.ts`: `defineNuxtPlugin((nuxtApp) =>
  {...})` that statically imports the app-supplied analytics module
  (via the alias/template `module.ts` set up) and installs issue 001's
  `typetrackPlugin`/`analyticsKey` onto `nuxtApp.vueApp` (e.g.
  `nuxtApp.vueApp.use(typetrackPlugin, { analytics })` or the equivalent
  direct `provide` call — implementor's choice, document whichever).
- `packages/nuxt/src/runtime/pageview.client.ts`: the `.client.ts`-
  suffixed, client-only runtime plugin — fires one initial
  `dispatchPageView()` call for the current route and registers
  `router.afterEach()` for subsequent navigations, exactly as described
  in Context.
- A pure, directly unit-testable function building the `.page()` args
  from a Vue Router `RouteLocationNormalized`-shaped input (mirroring
  `buildPageViewArgs.ts`'s shape/reasoning exactly — same `name`/
  `props.search`-when-non-empty contract, for cross-framework
  consistency).
- `packages/nuxt/src/index.ts`: barrel re-exporting the module (default
  export) and any types a consumer needs (`ModuleOptions`), plus
  re-exporting `useAnalytics`/`Analytics`/`EventMap` for direct import
  convenience alongside the auto-import.
- Root `.github/workflows/qa.yml`'s Build step runs `bun run build`
  inside `packages/nuxt`, immediately after `packages/vue` (dependency
  order — `packages/nuxt` resolves `@typetrack/vue` via `workspace:*`,
  which requires `packages/vue`'s `dist/` to already exist).

## Test requirements

**Unit:**
- The pure route-args-building function: given a route with an empty
  query string, returns `{ name: pathname }` with no `props` key (or
  `props: undefined`, document which); given a non-empty query string,
  returns `{ name: pathname, props: { search: "..." } }` with the exact
  query string — mirrors `buildPageViewArgs.test.ts`'s own test shape.
- `module.ts`'s `setup()` function: called directly (not through a real
  Nuxt build) with a minimal mock `nuxt`/`@nuxt/kit` function set (spied
  `addPlugin`/`addImports`/`addTemplate`/`addAlias`, whichever subset is
  actually used); assert each was called with the expected
  path/arguments, and assert `setup()` throws when
  `options.analyticsModule` is omitted/empty.

**Integration** (exercising the runtime plugin's actual logic against a
real Vue app instance via `@vue/test-utils`, standing in for what Nuxt's
own runtime would otherwise provide — since a real Nuxt SSR pass is out
of scope per Context's documented limitation):
- Construct a real Vue `app` (via `@vue/test-utils`/plain `createApp`),
  manually invoke `runtime/plugin.ts`'s exported setup logic against a
  `fakeAnalytics` stand-in for the statically-imported module (the
  implementor factors the plugin's logic so its core
  `vueApp.use(typetrackPlugin, { analytics })`/route-tracking behavior is
  testable independent of the literal static `import` statement, which
  cannot itself be exercised without a real Nuxt build — document this
  factoring choice explicitly), mount a consumer component calling
  `useAnalytics()`, and assert `track`/`page` calls reach
  `fakeAnalytics` as expected.
- Simulate a route change (calling the pure args-building function with
  two different route inputs, invoking the registered "afterEach"-
  equivalent callback directly) and assert `dispatchPageView()`
  (spied/mocked, or exercised against `fakeAnalytics.page` directly)
  fires once per genuinely different route and is deduped on a
  repeated/unrelated call, mirroring `@typetrack/next`'s issue 003
  dedup-assertion precedent.
- Full `bun test` from the repo root still passes, including issue 001's
  test suite and all pre-existing tests.

**Explicitly not covered by automated tests** (documented, not silently
skipped, per Context's "honest, documented testing limitation"): a real
`nuxi build`/`nuxi dev` pass proving the module's `addTemplate`/
`addAlias`-resolved static import genuinely resolves an app's real file
at real Nuxt build time, and that the server-side render of a real Nuxt
page genuinely never throws — both deferred to `examples/frameworks/
nuxt/`'s source-plus-README-only shape (issue 007) plus manual
verification.

## Out of scope

- A real `@nuxt/test-utils`-based or `nuxi`-driven integration test —
  see Context/Test requirements above.
- Nuxt Pages-directory-specific conventions beyond generic
  `useRouter()`/`afterEach` (e.g. no special handling for Nuxt's
  file-based routing metadata, layouts, middleware).
- Any Nuxt server-route/API-handler tracking.
- Nuxt 3 support (peer floor is `^4.0.0` only, per BRIEF.md's researched
  version-floor decision).
- Any change to `@typetrack/vue`'s own source beyond what issue 001
  already produced.
