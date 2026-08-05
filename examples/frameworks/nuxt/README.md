# frameworks/nuxt

A minimal, realistic Nuxt 4 app layout using `@typetrack/nuxt` (issue 002's
module): registers the module, points it at an app-authored
`analytics.ts` file (the `analyticsModule` option), and gets automatic
route-change pageview tracking (`autoPageViews`, default `true`) plus
`useAnalytics()` auto-imported into every component -- demonstrated here
via a small `signup.vue` page firing `identify()` + `track("User Signed
Up", ...)` on submit.

## Testing

**Not exercised by this repo's own CI/`bun test` suite.** Per
`plan/phase-14-framework-wrappers/BRIEF.md`'s Design decision 8 (extending
`plan/phase-13-runtime-agnostic/BRIEF.md`'s decision 5's own "no new heavy
per-framework dev/build CLI" reasoning to this phase's meta-frameworks),
this repo does not add `nuxi` (or any Nuxt-specific tooling) as a
devDependency anywhere in the monorepo (`CLAUDE.md`: "toolchain is
devDependencies only: Bun/tsgo/typescript/oxlint/Knip/tsup"). Nothing in
this directory is installed, type-checked, or run by `bun install`/`bun
test`/`bun run typecheck` at the repo root -- a passing `bun test` at the
repo root proves nothing about whether this app actually runs. See
[`../README.md`](../README.md) for the full tested-vs-source-only split
this directory is part of (contrast with [`../vue`](../vue),
[`../svelte`](../svelte), [`../solid`](../solid), which genuinely are
tested here).

## Prerequisites

- Node.js and a real Nuxt 4 project, set up by *you*, in *your own* project
  -- not by this repo (`npx nuxi@latest init my-app`, or add Nuxt to an
  existing project).
- `@typetrack/nuxt`, `@typetrack/vue`, `typetrack`, and
  `@typetrack/provider-ga4` installed as dependencies (`npm install
  @typetrack/nuxt @typetrack/vue typetrack @typetrack/provider-ga4`).
- A real GA4 property's Measurement ID and API secret (Google Analytics
  Admin -> Data Streams -> your stream -> Measurement Protocol API secrets),
  set as `NUXT_PUBLIC_GA4_MEASUREMENT_ID`/`NUXT_PUBLIC_GA4_API_SECRET`.

## How to run

Copy `nuxt.config.ts`'s `modules`/`typetrack` lines, `app/analytics.ts`, and
`app/pages/signup.vue` into your own Nuxt project, then:

```sh
# Local dev server:
nuxi dev

# Production build + preview:
nuxi build
nuxi preview
```

## Source

`nuxt.config.ts` registers the module and points it at this app's own
analytics file:

```ts
export default defineNuxtConfig({
  modules: ["@typetrack/nuxt"],
  typetrack: {
    analyticsModule: "~/analytics",
    autoPageViews: true,
  },
});
```

`app/analytics.ts` constructs and default-exports the real `Analytics`
instance -- `@typetrack/nuxt`'s generated runtime plugin statically imports
this exact file (see that file's own header comment for why it must be a
module path, not a live instance passed directly in config):

```ts
export default createAnalytics({
  provider: createGA4Provider({
    measurementId: process.env.NUXT_PUBLIC_GA4_MEASUREMENT_ID!,
    apiSecret: process.env.NUXT_PUBLIC_GA4_API_SECRET!,
  }),
});
```

`app/pages/signup.vue` uses the auto-imported `useAnalytics()` composable
(no explicit import needed in a real Nuxt app -- `@typetrack/nuxt`'s module
registers it via `@nuxt/kit`'s `addImports`):

```vue
<script setup lang="ts">
const analytics = useAnalytics<SignUpEvents>();

function handleSubmit() {
  void analytics.identify(email.value, { plan: "free", source: "signup_form" });
  void analytics.track("User Signed Up", { plan: "free" });
}
</script>
```

## Explanation

- **Install (config-time)**: `typetrack.analyticsModule` is a Nuxt-alias-
  resolvable path, not a live `Analytics` instance -- `@typetrack/nuxt`'s
  `setup()` runs once, in Node, at build/dev-server config time, which
  cannot hand a live object across the config-time/browser-bundle boundary.
  The module instead generates a template statically re-exporting
  `app/analytics.ts`'s own default export, aliased to
  `#typetrack/analytics-module`, which its runtime plugin imports.
- **SSR**: the generated runtime plugin (`packages/nuxt/src/runtime/
  plugin.ts`) runs identically on server and client (no `.client`/`.server`
  suffix) -- `app.provide()` itself is not browser-dependent, so
  `useAnalytics()` resolves correctly during Nuxt's server render too.
- **CSR + route-change tracking**: a second, genuinely client-only plugin
  (`runtime/pageview.client.ts`, gated on `autoPageViews`) fires one initial
  `.page()` call for the current route, then registers `vue-router`'s
  `afterEach()` for every subsequent client-side navigation -- both
  delegate to core's own `dispatchPageView()` (the same dedup-aware helper
  every other framework's route-tracking piece in this phase reuses).
- **Hydration**: since the same `app/analytics.ts` module (and therefore
  the same constructed `Analytics` instance shape) is imported by both the
  server and client runtime plugin, `useAnalytics()` resolves consistently
  across the SSR-to-CSR hydration boundary with no extra wiring needed.

## Production notes

- **`analyticsModule` must resolve on both server and client bundles.**
  `~/analytics` (Nuxt's own `srcDir`-relative alias, `app/` by default in
  Nuxt 4) works for both automatically -- a path escaping the app's own
  bundled source (e.g. reaching outside `app/`/`node_modules`) may not.
- **GA4 credentials are public**, unlike `../nuxt`'s Cloudflare-Worker-y
  counterparts' server-only secrets -- GA4's Measurement Protocol is
  designed for client-callable use, but the `apiSecret` above should still
  be scoped narrowly (a dedicated Measurement Protocol API secret, not a
  general Google Cloud credential) and rotated if ever exposed unexpectedly.
- **`autoPageViews: false`** if a route-change event stream would double up
  with a different pageview strategy this app already has in place (e.g. a
  provider with its own automatic SPA route tracking).
