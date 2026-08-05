// Registers happy-dom's DOM globals for `@vue/test-utils`'s `mount()` to
// render into, since `bun test` has no DOM/browser globals by default.
// Mirrors `packages/vue/src/testSetup.ts`'s own established precedent and
// reasoning exactly (including the Vue-specific addendum: `vue`/`@vue/
// test-utils`/this example's own `./index`/`./SignUpForm` must all load
// *after* `GlobalRegistrator.register()` runs, via `require(...)`, not a
// static `import`, or `@vue/runtime-dom` permanently caches a `null`
// `document`). Duplicated here rather than imported from `packages/vue`
// (not a published, importable module of that package -- `testSetup.ts`
// isn't part of its `src/index.ts` barrel), the same "own the whole
// register/unregister lifecycle locally" precedent every other package's
// own `testSetup.ts` in this phase follows.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
