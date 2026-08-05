// Ambient module declaration for the alias `module.ts`'s
// `setupTypetrackModule()` registers into `nuxt.options.alias` (see that
// file's header comment for the full "config-time/runtime-boundary"
// reasoning). This specifier only resolves to a real file at real Nuxt
// build time (via the `addTemplate`-generated file `module.ts` aliases it
// to) -- it has no corresponding file on disk in this package's own
// source tree. Declaring it ambiently here is what lets
// `runtime/plugin.ts`/`runtime/pageview.client.ts`'s static
// `import analytics from "#typetrack/analytics-module"` type-check under
// this repo's shared `tsgo --noEmit`/`tsc --noEmit` with **zero** tsconfig
// changes (no `paths` entry needed -- ambient module declarations are
// resolved globally by TypeScript from any included `.d.ts`, independent
// of `paths`/`moduleResolution`, confirmed by hand) -- consistent with
// this phase's BRIEF.md "Nuxt needs zero tsconfig/oxlint changes" toolchain
// finding.
declare module "#typetrack/analytics-module" {
  import type { Analytics, EventMap } from "typetrack";

  const analytics: Analytics<EventMap>;
  export default analytics;
  export { analytics };
}
