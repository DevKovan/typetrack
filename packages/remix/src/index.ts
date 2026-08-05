// Plain re-exports of `@typetrack/react`'s `AnalyticsProvider`/`useAnalytics`,
// unmodified -- this package is a thin layer on top of `@typetrack/react`,
// not a reimplementation (mirrors how `@typetrack/next`'s own `useAnalytics`
// re-export is documented). Unlike `@typetrack/next`, no `"use client"`
// boundary file wraps `AnalyticsProvider` here: React Router v8's default
// framework mode has no Server/Client Component split, so a plain React
// Context provider works directly with zero boundary-marking needed -- see
// `plan/phase-14-framework-wrappers/006-remix-react-router-wrapper.md`
// Context for the full research finding.
export { AnalyticsProvider, type AnalyticsProviderProps, useAnalytics } from "@typetrack/react";

// Re-exported (not redefined) so a consumer can type its own `Events` map
// against `useAnalytics<MyEvents>()`/`<AnalyticsProvider analytics={...}>`
// without a separate direct dependency on `typetrack` or `@typetrack/react`.
export type { Analytics, EventMap } from "@typetrack/react";

// Automatic pageview tracking on client-side route change, via
// `react-router`'s `useLocation()` -- see `AnalyticsPageView.tsx`'s
// module-level comment. This package's own genuinely new code (the
// router-aware piece), not a re-export.
export { AnalyticsPageView } from "./AnalyticsPageView";

// Re-exported alongside `AnalyticsPageView`: a consumer may want to unit
// test or customize the `.page()` call shape (e.g. wrap it, or build an
// equivalent tracker for a route not covered by this component) without
// reimplementing the `name`/`props` logic themselves. This is a plain
// function, not a component.
export { buildPageViewArgs, type PageViewArgs } from "./buildPageViewArgs";
