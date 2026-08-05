import { describe, expect, it } from "bun:test";
import { renderServerGreetingToString, runServerSideIdentifyAndTrack } from "./index";

// SSR integration test -- exercises the exact same functions `bun run
// index.ts` calls, genuinely (real `svelte/compiler` server-target
// compilation + `svelte/server`'s real `render()`; a real
// `createAnalytics()` instance), not stubbed. See `README.md`'s own
// "Explanation" section and `./compileForServer.ts`'s own header comment
// for why this example's SSR story is shaped this way (two real, current
// limitations in `@typetrack/svelte`'s own published package -- out of
// scope for this examples-only issue to fix).
describe("frameworks/svelte example -- SSR (real svelte/compiler + svelte/server)", () => {
  it("server-renders ServerGreeting.svelte's real source with a real Analytics instance, with no browser-global crash", async () => {
    const { html, callLogLength } = await renderServerGreetingToString();

    expect(html).toContain("Welcome, you're signed up!");
    // `ServerGreeting.svelte`'s own `<script>` block fires exactly one
    // `track()` call during its own server render.
    expect(callLogLength).toBe(1);
  });

  it("produces deterministic markup across repeated calls (no leaked state between renders)", async () => {
    const first = await renderServerGreetingToString();
    const second = await renderServerGreetingToString();

    expect(first.html).toBe(second.html);
  });

  it("createAnalytics().identify()/track()/flush() work correctly server-side, with no Svelte component or context involved at all", async () => {
    const { callLogLength } = await runServerSideIdentifyAndTrack();

    // identify() -> track("User Signed Up") -> flush(): 3 real calls
    // reaching the stub provider, none lost.
    expect(callLogLength).toBe(3);
  });
});
