# 005 — `@typetrack/astro`: Integration-API package (`astro:config:setup` + `injectScript`)

## Context

No dependency on any other issue in this phase, beyond core `typetrack`
(`dispatchPageView`, already shipped since Phase 10).

**This package is structurally different from every other package in
this phase — deliberately, not by oversight.** Astro ships **zero**
client JS by default (islands architecture: only explicitly
`client:*`-directived components hydrate at all) — there is no
persistent, app-wide component tree of the kind React/Vue/Svelte/Solid
all have, so a context/hook pattern has nothing to attach to. Research
into Astro's own current (Astro 6/7 — confirmed current stable: v6 GA'd
March 2026, v7 is the current latest, 7.1.x) Integration API confirms the
idiomatic mechanism instead is the `astro:config:setup` hook's
`injectScript(stage, content)` function — injects a literal script into
every page at build time. Real-world precedent (Vercel Analytics' own
documented Astro integration pattern, GA4/View-Transitions Astro guides)
confirms the further-idiomatic pattern for pageview tracking
specifically: a client-side listener on the `astro:page-load` DOM event,
which fires once on Astro's initial page load **and** again on every
subsequent client-side navigation when Astro's View Transitions
(ClientRouter) are enabled — covering both Astro's default full-MPA-
reload mode (where `astro:page-load` fires once per real navigation
naturally, since each is a fresh page load) and View-Transitions-enabled
SPA-style navigation, with the same event, no branching needed.

**The config-time/runtime-boundary problem (see BRIEF.md's Design
decision 5 for the shared reasoning with issue 002's Nuxt module)**: this
package's `astro:config:setup` hook runs once, in Node, at Astro build/
dev-server config time — it cannot hold a live `Analytics` instance.
This package therefore accepts a required option `analyticsModule:
string` (an import specifier resolving to an app-authored file that
constructs `createAnalytics(...)` and default-exports the resulting
instance), and the script injected via `injectScript` contains a
**literal, static** `import analytics from "<analyticsModule>"`
statement (the specifier JSON-stringified into the injected script's
source text) — Astro's own build pipeline (Vite) processes injected
script content, so this import is resolved and bundled exactly like any
other client-side import in an Astro project.

**Dispatch delegation**: the injected script's `astro:page-load`
listener delegates to core's own `dispatchPageView()` (imported from
`typetrack` inside the injected script, also resolved through Astro's
Vite pipeline) — the same dedup helper every other route-tracking piece
in this phase reuses, for genuine cross-package consistency rather than
a bespoke reimplementation.

