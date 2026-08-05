// Unit tests -- pure logic, no rendering, no DOM, no vue-router/Nuxt
// mocking required. Mirrors `packages/next/src/buildPageViewArgs.test.ts`'s
// own test shape (same `name`/`props.search`-when-non-empty contract),
// adapted to Vue Router's `path`/`fullPath` input shape instead of
// Next's `pathname`/`URLSearchParams` pair. See `buildPageViewArgs.ts`'s
// module-level comment for the `name`/`props` shape decision this asserts.
import { describe, expect, it } from "bun:test";
import { buildPageViewArgs } from "./buildPageViewArgs";

describe("buildPageViewArgs (unit)", () => {
  it("returns { name: path } with no props key when the route has no query string", () => {
    const result = buildPageViewArgs({ path: "/dashboard", fullPath: "/dashboard" });

    expect(result).toEqual({ name: "/dashboard" });
    expect("props" in result).toBe(false);
  });

  it("returns { name: path, props: { search } } with the exact query string when non-empty", () => {
    const result = buildPageViewArgs({
      path: "/dashboard",
      fullPath: "/dashboard?tab=billing&ref=email",
    });

    expect(result).toEqual({ name: "/dashboard", props: { search: "tab=billing&ref=email" } });
  });

  it("excludes a trailing hash fragment from the extracted search string", () => {
    const result = buildPageViewArgs({ path: "/dashboard", fullPath: "/dashboard?tab=billing#section" });

    expect(result).toEqual({ name: "/dashboard", props: { search: "tab=billing" } });
  });

  it("returns no props for a route whose fullPath has only a hash fragment, no query string", () => {
    const result = buildPageViewArgs({ path: "/dashboard", fullPath: "/dashboard#section" });

    expect(result).toEqual({ name: "/dashboard" });
    expect("props" in result).toBe(false);
  });

  it("returns { name: '/' } for the root route with no query string", () => {
    const result = buildPageViewArgs({ path: "/", fullPath: "/" });

    expect(result).toEqual({ name: "/" });
  });
});
