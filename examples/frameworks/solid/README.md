# frameworks/solid

Demonstrates `@typetrack/solid` (the `<AnalyticsProvider>` component +
`useAnalytics()` hook pair) with a small, realistic `SignUpForm` component:
on submit, it calls `analytics.identify(email, ...)` followed by
`analytics.track("User Signed Up", { plan: "free" })` against a
hand-written stub `AnalyticsProvider` -- never live vendor infrastructure.

**Genuinely tested in this repo**, unlike [`../nuxt`](../nuxt),
[`../astro`](../astro), and [`../remix`](../remix) -- see
[`../README.md`](../README.md) for the full tested-vs-source-only split
this directory is part of.

## Prerequisites

- Bun installed (this repo's own toolchain, per `CLAUDE.md`).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack`/`@typetrack/solid` packages via
  `file:../../..`/`workspace:*`, not published npm versions).

## How to run

```sh
cd examples/frameworks/solid
bun run index.ts
```

Run the tests:

```sh
cd examples/frameworks/solid
bun test
```

(`bun test` alone, without `--conditions=browser`, will fail this package's
CSR tests -- see `package.json`'s own `"test"` script, and the "Explanation"
section below for why.)

## Source

`SignUpForm.tsx` reads `useAnalytics()` directly in the component body (a
plain call, not inside a lifecycle hook -- Solid components run once, not
per-render):

```tsx
export function SignUpForm() {
  const analytics = useAnalytics<SignUpEvents>();
  let emailInput: HTMLInputElement | undefined;
  const [submitted, setSubmitted] = createSignal(false);

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const email = emailInput?.value ?? "";
    if (!isValidSignUpEmail(email)) return;

    void analytics.identify(email, buildIdentifyTraits({ email, plan: "free" }));
    void analytics.track("User Signed Up", buildUserSignedUpProperties({ email, plan: "free" }));
    setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input ref={emailInput} type="email" name="email" placeholder="you@example.com" />
      <button type="submit">Sign up</button>
      {submitted() ? <p class="confirmation">Thanks for signing up!</p> : null}
    </form>
  );
}
```

The provider is installed once, wrapping the tree:

```tsx
<AnalyticsProvider analytics={analytics}>
  <SignUpForm />
</AnalyticsProvider>
```

`formLogic.ts` holds this example's pure, non-trivial logic (payload
shaping, email validation) -- see `formLogic.test.ts` for its isolated unit
tests. `stubProvider.ts` is a hand-written `AnalyticsProvider` (mirrors
`examples/providers/multi-provider-routing/index.ts`'s own
`makeStubProvider()` convention) recording every call it receives, passed to
a real `createAnalytics({ provider })` -- so this example exercises the real
end-to-end call path, never a mocked `Analytics` object.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full, fully
deterministic literal capture of `bun run index.ts`'s output (SSR-rendering
`<SignUpForm>` via `solid-js/web`'s `renderToString()`).

## Explanation

- **CSR** (`SignUpForm.integration.test.ts`): renders `<AnalyticsProvider>
  <SignUpForm /></AnalyticsProvider>` via `@solidjs/testing-library`'s
  `render()` against happy-dom. Filling in the email input and submitting
  the form calls `identify()` then `track("User Signed Up", ...)`, asserted
  against the stub provider's recorded call log -- genuinely exercised, not
  stubbed at the Solid/DOM layer. Rendering `<SignUpForm />` with no
  ancestor `<AnalyticsProvider>` throws `@typetrack/solid`'s own descriptive
  error.
- **SSR** (`index.ts`'s `renderSignUpFormToString()`, also exercised
  directly by `index.integration.test.ts`, kept in its own file -- see below
  for why): a plain function call to `solid-js/web`'s `renderToString()`, no
  dev server -- confirms the `AnalyticsProvider`-wrapped component tree
  renders successfully server-side with no browser-global crash, leaning on
  `createAnalytics()`'s own already-verified SSR-safety (Phase 9/13). The
  stub provider receives zero calls during SSR, since no user interaction
  ever happens during a server render.
