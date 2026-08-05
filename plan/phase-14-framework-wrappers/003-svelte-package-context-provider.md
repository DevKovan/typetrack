# 003 — `@typetrack/svelte`: `setContext`/`getContext` provider + `useAnalytics()`

## Context

No dependency on any other issue in this phase.

**Researched version/API decisions**: Svelte's current stable major is
**5** (runes — `$state`/`$props`/`$derived` — are the established
default, not a preview or opt-in feature); peer floor `^5.0.0`. Confirmed
via research: Svelte's Context API (`setContext`/`getContext`, imported
from `"svelte"`) remains the current, stable, correct primitive for
sharing a value scoped to a component subtree — runes exist for
*reactive* state, which an `Analytics` instance is not (a stable object
with methods, constructed once by the app, never reassigned — the same
"non-reactive service handle" nature every other framework's context
value in this phase shares). `setContext`/`getContext` **must** be
called during a component's own initialization (a hard Svelte runtime
constraint — calling either outside a component's synchronous setup
throws a `lifecycle_outside_component`-style runtime error), which is
why this package genuinely needs one real `.svelte` component
(`AnalyticsProvider.svelte`), unlike `@typetrack/vue`/`@typetrack/astro`
(issues 001/005), which need none.

**Svelte 5 children convention, researched (not the older, deprecated
convention)**: Svelte 5 replaced default slots with **snippets** —
a component receives its children via a `children` prop (from `$props()`)
and renders them with `{@render children?.()}`, not the Svelte-4-era
`<slot />`. `AnalyticsProvider.svelte`'s own `<script>` block therefore
destructures `let { analytics, children }: AnalyticsProviderProps =
$props();` and its markup is exactly `{@render children?.()}`.

**Toolchain gap, researched (see BRIEF.md's toolchain-gaps section for
the full summary — this issue owns fixing it)**:
1. `.svelte` files are never compiled by `tsup`'s default `esbuild`
   pipeline — this package's `tsup.config.ts` needs the `esbuild-svelte`
   plugin (confirmed current/maintained via research) wired into
   `esbuildPlugins`.
