<script lang="ts">
  import { setContext, untrack } from "svelte";
  import type { EventMap } from "typetrack";
  import { ANALYTICS_KEY, type AnalyticsProviderProps } from "./context";

  // Svelte 5 runes-era prop destructuring (not the Svelte-4-era `export let`
  // convention). `children` is a `Snippet` (Svelte 5's replacement for the
  // old default `<slot />`), rendered below via `{@render children?.()}`.
  let { analytics, children }: AnalyticsProviderProps<EventMap> = $props();

  // `setContext` must be called during this component's own synchronous
  // initialization (a hard Svelte runtime constraint) -- which is exactly
  // why this package ships one real `.svelte` component instead of a plain
  // `.ts` function, unlike `@typetrack/vue`'s plugin-based `provide()`.
  //
  // `untrack(...)` (not a bare `analytics` reference): the Svelte 5 compiler
  // otherwise raises a `state_referenced_locally` warning against any
  // `$props()`-derived binding read outside of a template/derived/closure,
  // assuming a missed-reactivity mistake. That warning does not apply here
  // -- `untrack` is Svelte's own documented way to say "yes, only the
  // initial value is intended," which is exactly this whole package's
  // design (see `context.ts`'s header comment): `Analytics` is a stable,
  // non-reactive service handle, constructed once by the app and never
  // reassigned, so there is no "later value" to react to in the first
  // place.
  setContext(ANALYTICS_KEY, untrack(() => analytics));
</script>

{@render children?.()}
