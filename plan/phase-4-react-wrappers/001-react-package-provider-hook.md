# 001 — `@typetrack/react`: package scaffold, `AnalyticsProvider`, `useAnalytics`

## Context

Phases 0-3 shipped the core `typetrack` package (`createAnalytics<Events>()`,
`Analytics<Events>`, `EventMap`) and three server-side `@typetrack/provider-*`
vendor adapters. This issue starts Phase 4: a React wrapper package,
`@typetrack/react`, so React apps can put a single `Analytics` instance
(from `createAnalytics()`) on context and reach it from any descendant via a
hook, instead of threading it through props or a hand-rolled singleton.

This is also the **first package in this repo with JSX/TSX source**. The
existing `packages/provider-*` packages are pure `.ts`, ship no build step
(`"main": "src/index.ts"` pointing straight at source, `"private": true`,
consumed only inside this monorepo), and the shared root `tsconfig.json`
(`include: ["src", "packages/*/src", "tsup.config.ts"]`) has no `jsx`
compiler option set. `@typetrack/react` deviates from the provider-*
precedent in two ways, both required by it being a genuinely
external-npm-consumable, JSX-bearing package rather than an internal
Bun/Node-only adapter:

- It needs a real build (`tsup`, ESM + CJS + `.d.ts`, matching the root
  `typetrack` package's own `tsup.config.ts` shape exactly) because a
  consuming app's bundler (webpack/Turbopack/Vite/etc.) only transpiles its
  own project source, not arbitrary `.tsx` sitting in `node_modules` — raw
  source, which is what the provider-* packages ship, does not work for a
  real external consumer of a JSX package.
  - Research finding: `tsup` (esbuild-based) resolves extensionless imports
    against `.tsx` automatically and compiles JSX per the project's
    `tsconfig` `jsx` option, with **no special entry-glob change needed**
    beyond what already works for `.ts` — the phase brief's suggestion that
    tsup's entry glob might need explicit `.tsx` handling did not pan out
    under research; `entry: ["src/index.ts"]` is sufficient even though
    `index.ts` transitively imports a `.tsx` file.
  - `package.json` `"main"`/`"module"`/`"types"` point at `./dist/*`
    (matching root `typetrack`'s pattern), not at `src/index.ts`
    (unlike provider-*). `"private": false` (unlike provider-*, which are
    `"private": true"` and never meant to be published) — this is the first
    package in the repo actually intended for genuine external npm
    consumption per this phase's brief ("consumer-facing peer-dependency-style
    wrappers").
- The shared root `tsconfig.json` needs `"jsx": "react-jsx"` added (React
  17+'s automatic runtime — no `jsxImportSource` override needed, default is
  `"react"`). This is additive and a no-op for every existing non-JSX file;
  it must not regress `packages/provider-*`'s or root `src/`'s own
  typecheck.
- `oxlint`'s default rule set does not enable React-specific rule
  categories. `.oxlintrc.json` needs the `react` plugin category enabled
  (and, if available in the installed `oxlint` version, its
  `react-hooks`/rules-of-hooks rules) for this package's `.tsx`/hook-heavy
  source to actually get linted meaningfully rather than just parsed.
- `knip.json`'s existing `"packages/*": {}` wildcard entry already covers
  new `packages/*` directories with no config change required (verified:
  it applies knip's own default entry/project inference per-package).

**React/Context API decision** (researched, not guessed): React 19
introduced using a context object directly as a JSX element —
`<SomeContext value={x}>` — instead of `<SomeContext.Provider value={x}>`.
The old `.Provider` form still works today but is on a deprecation path.
This package's peer/dev dependency floor is **React 19** (`^19.0.0` for
both `react` and `react-dom`, required peers — not optional, unlike `zod`'s
optional peer in root `typetrack`, since this package cannot function at
all without React), and its internal `AnalyticsContext` provider
implementation must use the current (React 19) direct-context-as-provider
form, not the legacy `.Provider` form.

**Testing library decision** (researched, not guessed): `bun test` has no
DOM/browser globals by default. Per Bun's own official docs
(https://bun.com/docs/test/dom), the supported approach is
`@happy-dom/global-registrator` + `@testing-library/react` +
`@testing-library/dom` + `@testing-library/jest-dom`, wired up via a
preload script that calls `GlobalRegistrator.register()` and imports
`@testing-library/jest-dom` so its matchers extend `bun:test`'s `expect`.
`@testing-library/react` must be pinned `^16.3.0` or later — earlier 14.x
releases declared a `^18` React peer and do not support React 19.

**Important deviation from Bun's docs' suggested wiring**: Bun's docs wire
this up via a root-level `bunfig.toml` `[test].preload`. This repo's CI
(`.github/workflows/qa.yml`) runs a single `bun test` invocation from the
repo root, which recursively discovers and runs **every** workspace's test
files (`src/**`, all `packages/*/src/**`) in one process. A root-level
`bunfig.toml` preload would therefore register happy-dom's DOM/`fetch`/etc.
globals for the *entire* monorepo's test run, including the unrelated
`packages/provider-*` and `src/devServer`/`src/cli` tests that rely on
Bun's native `fetch`/`Bun.serve()` behavior — a real cross-package
regression risk. Instead: this package ships its own
`src/testSetup.ts` module (registers happy-dom in a top-level statement,
imported by this package's own `*.test.tsx` files only) plus an `afterAll`
that calls `GlobalRegistrator.unregister()`, so DOM globals are torn down
before any other package's test files run later in the same `bun test`
process. No root or per-package `bunfig.toml` is introduced by this issue.

**CI wiring**: `.github/workflows/qa.yml`'s single "Build" step
(`bun run build`) today only builds the root `typetrack` package (the only
one with a build script). This issue adds a `"build": "tsup"` script to
`packages/react/package.json` and updates the CI "Build" step to also run
`bun run build` inside `packages/react` (order: root, then
`packages/react`) so this package's own `dist/` output is produced before
the repo-wide typecheck/lint/test/knip steps run against it.

**Naming note for implementors**: core `typetrack` already exports a type
named `AnalyticsProvider` (`src/providers/index.ts` — the vendor-SDK-adapter
interface, e.g. what `createPostHogProvider()` returns). This issue's
`<AnalyticsProvider analytics={...}>` **React component** is unrelated to
that interface and does not extend/implement it — the identical name is
mandated by the phase brief itself, not an invention of this issue. Do not
rename either side to avoid the collision; just avoid importing both under
the same bare name in one file (they live in different packages —
`typetrack` vs. `@typetrack/react` — so ordinary imports don't collide).

## Acceptance criteria

- `packages/react/package.json`:
  - `"name": "@typetrack/react"`, `"private": false`, `"type": "module"`.
  - `"main"`/`"module"`/`"types"` point at `./dist/index.cjs` /
    `./dist/index.js` / `./dist/index.d.ts`; `"exports"` map mirrors root
    `typetrack`'s shape (`types`/`import`/`require` conditions for `"."`).
  - `"files": ["dist"]`.
  - `"scripts"`: `"build": "tsup"`, `"lint": "oxlint"`,
    `"typecheck": "tsgo --noEmit"`, `"typecheck:tsc": "tsc --noEmit"`,
    `"test": "bun test"`.
  - `"peerDependencies"`: `"react": "^19.0.0"`, `"react-dom": "^19.0.0"`
    (both required — no `peerDependenciesMeta` optional flag).
  - `"dependencies"`: `"typetrack": "file:../.."` (for the `Analytics`,
    `EventMap` types).
  - `"devDependencies"` includes: `"react"`, `"react-dom"`, `"@types/react"`,
    `"@types/react-dom"`, `"@testing-library/react"` (`^16.3.0`+),
    `"@testing-library/dom"`, `"@testing-library/jest-dom"`,
    `"@happy-dom/global-registrator"`, plus this repo's existing toolchain
    set (`tsup`, `typescript`, `@typescript/native-preview`, `oxlint`,
    `knip`) at versions matching root's `package.json`.
- `packages/react/tsup.config.ts`: `entry: ["src/index.ts"]`,
  `format: ["esm", "cjs"]`, `dts: true`, `sourcemap: true`, `clean: true`,
  `splitting: false` (matching root `tsup.config.ts`'s first entry).
- Root `tsconfig.json` gains `"jsx": "react-jsx"` under `compilerOptions`;
  `bun run typecheck`/`bun run typecheck:tsc` at the repo root still pass
  for `src/` and every existing `packages/provider-*` package unchanged.
- `.oxlintrc.json` enables the `react` plugin category (and rules-of-hooks
  coverage if the installed `oxlint` version exposes it as a distinct
  category) so `.tsx`/hook source is actually linted, not just parsed.
- `.github/workflows/qa.yml`'s "Build" step also runs `bun run build`
  inside `packages/react` (after the root build).
- `packages/react/src/index.ts`: barrel export of `AnalyticsProvider` and
  `useAnalytics` (and re-exports whatever public types are needed for a
  consumer to type its own `Events` map, e.g. re-exporting `EventMap`/
  `Analytics` from `typetrack` if convenient — do not duplicate their
  definitions).
- `packages/react/src/AnalyticsProvider.tsx`:
  - An `AnalyticsContext` created via `createContext<Analytics<EventMap> |
    undefined>(undefined)` — the sentinel is `undefined`, not a fake
    no-op `Analytics` object, so "no provider in the tree" is
    distinguishable from "a real provider supplying a no-op analytics
    instance".
  - `AnalyticsProvider<Events extends EventMap = EventMap>({ analytics,
    children }: { analytics: Analytics<Events>; children: ReactNode })`
    implemented as a **named function declaration** (not an arrow function)
    to avoid the `<T,>` generic-arrow-function/JSX ambiguity in `.tsx`.
  - Uses the React 19 direct-context-as-provider JSX form
    (`<AnalyticsContext value={analytics}>...</AnalyticsContext>`), not
    the legacy `.Provider` form.
- `packages/react/src/useAnalytics.ts` (or co-located in the same file —
  implementor's call, document whichever is chosen):
  - `useAnalytics<Events extends EventMap = EventMap>(): Analytics<Events>`.
  - Reads `AnalyticsContext` via `useContext`; if the value is `undefined`,
    **throws** a descriptive `Error` (e.g. naming `useAnalytics` and
    `AnalyticsProvider` explicitly in the message) rather than returning a
    no-op `Analytics` object or `undefined` — a silent no-op must never be
    reachable from this hook.
  - Returns the context value type-asserted to the caller's `Events`
    type parameter. Document (code comment) that this assertion is sound
    only insofar as the caller's `Events` matches whatever the nearest
    ancestor `<AnalyticsProvider analytics={...}>` was actually
    instantiated with — same fundamental limitation as any generic React
    context helper (the type system does not verify the two ends agree);
    this is a known, accepted limitation, not a defect to "fix" here.
- `packages/react/src/testSetup.ts`: registers happy-dom globals (module
  top-level) and exposes/registers an `afterAll` (or is itself imported
  alongside an `afterAll(() => GlobalRegistrator.unregister())` in each
  test file) so DOM globals do not leak past this package's own test run
  within the shared, repo-wide `bun test` process.

## Test requirements

Both unit and integration tests are required; neither substitutes for the
other.

**Unit:**
- `useAnalytics()` throws (not returns undefined/a no-op) when invoked from
  a component with no ancestor `AnalyticsProvider` — assert the thrown
  error's message identifies the missing-provider condition.
- The context's default value is confirmed to be the `undefined` sentinel
  (exercised indirectly via the above throw test — no direct internal
  inspection of React's context internals).
- A typecheck-level check (not a `bun test` runtime assertion): a test
  source file that calls `useAnalytics<MyTestEvents>()` and assigns the
  result to a locally declared `Analytics<MyTestEvents>`-typed variable,
  and separately calls `.track()` with both a valid and a
  type-mismatched payload for one of `MyTestEvents`' events, relying on
  `bun run typecheck`/`typecheck:tsc` (already run in CI) to catch a
  genericity regression — document in the test file's comments that this
  file's purpose is compile-time verification, not a runtime assertion.
  (No dedicated type-testing harness exists in this repo yet; introducing
  one is out of scope.)

**Integration** (real rendering via `@testing-library/react`, not just
direct function calls):
- Render `<AnalyticsProvider analytics={fakeAnalytics}>` wrapping a
  consumer component that calls `useAnalytics()` and invokes
  `track`/`identify`/`page`/`flush` (e.g. via button `onClick`s triggered
  with `fireEvent`/`userEvent`); assert the `fakeAnalytics` mock functions
  were called with the expected arguments.
- Render the same consumer component **without** an `AnalyticsProvider**
  ancestor and assert the render throws the expected error (suppressing
  React's console-error render-throw logging via a spy for this specific
  test, restoring it afterward).
- Full `bun test` from the repo root (matching current CI invocation)
  passes in full, including every pre-existing `src/` and
  `packages/provider-*` test file — confirming this package's
  happy-dom register/unregister does not leak DOM globals into unrelated
  test files run in the same process.

## Out of scope

- `@typetrack/next` and any Next.js-specific behavior (App Router client
  boundary, automatic pageview tracking) — subsequent issues.
- Any change to core `src/` (`createAnalytics`, `Analytics`, `EventMap`)
  itself; this package only consumes those types/values.
- Support for React versions below 19, or for class components.
- SSR-specific analytics behavior (e.g., tracking during server rendering).
- Any batching/deduplication logic beyond what `createAnalytics()` already
  provides — this package is a pure pass-through onto one `Analytics`
  instance.
- Wrappers for any other framework (Vue, Svelte, Solid, etc.).
- Any devServer/CLI (`src/devServer`, `src/cli`) integration or UI.
