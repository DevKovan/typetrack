<script lang="ts">
  import type { Analytics, EventMap } from "typetrack";

  // A small, dedicated SSR-only component -- deliberately not
  // `SignUpForm.svelte` itself, and deliberately not wired through
  // `@typetrack/svelte`'s `useAnalytics()`/Context API at all. See
  // `README.md`'s own "Explanation" section (and `./compileForServer.ts`'s
  // own header comment) for the full, real, verified-by-hand reasons why:
  // in short, `@typetrack/svelte`'s own published `AnalyticsProvider` ships
  // precompiled client-mode-only output (cannot be server-rendered at all,
  // regardless of this file), and separately, `useAnalytics()`'s own
  // `getContext` import resolves through this repo's mandated
  // `--conditions=browser` test flag to Svelte's *client*-mode package
  // entry even during a genuine SSR pass -- a real, current limitation of
  // the shipped package, out of scope for this examples-only issue to fix.
  //
  // This component instead receives a real `Analytics` instance directly as
  // a plain prop -- still real Svelte SSR compilation (`svelte/compiler`,
  // `generate: "server"`) and real `svelte/server` rendering, still calling
  // into a genuinely real, unmodified `createAnalytics()` instance during
  // that server render, with no browser-global crash -- just not routed
  // through the Context-based integration this package's CSR story uses.
  let { analytics }: { analytics: Analytics<EventMap> } = $props();

  // Fires during this component's own SSR render, mirroring a realistic
  // "you're signed up" confirmation page a SvelteKit `load` function might
  // server-render after a successful sign-up.
  void analytics.track("User Signed Up", { plan: "free" });
</script>

<p>Welcome, you're signed up!</p>
