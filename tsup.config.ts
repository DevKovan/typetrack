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
]);
