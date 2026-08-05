// Registers happy-dom's DOM globals for `@solidjs/testing-library` to render
// into, since `bun test` has no DOM/browser globals by default. Per Bun's
// own docs (https://bun.com/docs/test/dom) the supported approach is
// `@happy-dom/global-registrator` + `@testing-library/*`-equivalent
// libraries. Mirrors `packages/react/src/testSetup.ts`/`packages/vue/src/
// testSetup.ts`/`packages/svelte/src/testSetup.ts`'s own established
// precedent and reasoning exactly.
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
// Ordering caveat, verified by hand (mirrors `packages/react`/`packages/vue`/
// `packages/svelte`'s own testSetup precedent): `solid-js`/`@solidjs/
// testing-library` must load *after* `GlobalRegistrator.register()` runs, or
// Solid's own reactive runtime may permanently cache a `null`/missing
// `document` reference at module-evaluation time. Bun's ESM loader does not
// guarantee that a plain `import "./testSetup"` placed before
// `import { render } from "@solidjs/testing-library"` finishes running this
// module's body first (unlike Node's spec-compliant depth-first ESM
// evaluation). The reliable fix, short of a `--preload` script, is for this
// package's test file to pull in `@solidjs/testing-library`/`solid-js` via a
// dynamic `await import(...)` (not a static `import`) *after*
// `import "./testSetup"`, so this module's `register()` call is guaranteed to
// run first. See `AnalyticsProvider.test.ts` for the pattern.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import babel from "@babel/core";
import tsPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";
import { fileURLToPath } from "node:url";

// Second, separate toolchain gap from the build-time-only fix
// `tsup.config.ts`'s header comment documents (`tsup-preset-solid`, which
// only ever runs for this package's own `dist/` build): Bun's own module
// loader has **no** built-in understanding of Solid's actual JSX
// compilation at all -- verified by hand -- so a bare
// `import("./AnalyticsProvider")` inside `bun test` does not throw outright
// (unlike `packages/svelte`'s analogous `.svelte`-parsing gap), but instead
// silently *miscompiles* `AnalyticsProvider.tsx`'s JSX using Bun's own
// built-in automatic-JSX-runtime transform (the same transform used for
// React's `react-jsx` mode) -- calling `jsx`/`jsxs`/`jsxDEV` from whatever
// `jsxImportSource` the file's own pragma names (`solid-js` here). `solid-
// js`'s package -- confirmed by hand by reading its own `dist/solid.js`
// bundle -- exports no such `jsx`/`jsxs`/`jsxDEV` functions at all (Solid
// has no automatic-JSX-runtime factory-call convention the way React does;
// its JSX is compiled entirely at build time, via `babel-preset-solid`, into
// direct fine-grained-reactive DOM-update calls, never a runtime `jsx()`
// factory call), so this actually throws
// `SyntaxError: Export named 'jsxDEV' not found in module ...solid-js/dist/
// solid.js` the moment `AnalyticsProvider.tsx` is first imported, with no
// plugin registered at all -- confirmed by hand.
//
// This package deliberately does **not** register a third-party community
// Bun plugin (e.g. `bun-plugin-solid`/`@dschz/bun-plugin-solid`) to fix this,
// unlike `packages/svelte`'s own `bun-plugin-svelte` precedent -- a real,
// verified-by-hand deviation, not an oversight. `Bun.plugin(...)`
// registrations are **process-global**, not scoped to the package that
// registered them: this repo runs one shared, repo-wide `bun test` process
// (per this file's own header comment), and a community Solid plugin's
// `onLoad({ filter: /\.[tj]sx$/ }, ...)` filter matches *every* `.tsx` file
// loaded for the rest of that shared process -- including
// `packages/react/src/AnalyticsProvider.tsx` (an entirely unrelated React
// component). Reproduced directly: registering `@dschz/bun-plugin-solid`
// here broke `packages/react`'s own test suite with
// `Cannot find module 'solid-js/web' from '.../packages/react/src/
// AnalyticsProvider.tsx'` -- `packages/react`'s JSX was being fed through
// `babel-preset-solid` too. This is the same category of hazard already
// documented for `mock.module()` (a vendor SDK mock leaking cross-file in
// this shared process) -- a global registration API with no built-in way to
// scope it to "this package's own files only."
//
// The fix: a small, hand-rolled Bun plugin, registered here instead, whose
// `onLoad` *filter itself* (not merely an in-callback check -- see the
// second comment block below for why that distinction turned out to be
// load-bearing too) is scoped to this package's own `src/` directory, so
// `packages/react`/`packages/next`/any future `.tsx`-bearing package's own
// files are never even matched by this package's own test-time JSX
// transform, let alone touched by it. The transform itself (`@babel/core` +
// `@babel/preset-typescript` + `babel-preset-solid`, all already this
// package's own devDependencies, needed regardless -- `babel-preset-solid`
// is the same transform `tsup-preset-solid` uses for this package's real
// `dist/` build, see `tsup.config.ts`) is exactly what a community wrapper
// like `@dschz/bun-plugin-solid` does internally; only the path-scoping
// guard is this package's own addition.
const thisPackageSrcDir = fileURLToPath(new URL(".", import.meta.url));

// The filter regex itself is scoped to this package's own `src/` directory
// (not a bare `/\.tsx$/`, with an in-callback path check performed
// afterwards) -- a second, independently-verified-by-hand fix on top of the
// path check below. Confirmed by hand: a bare `/\.tsx$/` filter, even paired
// with an in-callback `return undefined` for out-of-scope files, still
// crashes `bun test` silently (no error printed at all, exit code 1, zero
// test output) the moment any *other* package's own `.tsx` file is used as a
// `bun test` *entry* file (not merely an imported dependency) --
// reproduced directly with `packages/react`'s own `AnalyticsProvider.test.
// tsx`. Bun's test-file-loading path apparently does not tolerate a plugin
// whose filter *matches* a test entry file's own path but then declines to
// handle it via `return undefined`, unlike ordinary (non-entry) imported
// module resolution, where `return undefined` is documented and confirmed
// to work correctly as a pass-through. Anchoring the filter itself to this
// package's own directory means Bun's filter-matching step never even
// considers `packages/react`/any other package's `.tsx` files as
// "potentially handled by this plugin" in the first place -- the safest,
// most conservative fix, not reliant on any fallback behavior.
const filter = new RegExp(`^${thisPackageSrcDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\.tsx$`);

plugin({
  name: "typetrack-solid-jsx (packages/solid/src only)",
  setup(build) {
    build.onLoad({ filter }, async ({ path }) => {
      const result = await babel.transformFileAsync(path, {
        presets: [
          [tsPreset, {}],
          // `generate: "dom"` is required, not a stylistic choice: it
          // produces client-mode, browser-DOM-mutating output -- the only
          // mode `@solidjs/testing-library`'s `render()` (a thin wrapper
          // over `solid-js/web`'s own `render`, which mounts into a real
          // DOM container) can use. The alternative, `"ssr"`, produces a
          // `renderToString`-shaped export this package's tests never call.
          [solidPreset, { generate: "dom", hydratable: true }],
        ],
        filename: path,
        sourceMaps: "inline",
      });

      if (!result?.code) {
        throw new Error(`typetrack-solid-jsx: babel produced no code for ${path}`);
      }

      return { loader: "js", contents: result.code };
    });
  },
});

GlobalRegistrator.register();
