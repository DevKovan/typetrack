// This file owns this example's entire happy-dom register/unregister
// lifecycle for the whole `bun test` process, mirroring `packages/vue/src/
// useAnalytics.test.ts`'s own established precedent and reasoning exactly
// (see `./testSetup.ts`'s own header comment for the full "why `require(...)`
// after `import './testSetup'`" reasoning -- `vue` itself, not just a
// testing library, must load after `GlobalRegistrator.register()` runs).
//
// Both this example's CSR (real `@vue/test-utils` mounting + a real click)
// and SSR (real `@vue/server-renderer` `renderToString()`, the same function
// `bun run index.ts` calls) stories are genuinely exercised here -- neither
// is stubbed.
import "./testSetup";

import { afterAll, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createAnalytics } from "typetrack";

const { mount } = require("@vue/test-utils") as typeof import("@vue/test-utils");
const { typetrackPlugin } = require("@typetrack/vue") as typeof import("@typetrack/vue");
const { SignUpForm } = require("./SignUpForm") as typeof import("./SignUpForm");
const { buildApp, renderSignUpFormToString } = require("./index") as typeof import("./index");
const { createStubProvider } = require("./stubProvider") as typeof import("./stubProvider");

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("frameworks/vue example -- CSR (real @vue/test-utils mounting)", () => {
  it("submitting the form with a valid email calls identify() then track('User Signed Up') against the stub provider", async () => {
    const stub = createStubProvider();
    const analytics = createAnalytics({ provider: stub.provider });

    const wrapper = mount(SignUpForm, {
      global: {
        plugins: [[typetrackPlugin, { analytics }]],
      },
    });

    await wrapper.find("input[type=email]").setValue("ada@example.com");
    await wrapper.find("form").trigger("submit");

    expect(stub.callLog).toEqual([
      { verb: "identify", userId: "ada@example.com", traits: { plan: "free", source: "signup_form" } },
      { verb: "track", eventName: "User Signed Up" },
    ]);
    expect(wrapper.find("p.confirmation").exists()).toBe(true);
  });

  it("submitting the form with an invalid email fires no analytics calls at all", async () => {
    const stub = createStubProvider();
    const analytics = createAnalytics({ provider: stub.provider });

    const wrapper = mount(SignUpForm, {
      global: {
        plugins: [[typetrackPlugin, { analytics }]],
      },
    });

    await wrapper.find("input[type=email]").setValue("not-an-email");
    await wrapper.find("form").trigger("submit");

    expect(stub.callLog).toEqual([]);
    expect(wrapper.find("p.confirmation").exists()).toBe(false);
  });

  it("throws a descriptive error when mounted with no ancestor app.use(typetrackPlugin, ...) install", () => {
    expect(() => mount(SignUpForm)).toThrow(/useAnalytics/);
    expect(() => mount(SignUpForm)).toThrow(/typetrackPlugin/);
  });
});

describe("frameworks/vue example -- SSR (real @vue/server-renderer renderToString())", () => {
  it("renders the wrapped <SignUpForm> to a real HTML string with no browser-global crash", async () => {
    const { html, callLogLength } = await renderSignUpFormToString();

    expect(html).toContain("<form>");
    expect(html).toContain('type="email"');
    expect(html).toContain("Sign up");
    // No interaction ever happens during a server render -- the stub
    // provider should have received exactly zero calls.
    expect(callLogLength).toBe(0);
  });

  it("buildApp() (the same function the SSR demo and a real app's own entry point would both call) installs the plugin correctly", async () => {
    const stub = createStubProvider();
    const analytics = createAnalytics({ provider: stub.provider });
    const app = buildApp(analytics);

    // A fresh app built with a *different* stub still renders successfully
    // -- confirms `buildApp()` itself (not just the module-level singleton
    // in `renderSignUpFormToString()`) is what a real app's own SSR entry
    // point should call.
    const { renderToString } = require("@vue/server-renderer") as typeof import("@vue/server-renderer");
    const html = await renderToString(app);
    expect(html).toContain("<form>");
  });
});
