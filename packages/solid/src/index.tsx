// Named `index.tsx`, not `index.ts` -- a deliberate, verified-by-hand
// deviation from this issue's own initial file-naming text (which lists
// `src/index.ts`), documented here rather than silently made. This barrel
// contains no literal JSX syntax of its own (pure re-exports only), so a
// `/** @jsxImportSource solid-js */` pragma is not needed for type-checking
// purposes (same reasoning as `useAnalytics.ts`'s own header comment). The
// `.tsx` extension is required for an entirely different, build-time reason:
// `tsup-preset-solid`'s own `"solid"` export-condition generation (see
// `tsup.config.ts`'s header comment and this package's `package.json`
// header comment for the full, verified-by-hand finding) is gated *purely*
// on the tsup entry file's own literal extension being `.tsx`/`.jsx`
// (confirmed by reading `tsup-preset-solid@2.2.0`'s own source,
// `dist/index.js`: `jsx: options.entry.endsWith(".jsx") ||
// options.entry.endsWith(".tsx")` -- content-independent, purely a
// filename-extension check). Since this issue's acceptance criteria firmly
// requires a working `"solid"` export condition (confirmed load-bearing:
// SolidStart/`vite-plugin-solid` resolve via it) *and* firmly requires
// following `tsup-preset-solid`'s own real, non-hand-rolled output rather
// than guessing a shape that might not match it, and a `.ts`-extensioned
// entry verifiably never receives a `"solid"` condition from the real,
// installed preset no matter what it re-exports, satisfying both
// constraints simultaneously requires this file to carry the `.tsx`
// extension. Everything else about this file (its exports, its role as the
// package's sole public barrel) is unchanged from the issue's own spec.
export { AnalyticsProvider, AnalyticsContext, type AnalyticsProviderProps } from "./AnalyticsProvider";
export { useAnalytics } from "./useAnalytics";

// Re-exported (not redefined) so a consumer can type its own `Events` map
// against `useAnalytics<MyEvents>()`/`<AnalyticsProvider analytics={...}>`
// without a separate direct dependency on `typetrack`.
export type { Analytics, EventMap } from "typetrack";
