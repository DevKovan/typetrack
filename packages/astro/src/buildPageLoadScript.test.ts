// Unit + integration tests for `buildPageLoadScript()`. See this
// package's own issue file (`plan/phase-14-framework-wrappers/
// 005-astro-integration.md`, "Test requirements") for the exact
// assertions this file is required to make.
//
// The "runtime behavior" describe block below is the genuinely
// integration-shaped test: it exercises the *actual returned script
// string* as real, executed JS (not just asserted against as text) --
// see `buildPageLoadScript.ts`'s own header comment ("Runtime-
// testability note") for why the two `import` lines must be stripped
// before `new Function(...)` can evaluate the remainder, and why that's
// a documented, reasonable workaround rather than a real Vite/Astro
// bundler round trip (out of scope for this package -- see this issue's
// "Explicitly not covered by automated tests" section).
//
// Root `tsconfig.json` deliberately has no `"dom"` in `lib` (see
// `src/plugins/autoPage.ts`'s own header comment in core), so `document`/
// `history`/`Event` are never ambient globals here either -- this file
// reads them off `globalThis` through a minimal, ad-hoc structural type
// via `browserGlobal()`, mirroring `src/plugins/autoPage.ts`'s/
// `src/context.test.ts`'s own established technique, rather than adding
// a package-local `"dom"` lib override.
import "./testSetup";
import { afterAll, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { buildPageLoadScript } from "./buildPageLoadScript";

afterAll(() => {
  // Guarded: see `packages/svelte/src/AnalyticsProvider.test.ts`'s
  // identical afterAll comment -- under `bun test --rerun-each`, this
  // file's hooks re-run per rerun but `./testSetup`'s module-top-level
  // `register()` does not, so an unguarded second `unregister()` throws.
  // Normal CI (`bun run test`) never re-runs this file.
  if (GlobalRegistrator.isRegistered) {
    GlobalRegistrator.unregister();
  }
});

interface MinimalEvent {
  type: string;
}

interface MinimalDocument {
  addEventListener(type: string, listener: () => void): void;
  dispatchEvent(event: MinimalEvent): void;
}

interface MinimalHistory {
  pushState(state: unknown, title: string, url?: string): void;
}

interface MinimalBrowserGlobal {
  document: MinimalDocument;
  history: MinimalHistory;
  Event: new (type: string) => MinimalEvent;
}

function browserGlobal(): MinimalBrowserGlobal {
  return globalThis as unknown as MinimalBrowserGlobal;
}

describe("buildPageLoadScript (unit, plain string assertions, no DOM)", () => {
  it("contains a static default import of the analyticsModule specifier, bound as `analytics`", () => {
    const script = buildPageLoadScript("/src/lib/analytics.ts");

    expect(script).toContain('import analytics from "/src/lib/analytics.ts";');
  });

  it("contains a static named import of dispatchPageView from typetrack", () => {
    const script = buildPageLoadScript("/src/lib/analytics.ts");

    expect(script).toContain('import { dispatchPageView } from "typetrack";');
  });

  it("registers a document-level astro:page-load listener", () => {
    const script = buildPageLoadScript("/src/lib/analytics.ts");

    expect(script).toContain('document.addEventListener("astro:page-load", handleAstroPageLoad);');
  });

  it("delegates to dispatchPageView(analytics, args) inside the astro:page-load handler", () => {
    const script = buildPageLoadScript("/src/lib/analytics.ts");

    expect(script).toContain("dispatchPageView(analytics, args);");
  });

  it("JSON-stringifies the analyticsModule specifier, so an unusual specifier stays a syntactically valid string literal", () => {
    const unusual = '"; alert(1); //';
    const script = buildPageLoadScript(unusual);

    expect(script).toContain(`import analytics from ${JSON.stringify(unusual)};`);
  });

  it("returns a different script per distinct analyticsModule specifier (not a cached/shared literal)", () => {
    const scriptA = buildPageLoadScript("/src/lib/analytics-a.ts");
    const scriptB = buildPageLoadScript("/src/lib/analytics-b.ts");

    expect(scriptA).not.toBe(scriptB);
    expect(scriptA).toContain('"/src/lib/analytics-a.ts"');
    expect(scriptB).toContain('"/src/lib/analytics-b.ts"');
  });
});

describe("buildPageLoadScript runtime behavior (integration: happy-dom + new Function, import lines stripped)", () => {
  // See `buildPageLoadScript.ts`'s header comment for why this stripping
  // step exists: `eval()`/`new Function(...)` cannot execute ES module
  // `import` syntax outside a real module context. Stripping only lines
  // that begin with `import ` (rather than hard-coding a fixed line
  // count) is robust to reordering/reformatting of the two import lines
  // and leaves every other line -- the actual `astro:page-load` listener
  // registration and `dispatchPageView` delegation -- byte-for-byte the
  // real, unmodified output of `buildPageLoadScript()`.
  function stripImportLines(script: string): string {
    return script
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("import "))
      .join("\n");
  }

  function runScript(script: string, analytics: unknown, dispatchPageView: (...args: unknown[]) => void): void {
    const body = stripImportLines(script);
    // `analytics`/`dispatchPageView` become real parameters of the
    // generated function, standing in for what a real Vite/Astro bundle
    // would otherwise resolve via the (stripped) `import` lines --
    // everything else in `body` runs as genuine, unmodified JS.
    const run = new Function("analytics", "dispatchPageView", body);
    run(analytics, dispatchPageView);
  }

  it("registers a real astro:page-load listener that, once fired, calls dispatchPageView with the current pathname and search", () => {
    const script = buildPageLoadScript("/src/lib/analytics.ts");
    const calls: unknown[][] = [];
    const mockAnalytics = { marker: "the-analytics-instance" };
    const g = browserGlobal();

    g.history.pushState(null, "", "/about?tab=info");

    runScript(script, mockAnalytics, (...args: unknown[]) => {
      calls.push(args);
    });

    // Registering the listener alone must not fire it.
    expect(calls.length).toBe(0);

    g.document.dispatchEvent(new g.Event("astro:page-load"));

    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toBe(mockAnalytics);
    expect(calls[0]![1]).toEqual({ name: "/about", props: { search: "?tab=info" } });
  });

  it("omits the props key entirely (not props: undefined) when the current URL has no query string", () => {
    const script = buildPageLoadScript("/src/lib/analytics.ts");
    const calls: unknown[][] = [];
    const g = browserGlobal();

    g.history.pushState(null, "", "/");

    runScript(script, {}, (...args: unknown[]) => {
      calls.push(args);
    });
    g.document.dispatchEvent(new g.Event("astro:page-load"));

    expect(calls.length).toBe(1);
    const args = calls[0]![1] as Record<string, unknown>;
    expect(args).toEqual({ name: "/" });
    expect("props" in args).toBe(false);
  });

  it("fires again, with updated pathname/search, on a second astro:page-load event -- covers repeated View-Transitions navigation, not just the initial load", () => {
    const script = buildPageLoadScript("/src/lib/analytics.ts");
    const calls: unknown[][] = [];
    const g = browserGlobal();

    g.history.pushState(null, "", "/first");
    runScript(script, {}, (...args: unknown[]) => {
      calls.push(args);
    });

    g.document.dispatchEvent(new g.Event("astro:page-load"));
    expect(calls.length).toBe(1);
    expect((calls[0]![1] as { name: string }).name).toBe("/first");

    g.history.pushState(null, "", "/second?x=1");
    g.document.dispatchEvent(new g.Event("astro:page-load"));

    expect(calls.length).toBe(2);
    expect(calls[1]![1]).toEqual({ name: "/second", props: { search: "?x=1" } });
  });
});
