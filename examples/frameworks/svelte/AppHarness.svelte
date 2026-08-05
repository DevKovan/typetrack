<script lang="ts">
  import type { Analytics, EventMap } from "typetrack";
  import { AnalyticsProvider } from "@typetrack/svelte";
  import SignUpForm from "./SignUpForm.svelte";

  // A real app's own root component: installs `<AnalyticsProvider
  // analytics={...}>` once, wrapping `<SignUpForm>` -- exactly what a real
  // Svelte app's own root layout would do. `@testing-library/svelte`'s
  // `render()` renders one component at a time, so this small `.svelte`
  // file is what CSR tests (`SignUpForm.integration.test.ts`) mount,
  // mirroring `packages/svelte/src/__fixtures__/ProviderHarnessFixture.
  // svelte`'s own convention.
  //
  // `<SignUpForm />` is nested directly inside `<AnalyticsProvider>`'s own
  // tags with no explicit `{#snippet children()}...{/snippet}` wrapper --
  // Svelte 5 implicitly turns plain, unwrapped markup nested inside a
  // component's own tags into that component's `children` snippet prop
  // (verified by `packages/svelte`'s own equivalent fixture; the explicit
  // form does not actually bind).
  let { analytics }: { analytics: Analytics<EventMap> } = $props();
</script>

<AnalyticsProvider {analytics}>
  <SignUpForm />
</AnalyticsProvider>
