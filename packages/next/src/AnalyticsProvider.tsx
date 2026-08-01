"use client";

// The directive above MUST be the literal first line of this file, before
// any import statement -- Next.js's compiler keys off of this exact
// placement to know this module (and everything it exclusively imports)
// needs to be bundled for the client. See the "Hook re-export note" in this
// issue's plan doc for why `useAnalytics` (re-exported from `./index.ts`
// instead) does not need this directive on its own defining file.
//
// This package exists solely to supply that boundary: `@typetrack/react`'s
// `AnalyticsProvider` itself deliberately carries no directive (a
// server/client split -- and therefore this directive -- is meaningless in
// a plain React app with no such split), so this is a thin, generic-
// preserving re-export, not a reimplementation.
//
// `tsup`/esbuild's bundler does not preserve a non-entry module's top-of-file
// directive when it gets inlined into `dist/index.js`/`dist/index.cjs` --
// esbuild only hoists a directive from the module that is itself the
// build's entry point. `tsup.config.ts` reinjects it as a `banner` instead,
// so the *shipped* `dist/` output (what a real Next.js app actually
// consumes) also starts with this directive, not just this source file.
export { AnalyticsProvider, type AnalyticsProviderProps } from "@typetrack/react";
