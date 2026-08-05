import { defineConfig } from "tsup";
import * as preset from "tsup-preset-solid";

// `tsup-preset-solid` (a tsup-native community preset built specifically for
// packaging SolidJS libraries with tsup) is required here because `esbuild`'s
// own built-in JSX transform -- what plain `tsup`/`esbuild` uses for React's
// `react-jsx` mode -- cannot correctly compile Solid JSX: Solid's JSX
// compiles at build time into fine-grained reactive DOM-update calls via a
// dedicated Babel transform (`babel-preset-solid`), fundamentally different
// from React's `createElement`/automatic-runtime output. Without this preset,
// `AnalyticsProvider.tsx`'s JSX would be silently miscompiled as if it were
// React's.
const presetOptions: preset.PresetOptions = {
  entries: [
    {
      // `.tsx`, not `.ts` -- see `src/index.tsx`'s own header comment for
      // the full, verified-by-hand reasoning: `tsup-preset-solid`'s
      // `"solid"` export-condition generation is gated purely on this
      // entry filename's own extension, not its content.
      entry: "src/index.tsx",
    },
  ],
  // Produces a CJS build alongside ESM, matching this repo's existing
  // dual-format (ESM+CJS+d.ts) convention as closely as the preset allows
  // (see its own README "Usage gotchas" #3 -- CJS is opt-in, off by
  // default).
  cjs: true,
};

export default defineConfig((config) => {
  const watching = !!config.watch;
  const parsedData = preset.parsePresetOptions(presetOptions, watching);

  if (!watching) {
    const packageFields = preset.generatePackageExports(parsedData);
    // Writes the correct `"exports"`/`"main"`/`"module"`/`"types"` fields
    // (including the `"solid"` export condition the preset adds
    // automatically for `.tsx`-authored entries -- see `src/index.tsx`'s own
    // header comment for the full reasoning, and this package's checked-in
    // `package.json` for the actual, verified emitted shape:
    // `"solid": "./dist/index.jsx"`) directly into `package.json`, per the
    // preset's own documented, non-optional workflow (its README does not
    // offer a "compute but don't write" mode).
    preset.writePackageJson(packageFields);
  }

  return preset.generateTsupOptions(parsedData);
});
