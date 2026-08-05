import { describe, expect, it } from "bun:test";
import { renderSignUpFormToString } from "./index";

// SSR-only integration test -- deliberately kept in its own file, separate
// from `SignUpForm.integration.test.ts`'s CSR tests: registering happy-dom's
// DOM globals (required for the CSR tests' `@solidjs/testing-library`
// rendering) makes `solid-js/web` treat the process as a real browser
// environment and refuse to run `renderToString()` at all ("renderToString
// is not supported in the browser", verified by hand) -- the two concerns
// cannot coexist in one `bun test` file. This file never registers
// happy-dom, so `solid-js/web` correctly resolves its server build here.
//
// Exercises the exact same `renderSignUpFormToString()` function `bun run
// index.ts` calls -- genuinely, not stubbed, real `solid-js/web`
// `renderToString()`, a plain function call, no dev server.
describe("frameworks/solid example -- SSR (real solid-js/web renderToString())", () => {
  it("renders the wrapped <SignUpForm> to a real HTML string with no browser-global crash", async () => {
    const { html, callLogLength } = await renderSignUpFormToString();

    expect(html).toContain("<form>");
    expect(html).toContain('type="email"');
    expect(html).toContain("Sign up");
    // No interaction ever happens during a server render -- the stub
    // provider should have received exactly zero calls.
    expect(callLogLength).toBe(0);
  });

  it("produces deterministic markup across repeated calls (no leaked state between renders)", async () => {
    const first = await renderSignUpFormToString();
    const second = await renderSignUpFormToString();

    expect(first.html).toBe(second.html);
  });
});
