<script lang="ts">
  import type { Analytics, EventMap } from "typetrack";
  import AnalyticsProvider from "../AnalyticsProvider.svelte";
  import ConsumerFixture from "./ConsumerFixture.svelte";

  // Test-only harness: `@testing-library/svelte`'s `render()` renders one
  // component at a time, so wiring "`<AnalyticsProvider analytics={...}>`
  // wrapping a consumer component, the consumer passed as the Svelte 5
  // `children` snippet" (per this issue's own Test requirements) needs a
  // small `.svelte` file that actually authors that markup -- and has no
  // plain-`.ts`-callable equivalent that would still satisfy Svelte's "must
  // be a real component" constraint on `useAnalytics()`/`getContext()` (see
  // `../context.ts`).
  //
  // `<ConsumerFixture />` is nested directly inside `<AnalyticsProvider>`'s
  // own tags below with *no* explicit `{#snippet children()}...{/snippet}`
  // wrapper -- verified by hand that the explicit form does not actually
  // bind to `AnalyticsProvider.svelte`'s `let { children } = $props()` (it
  // silently renders nothing at all, no error). Plain, unwrapped markup
  // nested inside a component's own tags is what Svelte 5 implicitly turns
  // into that component's `children` snippet prop, and is the form that
  // actually works.
  interface TestEvents extends EventMap {
    button_clicked: { label: string };
  }

  let { analytics }: { analytics: Analytics<TestEvents> } = $props();
</script>

<AnalyticsProvider {analytics}>
  <ConsumerFixture />
</AnalyticsProvider>
