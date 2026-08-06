// Unit tests for `src/deprecation.ts` (Phase 15 issue 001). Pure logic, no
// I/O -- per the issue's "Testing" section, no integration test is needed
// for this issue since nothing wires into `createAnalytics()` yet (issue
// 002 owns that, and its own integration tests).
import { describe, expect, it } from "bun:test";
import { formatDeprecationWarning, resolveDeprecatedEvent } from "./deprecation";
import type { DeprecatedEventsMap } from "./deprecation";

describe("resolveDeprecatedEvent", () => {
  it("resolves to not-deprecated when deprecatedEvents is undefined", () => {
    const result = resolveDeprecatedEvent("checkout_started", undefined);
    expect(result).toEqual({ name: "checkout_started", deprecated: false });
  });

  it("resolves to not-deprecated when the event isn't in the map", () => {
    const deprecatedEvents: DeprecatedEventsMap = {
      other_event: { message: "unrelated" },
    };
    const result = resolveDeprecatedEvent("checkout_started", deprecatedEvents);
    expect(result).toEqual({ name: "checkout_started", deprecated: false });
  });

  it("resolves to deprecated with the original name when there's no replacement", () => {
    const deprecatedEvents: DeprecatedEventsMap = {
      checkout_started: { message: "retired, no replacement" },
    };
    const result = resolveDeprecatedEvent("checkout_started", deprecatedEvents);
    expect(result.name).toBe("checkout_started");
    expect(result.deprecated).toBe(true);
    expect(result.info).toEqual(deprecatedEvents.checkout_started);
  });

  it("resolves to deprecated with the replacement name when one is present", () => {
    const deprecatedEvents: DeprecatedEventsMap = {
      checkout_started: { replacement: "Checkout Started" },
    };
    const result = resolveDeprecatedEvent("checkout_started", deprecatedEvents);
    expect(result.name).toBe("Checkout Started");
    expect(result.deprecated).toBe(true);
    expect(result.info).toEqual(deprecatedEvents.checkout_started);
  });

  it("is pure and never mutates its inputs", () => {
    const deprecatedEvents: DeprecatedEventsMap = {
      checkout_started: { replacement: "Checkout Started" },
    };
    const snapshot = structuredClone(deprecatedEvents);
    resolveDeprecatedEvent("checkout_started", deprecatedEvents);
    expect(deprecatedEvents).toEqual(snapshot);
  });

  it("never throws for an empty deprecatedEvents map", () => {
    expect(() => resolveDeprecatedEvent("checkout_started", {})).not.toThrow();
    expect(resolveDeprecatedEvent("checkout_started", {})).toEqual({
      name: "checkout_started",
      deprecated: false,
    });
  });
});

describe("formatDeprecationWarning", () => {
  it("formats a bare warning with no replacement, message, or sunsetDate", () => {
    const message = formatDeprecationWarning("checkout_started", {});
    expect(message).toContain('typetrack: event "checkout_started" is deprecated');
    expect(message).not.toContain("use \"");
    expect(message).not.toContain("Planned removal");
  });

  it("appends the replacement when present, without message or sunsetDate", () => {
    const message = formatDeprecationWarning("checkout_started", {
      replacement: "Checkout Started",
    });
    expect(message).toContain('typetrack: event "checkout_started" is deprecated');
    expect(message).toContain('use "Checkout Started" instead');
    expect(message).not.toContain("Planned removal");
  });

  it("appends the sunsetDate when present, without replacement or message", () => {
    const message = formatDeprecationWarning("checkout_started", {
      sunsetDate: "2026-12-01",
    });
    expect(message).toContain('typetrack: event "checkout_started" is deprecated');
    expect(message).not.toContain("use \"");
    expect(message).toContain("Planned removal: 2026-12-01.");
  });

  it("appends the message when present, without replacement or sunsetDate", () => {
    const message = formatDeprecationWarning("checkout_started", {
      message: "Also drop the legacy \"source\" property -- it's unused downstream.",
    });
    expect(message).toContain('typetrack: event "checkout_started" is deprecated');
    expect(message).not.toContain("use \"");
    expect(message).not.toContain("Planned removal");
    expect(message).toContain("Also drop the legacy \"source\" property");
  });

  it("appends replacement and sunsetDate together, without message", () => {
    const message = formatDeprecationWarning("checkout_started", {
      replacement: "Checkout Started",
      sunsetDate: "2026-12-01",
    });
    expect(message).toContain('use "Checkout Started" instead');
    expect(message).toContain("Planned removal: 2026-12-01.");
    expect(message.indexOf('use "Checkout Started" instead')).toBeLessThan(
      message.indexOf("Planned removal"),
    );
  });

  it("appends replacement and message together, without sunsetDate", () => {
    const message = formatDeprecationWarning("checkout_started", {
      replacement: "Checkout Started",
      message: "See the migration guide.",
    });
    expect(message).toContain('use "Checkout Started" instead');
    expect(message).not.toContain("Planned removal");
    expect(message).toContain("See the migration guide.");
  });

  it("appends sunsetDate and message together, without replacement", () => {
    const message = formatDeprecationWarning("checkout_started", {
      sunsetDate: "2026-12-01",
      message: "See the migration guide.",
    });
    expect(message).not.toContain("use \"");
    expect(message).toContain("Planned removal: 2026-12-01.");
    expect(message).toContain("See the migration guide.");
  });

  it("appends replacement, sunsetDate, and message together, in that order", () => {
    const message = formatDeprecationWarning("checkout_started", {
      replacement: "Checkout Started",
      sunsetDate: "2026-12-01",
      message: 'Also drop the legacy "source" property -- it\'s unused downstream.',
    });
    expect(message).toContain('typetrack: event "checkout_started" is deprecated');
    expect(message).toContain('use "Checkout Started" instead');
    expect(message).toContain("Planned removal: 2026-12-01.");
    expect(message).toContain('Also drop the legacy "source" property');

    const useIndex = message.indexOf('use "Checkout Started" instead');
    const removalIndex = message.indexOf("Planned removal");
    const legacyIndex = message.indexOf("Also drop the legacy");
    expect(useIndex).toBeLessThan(removalIndex);
    expect(removalIndex).toBeLessThan(legacyIndex);
  });

  it("is pure and never mutates its inputs", () => {
    const info = { replacement: "Checkout Started", sunsetDate: "2026-12-01" };
    const snapshot = structuredClone(info);
    formatDeprecationWarning("checkout_started", info);
    expect(info).toEqual(snapshot);
  });
});
