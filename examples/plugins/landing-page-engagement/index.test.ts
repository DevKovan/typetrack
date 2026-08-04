import { describe, expect, test } from "bun:test";
import { elementMatchesSelector } from "./index";

// Unit test for `elementMatchesSelector`'s pure selector-matching logic --
// exercised directly against hand-built `StubElement`s, no `createAnalytics()`,
// no provider, no simulated click event, no I/O. This is the one piece of
// genuinely non-trivial pure logic this example's `index.ts` defines
// (the tag-name/class/attribute-selector branching that
// `autoClicks({ selector: "[data-cta]" })`'s scoping needs a realistic
// `closest()` to drive) -- everything else in `index.ts` is direct
// `typetrack` API calls, provider-stub construction, or global-stubbing
// plumbing, which belong in the integration test instead (see
// `index.integration.test.ts`'s own doc comment for the
// `pipeline-basics`-style rationale).
describe("elementMatchesSelector", () => {
  test("bare tag-name selector matches case-insensitively", () => {
    expect(elementMatchesSelector({ tagName: "A" }, "a")).toBe(true);
    expect(elementMatchesSelector({ tagName: "a" }, "A")).toBe(true);
  });

  test("bare tag-name selector does not match a different tag", () => {
    expect(elementMatchesSelector({ tagName: "SPAN" }, "a")).toBe(false);
  });

  test("leading-dot class selector matches one class among several space-separated ones", () => {
    expect(elementMatchesSelector({ tagName: "A", className: "btn btn-primary" }, ".btn-primary")).toBe(true);
  });

  test("leading-dot class selector does not match when className is absent", () => {
    expect(elementMatchesSelector({ tagName: "A" }, ".btn-primary")).toBe(false);
  });

  test("leading-dot class selector does not match a non-present class", () => {
    expect(elementMatchesSelector({ tagName: "A", className: "btn" }, ".btn-primary")).toBe(false);
  });

  test("bracketed attribute selector matches when the attribute is present, regardless of its value", () => {
    expect(elementMatchesSelector({ tagName: "A", attributes: { "data-cta": "true" } }, "[data-cta]")).toBe(true);
    expect(elementMatchesSelector({ tagName: "A", attributes: { "data-cta": "" } }, "[data-cta]")).toBe(true);
  });

  test("bracketed attribute selector does not match when the attribute is absent", () => {
    expect(elementMatchesSelector({ tagName: "A", attributes: { id: "x" } }, "[data-cta]")).toBe(false);
    expect(elementMatchesSelector({ tagName: "A" }, "[data-cta]")).toBe(false);
  });
});
