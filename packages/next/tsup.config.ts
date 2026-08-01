import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // `src/AnalyticsProvider.tsx`'s own `"use client";` directive doesn't
  // survive esbuild inlining it as a non-entry module into this single
  // bundled output (see the comment in that file) -- reinject it as a
  // banner instead, so the *shipped* `dist/index.js`/`dist/index.cjs` (what
  // a real Next.js app actually consumes) starts with the directive, not
  // just the source. Applying it to the whole bundle is harmless: every
  // other export (`useAnalytics`) has no meaning outside a Client Component
  // either, so marking the entire module client-boundary is correct, not
  // just expedient.
  banner: { js: '"use client";' },
});
