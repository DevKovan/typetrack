/** @jsxImportSource solid-js */
// Compile-time-only verification that `useAnalytics<Events>()`'s generic
// return type still flows through to a strongly-typed `Analytics<Events>`
// binding, and that `.track()` on that binding still enforces per-event
// payload shapes -- mirrors `packages/react/src/useAnalytics.typecheck.test.
// tsx`/`packages/svelte/src/useAnalytics.typecheck.test.ts`'s own
// established precedent exactly. This is *not* a runtime assertion of that
// genericity -- `useTypecheckOnlyAnalyticsGenerics` below is declared but
// deliberately never invoked (it can't be: it calls `useAnalytics()`, which
// requires a Solid reactive-root/component-tree context to resolve against
// -- there is no surrounding `<AnalyticsProvider>` here at all). `bun run
// typecheck` / `typecheck:tsc` (both run in CI) are what actually exercise
// this file: a regression in `useAnalytics`'s generic plumbing, or in
// `AnalyticsProviderProps`'s own `children: JSX.Element` typing, surfaces as
// a type error here, not as a failing runtime assertion in this file.
//
// `.tsx`, carrying its own pragma, per this issue's own explicit test
// requirement -- verified as genuinely load-bearing here (not merely
// decorative): `childrenType` below is typed against
// `AnalyticsProviderProps<MyTestEvents>["children"]`, which resolves to
// `JSX.Element` -- the `solid-js/jsx-runtime` one, per this file's own
// pragma. Without this file's own pragma, that reference would instead
// resolve against the shared root `tsconfig.json`'s `"jsx": "react-jsx"`
// default (React's `JSX` namespace), a structurally different type.
//
// `useAnalytics` (and, transitively, `AnalyticsProvider.tsx`'s own real
// JSX) is pulled in via a *dynamic* `await import(...)`, not a static
// `import`, deliberately -- verified by hand: a *static* import here would
// have `AnalyticsProvider.tsx` parsed/transformed as part of building this
// file's own static module graph, strictly before `import "./testSetup"`'s
// `@dschz/bun-plugin-solid` registration (itself runtime code) has any
// chance to run, so Bun's own default (non-Solid-aware) JSX transform would
// handle it instead and crash with
// `SyntaxError: Export named 'jsxDEV' not found in module ...solid-js/
// dist/solid.js` -- reproduced directly. See `AnalyticsProvider.test.ts`'s
// own header comment for the identical, general ordering constraint every
// `.tsx`-reaching import in this package's tests must respect.
import "./testSetup";

import { describe, expect, it } from "bun:test";
import type { Analytics, EventMap } from "typetrack";
import type { JSX } from "solid-js";
import type { AnalyticsProviderProps } from "./AnalyticsProvider";

const { useAnalytics } = await import("./useAnalytics");

interface MyTestEvents extends EventMap {
  signup_completed: { plan: "free" | "pro" };
}

function useTypecheckOnlyAnalyticsGenerics() {
  const analytics: Analytics<MyTestEvents> = useAnalytics<MyTestEvents>();

  // Valid payload for `signup_completed`.
  analytics.track("signup_completed", { plan: "pro" });

  // @ts-expect-error -- `plan` must be "free" | "pro", not an arbitrary string.
  analytics.track("signup_completed", { plan: "enterprise" });

  // Exercises `AnalyticsProviderProps<Events>["children"]`'s own
  // `JSX.Element` typing against the ambient `JSX` namespace this file's
  // pragma redirects, without needing any literal JSX syntax of its own.
  const childrenType: AnalyticsProviderProps<MyTestEvents>["children"] = null as unknown as JSX.Element;

  return { analytics, childrenType };
}

describe("useAnalytics generics (typecheck-only, see comments above)", () => {
  it("is exported as a function -- the real assertion here is compile-time, via bun run typecheck", () => {
    expect(typeof useAnalytics).toBe("function");
    expect(typeof useTypecheckOnlyAnalyticsGenerics).toBe("function");
  });
});
