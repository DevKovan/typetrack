// Integration test: exercises `installTypetrackPlugin`'s actual logic
// against a real Vue `app` (via `@vue/test-utils`), standing in for what
// Nuxt's own runtime plugin execution would otherwise provide -- since a
// real Nuxt SSR pass is out of scope per this issue's plan doc's documented
// limitation. `runtime/plugin.ts` itself (the real `defineNuxtPlugin`
// wrapper) is NOT imported here -- its own static
// `import analytics from "#typetrack/analytics-module"` only resolves
// inside a real Nuxt build (see `./plugin.ts`'s header comment) -- this
// file instead calls `installTypetrackPlugin` directly with a
// `fakeAnalytics` stand-in for that statically-imported module, which is
// exactly the factoring this issue's Test requirements section asks for.
//
// See `packages/vue/src/testSetup.ts` for the Bun-ESM-ordering hazard this
// file works around the same way: `import "../testSetup"` first, then
// `vue`/`@vue/test-utils`/`@typetrack/vue`/this file's own
// `./installTypetrackPlugin` via `require(...)`, not a static `import`.
//
// A second, genuinely new hazard this file hits (not present in
// `packages/vue`'s own tests, which never cross a package boundary for
// `@typetrack/vue` itself, only relative-import their own source):
// `./installTypetrackPlugin.ts` has its own top-level static
// `import { typetrackPlugin } from "@typetrack/vue"`, which Bun resolves
// via `@typetrack/vue`'s package.json `"exports"."import"` condition
// (`packages/vue/dist/index.js`, the ESM build). A plain
// `require("@typetrack/vue")` in *this* file, however, resolves via the
// `"require"` condition instead (`packages/vue/dist/index.cjs`, the CJS
// build) -- a genuinely different file, evaluated as a separate module
// instance with its own `analyticsKey = Symbol(...)` (verified by hand:
// `require("@typetrack/vue").typetrackPlugin !== ` the object a static
// `import` of the same specifier produces). `provide()`/`inject()` then
// silently fail to match, since they're keyed on two different `Symbol`
// instances. Fix: resolve `@typetrack/vue` here the same way the static
// import inside `installTypetrackPlugin.ts` does --
// `import.meta.resolve("@typetrack/vue")` (Bun's synchronous ESM-condition
// resolver, matching a real `import` statement's own resolution) followed
// by `require(<that resolved path>)`, guaranteeing both sides load the
// exact same `dist/index.js` module instance.
import "../testSetup";

import { afterAll, describe, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Analytics, EventMap } from "typetrack";

const { mount } = require("@vue/test-utils") as typeof import("@vue/test-utils");
const { defineComponent, h } = require("vue") as typeof import("vue");
const { useAnalytics } = require(import.meta.resolve("@typetrack/vue")) as typeof import("@typetrack/vue");
const { installTypetrackPlugin } = require("./installTypetrackPlugin") as typeof import("./installTypetrackPlugin");

afterAll(() => {
  // Guarded: see `packages/svelte/src/AnalyticsProvider.test.ts`'s
  // identical afterAll comment -- under `bun test --rerun-each`, this
  // file's hooks re-run per rerun but `../testSetup`'s module-top-level
  // `register()` does not, so an unguarded second `unregister()` throws.
  // Normal CI (`bun run test`) never re-runs this file.
  if (GlobalRegistrator.isRegistered) {
    GlobalRegistrator.unregister();
  }
});

interface TestEvents extends EventMap {
  cta_clicked: { label: string };
}

function createFakeAnalytics(): Analytics<TestEvents> {
  const track = mock((_event: keyof TestEvents, _payload?: TestEvents[keyof TestEvents]) => {});
  const identify = mock((_userId: string, _traits?: Record<string, unknown>) => {});
  const page = mock((_name?: string, _props?: Record<string, unknown>) => {});
  const flush = mock(async () => {});

  return { track, identify, page, flush } as unknown as Analytics<TestEvents>;
}

// A realistic consumer component: reads `useAnalytics()` (issue 001's
// composable, re-exported/auto-imported by this package unmodified) in
// `setup()` and wires it to a button's click handler.
function createConsumerComponent() {
  return defineComponent({
    name: "NuxtConsumerComponent",
    setup() {
      const analytics = useAnalytics<TestEvents>();

      return () =>
        h(
          "button",
          { onClick: () => analytics.track("cta_clicked", { label: "signup" }) },
          "track",
        );
    },
  });
}

describe("installTypetrackPlugin (integration, real Vue app via @vue/test-utils standing in for Nuxt's own runtime)", () => {
  it("installs the fakeAnalytics stand-in so a mounted consumer component's useAnalytics()/track() calls reach it", async () => {
    const fakeAnalytics = createFakeAnalytics();

    const wrapper = mount(createConsumerComponent(), {
      global: {
        // Installed via a plain inline plugin object calling
        // `installTypetrackPlugin` directly, rather than
        // `[typetrackPlugin, { analytics }]` -- this is deliberately
        // exercising THIS package's own factored function, not
        // `@typetrack/vue`'s plugin object directly (that's issue 001's
        // own test suite's job).
        plugins: [
          {
            install(app) {
              installTypetrackPlugin(app, fakeAnalytics);
            },
          },
        ],
      },
    });

    await wrapper.trigger("click");

    expect(fakeAnalytics.track).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.track).toHaveBeenCalledWith("cta_clicked", { label: "signup" });
  });

  it("useAnalytics() throws when installTypetrackPlugin was never called (no ancestor plugin install)", () => {
    expect(() => mount(createConsumerComponent())).toThrow(/useAnalytics/);
  });
});
