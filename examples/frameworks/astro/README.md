# frameworks/astro

A minimal, realistic Astro app layout using `@typetrack/astro` (issue 005's
Integration-API package): registers the integration in `astro.config.mjs`,
points it at an app-authored `analytics.ts` file (the `analyticsModule`
option), and gets automatic pageview tracking on every page load and every
subsequent View-Transitions navigation (`astro:page-load`, `autoPageViews`,
default `true`) -- plus a `signup.astro` page demonstrating a custom event
(`identify()` + `track("User Signed Up", ...)`) fired from a plain
client-side `<script>`.

## Testing

**Not exercised by this repo's own CI/`bun test` suite.** Per
`plan/phase-14-framework-wrappers/BRIEF.md`'s Design decision 8 (extending
`plan/phase-13-runtime-agnostic/BRIEF.md`'s decision 5's own "no new heavy
per-framework dev/build CLI" reasoning to this phase's meta-frameworks),
this repo does not add `astro` (or any Astro-specific tooling) as a
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

- Node.js and a real Astro 6/7 project, set up by *you*, in *your own*
  project -- not by this repo (`npm create astro@latest`, or add Astro to an
  existing project).
- `@typetrack/astro`, `typetrack`, and `@typetrack/provider-ga4` installed
  as dependencies (`npm install @typetrack/astro typetrack
  @typetrack/provider-ga4`).
- A real GA4 property's Measurement ID and API secret (Google Analytics
  Admin -> Data Streams -> your stream -> Measurement Protocol API secrets),
  set as `PUBLIC_GA4_MEASUREMENT_ID`/`PUBLIC_GA4_API_SECRET` (Astro's
  `PUBLIC_`-prefix convention for client-exposed env vars).

## How to run

Copy `astro.config.mjs`'s `integrations` line, `src/lib/analytics.ts`,
`src/layouts/Layout.astro`, and `src/pages/signup.astro` into your own
Astro project, then:

```sh
# Local dev server:
astro dev

# Production build + preview:
astro build
astro preview
```

## Source

`astro.config.mjs` registers the integration and points it at this app's
own analytics file:

```js
export default defineConfig({
  integrations: [
    typetrackAstro({
      analyticsModule: "/src/lib/analytics.ts",
      autoPageViews: true,
    }),
  ],
});
```

`src/lib/analytics.ts` constructs and default-exports the real `Analytics`
instance -- both `@typetrack/astro`'s own injected pageview script and this
example's own `signup.astro` client script statically `import` this exact
file:

```ts
export default createAnalytics({
  provider: createGA4Provider({
    measurementId: import.meta.env.PUBLIC_GA4_MEASUREMENT_ID,
    apiSecret: import.meta.env.PUBLIC_GA4_API_SECRET,
  }),
});
```

`src/pages/signup.astro`'s plain client `<script>` imports it directly (no
framework/context/hook involved -- Astro ships zero client JS by default,
so there is no persistent component tree for a hook pattern to attach to):

```ts
import analytics from "../lib/analytics";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void analytics.identify(email, { plan: "free", source: "signup_form" });
  void analytics.track("User Signed Up", { plan: "free" });
});
```

## Explanation

- **Install (config-time)**: `typetrackAstro({ analyticsModule })` is
  validated eagerly, at `astro.config.mjs` load time -- a misconfigured
  option fails loudly before Astro ever invokes any build hook.
  `analyticsModule` is an import specifier, not a live `Analytics`
  instance, for the same config-time/browser-bundle-boundary reason
  `@typetrack/nuxt`'s identically-named option exists (see
  `packages/astro/src/index.ts`'s own header comment).
- **SSR/CSR + automatic pageview tracking**: `astro:config:setup`'s
  `injectScript("page", ...)` embeds a small script into every page's
  bundle, containing a static `import analytics from "/src/lib/
  analytics.ts"` plus a `document.addEventListener("astro:page-load", ...)`
  listener that calls core's own `dispatchPageView()` -- the same
  dedup-aware helper every other framework's route-tracking piece in this
  phase reuses. `astro:page-load` fires once on Astro's default full-MPA
  initial load (and again naturally per real navigation, since each is a
  fresh page load) *and* on every subsequent View-Transitions/ClientRouter
  navigation if this app opts into that -- one listener covers both modes.
- **Custom events (this page's own sign-up flow)**: no context/hook
  pattern exists to opt into (Astro's islands architecture has no
  persistent app-wide component tree) -- a plain client `<script>`
  importing the same `analyticsModule` directly is the idiomatic way to
  fire a custom event from an Astro page, exactly like the injected
  pageview script itself does.
- **Hydration**: not a meaningful concept here the way it is for
  React/Vue/Svelte/Solid -- Astro's own islands opt into client JS
  individually (`client:load`/`client:idle`/etc.) per-component, and this
  example's own plain `<script>` has no server-rendered state to reconcile
  against at all (it only wires up a `submit` listener after the page's
  static HTML is already in the DOM).

## Production notes

- **`analyticsModule` must resolve on both the server-rendered page bundle
  and the client-side injected script bundle.** `/src/lib/analytics.ts`
  (root-relative, resolved by Astro's own Vite pipeline) works for both
  automatically.
- **`PUBLIC_`-prefixed env vars are exposed to the client bundle** by
  Astro's own convention -- the same public/scoped-secret consideration
  `../nuxt`'s own Production notes call out for GA4's Measurement Protocol
  applies here too.
- **`autoPageViews: false`** if a route-change event stream would double up
  with a different pageview strategy this app already has in place.
