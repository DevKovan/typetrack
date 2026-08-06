import { describe, expect, test } from "bun:test";
import { resolveValidationConfig } from "./index";

// Unit test for `resolveValidationConfig`'s pure decision logic -- exercised
// directly (no `createAnalytics()`, no provider, no I/O). This is the one
// piece of genuinely non-trivial pure logic this example's `index.ts`
// defines: the actual real-world recipe for shrinking a production bundle
// (guard BOTH `schemas` and `validate` behind the same env check). Everything
// else in `index.ts` is direct `typetrack` API calls or provider-stub
// construction, which belongs in `index.integration.test.ts` instead.

describe("resolveValidationConfig", () => {
  test("isProduction: false -> validate: true, schemas defined (the development/default behavior)", () => {
    const config = resolveValidationConfig(false);
    expect(config.validate).toBe(true);
    expect(config.schemas).toBeDefined();
    expect(config.schemas!["Order Placed"]).toBeDefined();
  });

  test("isProduction: true -> validate: false, schemas undefined (both guards flip together)", () => {
    const config = resolveValidationConfig(true);
    expect(config.validate).toBe(false);
    expect(config.schemas).toBeUndefined();
  });

  test("the two flags are never independent -- always the exact inverse of isProduction, together", () => {
    for (const isProduction of [true, false]) {
      const config = resolveValidationConfig(isProduction);
      expect(config.validate).toBe(!isProduction);
      expect(config.schemas === undefined).toBe(isProduction);
    }
  });
});
