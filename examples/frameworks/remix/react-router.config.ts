// A minimal `react-router.config.ts` excerpt for a React Router v8
// framework-mode app (the "Remix" successor -- see
// `plan/phase-14-framework-wrappers/BRIEF.md`'s Design decision 7 for why
// `@typetrack/remix` targets `react-router: ^8.0.0`, never `@remix-run/*`).
// `@typetrack/remix` needs no framework-mode-specific config of its own --
// it's a thin re-export of `@typetrack/react`'s `AnalyticsProvider`/
// `useAnalytics` plus a router-aware `AnalyticsPageView`, both plain React
// components/hooks, nothing framework-mode-config-shaped.
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
} satisfies Config;
