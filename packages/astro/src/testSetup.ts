// Registers happy-dom's DOM globals (`document`, `location`,
// `addEventListener`) for `buildPageLoadScript.test.ts`'s "runtime
// behavior" integration test, since `bun test` has no DOM/browser globals
// by default. Duplicated (not shared cross-package), per this repo's own
// established reasoning (see e.g. `packages/nuxt/src/testSetup.ts`'s
// identical header comment): this repo's CI runs a single repo-wide
// `bun test` that also runs `packages/provider-*`/`src/devServer`/
// `src/cli` tests relying on Bun's native `fetch`/`Bun.serve()` behavior,
// so a root-level preload would leak happy-dom's globals into all of
// those. Imported directly by the one test file in this package that
// needs a DOM, paired with an `afterAll(() => GlobalRegistrator.
// unregister())` there.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// A real base `url` is required: happy-dom otherwise registers with a
// `document.location` of `about:blank`, against which
// `history.pushState(state, title, "/some/path")`'s relative-URL
// resolution silently fails to update `location.pathname` -- observed by
// hand while writing `buildPageLoadScript.test.ts`'s "runtime behavior"
// integration test, which relies on `history.pushState` synchronously
// updating `location.pathname`/`location.search` before firing a
// simulated `astro:page-load` event.
GlobalRegistrator.register({ url: "http://localhost/" });
