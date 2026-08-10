# @typetrack/vue

Vue 3 bindings (plugin + useAnalytics composable) for typetrack.

## Install

```sh
bun add typetrack @typetrack/vue
```

Requires Vue 3.4+.

## Usage

```ts
// main.ts
import { createApp } from "vue";
import { createAnalytics } from "typetrack";
import { typetrackPlugin } from "@typetrack/vue";
import App from "./App.vue";

const analytics = createAnalytics();

createApp(App).use(typetrackPlugin, { analytics }).mount("#app");
```

```vue
<!-- any component -->
<script setup lang="ts">
import { useAnalytics } from "@typetrack/vue";

const analytics = useAnalytics();
</script>

<template>
  <button @click="analytics.track('Signup Completed', { plan: 'pro' })">Sign up</button>
</template>
```

`useAnalytics()` throws if called without an ancestor
`app.use(typetrackPlugin, ...)` install — a missing plugin is a loud,
immediate error, not a silent no-op.

See [`docs/README.md`](https://github.com/DevKovan/typetrack/blob/main/docs/README.md) for the full documentation index.
