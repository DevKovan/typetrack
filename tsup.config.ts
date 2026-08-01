import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
  },
  // `typetrack dev`'s CLI entrypoint (`package.json`'s `bin`). ESM-only --
  // it's a hard Bun-runtime dependency already (see `src/cli/index.ts`), so
  // there's no CJS consumer to support. `src/cli/index.ts` itself starts
  // with `#!/usr/bin/env bun`; tsup's built-in shebang plugin preserves that
  // line at the top of the emitted chunk and marks the output executable
  // (mode 0o755) -- no separate `banner` config needed.
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    // Runs after the entry above in the same `tsup` invocation -- must not
    // wipe out that entry's already-written `dist/` output.
    clean: false,
    splitting: false,
  },
  // Bundled browser global build (`<script src="https://unpkg.com/typetrack">`
  // with zero build tooling). `src/index.ts` has zero runtime dependencies
  // (its imports from `./providers`/`./schema` are type-only), so this entry
  // needs no `noExternal`/bundling decisions. tsup's default output naming
  // for an IIFE build of an entry named `index` is `dist/index.global.js` --
  // no collision with `dist/index.js` / `dist/index.cjs`. Runs after the two
  // entries above in the same `tsup` invocation -- must not wipe out their
  // already-written `dist/` output, and `.d.ts` is already emitted by entry
  // 1 so this entry doesn't need its own.
  {
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "Typetrack",
    minify: true,
    dts: false,
    clean: false,
    splitting: false,
    platform: "browser",
    sourcemap: true,
  },
]);
