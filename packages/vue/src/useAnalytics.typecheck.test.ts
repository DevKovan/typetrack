// Compile-time-only verification that `useAnalytics<Events>()`'s generic
// return type still flows through to a strongly-typed `Analytics<Events>`
// binding, and that `.track()` on that binding still enforces per-event
// payload shapes. Mirrors
// `packages/react/src/useAnalytics.typecheck.test.tsx`'s own precedent
// exactly (see that file's header comment for the full reasoning) -- this
// is *not* a runtime assertion of that genericity;
// `useTypecheckOnlyAnalyticsGenerics` below is declared but deliberately
// never invoked (it can't be: it calls a composable, and `inject()` only
// works inside a real component's `setup()`, which no code here provides).
// `bun run typecheck` / `typecheck:tsc` (already run in CI) are what
// actually exercise this file: a regression in `useAnalytics`'s generic
// plumbing surfaces as a type error there, not as a failing runtime
// assertion in this file.
//
// Nothing in this file ever mounts or calls anything at runtime, so no
// `@vue/test-utils`/DOM rendering happens here. `import "./testSetup"` is
// still included first, though, defensively: this file's own import of
// `./useAnalytics` transitively loads `vue`, and `vue` must not be the
// *first* thing in the whole `bun test` process to load `@vue/runtime-dom`
// (which permanently caches whatever `document` reference exists at that
// moment) -- see `./testSetup.ts`'s own header comment for the full
// reasoning. `bun test`'s cross-file module registry caches `./testSetup`
// itself (so `register()` only ever runs once, however many files import
// it), so this costs nothing even though this file never renders anything.
import "./testSetup";

import { describe, expect, it } from "bun:test";
import type { Analytics, EventMap } from "typetrack";

const { useAnalytics } = require("./useAnalytics") as typeof import("./useAnalytics");

interface MyTestEvents extends EventMap {
  signup_completed: { plan: "free" | "pro" };
}

// Named with a `use` prefix so this reads as (and is) a composable, even
// though it is never actually called.
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
