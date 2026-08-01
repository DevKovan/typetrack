"use client";

// The directive above MUST be the literal first line of this file, before
// any import statement -- see `AnalyticsProvider.tsx`'s module-level comment
// for why (the same Next.js compiler contract, and the same `tsup.config.ts`
// `banner` reinjection, apply here).
//
// Automatic pageview tracking on client-side route change, per this issue's
// plan doc: the App Router has no built-in "route changed" event for Client
// Components, so this reads `usePathname()`/`useSearchParams()` from
// `next/navigation` and fires `.page()` via `useEffect` on change -- the
// established pattern from comparable published Next.js analytics
// integrations (see plan doc Context).
//
// `useSearchParams()` requires an ancestor `<Suspense>` boundary in the App
// Router (or Next's static-generation build fails). Most published examples
// require the *consumer* to supply that boundary. This component instead
// wraps its own `usePathname`/`useSearchParams`-consuming logic in its own
// internal `<Suspense fallback={null}>`, so `<AnalyticsPageView />` can be
// dropped in with zero additional Suspense setup by the consumer -- see plan
// doc Context for why this one extra wrapping component is still consistent
// with "as thin as the real requirement".
import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAnalytics } from "@typetrack/react";
import { buildPageViewArgs } from "./buildPageViewArgs";

// The actual hook-consuming logic, kept separate from the exported
// `AnalyticsPageView` only so that component can wrap it in its own
// `<Suspense>` boundary -- `useSearchParams()` itself must be called from
// inside that boundary, not merely rendered under one, so the Suspense
// wrapping happens one component level up from the hook calls.
function AnalyticsPageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const analytics = useAnalytics();

  // The query string, not the `searchParams` object itself, is the
  // dependency here: `next/navigation` gives no guarantee that
  // `useSearchParams()` returns a referentially stable object across
  // renders with unchanged params, so depending on the object reference
  // would risk firing `.page()` again on an unrelated parent re-render --
  // exactly the duplicate-call bug the effect's dependency array must
  // avoid, per this issue's Acceptance criteria.
  const search = searchParams.toString();

  useEffect(() => {
    const { name, props } = buildPageViewArgs(pathname, searchParams);

    analytics.page(name, props);
    // `searchParams` is deliberately omitted from the dependency array in
    // favor of its derived, stable `search` string -- see the comment above
    // `const search = searchParams.toString();`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, analytics]);

  // A tracking-only component: no visible DOM output of its own.
  return null;
}

// Exported entry point. Takes no required props; usable as
// `<AnalyticsPageView />` inside (a descendant of) an `AnalyticsProvider`.
// Renders no visible DOM output of its own.
export function AnalyticsPageView() {
  return (
    <Suspense fallback={null}>
      <AnalyticsPageViewTracker />
    </Suspense>
  );
}
