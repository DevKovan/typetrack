// Unit test for Phase 10 issue 001's `Plugin` type. `Plugin` itself has no
// runtime logic to exercise in isolation (it's a bare function type, not a
// registry/chain-runner like `Middleware`'s `runBeforeChain`/`runAfterChain`)
// -- this file is deliberately minimal, asserting only that the shape
// compiles and is invocable as documented. The registration/teardown
// mechanism this type feeds into (`createAnalytics({ plugins })`,
// `destroy()`'s teardown walk) is exercised end-to-end by the integration
// tests in `src/index.test.ts` instead, per this issue's "implementor's
// call" on where to draw this line.
import { describe, expect, it } from "bun:test";
import type { Analytics } from "./index";
import type { Plugin } from "./plugins";

describe("Plugin", () => {
  it("a plugin returning a teardown function compiles and is invocable with an Analytics-shaped instance", () => {
    let torndown = false;
    const plugin: Plugin = (analytics) => {
      // The instance is usable from inside a plugin at setup time -- calling
      // a verb here must not throw.
      expect(typeof analytics.track).toBe("function");
      return () => {
        torndown = true;
      };
    };

    const fakeAnalytics = { track: () => {} } as unknown as Analytics<any>;
    const teardown = plugin(fakeAnalytics);

    expect(typeof teardown).toBe("function");
    teardown!();
    expect(torndown).toBe(true);
  });

  it("a plugin returning nothing (undefined) also satisfies the type -- no teardown to invoke", () => {
    const plugin: Plugin = (_analytics) => {
      // one-shot plugin, e.g. Phase 10's autoUTM -- nothing to tear down.
    };

    const fakeAnalytics = { track: () => {} } as unknown as Analytics<any>;
    const teardown = plugin(fakeAnalytics);

    expect(teardown).toBeUndefined();
  });
});
