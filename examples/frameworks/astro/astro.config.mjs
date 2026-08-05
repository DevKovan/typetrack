// A minimal `astro.config.mjs` excerpt -- copy the `integrations` line
// below into your own Astro project. Registers `@typetrack/astro` (issue
// 005's Integration-API package), pointing `analyticsModule` at
// `src/lib/analytics.ts` (this directory's own app-authored file -- see
// that file's own header comment for why it must be a *module specifier*,
// not a live `Analytics` instance passed here directly --
// `packages/astro/src/index.ts`'s own header comment has the full
// "config-time/runtime-boundary" reasoning, shared with `@typetrack/nuxt`).
// `autoPageViews` defaults to `true` -- shown explicitly here for clarity.
import { defineConfig } from "astro/config";
import typetrackAstro from "@typetrack/astro";

export default defineConfig({
  integrations: [
    typetrackAstro({
      analyticsModule: "/src/lib/analytics.ts",
      autoPageViews: true,
    }),
  ],
});
