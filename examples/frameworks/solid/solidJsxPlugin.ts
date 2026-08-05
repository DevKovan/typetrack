// Registers a small, hand-rolled Bun plugin that compiles this example's own
// `.tsx` files' Solid JSX (via `@babel/core` + `@babel/preset-typescript` +
// `babel-preset-solid`) -- mirrors `packages/solid/src/testSetup.ts`'s own
// established precedent and reasoning exactly (see that file's own header
// comment for the full "why a hand-rolled, path-scoped plugin instead of a
// community Bun-Solid plugin" story: `Bun.plugin(...)` registrations are
// process-global, and this repo runs one shared, repo-wide `bun test`
// process that also runs `packages/react`'s own `.tsx` files -- an
// unscoped plugin would silently miscompile those too).
//
// Imported by both `index.ts` (this example's runnable `bun run index.ts`
// entry point, which needs `./SignUpForm.tsx`'s JSX compiled correctly even
// outside of `bun test`) and `testSetup.ts` (this example's own test-only
// happy-dom registration) -- registering it exactly once, here, avoids two
// independently-drifting copies of the same babel config.
//
// `generate: "dom", hydratable: false` (not `hydratable: true`, unlike
// `packages/solid/src/testSetup.ts`'s own CSR-only config): matches
// `@typetrack/solid`'s own default build output (`packages/solid/
// tsup.config.ts`'s `tsup-preset-solid` default, confirmed by reading
// `packages/solid/dist/index.js`) -- Solid's plain (non-hydratable)
// "dom"-generated output is genuinely isomorphic (verified by hand: the
// same compiled artifact renders correctly through both `@solidjs/
// testing-library`'s real-DOM `render()` for CSR, and `solid-js/web`'s
// `renderToString()` for SSR, since `solid-js/web`'s own export map --
// unlike Svelte's -- resolves to a server-appropriate string-rendering
// implementation transparently, purely based on the *importing* runtime,
// not on how the component itself was compiled). `hydratable: true`
// (`packages/solid/src/testSetup.ts`'s own choice, correct for that
// package's CSR-only tests) compiles template creation to
// `getNextElement()`/`getNextMarker()` instead -- calls meant to *walk* an
// already-server-rendered DOM tree during a real client-side hydration
// pass, which `solid-js/web`'s own server build has no implementation for
// at all (confirmed by hand: it throws "Client-only API called on the
// server side" the moment `renderToString()` reaches one). `hydratable:
// false` is what's actually portable across both this example's CSR test
// and its own SSR demo, so `./SignUpForm.tsx` can be reused, unmodified,
// for both, with no separate `"ssr"`-generated build needed.
import { plugin } from "bun";
import babel from "@babel/core";
import tsPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";
import { fileURLToPath } from "node:url";

const thisPackageDir = fileURLToPath(new URL(".", import.meta.url));

// Scoped to this example's own directory only -- see `packages/solid/src/
// testSetup.ts`'s own header comment for why the filter itself (not merely
// an in-callback path check) must be scoped this way.
const filter = new RegExp(`^${thisPackageDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\.tsx$`);

let registered = false;

// Idempotent: both `index.ts` and `testSetup.ts` import this module, and
// (when run together, e.g. this example's own `bun test` importing
// `index.integration.test.ts`, which itself imports `./index`) Bun's own
// ESM module cache already deduplicates repeated `import`s of the same
// module -- this guard is a second, explicit safeguard against ever calling
// `plugin(...)` twice for the same filter in one process, which is
// unnecessary (not harmful, but wasteful) rather than a correctness fix.
function registerSolidJsxPlugin(): void {
  if (registered) {
    return;
  }
  registered = true;

  plugin({
    name: "typetrack-example-solid-jsx (examples/frameworks/solid only)",
    setup(build) {
      build.onLoad({ filter }, async ({ path }) => {
        const result = await babel.transformFileAsync(path, {
          presets: [
            [tsPreset, {}],
            [solidPreset, { generate: "dom", hydratable: false }],
          ],
          filename: path,
          sourceMaps: "inline",
        });

        if (!result?.code) {
          throw new Error(`typetrack-example-solid-jsx: babel produced no code for ${path}`);
        }

        return { loader: "js", contents: result.code };
      });
    },
  });
}

registerSolidJsxPlugin();
