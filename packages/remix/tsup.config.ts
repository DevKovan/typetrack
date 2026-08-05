import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // Deliberately no `banner` here, unlike `packages/next/tsup.config.ts` --
  // see this package's `AnalyticsPageView.tsx`/`index.ts` header comments
  // and `plan/phase-14-framework-wrappers/006-remix-react-router-wrapper.md`
  // Context for why: React Router v8's default framework mode has no
  // Server/Client Component split, so no `"use client"`-equivalent directive
  // is needed anywhere in this package.
});
