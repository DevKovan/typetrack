// The literal script source injected into every Astro page via
// `injectScript("page", ...)` (see `index.ts`'s `astro:config:setup`
// hook) -- extracted into its own pure, directly unit-testable function
// specifically so its exact output (the static import specifier, the
// `astro:page-load` listener wiring, the `dispatchPageView` delegation)
// has a real unit test, mirroring `@typetrack/next`'s
// `buildPageViewArgs.ts` "extract the pure logic" precedent (see this
// issue's plan doc, `plan/phase-14-framework-wrappers/
// 005-astro-integration.md`).
//
// Import-binding names, documented (per this issue's own "document the
// exact delegation shape" instruction): the app-authored `analyticsModule`
// file's default export is bound locally as `analytics`; core's dedup
// helper is imported by its real, public name, `dispatchPageView`, from
// `typetrack`'s own barrel (the same helper `src/plugins/autoPage.ts`
// exports and every other route-tracking piece in this phase reuses --
// see that file's own header comment).
//
// Both `import` lines are processed and resolved by Astro's own build
// pipeline (Vite) exactly like any other client-side import in an Astro
// project, since `injectScript`'s `"page"` stage is Vite-processed (per
// Astro's own `InjectedScriptStage` doc comment: "Injected into the
// JavaScript bundle of every page. Processed & resolved by Vite.") --
// `analyticsModule`'s string value is JSON-stringified into the specifier
// position, so it's always a syntactically valid string literal
// regardless of the path shape the app supplies.
//
// `astro:page-load` fires once on Astro's initial page load and again on
// every subsequent View-Transitions/ClientRouter navigation -- covering
// both Astro's default full-MPA-reload mode (where it fires once per real
// navigation naturally, since each is a fresh page load) and
// View-Transitions-enabled SPA-style navigation, with one listener, no
// branching needed. `props` mirrors `buildPageViewArgs.ts`'s existing
// shape exactly: a `search` key present only when the query string is
// non-empty, omitted entirely (not `props: undefined` as a JS value --
// the object literal below simply doesn't include a `search` key) when
// there's no query string.
//
// **Runtime-testability note** (see `buildPageLoadScript.test.ts`'s own
// "runtime behavior" describe block): the two `import` lines below are
// real ES module syntax, which neither `eval()` nor `new Function(...)`
// can execute outside an actual module context -- there is no dynamic-
// `import()`-inside-`eval` composition that works meaningfully in a
// `bun test` process without a real Vite/Astro bundler actually resolving
// `analyticsModule`/`typetrack`. This package's own test file works
// around that -- not by changing this function's output shape, but by
// stripping lines that begin with `import ` before evaluating the
// remainder (the `astro:page-load` listener registration and the
// `dispatchPageView` call) via `new Function("analytics",
// "dispatchPageView", <remaining source>)`, standing `analytics`/
// `dispatchPageView` in as injected function parameters instead of
// resolved imports -- everything below the import lines is genuine,
// unmodified runtime logic exercised as real, executed code, not just
// asserted against as a string.
export function buildPageLoadScript(analyticsModule: string): string {
  return `import analytics from ${JSON.stringify(analyticsModule)};
import { dispatchPageView } from "typetrack";

function handleAstroPageLoad() {
  var search = location.search;
  var args = search.length > 0
    ? { name: location.pathname, props: { search: search } }
    : { name: location.pathname };
  dispatchPageView(analytics, args);
}

document.addEventListener("astro:page-load", handleAstroPageLoad);
`;
}
