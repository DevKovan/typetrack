import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createAnalytics } from "typetrack";
import { typetrackPlugin, type Analytics } from "@typetrack/vue";
import { SignUpForm, type SignUpEvents } from "./SignUpForm";
import { createStubProvider } from "./stubProvider";

// The one subdirectory of `examples/frameworks/` demonstrating Vue --
// genuinely runnable and tested in this repo (see
// `../README.md`/`README.md` for why, mirroring
// `examples/runtimes/README.md`'s own tested-vs-source-only split).
//
// This file's own `bun run index.ts` entry point demonstrates SSR only --
// server-rendering `<SignUpForm>` (wrapped in `typetrackPlugin`) via
// `@vue/server-renderer`'s `renderToString()`, a plain function call, no dev
// server -- since that's what's meaningfully deterministic and printable to
// a console. CSR (mounting, filling in the form, submitting it) is
// exercised by `index.integration.test.ts` instead, via `@vue/test-utils` +
// happy-dom, which this file's own Node/Bun-run path does not register.

// Builds a real Vue app wrapping `<SignUpForm>` with `typetrackPlugin` --
// shared by both this file's own SSR demo and `index.integration.test.ts`'s
// CSR mount, so neither can silently drift out of sync with the other's
// idea of "how a real app installs the plugin."
export function buildApp(analytics: Analytics<SignUpEvents>) {
  const app = createSSRApp({ render: () => h(SignUpForm) });
  app.use(typetrackPlugin, { analytics });
  return app;
}

export interface SsrDemoResult {
  html: string;
  callLogLength: number;
}

// Server-renders `<SignUpForm>` against a fresh stub-provider-backed
// `Analytics` instance -- exported (not only run inline) so
// `index.integration.test.ts` exercises the exact same function `bun run
// index.ts` calls, per this repo's established `examples/*` convention (see
// `examples/runtimes/bun/index.ts`'s own `runBunRuntimeTrackingFlow`).
export async function renderSignUpFormToString(): Promise<SsrDemoResult> {
  const stub = createStubProvider();
  const analytics = createAnalytics({ provider: stub.provider });
  const app = buildApp(analytics);

  const html = await renderToString(app);

  return { html, callLogLength: stub.callLog.length };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  console.log("[frameworks/vue] server-rendering <SignUpForm> (wrapped in typetrackPlugin) via @vue/server-renderer's renderToString()...");
  const { html, callLogLength } = await renderSignUpFormToString();
  console.log(`[frameworks/vue] rendered markup: ${html}`);
  console.log(
    `[frameworks/vue] stub provider received ${callLogLength} calls during SSR (expected 0 -- analytics fires only once a user actually submits the form, which never happens during a server render)`,
  );
}
