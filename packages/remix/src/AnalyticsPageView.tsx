// Automatic pageview tracking on client-side route change, for a React
// Router v8 framework-mode app. Unlike `@typetrack/next`'s equivalent (which
// needs two separate hooks, `usePathname()`/`useSearchParams()`, and its own
// internal `<Suspense>` boundary around the latter), `react-router`'s
// `useLocation()` already exposes both `pathname` and `search` together from
// a single hook, with no Suspense requirement of its own -- see this
// package's plan doc
// (`plan/phase-14-framework-wrappers/006-remix-react-router-wrapper.md`)
// Context for the full "why no Suspense wrapper" research finding. This file
// carries no `"use client"`-equivalent directive either: React Router v8's
// default framework mode has no Server/Client Component split (see the same
// Context section) -- a plain, undirected React component works directly.
import { useEffect } from "react";
import { useLocation } from "react-router";
import { useAnalytics } from "@typetrack/react";
import { dispatchPageView } from "typetrack";
import { buildPageViewArgs } from "./buildPageViewArgs";

// Exported entry point. Takes no required props; usable as
// `<AnalyticsPageView />` inside (a descendant of) an `AnalyticsProvider`.
// Renders no visible DOM output of its own.
export function AnalyticsPageView() {
  const location = useLocation();
  const analytics = useAnalytics();

  // `pathname`/`search` (the derived string fields), not `location` itself,
  // are the effect's dependencies: `react-router` gives no guarantee that
  // `useLocation()` returns a referentially stable object across renders
  // with an otherwise-unchanged route (it also carries `hash`/`state`/`key`,
  // any of which could change independently), so depending on the object
  // reference would risk firing `.page()` again on an unrelated parent
  // re-render -- exactly the duplicate-call bug the effect's dependency
  // array must avoid, per this issue's Acceptance criteria (mirrors
  // `@typetrack/next`'s `AnalyticsPageView.tsx` reasoning for the same
  // choice).
  const { pathname, search } = location;

  useEffect(() => {
    const { name, props } = buildPageViewArgs(pathname, search);

    // Delegates to the same shared, dedup-aware dispatch helper every other
    // framework's route-tracking piece in this phase reuses (`typetrack`'s
    // `dispatchPageView`, Phase 10 issue 002) instead of calling
    // `analytics.page(name, props)` directly -- genuine code reuse, with
    // React Strict Mode's development-only double-invoked effects no longer
    // producing two delivered page views for one real navigation as a
    // welcome side effect (same behavior `@typetrack/next`'s equivalent
    // relies on).
    dispatchPageView(analytics, { name, props });
    // `location` is deliberately omitted from the dependency array in favor
    // of its derived, stable `pathname`/`search` fields -- see the comment
    // above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, analytics]);

  // A tracking-only component: no visible DOM output of its own.
  return null;
}
