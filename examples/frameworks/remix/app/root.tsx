import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { AnalyticsProvider, AnalyticsPageView } from "@typetrack/remix";
import { analytics } from "./analytics";

// A minimal React Router v8 framework-mode root -- `<AnalyticsProvider>`
// wraps `<Outlet />` once, at the app root, exactly like a plain
// `@typetrack/react` app would (no `"use client"`-equivalent boundary
// needed -- React Router v8's default framework mode has no Server/Client
// Component split, see `plan/phase-14-framework-wrappers/BRIEF.md`'s
// Design decision 7). `<AnalyticsPageView />` fires one `.page()` call on
// mount and on every subsequent client-side route change, via
// `react-router`'s own `useLocation()`.
export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <AnalyticsProvider analytics={analytics}>
          <AnalyticsPageView />
          <Outlet />
        </AnalyticsProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
