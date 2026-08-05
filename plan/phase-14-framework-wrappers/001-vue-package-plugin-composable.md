# 001 — `@typetrack/vue`: plugin (`app.use`) + `useAnalytics()` composable

## Context

First package in this phase — no dependency on any other issue here.
Read `packages/react/src/{AnalyticsProvider.tsx,useAnalytics.ts,
index.ts}` first: this issue reproduces that package's exact contract
(throw-on-missing-provider, no silent no-op, generic over the caller's
`Events` type) using Vue's own idioms instead of React's.

**Researched API decision, not guessed**: Vue 3's current stable is
3.5.x/3.6 (peer floor `^3.4.0` — the surface this issue uses,
`provide`/`inject`/plugin `install()`, has been stable since Vue 3.0, so
a broad floor is correct). Research into Vue's own documentation and
current community guides on sharing a non-reactive singleton service
(as opposed to reactive shared *state*, which is a different, unrelated
problem Pinia/reactive `provide` solve) converges on exactly one pattern:
a **plugin** (an object with an `install(app, options)` method, installed
via `app.use(plugin, options)`) that calls `app.provide(key, value)` at
the app level, paired with a **composable** (a plain exported function,
conventionally `useX()`) that calls `inject(key)` and throws a clear
error if the key was never provided. This is the Vue-idiomatic analogue
of `@typetrack/react`'s `AnalyticsProvider` component +
`useAnalytics()` hook pair — but **no component and no `.vue` SFC is
needed at all**: `app.provide`/`inject` are plain Composition-API
function calls, with zero template/JSX syntax involved. This is a real,
verified finding (see BRIEF.md's toolchain-gaps section) that
significantly simplifies this package relative to React's: no JSX
compiler config, no SFC compiler, no `vue-tsc` gap — the entire package
is plain `.ts`, already covered by the existing shared root
`tsconfig.json`/`.oxlintrc.json` with zero changes.

**Typed injection key decision**: Vue's `InjectionKey<T>` (a generic
`Symbol` subtype exported by `vue` itself) is the researched, current,
idiomatic way to keep `provide()`/`inject()`'s value type in sync without
either side re-declaring it — confirmed via research into Vue's own
TypeScript guide and multiple current type-safe-DI writeups. This
package's key is typed `InjectionKey<Analytics<EventMap>>`, exported (not
just used internally) so `@typetrack/nuxt` (issue 002) can `provide()`
onto the *same* key from its own generated runtime plugin and have this
package's own `useAnalytics()` keep working unmodified — genuine code
reuse across the two packages, not a parallel reimplementation.

