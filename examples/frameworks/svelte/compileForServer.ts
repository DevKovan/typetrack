// Compiles `ServerGreeting.svelte`'s real, unmodified source for Svelte's
// server target (`generate: "server"`) directly via `svelte/compiler`, and
// dynamically imports the result -- a plain function call, no dev server.
//
// **Why `ServerGreeting.svelte`, and not `SignUpForm.svelte` (this
// example's own CSR component) or `@typetrack/svelte`'s `AnalyticsProvider`
// -- two real, verified-by-hand limitations, not an oversight**:
//
// 1. `@typetrack/svelte`'s own published `dist/index.js`
//    (`packages/svelte/tsup.config.ts`'s own documented default -- tsup's
//    built-in `.svelte` esbuild plugin, `generate: "client"`) ships
//    *precompiled client-mode-only* Svelte output. Rendering a component
//    tree containing its `AnalyticsProvider` server-side throws
//    `ReferenceError: document is not defined` immediately (reproduced
//    directly: its compiled body unconditionally calls a DOM-node-creating
//    template helper the moment it's invoked -- a server-compiled parent
//    calls children using a completely different calling convention than a
//    client-compiled component expects; the two are not interoperable at
//    all, by design). This is a real, current limitation of how
//    `packages/svelte` ships (out of scope for this examples-only issue to
//    fix -- see `plan/phase-14-framework-wrappers/
//    003-svelte-analytics-provider.md`/`BRIEF.md`'s Design decision 2 for
//    why the package ships precompiled dist rather than raw `.svelte`
//    source).
// 2. Separately (reproduced directly, and genuinely surprising): even
//    `SignUpForm.svelte`'s own `useAnalytics()` call -- a plain,
//    dependency-free function, no precompiled-dist involvement at all --
//    fails during a real `bun test` run specifically, throwing Svelte's own
//    `lifecycle_outside_component` error instead of `useAnalytics()`'s own
//    missing-provider error. Root cause: this repo's root `bun test` runs
//    with `--conditions=browser` set process-wide (required for
//    `@typetrack/svelte`'s CSR tests, and this example's own CSR tests).
//    `useAnalytics()` (`packages/svelte/src/context.ts`) imports
//    `getContext` from the *bare* `"svelte"` package specifier, whose own
//    `package.json` `"exports"` `"."` entry resolves `"browser"` (Svelte's
//    *client*-mode entry point) ahead of the unconditional default -- so
//    with that flag active, `getContext` always resolves to Svelte's
//    client-mode internal component-context tracking, even during a
//    genuine server render performed via `svelte/server`'s real,
//    correctly-server-resolved `render()` (`svelte/server`'s own exports
//    entry is unconditional). The two internal trackers are for different,
//    unrelated "current component" stacks -- `render()` only ever sets the
//    *server* one, so client-resolved `getContext()` always sees "no active
//    component," regardless of whether a real ancestor provider is present.
//    A second real, current limitation, out of scope for this
//    examples-only issue to fix.
//
// Given both, this file compiles a small, dedicated SSR-only component
// (`ServerGreeting.svelte`) instead -- one that receives a real `Analytics`
// instance as a plain prop rather than through `@typetrack/svelte`'s
// Context integration -- so this example can still genuinely demonstrate
// real Svelte SSR compilation + rendering + a real, unmodified
// `createAnalytics()` instance being called during that render, with no
// browser-global crash, without depending on either of the two limitations
// above. See `README.md`'s own "Explanation" section for the full story,
// including the separate, genuinely-unconditional `createAnalytics()`
// direct-call SSR demo (`index.ts`'s `runServerSideIdentifyAndTrack()`).
import { compile } from "svelte/compiler";
import type { Component } from "svelte";
import type { Analytics, EventMap } from "typetrack";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const serverGreetingPath = fileURLToPath(new URL("./ServerGreeting.svelte", import.meta.url));

// Typed against `svelte`'s own `Component<Props>` shape -- for type-checking
// purposes only. The real, server-compiled runtime shape (`($$renderer,
// $$props) => void`, per `svelte/compiler`'s own `generate: "server"`
// output, verified by hand) is genuinely different from `Component<Props>`'s
// own client-oriented call signature -- there is no compiled `.d.ts` for a
// module this file writes to a transient temp path at runtime, so this cast
// documents "close enough for `svelte/server`'s `render()` to accept it
// structurally," not a claim that the two shapes are the same thing.
export type ServerGreetingComponent = Component<{ analytics: Analytics<EventMap> }>;

export async function compileServerGreetingForServer(): Promise<ServerGreetingComponent> {
  const source = await readFile(serverGreetingPath, "utf8");
  const result = compile(source, { generate: "server", filename: "ServerGreeting.svelte" });

  const tempPath = fileURLToPath(new URL(`./.ServerGreeting.server.${crypto.randomUUID()}.mjs`, import.meta.url));
  await Bun.write(tempPath, result.js.code);
  try {
    const mod = (await import(tempPath)) as { default: unknown };
    return mod.default as ServerGreetingComponent;
  } finally {
    await unlink(tempPath);
  }
}
