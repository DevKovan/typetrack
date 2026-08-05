# frameworks/svelte

Demonstrates `@typetrack/svelte` (the `<AnalyticsProvider>` component +
`useAnalytics()` composable pair) with a small, realistic `SignUpForm`
component: on submit, it calls `analytics.identify(email, ...)` followed by
`analytics.track("User Signed Up", { plan: "free" })` against a
hand-written stub `AnalyticsProvider` -- never live vendor infrastructure.

**Genuinely tested in this repo**, unlike [`../nuxt`](../nuxt),
[`../astro`](../astro), and [`../remix`](../remix) -- see
[`../README.md`](../README.md) for the full tested-vs-source-only split
this directory is part of.

## Prerequisites

- Bun installed (this repo's own toolchain, per `CLAUDE.md`).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack`/`@typetrack/svelte` packages via
  `file:../../..`/`workspace:*`, not published npm versions).

## How to run

```sh
cd examples/frameworks/svelte
bun run index.ts
```

Run the tests:

```sh
cd examples/frameworks/svelte
bun test
```

(`bun test` alone, without `--conditions=browser`, will fail this package's
CSR tests -- see `package.json`'s own `"test"` script.)

## Source

`SignUpForm.svelte` reads `useAnalytics()` directly in its `<script>` block
(a Svelte runtime constraint -- Context calls must happen during a
component's own synchronous initialization):

```svelte
<script lang="ts">
  import { useAnalytics, type EventMap } from "@typetrack/svelte";

  const analytics = useAnalytics<SignUpEvents>();
  let emailInput: HTMLInputElement | undefined;
  let submitted = $state(false);

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const email = emailInput?.value ?? "";
    if (!isValidSignUpEmail(email)) return;

    void analytics.identify(email, buildIdentifyTraits({ email, plan: "free" }));
    void analytics.track("User Signed Up", buildUserSignedUpProperties({ email, plan: "free" }));
    submitted = true;
  }
</script>

<form onsubmit={handleSubmit}>
  <input bind:this={emailInput} type="email" name="email" placeholder="you@example.com" />
  <button type="submit">Sign up</button>
  {#if submitted}<p class="confirmation">Thanks for signing up!</p>{/if}
</form>
```

The provider is installed once, wrapping the tree (`AppHarness.svelte`, this
example's small stand-in for a real app's root layout):

```svelte
<AnalyticsProvider {analytics}>
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
deterministic literal capture of `bun run index.ts`'s output.

## Explanation

- **CSR** (`SignUpForm.integration.test.ts`): renders `<AppHarness
  analytics={...}>` (which wraps `<AnalyticsProvider><SignUpForm />
  </AnalyticsProvider>`) via `@testing-library/svelte`'s `render()` against
  happy-dom. Filling in the email input and submitting the form calls
  `identify()` then `track("User Signed Up", ...)`, asserted against the
  stub provider's recorded call log -- genuinely exercised, not stubbed at
  the Svelte/DOM layer. Rendering `<SignUpForm />` with no ancestor
  `<AnalyticsProvider>` throws `@typetrack/svelte`'s own descriptive error.
- **SSR** (`index.ts`, exercised directly by `index.integration.test.ts`):
  two genuinely real, deterministic demonstrations, deliberately **not**
  routed through `@typetrack/svelte`'s own `AnalyticsProvider`/
  `useAnalytics()` -- see the two bullet points below for the real,
  verified-by-hand reasons why, and `./compileForServer.ts`'s own header
  comment for the full detail:
  1. `renderServerGreetingToString()`: a plain function call to
     `svelte/compiler`'s `compile(..., { generate: "server" })` (compiling
     `ServerGreeting.svelte`'s real, unmodified source for Svelte's server
     target) followed by `svelte/server`'s real `render()` -- no dev
     server. `ServerGreeting.svelte` receives a real, stub-provider-backed
     `Analytics` instance directly as a prop and fires
     `track("User Signed Up", ...)` during its own server render, with no
     browser-global crash.
  2. `runServerSideIdentifyAndTrack()`: `createAnalytics()` itself (core,
     already-verified SSR-safe since Phase 9/13) constructing an instance
     and calling `identify()`/`track()`/`flush()` directly -- no Svelte
     component, no Context, involved at all. This is what a real SvelteKit
     `+page.server.ts`/`hooks.server.ts` server action would do.
  - **Why not `AnalyticsProvider`/`useAnalytics()`, two real, current,
    verified-by-hand limitations of the shipped `@typetrack/svelte`
    package** (out of scope for this examples-only issue to fix):
    1. `@typetrack/svelte`'s own published `dist/index.js`
       (`packages/svelte/tsup.config.ts`'s documented default -- tsup's
       built-in `.svelte` esbuild plugin, `generate: "client"`) ships
       *precompiled client-mode-only* Svelte output. Server-rendering a
       component tree containing its `AnalyticsProvider` throws
       `ReferenceError: document is not defined` immediately -- a
       server-compiled parent calls children using a completely different
       calling convention than a client-compiled component expects; the
       two are not interoperable at all, by design.
    2. Separately: even `SignUpForm.svelte`'s own `useAnalytics()` call
       (which needs no precompiled dist at all) throws Svelte's own
       `lifecycle_outside_component` error instead of `useAnalytics()`'s
       own missing-provider error, specifically when run under this repo's
       *own* `bun test --conditions=browser` flag (required for this
       package's, and this example's, CSR tests). `useAnalytics()`
       (`packages/svelte/src/context.ts`) imports `getContext` from the
       *bare* `"svelte"` specifier, whose own `package.json` `"exports"`
       resolves `"browser"` (Svelte's client-mode entry) ahead of the
       unconditional default -- so with that flag active, `getContext`
       always resolves to Svelte's *client*-mode internal
       component-context tracking, even during a genuine server render
       performed via `svelte/server`'s correctly-server-resolved
       `render()`. The two internal trackers are for different, unrelated
       "current component" stacks, so client-resolved `getContext()`
       always sees "no active component" during an SSR pass, regardless of
       whether a real ancestor provider is present.
- **Hydration**: a real app's client entry point constructs the *same*
  `Analytics` instance shape on both the SSR and CSR/hydration code paths
  (typically via one shared `createAnalytics()` call a SvelteKit
  `hooks.server.ts`/root `+layout.svelte` and its client counterpart both
  reference), then wraps the tree in `<AnalyticsProvider analytics={...}>`
  identically on both sides. A stable `Analytics` instance across both is
  required so `useAnalytics()` resolves to the same logical service (same
  `anonymousId`, same provider connections) once hydration completes -- see
  the limitations above for why, as of this package's current shipped form,
  a real SvelteKit app should keep `<AnalyticsProvider>`-wrapped subtrees
  client-rendered-only (e.g. via SvelteKit's own `$app/environment`
  `browser` flag) until those are addressed upstream in `@typetrack/svelte`.

## Production notes

- **Swap the stub provider for a real one.** This example's `stubProvider.ts`
  only records calls and never talks to real vendor infrastructure -- swap
  `createStubProvider()`'s `provider` for a real `@typetrack/provider-*`
  adapter (e.g. `createGA4Provider(...)`) in production.
- **`@typetrack/svelte`'s own `.svelte` file has no dedicated typecheck
  coverage from this repo's own `tsc`/`tsgo`** (`.svelte` files are never
  matched by any `tsconfig.json` `include` glob) -- `packages/svelte`'s own
  `bun run typecheck:svelte` (`svelte-check`) is what actually verifies its
  `<script>` block. This example's own `.svelte` files (`SignUpForm.svelte`,
  `AppHarness.svelte`, `ServerGreeting.svelte`) inherit the same gap, an
  accepted, documented limitation shared with `packages/svelte` itself, not
  something this examples-only issue introduces.
- **Bundling notes**: `@typetrack/svelte` ships plain ESM/CJS
  (`packages/svelte/package.json`'s own `exports` map), compiled via tsup +
  its own built-in `.svelte` esbuild plugin -- any Svelte 5 build tooling
  (Vite, SvelteKit) consumes it unmodified for CSR use. See the
  "Explanation" section above for its current, real SSR limitations.
