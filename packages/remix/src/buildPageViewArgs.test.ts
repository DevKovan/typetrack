// Unit tests -- pure logic, no rendering, no DOM, no react-router routing
// context required. See `buildPageViewArgs.ts`'s module-level comment for the
// `name`/`props` shape decision this asserts (mirrors
// `@typetrack/next`'s `buildPageViewArgs.test.ts`).
import { describe, expect, it } from "bun:test";
import { buildPageViewArgs } from "./buildPageViewArgs";

describe("buildPageViewArgs (unit)", () => {
  it("returns { name: pathname } with no props key when search is empty", () => {
    const result = buildPageViewArgs("/dashboard", "");

    expect(result).toEqual({ name: "/dashboard" });
    expect("props" in result).toBe(false);
  });

  it("returns { name: pathname, props: { search } } with the bare query string when search is non-empty", () => {
    const result = buildPageViewArgs("/dashboard", "?tab=billing&ref=email");

    expect(result).toEqual({ name: "/dashboard", props: { search: "tab=billing&ref=email" } });
  });

  it("strips a leading '?' from a non-empty search string", () => {
    const result = buildPageViewArgs("/search", "?q=1");

    expect(result).toEqual({ name: "/search", props: { search: "q=1" } });
  });

  it("treats a search string with no leading '?' the same as one with it", () => {
    const result = buildPageViewArgs("/search", "q=1");

    expect(result).toEqual({ name: "/search", props: { search: "q=1" } });
  });
});
