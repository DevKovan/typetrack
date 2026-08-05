// A minimal `nuxt.config.ts` excerpt -- copy the `modules`/`typetrack`
// lines below into your own Nuxt 4 app's config. Registers `@typetrack/nuxt`
// (issue 002's module), pointing `analyticsModule` at `./app/analytics.ts`
// (this directory's own app-authored file, see that file's own header
// comment for why it must be a *module path*, not a live `Analytics`
// instance passed here directly -- `packages/nuxt/src/module.ts`'s own
// header comment has the full "config-time/runtime-boundary" reasoning).
// `autoPageViews` defaults to `true` -- shown explicitly here for clarity.
export default defineNuxtConfig({
  modules: ["@typetrack/nuxt"],

  typetrack: {
    analyticsModule: "~/analytics",
    autoPageViews: true,
  },

  compatibilityDate: "2026-08-01",
});
