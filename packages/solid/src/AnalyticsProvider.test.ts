// This file owns this package's entire happy-dom + Bun-Solid-JSX-plugin
// register/unregister lifecycle for the whole `bun test` process -- both the
// "unit" (`useAnalytics()` throws when rendered with no ancestor provider,
// exercised via a real rendered minimal consumer component per the issue's
// own requirement) and "integration" (real `@solidjs/testing-library`
// rendering, with and without an ancestor `<AnalyticsProvider>`) test
// requirements from the issue live here together, deliberately, mirroring
// `packages/react/src/AnalyticsProvider.test.tsx`/`packages/svelte/src/
// AnalyticsProvider.test.ts`'s own established precedent and reasoning.
//
// Deliberately a plain `.ts` file, with no JSX syntax of its own anywhere in
// it -- unlike `packages/react`'s equivalent test file (which freely mixes
// JSX and test code in one `.tsx` file). Verified by hand: `@dschz/bun-
// plugin-solid` (registered in `./testSetup.ts`, imported below) only
// correctly compiles a `.tsx` file's Solid JSX for modules resolved *after*
// its `plugin(...)` registration call actually runs. A `bun test` *entry*
// file, if it contained literal JSX itself, would have that JSX already
// parsed/transformed by Bun's own built-in, React-shaped, automatic-JSX-
// runtime transform (via whatever `jsxImportSource` its own pragma names)
// as part of building this file's own module record, strictly *before* any
// of this file's own top-level statements -- including
// `import "./testSetup"`'s side effects -- run at all; confirmed by hand
// (two failure modes reproduced directly: `Cannot find module 'react/jsx-
// dev-runtime'` with no pragma at all, since the shared root
// `tsconfig.json`'s `"jsx": "react-jsx"` is the fallback; and
// `SyntaxError: Export named 'jsxDEV' not found in module ...solid-js/
// dist/solid.js` with a `/** @jsxImportSource solid-js */` pragma present,
// since `solid-js` ships no automatic-JSX-runtime factory functions at all
// -- Solid has no such convention, unlike React). All of this file's own
// JSX-composing work is therefore delegated to `./__fixtures__/
// ConsumerFixture.tsx`/`./__fixtures__/ProviderHarnessFixture.tsx`, pulled
// in below via a *dynamic* `await import(...)` -- guaranteed, per the
// ECMAScript module spec, to run only once this line of this file's own
// body is reached, strictly after `import "./testSetup"` (a *static*
// import) has already fully evaluated, so `@dschz/bun-plugin-solid`'s
// registration is guaranteed to be in place before either fixture file is
// ever parsed.
//
// See `./testSetup.ts`'s own header comment for why `solid-js`/`@solidjs/
// testing-library` themselves must *also* load only after `./testSetup`'s
// registrations run (the same Bun-ESM-ordering hazard `packages/react`'s/
// `packages/svelte`'s own testSetup already documents), and why `require(
// ...)` cannot be used for that here (`@solidjs/testing-library`'s own
// module graph is an "async module", the same reason `packages/svelte`'s
// test file uses `await import(...)` instead of `require(...)`).
import "./testSetup";

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Analytics } from "typetrack";
import type { TestEvents } from "./__fixtures__/ConsumerFixture";

const { cleanup, fireEvent, render } = await import("@solidjs/testing-library");
const { default: ConsumerFixture } = await import("./__fixtures__/ConsumerFixture");
const { default: ProviderHarnessFixture } = await import("./__fixtures__/ProviderHarnessFixture");

afterAll(() => {
  GlobalRegistrator.unregister();
});

// `@solidjs/testing-library`'s own auto-cleanup (an `afterEach(cleanup)` it
// registers itself, at import time, guarded by
// `typeof afterEach === "function"`) silently never fires under `bun test`
// -- verified by hand: Bun's test runner does not inject `describe`/`it`/
// `afterEach`/etc. as ambient globals the way Jest does; they exist only as
// named exports of `"bun:test"`, imported explicitly. Without this package's
// own explicit `afterEach(cleanup)` below, each `render()` call's mounted
// container would leak into `document.body` for the rest of this file's
// test run, causing later `getByText(...)` queries to match multiple
// (stale) elements.
afterEach(() => {
  cleanup();
});

function createFakeAnalytics(): Analytics<TestEvents> {
  // Typed loosely (rather than against `Analytics<TestEvents>["track"]`
  // directly) and cast as a whole below -- `track`'s generic-over-`K`
  // signature does not narrow cleanly through `mock<...>()`'s own generic
  // inference, the same fundamental limitation every other package's own
  // fake hits in this phase.
  const track = mock((_event: keyof TestEvents, _payload?: TestEvents[keyof TestEvents]) => {});
  const identify = mock((_userId: string, _traits?: Record<string, unknown>) => {});
  const page = mock((_name?: string, _props?: Record<string, unknown>) => {});
  const flush = mock(async () => {});

  return { track, identify, page, flush } as unknown as Analytics<TestEvents>;
}

describe("useAnalytics (unit)", () => {
  it("throws a descriptive error identifying the missing AnalyticsProvider when a minimal consumer component is rendered with no ancestor provider", () => {
    // Exercises the hook via a real rendered component (`ConsumerFixture`,
    // whose own module body calls `useAnalytics()` -- see that file), not
    // by calling `useContext` directly at module scope outside of any
    // reactive root, which would instead hit Solid's own "no root" warning/
    // undefined-context behavior, a different failure mode entirely from
    // this package's own missing-provider error asserted below. This is
    // also how the context's default value is confirmed to be the
    // `undefined` sentinel: if it were anything else (e.g. a fake no-op
    // `Analytics`), rendering `ConsumerFixture` with no ancestor provider
    // would not throw.
    expect(() => render(() => ConsumerFixture())).toThrow(/useAnalytics/);
    expect(() => render(() => ConsumerFixture())).toThrow(/AnalyticsProvider/);
  });
});

describe("AnalyticsProvider + useAnalytics (integration, real @solidjs/testing-library rendering)", () => {
  it("delivers track/identify/page/flush calls through context to a real rendered consumer component", async () => {
    const fakeAnalytics = createFakeAnalytics();

    // `ProviderHarnessFixture` renders `<AnalyticsProvider analytics={...}>`
    // wrapping `ConsumerFixture` -- see that fixture's own header comment
    // for why a small `.tsx` harness file, not inline JSX in this file, is
    // needed to author that markup. Called as a plain function (not via
    // JSX), passing `analytics` as a regular argument -- valid because
    // `render()`'s own `ui` parameter is itself just a zero-argument
    // function returning `JSX.Element`, and a direct function call composes
    // just as well as JSX syntax would, without requiring this file to
    // contain any JSX of its own.
    const { getByText } = render(() => ProviderHarnessFixture({ analytics: fakeAnalytics }));

    await fireEvent.click(getByText("track"));
    await fireEvent.click(getByText("identify"));
    await fireEvent.click(getByText("page"));
    await fireEvent.click(getByText("flush"));

    expect(fakeAnalytics.track).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.track).toHaveBeenCalledWith("button_clicked", { label: "cta" });
    expect(fakeAnalytics.identify).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.identify).toHaveBeenCalledWith("user_1", { plan: "pro" });
    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("home", { referrer: "google" });
    expect(fakeAnalytics.flush).toHaveBeenCalledTimes(1);
    expect(getByText("track")).toBeTruthy();
  });

  it("throws when the same consumer component is rendered without an ancestor AnalyticsProvider", () => {
    expect(() => render(() => ConsumerFixture())).toThrow(/AnalyticsProvider/);
  });
});
