import { render } from "svelte/server";
import { createAnalytics } from "typetrack";
import { createStubProvider } from "./stubProvider";
import { compileServerGreetingForServer } from "./compileForServer";

// The one subdirectory of `examples/frameworks/` demonstrating Svelte --
// genuinely runnable and tested in this repo (see `../README.md`/
// `README.md` for why, mirroring `examples/runtimes/README.md`'s own
// tested-vs-source-only split).
//
// This file's own `bun run index.ts` entry point demonstrates two SSR
// stories, both genuinely real and deterministic regardless of how they're
// invoked -- see `README.md`'s own "Explanation" section, and
// `./compileForServer.ts`'s own header comment, for the full "why" behind
// not routing this demo through `@typetrack/svelte`'s own
// `AnalyticsProvider`/`useAnalytics()` (two real, current, documented
// limitations of that shipped package, out of scope for this
// examples-only issue to fix). CSR (mounting `<SignUpForm>`, filling it in,
// submitting it) is exercised by `SignUpForm.integration.test.ts` instead,
// via `@testing-library/svelte` + happy-dom, which this file's own
// Node/Bun-run path does not register.

export interface SsrRenderResult {
  html: string;
  callLogLength: number;
}

// Server-renders `ServerGreeting.svelte`'s own real, unmodified source (via
// `./compileForServer.ts`, a plain function call, no dev server), passing a
// real, stub-provider-backed `Analytics` instance directly as a prop.
// Exported (not only run inline) so `index.integration.test.ts` exercises
// the exact same function `bun run index.ts` calls.
export async function renderServerGreetingToString(): Promise<SsrRenderResult> {
  const ServerGreeting = await compileServerGreetingForServer();

  const stub = createStubProvider();
  const analytics = createAnalytics({ provider: stub.provider });

  const { html } = render(ServerGreeting, { props: { analytics } });

  return { html, callLogLength: stub.callLog.length };
}

export interface ServerSideTrackingResult {
  callLogLength: number;
}

// Demonstrates the piece of this example that's genuinely, unconditionally
// SSR-safe today: `createAnalytics()` itself (core, Phase 9/13's
// already-verified SSR safety) constructing and calling `identify()`/
// `track()`/`flush()` directly -- no Svelte component, no Context,
// involved at all. This is what a real SvelteKit `+page.server.ts`/
// `hooks.server.ts` server action would do to record a sign-up server-side.
export async function runServerSideIdentifyAndTrack(): Promise<ServerSideTrackingResult> {
  const stub = createStubProvider();
  const analytics = createAnalytics({ provider: stub.provider });

  await analytics.identify("ada@example.com", { plan: "free", source: "signup_form" });
  await analytics.track("User Signed Up", { plan: "free" });
  await analytics.flush();

  return { callLogLength: stub.callLog.length };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  console.log(
    "[frameworks/svelte] server-rendering ServerGreeting.svelte (svelte/compiler, generate: \"server\") with a real Analytics instance passed as a prop...",
  );
  const { html, callLogLength: greetingCallLogLength } = await renderServerGreetingToString();
  console.log(`[frameworks/svelte] rendered markup: ${html}`);
  console.log(`[frameworks/svelte] stub provider received ${greetingCallLogLength} call(s) during that server render -- no browser-global crash`);

  console.log(
    "[frameworks/svelte] calling createAnalytics().identify()/track()/flush() directly, server-side (e.g. a SvelteKit server action) -- no Svelte component involved...",
  );
  const { callLogLength } = await runServerSideIdentifyAndTrack();
  console.log(
    `[frameworks/svelte] stub provider received ${callLogLength} calls (identify, track, flush) -- core's own already-verified SSR safety (Phase 9/13)`,
  );
}
