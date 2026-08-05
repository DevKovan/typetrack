// `@typetrack/nuxt`'s `defineNuxtModule`: wires `@typetrack/vue`'s
// `typetrackPlugin`/`useAnalytics` into a Nuxt 4 app via `@nuxt/kit`, plus
// (by default) automatic pageview tracking on route change. See this
// package's issue file (`plan/phase-14-framework-wrappers/
// 002-nuxt-module-ssr-route-tracking.md`) for the full researched design.
//
// **The config-time/runtime-boundary problem**: this module's `setup()`
// runs once, in Node, at Nuxt build/dev-server config time -- it cannot
// hold a live `Analytics` instance and hand it to the generated client/
// server runtime bundle directly (different JS realms; a live object
// can't cross a Node-process/browser-bundle boundary, only source
// code/references can). This module therefore requires
// `options.analyticsModule: string`, a Nuxt-alias-resolvable path (e.g.
// `"~/app/analytics"`) to an app-authored file that itself constructs
// `createAnalytics(...)` and **default-exports** the resulting instance.
// `setupTypetrackModule()` below wires that path into a generated
// template (`addTemplate`) whose own contents are a static
// `export { default } from "<analyticsModule>"` re-export, then aliases
// that generated file to the stable specifier `ANALYTICS_MODULE_ALIAS`
// (`#typetrack/analytics-module`) -- `runtime/plugin.ts` and
// `runtime/pageview.client.ts` both statically `import analytics from
// "#typetrack/analytics-module"`, so the live object is constructed only
// once the actual client/server runtime bundle executes that import,
// never inside `setup()` itself.
//
// **A documented deviation from this issue's own planning doc**: the plan
// doc (and this phase's BRIEF.md) describe the alias step as using
// `@nuxt/kit`'s `addTemplate`/`addAlias` together. Verified by directly
// reading `@nuxt/kit@4.5.1`'s shipped `.d.mts` (not assumed): there is no
// `addAlias` export in the current `@nuxt/kit` API -- the planning doc's
// mention of one didn't survive contact with the actual current package.
// The real, current mechanism real published Nuxt modules use for exactly
// this "alias a generated template to a stable import specifier" case is
// writing directly into `nuxt.options.alias` (a real, documented
// `NuxtOptions` field, `Record<string, string>`) -- which is what
// `setupTypetrackModule` does below, using the `dst` (resolved output
// path) of the `addTemplate()`-generated file.
//
// **Testability / dependency-injection factoring**: real `@nuxt/kit`
// functions (`addPlugin`/`addTemplate`/`addImports`) read Nuxt's *ambient*
// module-authoring context via `unctx`, populated only while a real Nuxt
// build/dev-server is actually running `defineNuxtModule`'s `setup()` --
// calling them directly from a `bun test` process (no real Nuxt instance
// ever running) throws `NUXT_B8001: The active Nuxt instance is
// unavailable in the current context` (verified by hand). This repo's own
// established policy is to never `mock.module()` a vendor SDK in tests
// (leaks cross-file in Bun's shared test process -- see this repo's own
// git history), so `@nuxt/kit`'s ambient-context functions can't be
// stubbed that way either. `setupTypetrackModule` therefore takes this
// functions subset as an explicit, injectable `ModuleKit` parameter
// (defaulting to the real `@nuxt/kit` functions for actual Nuxt use) --
// `module.test.ts` passes hand-written spies instead of a real Nuxt
// instance, satisfying this issue's "called directly (not through a real
// Nuxt build), spied addPlugin/addImports/addTemplate" test requirement.
// `@nuxt/schema` is a direct devDependency of this package (verified by
// hand, not merely a transitive one) even though it's only ever
// `import type`-ed below: `@nuxt/kit`'s own shipped `.d.mts` re-exports
// `Nuxt`/`NuxtModule` from `@nuxt/schema`, but doesn't itself depend on it
// as a real (non-dev) dependency -- and in this repo's Bun-workspace
// `node_modules` layout (unlike a flat/hoisted npm install), `@nuxt/schema`
// isn't otherwise directly resolvable from `packages/nuxt/node_modules`,
// which both `tsc`/`tsgo`'s type-checking AND (more strictly) `tsup`'s own
// `.d.ts`-bundling step for `dist/index.d.ts` (which re-exports
// `ModuleOptions`, transitively referencing `Nuxt`) both need.
import { addImports, addPlugin, addTemplate, createResolver, defineNuxtModule } from "@nuxt/kit";
import type { Nuxt, NuxtModule } from "@nuxt/schema";

export interface ModuleOptions {
  // Required (not optional) -- mirrors `AnalyticsProvider`'s required
  // `analytics` prop across every other package in this phase: a
  // Nuxt-alias-resolvable path (e.g. `"~/app/analytics"`, or a bare
  // package specifier) to an app-authored file that default-exports a
  // `createAnalytics(...)`-constructed `Analytics` instance.
  analyticsModule: string;
  // Gates the client-only automatic pageview-tracking plugin
  // (`runtime/pageview.client.ts`). Defaults to `true`.
  autoPageViews?: boolean;
}

// The `@nuxt/kit` functions `setupTypetrackModule` calls -- see this
// file's header comment for why this is an injectable parameter rather
// than calling `@nuxt/kit`'s free functions directly.
export interface ModuleKit {
  addPlugin: typeof addPlugin;
  addTemplate: typeof addTemplate;
  addImports: typeof addImports;
}

