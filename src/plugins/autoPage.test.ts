// Unit tests for Phase 10 issue 002's `dispatchPageView` (pure dedup +
// dispatch logic, exercised against a hand-written `{ page: mock fn }` stub
// -- no `createAnalytics()`, no providers) and `autoPage()`'s default
// `getPageArgs` computation (exercised by invoking the plugin's own setup
// function directly against a stubbed browser global and a hand-written
// fake `Analytics`, asserting only the initial fire's computed args --
// `pushState`/`popstate`-driven navigation and full `createAnalytics()`
// wiring/teardown are exercised by `autoPage.integration.test.ts` instead).
//
// Browser-environment stubbing reuses `src/context.test.ts`'s
// `Object.defineProperty(globalThis, ...)` technique (manual stub, always
// torn down in `afterEach`) rather than a DOM test-environment dependency --
// see that file's header comment for the full rationale (a real DOM
// registrator leaks across the whole `bun test` process).
import { afterEach, describe, expect, it, mock } from "bun:test";
import { autoPage, dispatchPageView } from "./autoPage";
import type { Analytics } from "../index";

interface BrowserStub {
  pathname?: string;
  search?: string;
}

function stubBrowserGlobals(stub: BrowserStub = {}): void {
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: { pathname: stub.pathname ?? "/", search: stub.search ?? "" },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "history", {
    value: { pushState: () => {}, replaceState: () => {} },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "addEventListener", {
    value: () => {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "removeEventListener", {
    value: () => {},
    configurable: true,
    writable: true,
  });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "location", "history", "addEventListener", "removeEventListener"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

// Hand-written stub satisfying `dispatchPageView`'s `Pick<Analytics<any>,
// "page">` parameter -- no other `Analytics` method is needed.
function makePageStub(): { page: ReturnType<typeof mock>; instance: Pick<Analytics<any>, "page"> } {
  const page = mock(() => {});
  return { page, instance: { page } };
}

describe("dispatchPageView", () => {
  it("calls analytics.page(name, undefined) when no props are supplied", () => {
    const { page, instance } = makePageStub();

    dispatchPageView(instance, { name: "Home" });

    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith("Home", undefined);
  });

  it("calls analytics.page(name, props) when props are supplied", () => {
    const { page, instance } = makePageStub();

    dispatchPageView(instance, { name: "Home", props: { search: "?a=1" } });

    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith("Home", { search: "?a=1" });
  });

  it("dedupes two consecutive calls with identical args into a single .page() call", () => {
    const { page, instance } = makePageStub();

    dispatchPageView(instance, { name: "Home", props: { search: "?a=1" } });
    dispatchPageView(instance, { name: "Home", props: { search: "?a=1" } });

    expect(page).toHaveBeenCalledTimes(1);
  });

  it("a third call with different args after two identical calls results in a second .page() call", () => {
    const { page, instance } = makePageStub();

    dispatchPageView(instance, { name: "Home" });
    dispatchPageView(instance, { name: "Home" });
    dispatchPageView(instance, { name: "About" });

    expect(page).toHaveBeenCalledTimes(2);
    expect(page).toHaveBeenNthCalledWith(1, "Home", undefined);
    expect(page).toHaveBeenNthCalledWith(2, "About", undefined);
  });

  it("does not dedup identical args dispatched against two different analytics instances", () => {
    const a = makePageStub();
    const b = makePageStub();

    dispatchPageView(a.instance, { name: "Home" });
    dispatchPageView(b.instance, { name: "Home" });

    expect(a.page).toHaveBeenCalledTimes(1);
    expect(b.page).toHaveBeenCalledTimes(1);
  });

  it("never throws and skips dedup entirely when JSON.stringify fails on props (e.g. a circular reference)", () => {
    const { page, instance } = makePageStub();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => dispatchPageView(instance, { name: "Home", props: circular })).not.toThrow();
    expect(() => dispatchPageView(instance, { name: "Home", props: circular })).not.toThrow();

    // Dedup was skipped (not just "didn't crash") -- both calls reached
    // `.page()` unconditionally.
    expect(page).toHaveBeenCalledTimes(2);
  });
});

describe("autoPage()'s default getPageArgs", () => {
  it("computes { name: pathname, props: undefined } when location.search is empty", () => {
    stubBrowserGlobals({ pathname: "/foo", search: "" });
    const { page, instance } = makePageStub();

    const teardown = autoPage()(instance as Analytics<any>);

    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith("/foo", undefined);

    teardown?.();
  });

  it("computes { name: pathname, props: { search } } when location.search is non-empty", () => {
    stubBrowserGlobals({ pathname: "/foo", search: "?a=1" });
    const { page, instance } = makePageStub();

    const teardown = autoPage()(instance as Analytics<any>);

    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith("/foo", { search: "?a=1" });

    teardown?.();
  });

  it("a custom getPageArgs overrides the default pathname/search-based computation", () => {
    stubBrowserGlobals({ pathname: "/foo", search: "?a=1" });
    const { page, instance } = makePageStub();

    const teardown = autoPage({ getPageArgs: () => ({ name: "Custom", props: { foo: "bar" } }) })(
      instance as Analytics<any>,
    );

    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith("Custom", { foo: "bar" });

    teardown?.();
  });
});
