// Compile-time-only verification that `useAnalytics<Events>()`'s generic
// return type still flows through to a strongly-typed `Analytics<Events>`
// binding, and that `.track()` on that binding still enforces per-event
// payload shapes. This is *not* a runtime assertion of that genericity --
// `useTypecheckOnlyAnalyticsGenerics` below is declared but deliberately
// never invoked (it can't be: it calls `useAnalytics()`, which requires
// Svelte's own "component initialization" window -- there is no surrounding
// component here at all). `bun run typecheck` / `typecheck:tsc` (already
// run in CI) are what actually exercise this file: a regression in
// `useAnalytics`'s generic plumbing surfaces as a type error there, not as a
// failing runtime assertion in this file. Mirrors
// `packages/react/src/useAnalytics.typecheck.test.tsx`/`packages/vue/src/
// useAnalytics.typecheck.test.ts`'s own established precedent exactly.
//
// No DOM/`testSetup` import is needed here: nothing in this file ever
// renders or calls anything at runtime.
import { describe, expect, it } from "bun:test";
import type { Analytics, EventMap } from "typetrack";
import { useAnalytics } from "./context";

interface MyTestEvents extends EventMap {
  signup_completed: { plan: "free" | "pro" };
}

function useTypecheckOnlyAnalyticsGenerics() {
  const analytics: Analytics<MyTestEvents> = useAnalytics<MyTestEvents>();

  // Valid payload for `signup_completed`.
  analytics.track("signup_completed", { plan: "pro" });

  // @ts-expect-error -- `plan` must be "free" | "pro", not an arbitrary string.
  analytics.track("signup_completed", { plan: "enterprise" });
}

describe("useAnalytics generics (typecheck-only, see comments above)", () => {
  it("is exported as a function -- the real assertion here is compile-time, via bun run typecheck", () => {
    expect(typeof useAnalytics).toBe("function");
    expect(typeof useTypecheckOnlyAnalyticsGenerics).toBe("function");
  });
});
