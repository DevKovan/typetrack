// Registers happy-dom's DOM globals for `@vue/test-utils`'s `mount()` to
// render into (used by `runtime/installTypetrackPlugin.test.ts`'s
// integration test), since `bun test` has no DOM/browser globals by
// default. Duplicated (not shared cross-package) from
// `packages/vue/src/testSetup.ts`, per that file's own established
// reasoning: this repo's CI runs a single repo-wide `bun test` that also
// runs `packages/provider-*`/`src/devServer`/`src/cli` tests relying on
// Bun's native `fetch`/`Bun.serve()` behavior, so a root-level preload
// would leak happy-dom's globals into all of those. This module is
// imported directly by this package's own DOM-rendering test file, paired
// with an `afterAll(() => GlobalRegistrator.unregister())` there.
//
// Vue-specific addendum (same hazard `packages/vue/src/testSetup.ts`
// documents, applies identically here since this package also transitively
// pulls in `vue` via `@typetrack/vue`): `vue` itself, not just
// `@vue/test-utils`, must load after this module's `register()` call, or
// `@vue/runtime-dom` permanently caches a `null` `document` reference for
// the rest of the `bun test` process. Every test file that transitively
// touches `vue` must `import "./testSetup"` first, then pull in `vue`/
// `@vue/test-utils`/`@typetrack/vue`/this package's own runtime modules via
// `require(...)` (not a static `import`) immediately after.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