**No JSX/SFC, no toolchain gap**: this package is pure `.ts` (a plain
object implementing Astro's `AstroIntegration` type) — no `.astro`
component, no framework-specific compiler. The existing shared root
`tsconfig.json`/`.oxlintrc.json` already cover it with zero changes,
mirroring `@typetrack/vue`'s own finding (issue 001).

## Acceptance criteria

- `packages/astro/package.json`:
  - `"name": "@typetrack/astro"`, `"private": false`, `"type":
    "module"`.
  - `"main"`/`"module"`/`"types"`/`"exports"` shaped identically to
    `packages/react/package.json`.
  - `"scripts"`: same set as issue 001's package.
  - `"peerDependencies"`: `"astro": "^6.0.0 || ^7.0.0"` (required).
  - `"dependencies"`: `"typetrack": "file:../.."`.
  - `"devDependencies"`: `"astro"` (current stable, e.g. `7.x`, for its
    own `AstroIntegration`/hook-parameter types), plus this repo's
    existing toolchain set.
- `packages/astro/tsup.config.ts`: same base shape as
  `packages/react/tsup.config.ts` minus `banner` (no client-boundary
  directive concept applies here).
- `packages/astro/src/buildPageLoadScript.ts` (or equivalent name —
  document whichever is chosen): a pure, directly unit-testable function
  `buildPageLoadScript(analyticsModule: string): string` returning the
  literal script source injected via `injectScript` — extracted into its
  own module specifically so its exact output (the static import
  specifier, the `astro:page-load` listener wiring, the
  `dispatchPageView` call) is unit-testable as a plain string, mirroring
  `buildPageViewArgs.ts`'s "extract the pure logic" precedent.
- `packages/astro/src/index.ts`:
  - `export interface TypetrackAstroOptions { analyticsModule: string;
    autoPageViews?: boolean; }`.
  - `export default function typetrackAstro(options:
    TypetrackAstroOptions): AstroIntegration` — returns an object with
    `name: "@typetrack/astro"` and a `hooks["astro:config:setup"]`
    handler that calls `injectScript("page",
    buildPageLoadScript(options.analyticsModule))` when
    `options.autoPageViews ?? true`.
  - Throws a clear, descriptive error if `options.analyticsModule` is
    missing/empty — mirrors every other package's required-config
    contract in this phase.

## Test requirements

Both unit and integration tests are required; neither substitutes for
the other.

**Unit:**
- `buildPageLoadScript(analyticsModule)`: given a sample specifier
  (e.g. `"/src/lib/analytics.ts"`), asserts the returned string contains
  a static `import analytics from "/src/lib/analytics.ts"` line (or
  whatever the implementor's exact chosen import-binding name is —
  document it), a `document.addEventListener("astro:page-load", ...)`
  registration, and a call into `dispatchPageView`/`analytics.page`
  (whichever the implementor's exact delegation shape ends up being —
  document it precisely, since this is the one piece of this package
  that literally *is* the shipped behavior).
- `typetrackAstro(options)` throws when `analyticsModule` is
  missing/empty.

**Integration** (exercising the returned `AstroIntegration` object's
hook against a mocked `injectScript`, standing in for what Astro's real
build pipeline would otherwise call — since a real `astro build` pass is
out of scope, see below):
- Call `typetrackAstro({ analyticsModule: "..." }).hooks["astro:config:
  setup"]` with a minimal stub params object providing a spied
  `injectScript` function (plus whatever other required fields Astro's
  `HookParameters["astro:config:setup"]` type mandates — stubbed
  minimally, not a real Astro config); assert `injectScript` was called
  with `stage: "page"` and script content matching
  `buildPageLoadScript`'s own output for the same `analyticsModule`.
- Call the same hook with `autoPageViews: false`; assert `injectScript`
  is **not** called.
- Separately (genuinely exercising the injected script's *runtime*
  behavior, not just its literal text): using happy-dom, `eval()` (or
  `new Function(...)`, implementor's choice) the string returned by
  `buildPageLoadScript` in an environment where the `analyticsModule`
  import and `dispatchPageView` are stubbed/mocked appropriately (e.g.
  by structuring `buildPageLoadScript`'s output so its dispatch logic is
  itself a thin call into a separately-exported, directly-testable
  function — implementor's call on the exact mechanism, document
  whichever approach is chosen, since literal dynamic-`import()`-inside-
  `eval` composition is genuinely awkward in a `bun test` context and a
  documented, reasonable workaround is acceptable here); fire a
  simulated `astro:page-load` event and assert the expected dispatch
  occurs. If, after genuine attempt, this proves impractical to test
  meaningfully without a real Astro/Vite runtime, document that
  specific gap explicitly (mirroring `@typetrack/next` issue 002's
  "Explicitly not covered" precedent) rather than silently skipping it.

**Explicitly not covered by automated tests** (documented, not silently
skipped): a real `astro build`/`astro dev` pass proving the injected
script is genuinely present in real page output and that
`astro:page-load` genuinely fires as expected under real View
Transitions — deferred to `examples/frameworks/astro/`'s source-plus-
README-only shape (issue 007) plus manual verification.

## Out of scope

- Any `.astro` component/file in this package (see Context — none is
  needed or produced).
- Server-side/`Astro.locals`/middleware-based tracking.
- A real `astro build` pass exercised in this repo's CI.
- Any change to core `src/`.
