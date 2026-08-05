# 004 — `@typetrack/solid`: `createContext`/`useContext` provider + `useAnalytics()`

## Context

No dependency on any other issue in this phase.

**Researched version/API decisions**: SolidJS's current stable is
**1.9.x** (`solid-js`; 2.0 is experimental/unreleased, not a target);
peer floor `^1.9.0`. Confirmed via research: Solid's `createContext`
(imported from `"solid-js"`) returns an object exposing a `.Provider`
component and an optional default value — **Solid's Provider is the
`Context.Provider` form** (like React's *legacy*, pre-19 form — Solid
has no React-19-style "context object directly as a JSX element"
equivalent; do not assume React 19's newer syntax applies here, it does
not). `useContext(SomeContext)` reads the nearest matching provider's
value, or the context's own default (here, `undefined`) if none is
found.

**Solid props/reactivity constraint, researched and load-bearing**:
Solid's fine-grained reactivity model means component `props` must
**never be destructured** at the top of a component function — doing so
breaks reactivity (a well-documented, current Solid gotcha, distinct
from React/Vue's own conventions). `AnalyticsProvider`'s implementation
must access `props.analytics`/`props.children` directly (or via Solid's
own `splitProps`/`mergeProps` helpers if genuinely needed — not via
plain object-destructuring assignment). An `Analytics` instance itself
needs **no** signal wrapping (it is a stable, non-reactive value,
confirmed consistent with every other framework's context value in this
phase) — `props.analytics` is read once, passed straight into
`AnalyticsContext.Provider`'s `value`.

**Toolchain gap, researched (see BRIEF.md's toolchain-gaps section for
the summary — this issue owns fixing it)**:
1. **Type-checking**: the shared root `tsconfig.json`'s `"jsx": "react-
   jsx"` (added by phase 4 for React) must **not** be changed globally —
   every other JSX-bearing package in this repo (React, Next, and this
   phase's Remix package) needs React's JSX runtime. Instead, every
   `.tsx` file in `packages/solid/src` carries a **per-file**
   `/** @jsxImportSource solid-js */` pragma comment as its first line
   (before any import) — a real, current TypeScript feature (stable
   since TS 4.1, and specifically made robust for exactly this
   "multiple JSX libraries in one project" case by TS 5.1's decoupled
   JSX-namespace resolution; this repo runs TypeScript 6.0.3). This
   redirects only that file's JSX type-checking to `solid-js/jsx-
   runtime`'s own `JSX` namespace/factory types — no tsconfig change,
   no project-references restructuring, no CI typecheck-step change
   needed for this half of the problem.
2. **Build (actual compilation)**: `esbuild`'s own built-in JSX
   transform (what `tsup` uses for React's `react-jsx` mode) **cannot**
   correctly compile Solid JSX — Solid's JSX compiles at build time into
   fine-grained reactive DOM-update calls via a dedicated Babel
   transform (`babel-preset-solid`), fundamentally different from
   React's `createElement`/automatic-runtime output. This issue wires
   `tsup-preset-solid` (a tsup-native community preset built specifically
   for packaging SolidJS libraries with tsup — confirmed current/
   maintained via research) into `packages/solid/tsup.config.ts`, as a
   package-scoped devDependency (narrowly scoped, matching the same
   "package-local build-plugin dependency" category as `packages/react`'s
   own testing-library additions — not a violation of CLAUDE.md's shared
   monorepo toolchain list).
3. **`package.json` `exports`**: gains a `"solid"` export condition
   (ahead of `"import"`/`"require"`) — confirmed via research that
   Solid-aware tooling (SolidStart, `vite-plugin-solid`) resolves via
   this condition specifically, distinct from a plain ESM/CJS consumer.

**SolidStart route tracking**: explicitly deferred — see BRIEF.md's
Design decision 4, mirroring SvelteKit's deferral in issue 003 exactly.

## Acceptance criteria

- `packages/solid/package.json`:
  - `"name": "@typetrack/solid"`, `"private": false`, `"type":
    "module"`.
  - `"main"`/`"module"`/`"types"` point at `./dist/*`; `"exports"["."]`
    includes a `"solid"` condition ahead of `"import"`/`"require"`
    (exact shape: `{ "types": "...", "solid": "./dist/index.jsx" [or
    whatever `tsup-preset-solid`'s own default output naming is —
    implementor documents the actual emitted shape], "import": "...",
    "require": "..." }` — implementor follows `tsup-preset-solid`'s own
    documented/generated `exports` shape rather than hand-rolling one
    that might not match its actual output).
  - `"files": ["dist"]`.
  - `"scripts"`: `"build": "tsup"`, `"lint": "oxlint"`,
    `"typecheck": "tsgo --noEmit"`, `"typecheck:tsc": "tsc --noEmit"`,
    `"test": "bun test"`.
  - `"peerDependencies"`: `"solid-js": "^1.9.0"` (required).
  - `"dependencies"`: `"typetrack": "file:../.."`.
  - `"devDependencies"`: `"solid-js"` (current stable, e.g. `1.9.x`),
    `"tsup-preset-solid"`, `"@solidjs/testing-library"` (official Solid
    testing library, confirmed current), `"@happy-dom/global-
    registrator"`, plus this repo's existing toolchain set.
- `packages/solid/tsup.config.ts`: built on `tsup-preset-solid`'s
  documented config shape (implementor follows its own README rather
  than hand-rolling an `esbuildPlugins` array manually), producing
  ESM+CJS+d.ts output matching this repo's existing dual-format
  convention as closely as the preset allows.
- `packages/solid/src/AnalyticsProvider.tsx`:
  - First line: `/** @jsxImportSource solid-js */`.
  - `export const AnalyticsContext = createContext<Analytics<EventMap> |
    undefined>(undefined)`.
  - `export interface AnalyticsProviderProps<Events extends EventMap =
    EventMap> { analytics: Analytics<Events>; children: JSX.Element; }`.
  - `AnalyticsProvider` implemented **without** destructuring `props` —
    accesses `props.analytics`/`props.children` directly (or via
    Solid's own prop-splitting helpers) — returns
    `<AnalyticsContext.Provider value={props.analytics as
    Analytics<EventMap>}>{props.children}</AnalyticsContext.Provider>`.
- `packages/solid/src/useAnalytics.ts`:
  - First line: `/** @jsxImportSource solid-js */` (needed even in a
    non-JSX-emitting file if it imports from `AnalyticsProvider.tsx` in
    a way that pulls in JSX types — implementor verifies whether this
    file genuinely needs the pragma or can omit it; document the
    finding either way).
  - `useAnalytics<Events extends EventMap = EventMap>(): Analytics<Events>`
    — calls `useContext(AnalyticsContext)`; throws a descriptive `Error`
    naming `useAnalytics`/`AnalyticsProvider` if `undefined` — mirrors
    every other package's throw contract in this phase exactly.
- `packages/solid/src/index.ts`: barrel export of `AnalyticsProvider`,
  `useAnalytics`, plus re-exported `Analytics`/`EventMap` from
  `typetrack`.
- `packages/solid/src/testSetup.ts`: same happy-dom register/
  `afterAll`-unregister approach as every other package in this phase.
- `.github/workflows/qa.yml`'s Build step runs `bun run build` inside
  `packages/solid`.

## Test requirements

Both unit and integration tests are required; neither substitutes for
the other.

**Unit:**
- `useAnalytics()` throws (not returns `undefined`) when invoked from a
  component with no ancestor `<AnalyticsProvider>` — exercised via
  `@solidjs/testing-library`'s `render()`, not a raw function call.
- A typecheck-level check (mirrors every other package's precedent) —
  a `.tsx` test file (carrying its own `/** @jsxImportSource solid-js
  */` pragma) calling `useAnalytics<MyTestEvents>()` in a typed context,
  relying on `bun run typecheck`/`typecheck:tsc` to catch a genericity
  regression.

**Integration** (real rendering via `@solidjs/testing-library`):
- Render `<AnalyticsProvider analytics={fakeAnalytics}>` wrapping a
  consumer component that calls `useAnalytics()` and invokes
  `track`/`identify`/`page`/`flush` via a button click (triggered with
  `fireEvent`); assert `fakeAnalytics`'s mock functions were called with
  the expected arguments.
- Render the same consumer component **without** an ancestor
  `<AnalyticsProvider>` and assert the render throws the expected error.
- Full `bun test` from the repo root still passes, including all
  pre-existing tests.

## Out of scope

- SolidStart-specific route-change auto-tracking (see BRIEF.md's Design
  decision 4).
- Any change to the shared root `tsconfig.json`'s `"jsx"` setting — the
  per-file pragma is the entire fix, deliberately (see Context).
- Any change to core `src/`.
- Solid 2.0 (experimental, unreleased) — peer floor is `^1.9.0` only.