const defaultKit: ModuleKit = { addPlugin, addTemplate, addImports };

// The stable import specifier every `runtime/*.ts` file statically imports
// the app-supplied `analyticsModule` through. Exported so `module.test.ts`
// can assert against it directly instead of hard-coding the literal string
// a second time.
export const ANALYTICS_MODULE_ALIAS = "#typetrack/analytics-module";

// Resolves paths relative to *this file's* own location (`import.meta.url`)
// -- safe to call unconditionally at module scope, even outside a real
// Nuxt build: unlike `addPlugin`/`addTemplate`/`addImports`,
// `createResolver()` is pure path arithmetic and reads no ambient Nuxt
// context (verified by hand).
//
// Known, documented gap: `import.meta.url` has no CJS equivalent, so
// `tsup`'s CJS build (`dist/index.cjs`, this package's own `"main"`/
// `"require"` export condition) emits an empty value for it (a build-time
// warning, verified by hand: "'import.meta' is not available with the
// 'cjs' output format and will be empty") -- `createResolver(undefined)`
// would then throw immediately at module-evaluation time for any consumer
// that somehow `require()`s this package instead of `import`-ing it. In
// practice this is unreachable: real Nuxt apps load `nuxt.config.ts`'s
// `modules` array (which is what would import this package) exclusively
// via Nuxt's own ESM-aware loader, never CommonJS `require()`. Not worked
// around with an `import.meta.url` CJS shim here, deliberately -- doing so
// would add real complexity to work around a code path this package's own
// real consumers structurally cannot reach, and the failure mode if
// somehow reached is a loud, immediate throw at import time, not a silent
// wrong-behavior bug.
const resolver = createResolver(import.meta.url);

// The actual, directly-unit-testable setup logic -- see this file's header
// comment for the `ModuleKit`/dependency-injection reasoning. Mutates
// `nuxt.options.alias` and calls into `kit`'s functions; performs no
// filesystem/network I/O of its own (that's `@nuxt/kit`'s job, real or
// stubbed).
export function setupTypetrackModule(options: ModuleOptions, nuxt: Nuxt, kit: ModuleKit = defaultKit): void {
  if (!options.analyticsModule) {
    throw new Error(
      '@typetrack/nuxt requires a non-empty "analyticsModule" option -- a Nuxt-alias-resolvable ' +
        "path (e.g. \"~/app/analytics\") to an app-authored file that constructs createAnalytics(...) " +
        "and default-exports the resulting instance. Example: " +
        'typetrack: { analyticsModule: "~/app/analytics" } in nuxt.config.ts.',
    );
  }

  // The generated template re-exports the app-supplied module's default
  // export unchanged -- this indirection (rather than aliasing
  // `options.analyticsModule` itself) is what lets `analyticsModule` be
  // any resolvable path shape (`~/...`, a bare package specifier, a
  // relative path) while the runtime plugins' own static import specifier
  // (`ANALYTICS_MODULE_ALIAS`) stays fixed.
  const analyticsTemplate = kit.addTemplate({
    filename: "typetrack-analytics-module.mjs",
    getContents: () =>
      `export { default } from ${JSON.stringify(options.analyticsModule)};\n` +
      `export { default as analytics } from ${JSON.stringify(options.analyticsModule)};\n`,
  });

  nuxt.options.alias[ANALYTICS_MODULE_ALIAS] = analyticsTemplate.dst;

  // The provide-registration plugin: runs identically on server and
  // client (no `.client`/`.server` suffix) -- `app.provide()` itself is
  // not browser-dependent, per this issue's plan doc "SSR-safety" section.
  kit.addPlugin(resolver.resolve("./runtime/plugin"));

  // The route-change-tracking plugin: genuinely client-only (a
  // server-rendered request has no "route change" concept), registered
  // via Nuxt's `.client.ts` filename-suffix convention on the referenced
  // file itself (a real, build-time bundle-exclusion mechanism, not a
  // runtime `if` check) -- gated on `autoPageViews` (default `true`).
  if (options.autoPageViews ?? true) {
    kit.addPlugin(resolver.resolve("./runtime/pageview.client"));
  }

  // `useAnalytics` auto-import: re-exports issue 001's composable (not a
  // reimplementation) so it "just works" in any Nuxt app component with no
  // explicit import line.
  kit.addImports({ name: "useAnalytics", from: "@typetrack/vue" });
}

// Explicitly typed (rather than left to inference) as `NuxtModule<
// ModuleOptions>` -- `tsup`'s `.d.ts`-bundling step (via `dts-bundle`'s
// underlying `rollup-plugin-dts`) cannot otherwise name `defineNuxtModule`'s
// inferred return type without a non-portable reference into
// `@nuxt/schema`'s own internals (verified by hand: omitting this
// annotation fails the `dts` build step with TS2883, "The inferred type of
// 'default' cannot be named without a reference to 'NuxtModule'").
const typetrackNuxtModule: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@typetrack/nuxt",
    configKey: "typetrack",
  },
  defaults: {
    autoPageViews: true,
  },
  setup(options, nuxt) {
    setupTypetrackModule(options, nuxt);
  },
});

export default typetrackNuxtModule;
