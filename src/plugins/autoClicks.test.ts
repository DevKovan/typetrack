// Unit tests for Phase 10 issue 003's `computeClickProperties` (pure
// element-to-properties mapping, exercised against hand-constructed
// DOM-like stub objects -- no `createAnalytics()`, no providers, no browser
// globals). `autoClicks()`'s full setup/click/teardown round trip is
// exercised by `autoClicks.integration.test.ts` instead.
import { describe, expect, it } from "bun:test";
import { computeClickProperties, type MinimalElement } from "./autoClicks";

function makeElement(overrides: Partial<MinimalElement> = {}): MinimalElement {
  return {
    tagName: "DIV",
    ...overrides,
  };
}

describe("computeClickProperties", () => {
  it("lowercases tagName", () => {
    expect(computeClickProperties(makeElement({ tagName: "BUTTON" })).tag).toBe("button");
  });

  it("includes id when present", () => {
    const result = computeClickProperties(makeElement({ id: "submit-button" }));
    expect(result.id).toBe("submit-button");
  });

  it("omits id (undefined) when empty string", () => {
    const result = computeClickProperties(makeElement({ id: "" }));
    expect(result.id).toBeUndefined();
  });

  it("includes classes when present", () => {
    const result = computeClickProperties(makeElement({ className: "btn btn-primary" }));
    expect(result.classes).toBe("btn btn-primary");
  });

  it("omits classes (undefined) when empty string", () => {
    const result = computeClickProperties(makeElement({ className: "" }));
    expect(result.classes).toBeUndefined();
  });

  it("trims and truncates textContent to 200 chars", () => {
    const result = computeClickProperties(makeElement({ textContent: "  hello world  " }));
    expect(result.text).toBe("hello world");
  });

  it("truncates textContent longer than 200 characters", () => {
    const longText = "a".repeat(250);
    const result = computeClickProperties(makeElement({ textContent: longText }));
    expect(result.text).toBe("a".repeat(200));
  });

  it("omits text (undefined) when textContent is null/undefined/whitespace-only", () => {
    expect(computeClickProperties(makeElement({ textContent: null })).text).toBeUndefined();
    expect(computeClickProperties(makeElement({ textContent: undefined })).text).toBeUndefined();
    expect(computeClickProperties(makeElement({ textContent: "   " })).text).toBeUndefined();
  });

  it("includes href when present (anchor-like element)", () => {
    const result = computeClickProperties(makeElement({ tagName: "A", href: "https://example.com/" }));
    expect(result.href).toBe("https://example.com/");
  });

  it("omits href (undefined) when absent", () => {
    const result = computeClickProperties(makeElement({}));
    expect(result.href).toBeUndefined();
  });

  it("returns the full documented shape for a fully-populated element", () => {
    const result = computeClickProperties(
      makeElement({
        tagName: "A",
        id: "cta",
        className: "link primary",
        textContent: "Sign up",
        href: "https://example.com/signup",
      }),
    );

    expect(result).toEqual({
      tag: "a",
      id: "cta",
      classes: "link primary",
      text: "Sign up",
      href: "https://example.com/signup",
    });
  });
});
