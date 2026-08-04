// The pure, non-component logic behind `AnalyticsPageView`'s `.page()` call,
// deliberately extracted into its own plain function (not inlined into the
// `useEffect` in `AnalyticsPageView.tsx`) so it has a true unit test that
// doesn't require rendering anything -- see this issue's plan doc,
// "Testability decision".
//
// `.page()` argument shape decision (see this issue's plan doc, "`.page()`
// argument shape decision"): `name` is always the current pathname -- a
// clean route identifier, with no query string mixed in. `props` surfaces
// the query string as structured, optional data under a `search` key, and
// is omitted entirely (not present as `props: undefined`) when the query
// string is empty, so a plain pathname-only `.page(name)` call is made for
// routes with no search params, matching core's own optional-`props`
// `page(name?, props?)` signature.
//
// `PageViewArgs` itself is no longer declared here (Phase 10 issue 006): it
// is imported from `typetrack`'s own public barrel, where `dispatchPageView`
// (see `AnalyticsPageView.tsx`) and the built-in `autoPage()` plugin already
// define/consume this exact shape (Phase 10 issue 002) -- re-exported below
// so existing `@typetrack/next` consumers importing `PageViewArgs` from this
// package keep working unchanged.
import type { PageViewArgs } from "typetrack";

export type { PageViewArgs };

// `searchParams` is typed against `next/navigation`'s real
// `useSearchParams()` return type (`URLSearchParams`, specifically Next's
// read-only `ReadonlyURLSearchParams` subtype) via the minimal structural
// `{ toString(): string }` shape -- this function needs nothing more than
// that one method, and typing it structurally (rather than importing
// `next/navigation`'s type here) keeps this module trivially unit-testable
// with a plain `URLSearchParams` and requires no Next.js runtime context.
export function buildPageViewArgs(
  pathname: string,
  searchParams: URLSearchParams | { toString(): string },
): PageViewArgs {
  const search = searchParams.toString();

  return search.length > 0 ? { name: pathname, props: { search } } : { name: pathname };
}
