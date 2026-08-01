// This package's client-marked `AnalyticsProvider` (see the `"use client"`
// directive at the top of `./AnalyticsProvider.tsx`) -- re-exported here so
// consumers only ever need `import { AnalyticsProvider } from
// "@typetrack/next"`, never a deep import into `./AnalyticsProvider`.
export { AnalyticsProvider, type AnalyticsProviderProps } from "./AnalyticsProvider";

// A plain re-export, deliberately *not* re-exported from
// `./AnalyticsProvider.tsx`: `useAnalytics` is a plain hook function with no
// JSX/Context instantiation of its own, so it carries no `"use client"`
// requirement of its own -- the client/server boundary that matters is at
// the call site (an already-`"use client"` component calling the hook), not
// at the hook's defining file. See this issue's plan doc, "Hook re-export
// note".
export { useAnalytics } from "@typetrack/react";

// Re-exported (not redefined) so a consumer can type its own `Events` map
// against `useAnalytics<MyEvents>()`/`<AnalyticsProvider analytics={...}>`
// without a separate direct dependency on `typetrack` or `@typetrack/react`.
export type { Analytics, EventMap } from "@typetrack/react";

// Automatic pageview tracking on client-side route change -- see
// `AnalyticsPageView.tsx`'s module-level comment. Carries its own
// `"use client"` directive (reinjected as this package's `tsup.config.ts`
// `banner` in the built `dist/` output, same as `AnalyticsProvider.tsx`).
export { AnalyticsPageView } from "./AnalyticsPageView";

// Re-exported alongside `AnalyticsPageView`: a consumer may want to unit
// test or customize the `.page()` call shape (e.g. wrap it, or build an
// equivalent tracker for a route not covered by this component) without
// reimplementing the `name`/`props` logic themselves. This is a plain
// function, not a component, so it carries no `"use client"` requirement of
// its own.
export { buildPageViewArgs, type PageViewArgs } from "./buildPageViewArgs";