**Plugin call shape decision**: `app.use(typetrackPlugin, { analytics })`
— Vue's own documented, current convention for passing plugin options
(the second, third, ... arguments to `app.use()` are forwarded verbatim
to the plugin's `install(app, ...options)`), confirmed via research. Not
`app.use(typetrackPlugin(analytics))` (a plugin *factory* — also a valid
Vue pattern, but `app.use(plugin, options)` is the more directly
documented convention for a single, simple options object and avoids an
extra factory-function layer for no benefit here).

## Acceptance criteria

- `packages/vue/package.json`:
  - `"name": "@typetrack/vue"`, `"private": false`, `"type": "module"`.
  - `"main"`/`"module"`/`"types"`/`"exports"` shaped identically to
    `packages/react/package.json` (dist-based, ESM+CJS+d.ts, `"files":
    ["dist"]`).
  - `"scripts"`: `"build": "tsup"`, `"lint": "oxlint"`,
    `"typecheck": "tsgo --noEmit"`, `"typecheck:tsc": "tsc --noEmit"`,
    `"test": "bun test"`.
  - `"peerDependencies"`: `"vue": "^3.4.0"` (required, no
    `peerDependenciesMeta` optional flag — this package cannot function
    without Vue, matching React's precedent).
  - `"dependencies"`: `"typetrack": "file:../.."`.
  - `"devDependencies"`: `"vue"` (current stable, e.g. `3.5.x`),
    `"@vue/test-utils"` (current stable, official Vue 3 testing library),
    `"@happy-dom/global-registrator"`, plus this repo's existing
    toolchain set (`tsup`, `typescript`, `@typescript/native-preview`,
    `oxlint`, `knip`) at versions matching root's `package.json`.
- `packages/vue/tsup.config.ts`: identical shape to
  `packages/react/tsup.config.ts` minus the `banner` field (no
  "use client"-equivalent boundary exists in this package — plain Vue
  has no server/client component split of Next's App-Router kind).
- `packages/vue/src/plugin.ts`:
  - `export const analyticsKey: InjectionKey<Analytics<EventMap>>` — a
    real, unique `Symbol`-backed key (e.g.
    `Symbol("typetrack-analytics") as InjectionKey<Analytics<EventMap>>`
    or Vue's own typed-key-construction convention — implementor's
    choice of exact construction, document whichever is chosen).
  - `export const typetrackPlugin: Plugin<...>` (or equivalent typed
    shape — implementor's call on the exact generic signature) whose
    `install(app, options: { analytics: Analytics<EventMap> })` calls
    `app.provide(analyticsKey, options.analytics)`.
- `packages/vue/src/useAnalytics.ts`:
  - `useAnalytics<Events extends EventMap = EventMap>(): Analytics<Events>`.
  - Calls `inject(analyticsKey)`; if the result is `undefined`, **throws**
    a descriptive `Error` naming `useAnalytics` and the plugin
    (`app.use(typetrackPlugin, ...)`) explicitly in the message — mirrors
    `@typetrack/react`'s `useAnalytics()` throw contract exactly, per
    BRIEF.md's cross-package consistency decision. Never returns a no-op
    `Analytics`/`undefined`.
  - Returns the injected value type-asserted to the caller's `Events`
    type parameter, with the same documented soundness caveat
    `@typetrack/react`'s `useAnalytics()` carries (the type system cannot
    verify the caller's `Events` matches what was actually provided).
- `packages/vue/src/index.ts`: barrel export of `typetrackPlugin`,
  `analyticsKey`, `useAnalytics`, plus re-exported `Analytics`/`EventMap`
  types from `typetrack` (not redefined).
- `packages/vue/src/testSetup.ts`: same happy-dom register/`afterAll`-
  unregister approach as `packages/react/src/testSetup.ts` (duplicated,
  not shared cross-package, per that package's own established Context
  reasoning).
- Root `tsconfig.json`'s `"paths"` map gains
  `"@typetrack/vue": ["./packages/vue/src/index.ts"]` (needed by issue
  002's `packages/nuxt`, ahead of `packages/vue` ever being built —
  mirrors the existing `"@typetrack/react"` entry's exact purpose).
- `.github/workflows/qa.yml`'s Build step also runs `bun run build`
  inside `packages/vue`, after `packages/react`/`packages/next` (no
  ordering dependency on either, but placed after them in the file for
  readability — before `packages/nuxt`, which issue 002 will add
  immediately after it).

## Test requirements

Both unit and integration tests are required; neither substitutes for
the other.

**Unit:**
- `useAnalytics()` throws (not returns `undefined`/a no-op) when called
  with no ancestor app-level `app.use(typetrackPlugin, ...)` installed —
  assert the thrown error's message identifies the missing-plugin
  condition. (Since `inject()` outside any component context also throws
  its own Vue-runtime error, this test must exercise `useAnalytics()`
  from *inside* a real component's `setup()`, via `@vue/test-utils`, with
  the plugin simply never installed on that component's own test `app` —
  not by calling `useAnalytics()` at raw module scope, which would
  conflate two different failure modes.)
- A typecheck-level check (not a `bun test` runtime assertion, mirroring
  `packages/react/src/useAnalytics.test.ts`'s own precedent exactly): a
  test source file calling `useAnalytics<MyTestEvents>()` inside a
  typed context and asserting the returned value's `.track()` call
  accepts/rejects payloads per `MyTestEvents`, relying on `bun run
  typecheck`/`typecheck:tsc` (already run in CI) to catch a genericity
  regression.

**Integration** (real mounting via `@vue/test-utils`, not just direct
function calls):
- Mount a consumer component (via `@vue/test-utils`'s `mount()`, passing
  `global: { plugins: [[typetrackPlugin, { analytics: fakeAnalytics }]]
  }`) that calls `useAnalytics()` in its own `setup()` and invokes
  `track`/`identify`/`page`/`flush` (e.g. via button click handlers
  triggered with `wrapper.find(...).trigger("click")`); assert the
  `fakeAnalytics` mock functions were called with the expected
  arguments.
- Mount the same consumer component **without** the plugin installed and
  assert the mount throws the expected error (Vue surfaces a `setup()`
  throw as a thrown error from `mount()` itself, or via `errorCaptured`/
  a synchronous throw depending on `@vue/test-utils`'s current behavior
  — implementor verifies and documents which, then asserts accordingly).
- Full `bun test` from the repo root (matching current CI invocation)
  passes in full, including every pre-existing test file — confirming
  this package's happy-dom register/unregister does not leak DOM globals
  into unrelated test files run in the same process.

## Out of scope

- `@typetrack/nuxt` and any Nuxt-specific behavior (module registration,
  SSR wiring, automatic route-change tracking) — issue 002.
- Any `.vue` SFC/component in this package (see Context — deliberately
  none needed).
- Any change to core `src/` — this package only consumes `Analytics`/
  `EventMap`.
- Support for Vue 2, or the Options API.
- Vue Router integration of any kind (that belongs to `@typetrack/nuxt`,
  or a future dedicated issue if a plain-Vue-Router — non-Nuxt — package
  is ever prioritized; not scoped here).
- Reactive/shared-state patterns (Pinia-style) — this package's only
  concern is exposing one stable, non-reactive `Analytics` instance.
