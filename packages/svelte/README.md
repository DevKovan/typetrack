# @typetrack/svelte

Svelte 5 bindings (AnalyticsProvider, useAnalytics) for typetrack.

## Install

```sh
bun add typetrack @typetrack/svelte
```

Requires Svelte 5+.

## Usage

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { createAnalytics } from "typetrack";
  import { AnalyticsProvider } from "@typetrack/svelte";

  const analytics = createAnalytics();
</script>

<AnalyticsProvider {analytics}>
  <SignupButton />
</AnalyticsProvider>
```

```svelte
<!-- SignupButton.svelte -->
<script lang="ts">
  import { useAnalytics } from "@typetrack/svelte";

  const analytics = useAnalytics();
</script>

<button onclick={() => analytics.track("Signup Completed", { plan: "pro" })}>Sign up</button>
```

`useAnalytics()` throws if called outside an `AnalyticsProvider` — a
missing provider is a loud, immediate error, not a silent no-op. Per
Svelte's own rules, it must be called synchronously during a component's
initialization (a `<script>` block), never from an async callback.

See [`docs/README.md`](https://github.com/DevKovan/typetrack/blob/main/docs/README.md) for the full documentation index.
