// `@typetrack/astro`: an Astro Integration-API package (`astro:config:
// setup` + `injectScript`), not a context/hook package -- see this
// package's own issue file (`plan/phase-14-framework-wrappers/
// 005-astro-integration.md`) and the phase BRIEF's Design decision 6 for
// the full "why" (Astro ships zero client JS by default -- islands
// architecture -- so there is no persistent, app-wide component tree of
// the kind React/Vue/Svelte/Solid all have for a context/hook pattern to
// attach to).
//
// **The config-time/runtime-boundary problem** (see BRIEF.md's Design
// decision 5, shared with issue 002's `@typetrack/nuxt` module): this
// package's `astro:config:setup` hook runs once, in Node, at Astro build/
// dev-server config time -- it cannot hold a live `Analytics` instance.
// This is why `TypetrackAstroOptions` requires `analyticsModule: string`
// (an import specifier resolving to an app-authored file that constructs
// `createAnalytics(...)` and default-exports the resulting instance)
// rather than an `analytics: Analytics` option -- see
// `buildPageLoadScript.ts`'s own header comment for how that specifier is
// woven into the injected script's static `import` statement.
import type { AstroIntegration, HookParameters } from "astro";
import { buildPageLoadScript } from "./buildPageLoadScript";

export interface TypetrackAstroOptions {
  // Required (not optional) -- mirrors every other package's own
  // required-config contract in this phase (e.g. `@typetrack/nuxt`'s own
  // identically-named, identically-required option). An import specifier
  // (bare package specifier, root-relative path like `/src/lib/
  // analytics.ts`, or any other path shape Astro's own Vite pipeline can
  // resolve) pointing at an app-authored file that constructs
  // `createAnalytics(...)` and default-exports the resulting instance.
  analyticsModule: string;
  // Gates the `injectScript`-based automatic pageview-tracking script.
  // Defaults to `true`.
  autoPageViews?: boolean;
}

// Returns an object implementing Astro's `AstroIntegration` type: a
// `name` plus a `hooks["astro:config:setup"]` handler that injects
// `buildPageLoadScript`'s output at the `"page"` stage (processed &
// resolved by Vite, per Astro's own `InjectedScriptStage` doc comment)
// when `autoPageViews` is enabled (default `true`).
//
// Validates `analyticsModule` eagerly, at call time -- not lazily inside
// the `astro:config:setup` handler -- so a misconfigured
// `typetrack: typetrackAstro({...})` line in `astro.config.mjs` fails
// loudly and immediately, before Astro ever invokes any hook.
export default function typetrackAstro(options: TypetrackAstroOptions): AstroIntegration {
  if (!options.analyticsModule) {
    throw new Error(
      '@typetrack/astro requires a non-empty "analyticsModule" option -- an import specifier ' +
        "(e.g. \"/src/lib/analytics.ts\") resolving to an app-authored file that constructs " +
        "createAnalytics(...) and default-exports the resulting instance. Example: " +
        'typetrackAstro({ analyticsModule: "/src/lib/analytics.ts" }) in astro.config.mjs\'s ' +
        "integrations array.",
    );
  }

  return {
    name: "@typetrack/astro",
    hooks: {
      "astro:config:setup"(params: HookParameters<"astro:config:setup">) {
        if (options.autoPageViews ?? true) {
          params.injectScript("page", buildPageLoadScript(options.analyticsModule));
        }
      },
    },
  };
}
