// Registers happy-dom's DOM globals and `bun-plugin-svelte` (client-mode
// compilation) for `@testing-library/svelte` to render `.svelte` files
// into, since `bun test` has no DOM/browser globals -- and no built-in
// `.svelte`-syntax understanding -- by default. Mirrors `packages/svelte/
// src/testSetup.ts`'s own established precedent and reasoning exactly
// (including the ordering caveats documented there: `svelte`/`@testing-
// library/svelte`/this example's own `.svelte` files must all load *after*
// this module's registrations run, via a *dynamic* `await import(...)`, not
// a static `import`).
//
// `bun-plugin-svelte`'s own `onLoad` registration has no per-package
// filter/scoping option (unlike `examples/frameworks/solid/
// solidJsxPlugin.ts`'s hand-rolled equivalent) -- registering it again here,
// with the identical `{ forceSide: "client", development: false }` config
// `packages/svelte/src/testSetup.ts` already registers, is harmless: both
// registrations compile any `.svelte` file the same way, so which one
// actually handles a given file (in this repo's one shared, repo-wide `bun
// test` process) makes no observable difference.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { SveltePlugin } from "bun-plugin-svelte";

plugin(SveltePlugin({ forceSide: "client", development: false }));

GlobalRegistrator.register();
