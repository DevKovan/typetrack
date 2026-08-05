// Registers happy-dom's DOM globals for `@vue/test-utils`'s `mount()` to
// render into, since `bun test` has no DOM/browser globals by default. Per
// Bun's own docs (https://bun.com/docs/test/dom) the supported approach is
// `@happy-dom/global-registrator` + a testing library.
//
// Deviating deliberately from Bun's docs' suggested wiring, for the exact
// same reason as `packages/react/src/testSetup.ts` (duplicated here, not
// shared cross-package, per that package's own established Context
// reasoning): Bun's docs wire this up via a root-level `bunfig.toml`
// `[test].preload`, but this repo's CI runs a single repo-wide `bun test`
// that also runs `packages/provider-*` and `src/devServer`/`src/cli` tests
// relying on Bun's native `fetch`/`Bun.serve()` behavior -- a root preload
// would leak happy-dom's globals into all of those. Instead, this module is
// imported directly by this package's own DOM-rendering test file, which
// pairs it with an `afterAll(() => GlobalRegistrator.unregister())` so DOM
// globals are torn down before any other package's test files run later in
// the same process.
//
// Vue-specific addendum (a genuinely new hazard `packages/react`'s own
// testSetup didn't need to document, verified by hand): it is not just a
// testing-library that must load after this module's `register()` call --
// `vue` itself must too. `vue`'s package entry re-exports
// `@vue/runtime-dom` wholesale, and `@vue/runtime-dom`'s own module body
// captures the global `document` reference once, at that module's first
// evaluation, for its DOM node-creation operations. If `vue` (or anything
// importing it, including this package's own `./plugin`/`./useAnalytics`)
// is loaded before `register()` runs, that captured reference is `null`
// permanently for the rest of the process -- `mount()` then fails deep
// inside Vue's renderer with an opaque `null is not an object (evaluating
// 'doc.createElement')`-shaped error instead of ever reaching this
// package's own thrown `useAnalytics()` error. Every test file that
// transitively touches `vue` must therefore `import "./testSetup"` first,
// then pull in `vue`/`@vue/test-utils`/this package's own `./plugin`/
// `./useAnalytics` via `require(...)` (not a static `import`) immediately
// after -- the same fix, for a Vue-specific instance of the same underlying
// Bun-ESM-ordering root cause `packages/react/src/testSetup.ts` already
// documents.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
