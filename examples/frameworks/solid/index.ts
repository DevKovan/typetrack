// A deliberate deep import, not the plain `"solid-js/web"` specifier:
// this repo's own root `bun test` invocation runs with `--conditions=browser`
// set process-wide (`package.json`'s own `"test"` script -- required for
// `@typetrack/svelte`'s own tests, see `packages/svelte/src/testSetup.ts`'s
// header comment). `solid-js/web`'s own `package.json` `"exports"` map lists
// its `"browser"` condition *before* `"node"`/the unconditional default
// (verified by hand, `node_modules/solid-js/package.json`), so with that
// flag active, the plain `"solid-js/web"` specifier resolves to the
// *client*-targeted build everywhere in this shared process -- including
// here, where a real SSR pass needs the *server* build specifically. That
// client build's own `renderToString()` throws "renderToString is not
// supported in the browser" unconditionally (confirmed by hand), regardless
// of whether happy-dom's DOM globals happen to be registered anywhere else
// in the process. `"solid-js/web/dist/server.js"` is a real, stable,
// wildcard-exported subpath (`"./web/dist/*"` in that same `package.json`)
// with no condition gating on it at all -- this bypasses the ambient
// `--conditions=browser` flag entirely and guarantees the genuine server
// build, which is what this file's own SSR demo needs regardless of which
// CLI flags happen to be set wherever it's run from.
import { renderToString } from "solid-js/web/dist/server.js";
import { sharedConfig } from "solid-js";
import { createAnalytics } from "typetrack";
// `@typetrack/solid`'s own published dist (`dist/index.js`, resolved via
// plain default `import`) contains no literal JSX at all -- it's already
// compiled -- so this static import needs no plugin/dynamic-import
// indirection of its own.
import { AnalyticsProvider } from "@typetrack/solid";
import { createStubProvider } from "./stubProvider";
import { compileSignUpFormForServer } from "./compileForServer";

// The one subdirectory of `examples/frameworks/` demonstrating SolidJS --
// genuinely runnable and tested in this repo (see `../README.md`/
// `README.md` for why, mirroring `examples/runtimes/README.md`'s own
// tested-vs-source-only split).
//
// This file's own `bun run index.ts` entry point demonstrates SSR only --
// server-rendering `<AnalyticsProvider><SignUpForm /></AnalyticsProvider>`
// via `solid-js/web`'s `renderToString()`, a plain function call, no dev
// server. CSR (mounting, filling in the form, submitting it) is exercised
// by `index.integration.test.ts` instead, via `@solidjs/testing-library` +
// happy-dom + `./solidJsxPlugin.ts`'s CSR-targeted compile, which this
// file's own SSR path does not use -- see `./compileForServer.ts`'s own
// header comment for why SSR needs a separate, server-targeted compile of
// `./SignUpForm.tsx`'s real, unmodified source.

export interface SsrDemoResult {
  html: string;
  callLogLength: number;
}

// Server-renders `<SignUpForm>` (wrapped in `AnalyticsProvider`) against a
// fresh stub-provider-backed `Analytics` instance -- exported (not only run
// inline) so `index.integration.test.ts` exercises the exact same function
// `bun run index.ts` calls, per this repo's established `examples/*`
// convention (see `examples/runtimes/bun/index.ts`'s own
// `runBunRuntimeTrackingFlow`).
//
// Called as a plain function (`AnalyticsProvider({...})`/`SignUpForm()`),
// not via JSX -- this file itself contains no literal JSX syntax, and a
// direct function call composes just as well as JSX would, since Solid
// components are plain functions returning `JSX.Element`.
export async function renderSignUpFormToString(): Promise<SsrDemoResult> {
  const SignUpForm = await compileSignUpFormForServer();

  const stub = createStubProvider();
  const analytics = createAnalytics({ provider: stub.provider });

  try {
    const html = renderToString(() =>
      AnalyticsProvider({
        analytics,
        get children() {
          return SignUpForm();
        },
      }),
    );

    return { html, callLogLength: stub.callLog.length };
  } finally {
    // Load-bearing, not defensive paranoia -- verified by hand:
    // `solid-js/web`'s server-build `renderToString()` sets `solid-js`'s own
    // *process-global* `sharedConfig.context` (marking "an SSR render is/was
    // in progress") and never clears it afterward on its own. Left set, a
    // *later*, unrelated `solid-js/web` *client*-build render anywhere else
    // in this repo's one shared `bun test` process (e.g.
    // `packages/solid/src/AnalyticsProvider.test.ts`'s own CSR test) then
    // incorrectly takes the *hydration* code path instead of a plain fresh
    // render, crashing with `sharedConfig.registry` being `undefined`
    // (reproduced directly). Resetting it back to `undefined` here is what
    // keeps this example's own SSR demo from corrupting every other
    // solid-js consumer's tests that happen to run later in the same
    // process -- a real, current Solid characteristic (SSR and CSR are
    // never meant to share one long-lived process in a real deployment
    // either), not a defect in this example's own logic.
    sharedConfig.context = undefined;
  }
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  console.log(
    "[frameworks/solid] server-rendering <SignUpForm> (wrapped in AnalyticsProvider) via solid-js/web's renderToString()...",
  );
  const { html, callLogLength } = await renderSignUpFormToString();
  console.log(`[frameworks/solid] rendered markup: ${html}`);
  console.log(
    `[frameworks/solid] stub provider received ${callLogLength} calls during SSR (expected 0 -- analytics fires only once a user actually submits the form, which never happens during a server render)`,
  );
}
