import { describe, expect, test } from "bun:test";
import { categorizeOutcome } from "./index";

// Unit test for `categorizeOutcome`'s pure categorization logic -- exercised
// directly with hand-picked boolean inputs, no `createAnalytics()`, no
// providers, no I/O. Per the issue's "a unit test is required only if
// index.ts contains non-trivial pure logic" rule: this is the one piece of
// genuinely non-trivial pure logic this example's `index.ts` defines (the
// defensive "impossible combination" branch is exactly the kind of logic
// worth isolating and asserting on directly, independent of whatever a real
// sampled run happens to produce). Everything else in `index.ts` is direct
// `typetrack` API calls, provider-stub construction, or built-in middleware
// configuration, which belongs in `index.integration.test.ts` instead.

describe("categorizeOutcome", () => {
  test('both false -> "globally-dropped"', () => {
    expect(categorizeOutcome(false, false)).toBe("globally-dropped");
  });

  test('warehouse only -> "vendor-excluded"', () => {
    expect(categorizeOutcome(true, false)).toBe("vendor-excluded");
  });

  test('both true -> "delivered-to-both"', () => {
    expect(categorizeOutcome(true, true)).toBe("delivered-to-both");
  });

  test("vendor-only (warehouse false, vendor true) throws -- this combination should be unreachable given VENDOR_SAMPLING_RATE < GLOBAL_SAMPLING_RATE", () => {
    expect(() => categorizeOutcome(false, true)).toThrow(/unreachable combination/);
  });
});