- **Why CSR and SSR live in separate test files**: registering happy-dom's
  DOM globals (required for the CSR test) makes `solid-js/web` treat the
  process as a real browser environment and refuse to run
  `renderToString()` at all ("renderToString is not supported in the
  browser", verified by hand) -- the two concerns cannot coexist in one
  `bun test` file, so `index.integration.test.ts` (SSR) and
  `SignUpForm.integration.test.ts` (CSR) are kept apart.
- **Why the SSR path uses an explicit deep `solid-js/web/dist/server.js`
  import, not the plain `solid-js/web` specifier**: this repo's own root
  `bun test` runs with `--conditions=browser` set process-wide (required for
  `@typetrack/svelte`'s own tests). `solid-js/web`'s `package.json`
  `"exports"` map lists its `"browser"` condition ahead of `"node"`/the
  unconditional default, so with that flag active the plain `"solid-js/web"`
  specifier resolves to the *client* build everywhere in this shared
  process -- including here, where SSR needs the *server* build
  specifically. `index.ts` and `compileForServer.ts` (via
  `babel-preset-solid`'s own `moduleName` option) both import the explicit,
  condition-immune `"solid-js/web/dist/server.js"` subpath instead, which
  Solid's own `package.json` exports as an unconditional wildcard.
  `SignUpForm.tsx`'s own compiled-for-CSR output (`./solidJsxPlugin.ts`)
  does not need this -- `@solidjs/testing-library`'s CSR tests need the
  *client* build, which the plain specifier already resolves to correctly
  once `--conditions=browser` is set.
- **Why SSR needs a separate compile pass from CSR at all**
  (`./compileForServer.ts`): a component that renders real markup (unlike
  `@typetrack/solid`'s own `AnalyticsProvider`, which renders no template of
  its own and is genuinely isomorphic) compiles, under `generate: "dom"`
  (the mode both `./solidJsxPlugin.ts` and `@typetrack/solid`'s own
  published dist use), into calls against `solid-js/web`'s `template()`/
  `insert()`/`use()` -- all three literal `notSup()` stubs on
  `solid-js/web`'s server build (verified by hand). `generate: "ssr"`
  compiles the same JSX into `ssr()`/`escape()` calls instead, genuinely
  implemented server-side. `./compileForServer.ts` performs this
  server-targeted recompilation of `SignUpForm.tsx`'s real, unmodified
  source directly (mirroring what a real SolidStart/Vite build does via
  `vite-plugin-solid`, per-target, automatically), since this repo's own
  `bun run`/`bun test` have no bundler-driven "which target am I building
  for" signal to key off.
- **Hydration**: a real app's client entry point constructs the *same*
  `Analytics` instance shape on both the SSR and CSR/hydration code paths
  (typically via one shared `createAnalytics()` call a SolidStart
  `entry-server.tsx`/`entry-client.tsx` both import), then wraps the tree in
  `<AnalyticsProvider analytics={analytics}>` identically on both sides
  before `hydrate(...)`/`render(...)`. A stable `Analytics` instance across
  both is required so `useAnalytics()` resolves to the same logical service
  (same `anonymousId`, same provider connections) once hydration completes.

## Production notes

- **Swap the stub provider for a real one.** This example's `stubProvider.ts`
  only records calls and never talks to real vendor infrastructure -- swap
  `createStubProvider()`'s `provider` for a real `@typetrack/provider-*`
  adapter (e.g. `createGA4Provider(...)`) in production.
- **A real SolidStart/Vite app never needs this example's own
  `compileForServer.ts` workaround.** `vite-plugin-solid` recompiles a
  project's own `.tsx` source per target (client vs. server) automatically,
  driven by which bundle it's building -- this example's manual, per-target
  `babel-preset-solid` recompilation only exists because this repo's own
  `bun run`/`bun test` have no bundler in the loop at all.
- **`@typetrack/solid`'s own package ships a dedicated `"solid"` export
  condition** (`packages/solid/package.json`'s `exports["."]"`) pointing at
  raw, uncompiled JSX (`dist/index.jsx`) specifically so SolidStart/
  `vite-plugin-solid`-aware tooling can recompile it per target -- unlike
  this example's own `SignUpForm.tsx` (application code, compiled once by
  whatever the app's own bundler does with it), a real app never touches
  `@typetrack/solid`'s dist directly; its bundler resolves the right variant
  automatically.
