// Registers happy-dom's DOM globals for `@testing-library/react` to render
// into, since `bun test` has no DOM/browser globals by default. Per Bun's
// own docs (https://bun.com/docs/test/dom) the supported approach is
// `@happy-dom/global-registrator` + `@testing-library/*`.
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
// Important, verified-by-hand ordering caveat: `@testing-library/dom`'s
// `screen` export (and, transitively, anything `@testing-library/react`
// re-exports from it) is computed exactly once, at module-load time, based
// on whether `document` already exists globally at that instant -- if it
// doesn't, every `screen.*` query permanently throws for the rest of the
// process, even after `GlobalRegistrator.register()` runs later. Bun's ESM
// loader does not guarantee that a plain `import "./testSetup"` placed
// before `import { render } from "@testing-library/react"` finishes running
// this module's body first (unlike Node's spec-compliant depth-first ESM
// evaluation) -- confirmed empirically. The only reliable fix, short of a
// `--preload` script, is for this package's test file to pull in
// `@testing-library/react` via `require(...)` (not a static `import`)
// *after* `import "./testSetup"`, so this module's `register()` call is
// guaranteed to run first. See `packages/react/src/AnalyticsProvider.test.tsx`
// for the pattern this package's own `index.test.tsx` follows.
//
// Deliberately duplicated (not shared cross-package) from
// `packages/react/src/testSetup.ts`/`packages/next/src/testSetup.ts` --
// mirrors those packages' own established precedent on this point.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
