// This file owns this package's entire happy-dom + Bun-Svelte-loader
// register/unregister lifecycle for the whole `bun test` process -- both the
// "unit" (throw behavior, exercised via a real rendered minimal consumer
// component, per the issue's own requirement that this NOT be conflated
// with Svelte's own "outside of component" runtime error) and "integration"
// (real `@testing-library/svelte` rendering, with and without an ancestor
// `<AnalyticsProvider>`) test requirements from the issue live here
// together, deliberately, mirroring
// `packages/react/src/AnalyticsProvider.test.tsx`/`packages/vue/src/
// useAnalytics.test.ts`'s own established precedent and reasoning.
//
// See `./testSetup.ts`'s own header comment for the full reasoning behind
// why `svelte`/`@testing-library/svelte`/this package's own `.svelte`
// fixtures must load only *after* `./testSetup`'s registrations run (both
// the pre-existing Bun-ESM-ordering hazard `packages/react`'s testSetup
// already documents, and this package's own two additions on top of it:
// Svelte's client runtime caching `document`, and the `bun-plugin-svelte`
// loader needing to be registered before any `.svelte` file is imported at
// all).
//
// Unlike `packages/react`/`packages/vue`'s own precedent, this file cannot
// use `require(...)` for that: Bun rejects it outright here --
// `@testing-library/svelte`'s own module graph is an "async module" (uses
// top-level `await` internally), and Bun's `require()` only supports
// synchronous CommonJS/ESM interop, throwing `require() async module ... is
// unsupported. use "await import()" instead.` A top-level `await import(
// ...)` is used instead: a *dynamic* import is not hoisted -- it only runs
// when this line of the module's own body is reached, which is strictly
// after all of this file's own *static* imports (including `./testSetup`)
// have already fully evaluated, per the ECMAScript module spec. This
// sidesteps the exact Bun-ESM-ordering hazard `require(...)` was originally
// reached for in `packages/react`/`packages/vue`, without needing it.
import "./testSetup";

import { afterAll, describe, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Analytics, EventMap } from "typetrack";

const { render, fireEvent } = await import("@testing-library/svelte");
const { default: ConsumerFixture } = await import("./__fixtures__/ConsumerFixture.svelte");
const { default: ProviderHarnessFixture } = await import("./__fixtures__/ProviderHarnessFixture.svelte");

afterAll(() => {
  // Guarded: under `bun test --rerun-each`, this file's hooks (afterAll
  // included) re-run once per rerun, but `../testSetup`'s top-level
  // `GlobalRegistrator.register()` call does not (Bun re-executes a test
  // file's hooks/tests on rerun, not its module-level side effects) -- an
  // unguarded second `unregister()` call throws "has not previously been
  // globally registered". Normal CI (`bun run test`, no `--rerun-each`)
  // never re-runs this file, so this only matters for that stress-testing
  // tool; the guard turns a crash into a no-op instead of chasing full
  // multi-rerun DOM availability, which the register-at-import-time
  // ordering hazard `../testSetup` documents makes structurally hard.
  if (GlobalRegistrator.isRegistered) {
    GlobalRegistrator.unregister();
  }
});

interface TestEvents extends EventMap {
  button_clicked: { label: string };
}

function createFakeAnalytics(): Analytics<TestEvents> {
  // Typed loosely (rather than against `Analytics<TestEvents>["track"]`
  // directly) and cast as a whole below -- `track`'s generic-over-`K`
  // signature does not narrow cleanly through `mock<...>()`'s own generic
  // inference, the same fundamental limitation `packages/react`'s/
  // `packages/vue`'s own fakes hit, and the same fix (a whole-object
  // `as unknown as Analytics<...>` cast) applies here.
  const track = mock((_event: keyof TestEvents, _payload?: TestEvents[keyof TestEvents]) => {});
  const identify = mock((_userId: string, _traits?: Record<string, unknown>) => {});
  const page = mock((_name?: string, _props?: Record<string, unknown>) => {});
  const flush = mock(async () => {});

  return { track, identify, page, flush } as unknown as Analytics<TestEvents>;
}

describe("useAnalytics (unit)", () => {
  it("throws a descriptive error identifying the missing AnalyticsProvider when a minimal consumer component is rendered with no ancestor provider", () => {
    // Exercises the hook via a real rendered component (`ConsumerFixture`,
    // whose own `<script>` block calls `useAnalytics()` -- see that file),
    // not by calling `getContext` directly at module scope, which would
    // instead hit Svelte's own "outside of component" runtime error, a
    // different failure mode entirely from this package's own
    // missing-provider error asserted below.
    expect(() => render(ConsumerFixture)).toThrow(/useAnalytics/);
    expect(() => render(ConsumerFixture)).toThrow(/AnalyticsProvider/);
  });
});

describe("AnalyticsProvider + useAnalytics (integration, real @testing-library/svelte rendering)", () => {
  it("delivers track/identify/page/flush calls through context to a real rendered consumer component", async () => {
    const fakeAnalytics = createFakeAnalytics();

    // `ProviderHarnessFixture` renders `<AnalyticsProvider analytics={...}>`
    // wrapping `ConsumerFixture` as its Svelte 5 `children` snippet -- see
    // that fixture's own header comment for why a small `.svelte` harness
    // file, not a plain `.ts` helper, is needed to author that markup.
    const { getByText } = render(ProviderHarnessFixture, { analytics: fakeAnalytics });

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
    expect(() => render(ConsumerFixture)).toThrow(/AnalyticsProvider/);
  });
});
