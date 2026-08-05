import { defineConfig } from "tsup";

export default defineConfig({
  // `src/index.ts` is the package's real public entry (bundled, ships a
  // `.d.ts`). `src/runtime/plugin.ts`/`src/runtime/pageview.client.ts` are
  // NOT bundled together with it or with each other -- each is a distinct
  // build output `module.ts`'s `setupTypetrackModule()` references by file
  // path (`resolver.resolve('./runtime/plugin')`) for Nuxt's own Vite/
  // webpack pipeline to pick up and process itself, as part of a real
  // consuming app's build -- this package's own `tsup` build only needs to
  // transpile TS -> JS for each of them (preserving the `runtime/` output
  // directory structure tsup's default entry-array behavior already gives),
  // never to bundle them into `index.js` or into each other. No `banner`
  // needed here (unlike `@typetrack/react`'s `"use client"` reinjection) --
  // a Nuxt module has no comparable client-boundary-marking-comment
  // requirement.
  entry: ["src/index.ts", "src/runtime/plugin.ts", "src/runtime/pageview.client.ts"],
  format: ["esm", "cjs"],
  // `.d.ts` generation is restricted to `src/index.ts` only (not the two
  // `runtime/*.ts` entries): those files each statically import
  // `"#typetrack/analytics-module"`, an alias that only resolves inside a
  // real Nuxt build (see `src/runtime/analytics-module.d.ts`'s ambient
  // module declaration, which makes that import type-check via `tsgo`/`tsc`
  // but is not something `tsup`'s own `.d.ts`-bundling step needs to
  // resolve/re-emit for either file -- neither is a public, consumer-facing
  // export with its own types to ship).
  dts: { entry: ["src/index.ts"] },
  sourcemap: true,
  clean: true,
  splitting: false,
  // `runtime/plugin.ts`/`runtime/pageview.client.ts` each statically
  // `import analytics from "#typetrack/analytics-module"` -- a specifier
  // that only resolves at real Nuxt build time, via the alias `module.ts`'s
  // `setupTypetrackModule()` registers into `nuxt.options.alias` (see that
  // file's header comment). `esbuild` (tsup's bundler) has no way to
  // resolve it either, so it must be marked `external` here -- leaving the
  // literal `import ... from "#typetrack/analytics-module"` statement
  // untouched in the shipped `dist/runtime/*.js` output, exactly as
  // intended: Nuxt's own Vite/webpack pipeline is what actually resolves it
  // when a real consuming app builds.
  // `@nuxt/kit`/`@nuxt/schema` are devDependencies here, not this package's
  // own runtime `dependencies` (see `src/module.ts`'s header comment for
  // why: any real consuming app already has both transitively, via its own
  // required `nuxt` peer dependency). `tsup` only auto-externalizes
  // packages it finds listed in `dependencies`/`peerDependencies`, so
  // without this explicit override it bundles `@nuxt/kit`'s (and its own
  // dependency tree's) entire source directly into `dist/index.js`
  // (verified by hand: omitting this produced a 520 KB `dist/index.js`,
  // versus ~1.5 KB with it) -- wasteful and wrong, since a real Nuxt app
  // always has its own `@nuxt/kit` already installed via `nuxt`.
  external: ["#typetrack/analytics-module", "@nuxt/kit", "@nuxt/schema"],
});
