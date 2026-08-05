import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // No `esbuild-svelte` devDependency/`esbuildPlugins` entry here, despite
  // this issue's own Context section anticipating one, and despite
  // `esbuild` (tsup's own bundler) having no *native* understanding of
  // `.svelte` syntax on its own. This is a deliberate, verified-by-hand
  // deviation from that initial plan, not an oversight:
  //
  // `tsup` itself ships its own built-in, unconditionally-registered
  // esbuild plugin for `.svelte` files (source: `tsup/dist/index.js`,
  // `sveltePlugin({ css })`, added to its internal plugin list
  // unconditionally, with no config flag to opt out). It is registered
  // *ahead of* whatever a user supplies via `esbuildPlugins`, and since
  // esbuild resolves a given file's `onLoad` via the *first* matching
  // plugin in registration order, that built-in plugin -- not a
  // user-supplied `esbuild-svelte` entry -- is what actually compiles
  // `AnalyticsProvider.svelte` for this package's `dist/` build, no matter
  // what `esbuildPlugins` config is passed here; a hand-configured
  // `esbuild-svelte` plugin's own `onLoad` would simply never run, silently
  // (confirmed by instrumenting both plugins directly). tsup's own
  // `esbuildOptions` hook -- which receives the fully-assembled esbuild
  // options object immediately before the real `esbuild.build()` call, and
  // looks at first glance like a plausible escape hatch for reordering
  // plugins -- does not work either: it reports an *empty* `plugins` array
  // at that point (esbuild does not expose its live, in-progress plugin
  // list through `initialOptions` for a plugin to introspect or mutate).
  // There is, as of tsup 8.5.1, no supported way to override tsup's choice
  // of `.svelte` compiler from `tsup.config.ts` at all -- so `esbuild-
  // svelte` is not installed as a devDependency here either (an installed,
  // configured, but never-actually-invoked plugin would be dead weight,
  // not a real safeguard).
  //
  // Fortunately, tsup's built-in plugin already produces exactly the output
  // this package needs, with no configuration: it defers to `svelte/
  // compiler`'s own default `generate: "client"` (browser-runnable output,
  // required for `AnalyticsProvider`'s `setContext` to do anything useful)
  // and default `dev: false` (production compile, no dev-mode runtime
  // checks baked into the shipped bundle) -- both confirmed against
  // `svelte/compiler`'s own `CompileOptions` type doc comments, not
  // assumed. It also preprocesses `<script lang="ts">` (stripping types via
  // esbuild's own `transform()`) before compiling -- using `svelte-
  // preprocess` instead, if that package happens to be installed, which it
  // is not here, since this package's one `.svelte` file needs nothing
  // beyond plain TypeScript stripping.
});
