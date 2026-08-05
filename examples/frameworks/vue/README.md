# frameworks/vue

Demonstrates `@typetrack/vue` (the `typetrackPlugin` + `useAnalytics()`
composable pair) with a small, realistic `SignUpForm` component: on submit,
it calls `analytics.identify(email, ...)` followed by
`analytics.track("User Signed Up", { plan: "free" })` against a
hand-written stub `AnalyticsProvider` -- never live vendor infrastructure.

**Genuinely tested in this repo**, unlike [`../nuxt`](../nuxt),
[`../astro`](../astro), and [`../remix`](../remix) -- see
[`../README.md`](../README.md) for the full tested-vs-source-only split
this directory is part of.

## Prerequisites

- Bun installed (this repo's own toolchain, per `CLAUDE.md`).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack`/`@typetrack/vue` packages via
  `file:../../..`/`workspace:*`, not published npm versions).

## How to run

```sh
cd examples/frameworks/vue
bun run index.ts
```

Run the tests:

```sh
cd examples/frameworks/vue
bun test
```

## Source

`SignUpForm.ts` is written with Vue's plain `h()` render-function API, not a
`.vue` SFC -- deliberate, matching `@typetrack/vue`'s own design (Design
decision 2, `plan/phase-14-framework-wrappers/BRIEF.md`): the plugin +
composable pair needs no SFC/template compiler at all, so this example needs
none either. A real app is equally free to author the same logic as a `.vue`
SFC -- `useAnalytics()` works identically either way, called from inside
`setup()`:

```ts
setup() {
  const analytics = useAnalytics<SignUpEvents>();

  function handleSubmit(event: Event) {
    event.preventDefault();
    const email = emailInput.value?.value ?? "";
    if (!isValidSignUpEmail(email)) return;

    void analytics.identify(email, buildIdentifyTraits({ email, plan: "free" }));
    void analytics.track("User Signed Up", buildUserSignedUpProperties({ email, plan: "free" }));
  }

  return () => h("form", { onSubmit: handleSubmit }, [...]);
}
```

The plugin itself is installed once, at the app root:

```ts
const app = createSSRApp({ render: () => h(SignUpForm) });
app.use(typetrackPlugin, { analytics });
```

`formLogic.ts` holds this example's pure, non-trivial logic (payload
shaping, email validation) -- see `formLogic.test.ts` for its isolated unit
tests. `stubProvider.ts` is a hand-written `AnalyticsProvider` (mirrors
`examples/providers/multi-provider-routing/index.ts`'s own
`makeStubProvider()` convention) recording every call it receives, passed to
a real `createAnalytics({ provider })` -- so this example exercises the real
end-to-end call path (`typetrackPlugin` install -> `useAnalytics()` ->
`analytics.track()`/`identify()` -> core's own dispatch logic ->
`provider.track()`/`identify()`), never a mocked `Analytics` object.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full, fully
deterministic literal capture of `bun run index.ts`'s output (SSR-rendering
`<SignUpForm>` via `@vue/server-renderer`'s `renderToString()`).

## Explanation

- **CSR** (`index.integration.test.ts`): mounts `<SignUpForm>` via
  `@vue/test-utils`' `mount()` against happy-dom, with `typetrackPlugin`
  installed carrying a stub-provider-backed `Analytics` instance. Filling in
  the email input and submitting the form calls `identify()` then
  `track("User Signed Up", ...)`, asserted against the stub provider's
  recorded call log -- genuinely exercised, not stubbed at the Vue/DOM
  layer. Submitting with an invalid email fires no calls at all. Mounting
  with no ancestor `app.use(typetrackPlugin, ...)` throws
  `@typetrack/vue`'s own descriptive error.
- **SSR** (`index.ts`'s `renderSignUpFormToString()`, also exercised
  directly by `index.integration.test.ts`): a plain function call to
  `@vue/server-renderer`'s `renderToString()`, no dev server -- confirms the
  `typetrackPlugin`-wrapped component tree renders successfully server-side
  with no browser-global crash, leaning on `createAnalytics()`'s own
  already-verified SSR-safety (Phase 9/13). The stub provider receives zero
  calls during SSR, since no user interaction ever happens during a server
  render -- exactly what a real app should expect too.
- **Hydration**: a real app's client entry point constructs the *same*
  `Analytics` instance shape on both the SSR and CSR/hydration code paths
  (typically via one shared `createAnalytics()` call in a module both
  `entry-server.ts` and `entry-client.ts` import), then calls
  `app.use(typetrackPlugin, { analytics })` identically on both sides before
  `createSSRApp(...).mount(...)`/hydrating. A stable `Analytics` instance
  across both is required so `useAnalytics()` resolves to the same
  logical service (same `anonymousId`, same provider connections) once
  hydration completes -- constructing two independent instances (one
  server-side, one client-side) would silently orphan whichever one the
  server-rendered markup was generated against.

## Production notes

- **Swap the stub provider for a real one.** This example's `stubProvider.ts`
  only records calls and never talks to real vendor infrastructure -- swap
  `createStubProvider()`'s `provider` for a real `@typetrack/provider-*`
  adapter (e.g. `createGA4Provider(...)`) in production.
- **Install the plugin once, at the app root** (`app.use(typetrackPlugin, {
  analytics })`), not per-component -- `provide`/`inject` only needs to
  happen once for every descendant `useAnalytics()` call to resolve.
- **No bundler-specific build step is required** for `@typetrack/vue`
  itself: it ships plain ESM/CJS (`packages/vue/package.json`'s own
  `exports` map), no SFC/template compilation involved, so it works with
  any Vue 3 build tooling (Vite, webpack, esbuild) unmodified.
