<script lang="ts">
  import type { EventMap } from "typetrack";
  import { useAnalytics } from "../context";

  // A realistic minimal consumer component: reads `useAnalytics()` in its
  // own `<script>` block (Svelte's required "component initialization"
  // window -- see `../context.ts`'s header comment) and wires each method
  // up to a button's click handler, the way an app would. Deliberately not
  // wrapped in an ancestor `<AnalyticsProvider>` here -- callers of this
  // fixture decide whether to nest it under one (see
  // `ProviderHarnessFixture.svelte` for the "with provider" case) or render
  // it bare (the "throws" case).
  interface TestEvents extends EventMap {
    button_clicked: { label: string };
  }

  const analytics = useAnalytics<TestEvents>();
</script>

<div>
  <button onclick={() => analytics.track("button_clicked", { label: "cta" })}>track</button>
  <button onclick={() => analytics.identify("user_1", { plan: "pro" })}>identify</button>
  <button onclick={() => analytics.page("home", { referrer: "google" })}>page</button>
  <button onclick={() => void analytics.flush()}>flush</button>
</div>
