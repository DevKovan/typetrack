// The pure, non-component logic behind `AnalyticsPageView`'s `.page()` call,
// deliberately extracted into its own plain function (not inlined into the
// `useEffect` in `AnalyticsPageView.tsx`) so it has a true unit test that
// doesn't require rendering anything or a `react-router` routing context --
// mirrors `@typetrack/next`'s `buildPageViewArgs.ts` exactly (same
// reasoning, same "Testability decision").
//
// `.page()` argument shape decision, same contract as `@typetrack/next`'s
// `buildPageViewArgs.ts` (and `@typetrack/nuxt`'s equivalent), for
// cross-framework consistency: `name` is always the current pathname -- a
// clean route identifier, with no query string mixed in. `props` surfaces
// the query string as structured, optional data under a `search` key, and
// is omitted entirely (not present as `props: undefined`) when the query
// string is empty, so a plain pathname-only `.page(name)` call is made for
// routes with no search params.
//
// Unlike `@typetrack/next`'s version (which takes a `URLSearchParams`-shaped
// second argument, matching `usePathname()`/`useSearchParams()`'s two
// separate hooks), this takes a plain `search` string directly --
// `react-router`'s `useLocation()` already exposes `location.search` as a
// single string (e.g. `"?tab=billing"`, including the leading `?`, or `""`
// when empty), a simpler shape than Next's `URLSearchParams` object, per
// this issue's Context ("a single hook already exposes both `pathname` and
// `search` together").
import type { PageViewArgs } from "typetrack";

export type { PageViewArgs };

export function buildPageViewArgs(pathname: string, search: string): PageViewArgs {
  // `location.search` includes a leading `"?"` when non-empty (e.g.
  // `"?tab=billing"`) -- stripped here so the reported `props.search` value
  // is the bare query string (`"tab=billing"`), matching
  // `@typetrack/next`'s `buildPageViewArgs.ts` exactly (its
  // `URLSearchParams#toString()` never includes a leading `"?"`).
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;

  return normalizedSearch.length > 0
    ? { name: pathname, props: { search: normalizedSearch } }
    : { name: pathname };
}
