// Unit tests -- pure logic, no rendering, no DOM, no next/navigation mocking
// required. See `buildPageViewArgs.ts`'s module-level comment for the
// `name`/`props` shape decision this asserts.
import { describe, expect, it } from "bun:test";
import { buildPageViewArgs } from "./buildPageViewArgs";

describe("buildPageViewArgs (unit)", () => {
  it("returns { name: pathname } with no props key when search params are empty", () => {
    const result = buildPageViewArgs("/dashboard", new URLSearchParams(""));

    expect(result).toEqual({ name: "/dashboard" });
    expect("props" in result).toBe(false);
  });

  it("returns { name: pathname, props: { search } } with the exact query string when search params are non-empty", () => {
    const result = buildPageViewArgs("/dashboard", new URLSearchParams("tab=billing&ref=email"));

    expect(result).toEqual({ name: "/dashboard", props: { search: "tab=billing&ref=email" } });
  });

  it("accepts any object with a toString() method, not only a real URLSearchParams instance", () => {
    const fakeSearchParams = { toString: () => "q=1" };

    const result = buildPageViewArgs("/search", fakeSearchParams);

    expect(result).toEqual({ name: "/search", props: { search: "q=1" } });
  });
});
