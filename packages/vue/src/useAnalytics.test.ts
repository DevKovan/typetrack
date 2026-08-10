// This file owns this package's entire happy-dom register/unregister
// lifecycle for the whole `bun test` process -- both the "unit" (throw
// behavior, exercised via a real mounted component's `setup()`, per the
// issue's own requirement that this NOT be conflated with `inject()`'s own
// outside-of-component-context error) and "integration" (real
// `@vue/test-utils` mounting, with and without the plugin installed) test
// requirements from the issue live here together, deliberately, mirroring
// `packages/react/src/AnalyticsProvider.test.tsx`'s own established
// precedent and reasoning.
//
// See `./testSetup.ts`'s own header comment for the full reasoning behind
// the `require(...)`-after-`import "./testSetup"` pattern below -- both the
// pre-existing Bun-ESM-ordering hazard `packages/react`'s testSetup already
// documents, and this package's own Vue-specific addendum (`vue` itself,
// not just a testing library, must load after `GlobalRegistrator.register()`
// runs, or `@vue/runtime-dom` permanently caches a `null` `document`).
// `vue`, `@vue/test-utils`, and this package's own `./plugin`/
// `./useAnalytics` are therefore all pulled in via `require(...)` here,
// after `import "./testSetup"`, rather than via static `import`.
import "./testSetup";

import { afterAll, describe, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Analytics, EventMap } from "typetrack";

// `@vue/server-renderer` is a peer of `@vue/test-utils` -- but it is
// required unconditionally at `@vue/test-utils`' own module top level (it
// backs that package's `renderToString` export), not lazily only when a
// caller actually reaches for SSR helpers. Verified by hand: without
// `@vue/server-renderer` present as this package's own devDependency (it is
// otherwise absent -- only `vue`, not `@vue/test-utils`'s peers, are
// installed by this package's own peer/devDependencies), even a
// CSR-only `mount()` call throws `Cannot find module '@vue/server-renderer'`
// before ever reaching this package's own code.
const { mount } = require("@vue/test-utils") as typeof import("@vue/test-utils");
const { defineComponent, h } = require("vue") as typeof import("vue");
const { typetrackPlugin } = require("./plugin") as typeof import("./plugin");
const { useAnalytics } = require("./useAnalytics") as typeof import("./useAnalytics");

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

interface TestEvents extends EventMap {
  button_clicked: { label: string };
}

function createFakeAnalytics(): Analytics<TestEvents> {
  // Typed loosely (rather than against `Analytics<TestEvents>["track"]`
  // directly) and cast as a whole below -- `track`'s generic-over-`K`
  // signature does not narrow cleanly through `mock<...>()`'s own generic
  // inference, the same fundamental limitation `packages/react`'s own fake
  // hits, and the same fix (a whole-object `as unknown as Analytics<...>`
  // cast) applies here.
  const track = mock((_event: keyof TestEvents, _payload?: TestEvents[keyof TestEvents]) => {});
  const identify = mock((_userId: string, _traits?: Record<string, unknown>) => {});
  const page = mock((_name?: string, _props?: Record<string, unknown>) => {});
  const flush = mock(async () => {});

  return { track, identify, page, flush } as unknown as Analytics<TestEvents>;
}

// A realistic consumer component: reads `useAnalytics()` in `setup()` and
// wires each method up to a button's click handler, the way an app would.
// Plain `h()` render function (not a `.vue` SFC) -- this package ships no
// SFC/template of its own, and neither does this test's own consumer.
function createConsumerComponent() {
  return defineComponent({
    name: "ConsumerComponent",
    setup() {
      const analytics = useAnalytics<TestEvents>();

      return () =>
        h("div", [
          h(
            "button",
            { onClick: () => analytics.track("button_clicked", { label: "cta" }) },
            "track",
          ),
          h(
            "button",
            { onClick: () => analytics.identify("user_1", { plan: "pro" }) },
            "identify",
          ),
          h(
            "button",
            { onClick: () => analytics.page("home", { referrer: "google" }) },
            "page",
          ),
          h("button", { onClick: () => void analytics.flush() }, "flush"),
        ]);
    },
  });
}

describe("useAnalytics (unit)", () => {
  it("throws a descriptive error identifying the missing plugin install when mounted without an ancestor app.use(typetrackPlugin, ...)", () => {
    // Exercises the composable from *inside* a real component's `setup()`,
    // via `@vue/test-utils`'s `mount()`, with the plugin simply never
    // installed on that component's own test `app` -- not by calling
    // `useAnalytics()` at raw module scope (which would instead hit
    // `inject()`'s own "must be called inside setup()" runtime error, a
    // different failure mode entirely).
    expect(() => mount(createConsumerComponent())).toThrow(/useAnalytics/);
    expect(() => mount(createConsumerComponent())).toThrow(/typetrackPlugin/);
  });
});

describe("typetrackPlugin + useAnalytics (integration, real @vue/test-utils mounting)", () => {
  it("delivers track/identify/page/flush calls through provide/inject to a real mounted consumer component", async () => {
    const fakeAnalytics = createFakeAnalytics();

    const wrapper = mount(createConsumerComponent(), {
      global: {
        plugins: [[typetrackPlugin, { analytics: fakeAnalytics }]],
      },
    });

    await wrapper.find("button:nth-of-type(1)").trigger("click");
    await wrapper.find("button:nth-of-type(2)").trigger("click");
    await wrapper.find("button:nth-of-type(3)").trigger("click");
    await wrapper.find("button:nth-of-type(4)").trigger("click");

    expect(fakeAnalytics.track).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.track).toHaveBeenCalledWith("button_clicked", { label: "cta" });
    expect(fakeAnalytics.identify).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.identify).toHaveBeenCalledWith("user_1", { plan: "pro" });
    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("home", { referrer: "google" });
    expect(fakeAnalytics.flush).toHaveBeenCalledTimes(1);
  });

  it("throws when the same consumer component is mounted without the plugin installed", () => {
    // Verified by hand: `@vue/test-utils`'s `mount()` installs a temporary
    // `app.config.errorHandler` around the mount call (its own documented
    // workaround for https://github.com/vuejs/core/issues/7020, so that a
    // `setup()` throw is observable at all instead of Vue's own default
    // error handling swallowing it) and rethrows the first captured error
    // itself, synchronously, from `mount()` -- not via `errorCaptured`/an
    // async rejection. That rethrow is what this assertion (and the "unit"
    // describe block above) observes.
    expect(() => mount(createConsumerComponent())).toThrow();
  });
});
