import { describe, expect, test } from "bun:test";
import type { DeprecatedEventsMap } from "typetrack";
import { deprecatedEventsConfig, describeCallSiteMigration } from "./index";

// Unit test for `describeCallSiteMigration`'s pure resolution logic --
// exercised directly against hand-built `DeprecatedEventsMap` configs, no
// `createAnalytics()`, no provider, no I/O. This is the one piece of
// genuinely non-trivial pure logic this example's `index.ts` defines:
// everything else is a direct `typetrack` API call or provider-stub
// construction, which belongs in `index.integration.test.ts` instead.

describe("describeCallSiteMigration", () => {
  test('"checkout_started", using this example\'s own config -> deprecated, fires as "Checkout Started"', () => {
    const status = describeCallSiteMigration("checkout_started", deprecatedEventsConfig);
    expect(status).toEqual({
      eventName: "checkout_started",
      isDeprecated: true,
      firesAs: "Checkout Started",
    });
  });

  test('"Checkout Started" (the new name) itself -> not deprecated, fires as given', () => {
    const status = describeCallSiteMigration("Checkout Started", deprecatedEventsConfig);
    expect(status).toEqual({
      eventName: "Checkout Started",
      isDeprecated: false,
      firesAs: "Checkout Started",
    });
  });

  test("an event name with no config entry at all -> not deprecated, fires as given", () => {
    const status = describeCallSiteMigration("Pricing Page Viewed", deprecatedEventsConfig);
    expect(status).toEqual({
      eventName: "Pricing Page Viewed",
      isDeprecated: false,
      firesAs: "Pricing Page Viewed",
    });
  });

  test("a deprecated entry with no replacement -> deprecated, but fires under its own original name", () => {
    const config: DeprecatedEventsMap = {
      legacy_signup: { message: "retired, no replacement" },
    };
    const status = describeCallSiteMigration("legacy_signup", config);
    expect(status).toEqual({
      eventName: "legacy_signup",
      isDeprecated: true,
      firesAs: "legacy_signup",
    });
  });

  test("an empty config -> every event name resolves as not deprecated", () => {
    const status = describeCallSiteMigration("checkout_started", {});
    expect(status.isDeprecated).toBe(false);
    expect(status.firesAs).toBe("checkout_started");
  });
});
