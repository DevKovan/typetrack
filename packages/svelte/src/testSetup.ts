// Registers happy-dom's DOM globals for `@testing-library/svelte` to render
// into, since `bun test` has no DOM/browser globals by default. Per Bun's
// own docs (https://bun.com/docs/test/dom) the supported approach is
// `@happy-dom/global-registrator` + `@testing-library/*`. Mirrors
// `packages/react/src/testSetup.ts`/`packages/vue/src/testSetup.ts`'s own
// established precedent and reasoning exactly.
//
// Deviating deliberately from Bun's docs' suggested wiring: Bun's docs wire
// this up via a root-level `bunfig.toml` `[test].preload`, but this repo's
// CI runs a single repo-wide `bun test` that also runs `packages/provider-*`
// and `src/devServer`/`src/cli` tests relying on Bun's native `fetch`/
// `Bun.serve()` behavior -- a root preload would leak happy-dom's globals
// into all of those. Instead, this module is imported directly by this
// package's own DOM-rendering test file, which pairs it with an
// `afterAll(() => GlobalRegistrator.unregister())` so DOM globals are torn
// down before any other package's test files run later in the same process.
//
// Ordering caveat, verified by hand (mirrors `packages/vue`'s own testSetup
// addendum): `svelte`/`@testing-library/svelte` must load *after*
// `GlobalRegistrator.register()` runs, or Svelte's own client runtime
// permanently caches a `null`/missing `document` reference. Bun's ESM
// loader does not guarantee that a plain `import "./testSetup"` placed
// before `import { render } from "@testing-library/svelte"` finishes
// running this module's body first (unlike Node's spec-compliant
// depth-first ESM evaluation) -- confirmed empirically. The reliable fix,
// short of a `--preload` script, is for this package's test file to pull in
// `svelte`/`@testing-library/svelte`/this package's own `.svelte` fixtures
// via a *dynamic* `await import(...)` (not `require(...)` -- Bun rejects a
// synchronous `require()` of `@testing-library/svelte` outright, since its
// own module graph uses top-level `await`; see `AnalyticsProvider.test.ts`'s
// own header comment) *after* `import "./testSetup"`, so this module's
// `register()` call is guaranteed to run first.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { SveltePlugin } from "bun-plugin-svelte";

// Second, separate toolchain gap from the built-in `.svelte` esbuild
// support `tsup.config.ts` documents (that one is build-time only, for
// `tsup`'s bundling of `dist/`): Bun's own module loader has **no** built-in
// understanding of `.svelte` syntax either, so a bare `import("./
// AnalyticsProvider.svelte")`/`import("./__fixtures__/ConsumerFixture.
// svelte")` inside `bun test` fails outright with no plugin registered at
// all. `bun-plugin-svelte` (the official, Bun-team-maintained Svelte plugin,
// published from Bun's own monorepo) fixes this the same way
// `@happy-dom/global-registrator` fixes the DOM-globals gap: registered here,
// once, before any `.svelte` file is ever imported by this package's test
// file.
//
// `forceSide: "client"` is required, not a stylistic choice: this plugin's
// own side-detection only recognizes `Bun.build({ target: "browser" })`'s
// bundler config to pick client-mode compilation. Outside of `Bun.build`
// (i.e. plain `bun test`, this package's own context, where no bundler
// `target` config exists at all) it silently falls back to server-mode
// (SSR-`render()`-to-string) compilation -- the wrong output shape entirely
// for `@testing-library/svelte`'s client-mode `render()`, which expects
// Svelte 5's `mount()`-based component export. Verified by hand against
// `bun-plugin-svelte`'s own source. `development: false` mirrors this
// package's own `tsup.config.ts` production-compile choice, so what's
// tested matches what ships.
plugin(SveltePlugin({ forceSide: "client", development: false }));

GlobalRegistrator.register();

// Third, separate toolchain gap, this one *not* fixable from inside this
// file at all: `svelte`'s own `package.json` `"exports"` field branches "."
// on a `"browser"` vs `"worker"`/`"default"` condition (`svelte/index-
// client.js` vs `svelte/index-server.js`), and Bun -- a server-like
// runtime, not a browser -- does not include `"browser"` in its default
// resolution conditions. `@testing-library/svelte-core`'s own `import {
// mount } from "svelte"` therefore silently resolves to Svelte's
// *server-side* `mount`, which throws `lifecycle_function_unavailable:
// mount(...) is not available on the server` for every real render --
// unrelated to, and not fixed by, `bun-plugin-svelte`'s own `forceSide`
// option above (that option controls how *this package's own* `.svelte`
// files are *compiled*; it has no bearing on which prebuilt `svelte`
// package export Bun's resolver picks for code that isn't compiled by this
// plugin at all, like `@testing-library/svelte-core`). The fix is Bun's own
// `--conditions=browser` CLI flag, added to both this package's own `"test"`
// script (`package.json`) and the repo root's `"test"` script -- confirmed
// by hand to be a safe, no-op addition for every other package's test files
// (none of their own dependencies branch on a `"browser"` export condition
// the way `svelte` does), and necessary at the *root* `bun test` invocation
// specifically because this repo runs one shared, repo-wide `bun test`
// process (per this file's own header comment) -- a flag scoped to only
// this package's own `package.json` `"test"` script has no effect on that
// shared root invocation.
