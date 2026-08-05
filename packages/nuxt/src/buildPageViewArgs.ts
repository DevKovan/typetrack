import type { PageViewArgs } from "typetrack";

export type { PageViewArgs };

// Structural, minimal input type -- exactly the two fields of Vue Router's
// real `RouteLocationNormalized`/`RouteLocationNormalizedLoaded` this
// function actually reads (mirrors `@typetrack/next`'s own
// `buildPageViewArgs.ts` structural-typing choice for `searchParams`, so
// this package incurs no direct `vue-router` type dependency of its own --
// `nuxt`'s own peer dependency already ships those types for
// `runtime/*.ts`'s real `useRouter()` call sites).
export interface RouteLike {
  path: string;
  fullPath: string;
}

// Extracts the exact query-string substring of `fullPath` (the part after
// `?`, before any `#` fragment) -- not a re-serialization via
// `URLSearchParams` (unlike `@typetrack/next`'s version, which starts from
// an already-parsed `URLSearchParams`): Vue Router's `fullPath` already IS
// the real, exact URL string, so slicing it directly avoids any risk of
// reordering/re-encoding drift a parse-then-`toString()` round trip could
// introduce.
function extractSearch(fullPath: string): string {
  const queryStart = fullPath.indexOf("?");
  if (queryStart === -1) return "";

  const hashStart = fullPath.indexOf("#", queryStart);
  return hashStart === -1 ? fullPath.slice(queryStart + 1) : fullPath.slice(queryStart + 1, hashStart);
}

// The pure, non-plugin logic behind both `runtime/plugin.ts`'s installed
// analytics instance's page tracking and
// `runtime/registerPageViewTracking.ts`'s dispatch calls -- mirrors
// `@typetrack/next`'s `buildPageViewArgs.ts` shape/reasoning exactly (same
// `name`/`props.search`-when-non-empty contract, for cross-framework
// consistency), adapted to Vue Router's `RouteLocationNormalized` shape
// instead of Next's `usePathname()`/`useSearchParams()` pair.
export function buildPageViewArgs(route: RouteLike): PageViewArgs {
  const search = extractSearch(route.fullPath);

  return search.length > 0 ? { name: route.path, props: { search } } : { name: route.path };
}