2. `.svelte` files are never matched by the shared root
   `tsconfig.json`'s `include` glob at all (`tsc`/`tsgo` don't parse
   `.svelte` syntax under any glob) — meaning
   `AnalyticsProvider.svelte`'s own `<script>` block gets **zero**
   type-checking from the existing repo-wide `bun run typecheck`/
   `typecheck:tsc` unless this issue adds Svelte's own official
   `svelte-check` tool. This issue adds `svelte-check` as a
   `packages/svelte`-scoped devDependency with its own **additional**
   `"typecheck:svelte": "svelte-check"` script (additive, does not
   replace the existing `tsgo --noEmit`/`tsc --noEmit` scripts, which
   still correctly typecheck this package's plain `.ts` files), and
   `.github/workflows/qa.yml`'s Typecheck step gains one targeted
   `cd packages/svelte && bun run typecheck:svelte` invocation.

**SvelteKit route tracking**: explicitly deferred — see BRIEF.md's
Design decision 4. This package works unmodified inside a SvelteKit app
(it's a plain component-subtree context wrapper, router-agnostic), but
ships no SvelteKit-router-aware pageview-tracking component of its own.

## Acceptance criteria

- `packages/svelte/package.json`:
  - `"name": "@typetrack/svelte"`, `"private": false`, `"type":
    "module"`.
  - `"main"`/`"module"`/`"types"`/`"exports"` shaped identically to
    `packages/react/package.json` (dist-based, ESM+CJS+d.ts).
  - `"scripts"`: `"build": "tsup"`, `"lint": "oxlint"`,
    `"typecheck": "tsgo --noEmit"`, `"typecheck:tsc": "tsc --noEmit"`,
    `"typecheck:svelte": "svelte-check"`, `"test": "bun test"`.
  - `"peerDependencies"`: `"svelte": "^5.0.0"` (required).
  - `"dependencies"`: `"typetrack": "file:../.."`.
  - `"devDependencies"`: `"svelte"` (current stable, e.g. `5.x`),
    `"esbuild-svelte"`, `"svelte-check"`,
    `"@testing-library/svelte"` (current, Svelte-5-compatible version),
    `"@happy-dom/global-registrator"`, plus this repo's existing
    toolchain set at versions matching root's `package.json`.
- `packages/svelte/tsup.config.ts`: same base shape as
  `packages/react/tsup.config.ts` (no `banner` needed) plus
  `esbuildPlugins: [esbuildSvelte(...)]` (exact plugin options —
  e.g. TypeScript preprocessing — implementor's call, document what's
  configured and why).
- `packages/svelte/src/context.ts`:
  - `const ANALYTICS_KEY = Symbol("typetrack-analytics")` (or an
    equivalent unique key construction — document the exact form
    chosen).
  - `export function useAnalytics<Events extends EventMap =
    EventMap>(): Analytics<Events>` — calls `getContext(ANALYTICS_KEY)`;
    if `undefined`, **throws** a descriptive `Error` naming
    `useAnalytics` and `AnalyticsProvider` explicitly (mirrors every
    other package's throw contract in this phase — no exceptions).
    Documented (code comment) that, per Svelte's own runtime
    constraint, this function must itself be called during a component's
    synchronous initialization (the same constraint `setContext`/
    `getContext` carry) — not from an async callback/`onMount`/etc.
- `packages/svelte/src/AnalyticsProvider.svelte`:
  - `<script lang="ts">` block: `let { analytics, children }:
    AnalyticsProviderProps<EventMap> = $props();` then `setContext(
    ANALYTICS_KEY, analytics)`.
  - Markup: `{@render children?.()}` (Svelte 5 snippet convention, not
    `<slot />`).
  - `AnalyticsProviderProps<Events extends EventMap = EventMap>` typed
    as `{ analytics: Analytics<Events>; children?: Snippet }` (or the
    current correct Svelte 5 `Snippet` type import — implementor
    verifies the exact current type name/import path via Svelte's own
    docs at implementation time).
- `packages/svelte/src/index.ts`: barrel export of `AnalyticsProvider`
  (the `.svelte` component), `useAnalytics`, plus re-exported
  `Analytics`/`EventMap` from `typetrack`.
- `packages/svelte/src/testSetup.ts`: same happy-dom register/
  `afterAll`-unregister approach as every other package in this phase.
- `.github/workflows/qa.yml`'s Build step runs `bun run build` inside
  `packages/svelte`; its Typecheck step gains the additional
  `packages/svelte`-scoped `svelte-check` invocation described in
  Context.

## Test requirements

Both unit and integration tests are required; neither substitutes for
the other.

**Unit:**
- `useAnalytics()` throws (not returns `undefined`) when called from a
  component with no ancestor `<AnalyticsProvider>` — exercised via
  `@testing-library/svelte`'s `render()` of a minimal consumer component
  (not by calling `getContext` directly outside a component, which would
  conflate Svelte's own "outside component" runtime error with this
  package's own missing-provider error).
- A typecheck-level check (mirrors every other package's precedent):
  a `.ts` (not `.svelte`) test file calling `useAnalytics<MyTestEvents>()`
  in a typed context, relying on `bun run typecheck`/`typecheck:tsc` to
  catch a genericity regression.

**Integration** (real rendering via `@testing-library/svelte`):
- Render `<AnalyticsProvider analytics={fakeAnalytics}>` wrapping a
  consumer component (passed as the Svelte 5 `children` snippet) that
  calls `useAnalytics()` and invokes `track`/`identify`/`page`/`flush`
  via a button click (triggered through `@testing-library/svelte`'s
  `fireEvent`); assert `fakeAnalytics`'s mock functions were called with
  the expected arguments.
- Render the same consumer component **without** an ancestor
  `<AnalyticsProvider>` and assert the render throws the expected error.
- Full `bun test` from the repo root still passes, including all
  pre-existing tests — confirming this package's happy-dom register/
  unregister does not leak DOM globals cross-file.

## Out of scope

- SvelteKit-specific route-change auto-tracking (see BRIEF.md's Design
  decision 4) — a `packages/sveltekit` package, if ever prioritized,
  handles this, mirroring `@typetrack/next`'s split from
  `@typetrack/react`.
- Svelte 4 (stores-based) support — peer floor is `^5.0.0` only.
- Any change to core `src/`.
- `eslint-plugin-svelte`/template-level linting — accepted gap, see
  BRIEF.md's toolchain-gaps section.
