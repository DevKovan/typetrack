# @typetrack/nuxt

Nuxt 4 module (SSR-safe provide/inject registration, automatic route-change pageview tracking) for typetrack.

## Install

```sh
bun add typetrack @typetrack/nuxt
```

Requires Nuxt 4+.

## Usage

```ts
// app/analytics.ts
import { createAnalytics } from "typetrack";

export default createAnalytics();
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@typetrack/nuxt"],
  typetrack: {
    analyticsModule: "~/app/analytics",
  },
});
```

```vue
<!-- any component -->
<script setup lang="ts">
const analytics = useAnalytics(); // auto-imported
</script>

<template>
  <button @click="analytics.track('Signup Completed', { plan: 'pro' })">Sign up</button>
</template>
```

`analyticsModule` must point at an app-authored file that default-exports
a `createAnalytics(...)`-constructed instance — Nuxt's module `setup()`
runs at build/config time in Node and can't hold a live instance across
the client/server runtime boundary directly. Automatic pageview tracking
on route change is on by default (`autoPageViews: false` to disable).

See [`docs/README.md`](https://github.com/DevKovan/typetrack/blob/main/docs/README.md) for the full documentation index.
