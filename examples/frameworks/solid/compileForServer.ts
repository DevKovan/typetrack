// A second, separate compile path from `./solidJsxPlugin.ts` -- deliberately
// not reused, because SSR (this file) and CSR (`./solidJsxPlugin.ts`) need
// genuinely different `babel-preset-solid` compile targets, not just
// different runtime environments for the same compiled output.
//
// Verified by hand: `generate: "dom"` (the mode `./solidJsxPlugin.ts` uses
// for CSR, and the mode `@typetrack/solid`'s own published dist itself uses
// -- `packages/solid/dist/index.js`) compiles a component that renders real
// markup (like `./SignUpForm.tsx`, unlike `@typetrack/solid`'s own
// `AnalyticsProvider`, which renders no template of its own and is
// therefore isomorphic) into calls against `solid-js/web`'s `template()`/
// `insert()`/`use()` -- all three of which are literal `notSup()` stubs on
// `solid-js/web`'s own *server* build (confirmed by hand: `solid-js/web/
// dist/server.js`'s own export list aliases `template`/`insert`/`use` (and
// `getNextElement`/`getNextMarker`, `dom`+`hydratable: true`'s own
// hydration-walking calls) to a function that unconditionally throws
// "Client-only API called on the server side"). `generate: "ssr"` compiles
// the *same* JSX into calls against `solid-js/web`'s `ssr()`/
// `ssrAttribute()`/`escape()` instead -- all genuinely implemented on the
// server build, string-templating the markup directly. This mirrors, in
// spirit, a real SolidStart/Vite build: `vite-plugin-solid` compiles a
// project's own `.tsx` source once per target (client vs. server) too, via
// this exact same `babel-preset-solid` `generate` option, driven by which
// bundle it's building for -- this file just performs that same per-target
// recompilation directly, since this repo's own `bun run`/`bun test` have
// no bundler-driven "which target am I building for" signal to key off.
import babel from "@babel/core";
import tsPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";
import type { JSX } from "solid-js";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const signUpFormPath = fileURLToPath(new URL("./SignUpForm.tsx", import.meta.url));

// Compiles `SignUpForm.tsx`'s real, unmodified source for the server
// target, writes the result to a transient sibling file (so its own
// `import "./formLogic"` -- a real relative import -- still resolves
// correctly), dynamically imports it, then deletes the transient file
// before returning -- nothing under version control is ever written to.
export async function compileSignUpFormForServer(): Promise<() => JSX.Element> {
  const result = await babel.transformFileAsync(signUpFormPath, {
    presets: [
      [tsPreset, {}],
      [
        solidPreset,
        {
          generate: "ssr",
          hydratable: false,
          // Overrides `babel-preset-solid`'s own default `moduleName:
          // "solid-js/web"` (the bare specifier the generated `ssr()`/
          // `escape()` calls import from) -- see `index.ts`'s own header
          // comment on its `renderToString` import for why: this repo's
          // root `bun test` runs with `--conditions=browser` set
          // process-wide, which resolves the bare `"solid-js/web"`
          // specifier to the *client* build everywhere, including in code
          // generated here. Redirecting the generated import to the same
          // explicit, condition-immune deep path `index.ts` itself uses
          // keeps this compiled output correct regardless of that flag.
          moduleName: "solid-js/web/dist/server.js",
        },
      ],
    ],
    filename: signUpFormPath,
  });

  if (!result?.code) {
    throw new Error("compileSignUpFormForServer: babel produced no code for SignUpForm.tsx");
  }

  const tempPath = fileURLToPath(new URL(`./.SignUpForm.server.${crypto.randomUUID()}.mjs`, import.meta.url));
  await Bun.write(tempPath, result.code);
  try {
    const mod = (await import(tempPath)) as { SignUpForm: () => JSX.Element };
    return mod.SignUpForm;
  } finally {
    await unlink(tempPath);
  }
}
