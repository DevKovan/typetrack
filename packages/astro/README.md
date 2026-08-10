# @typetrack/astro

Astro integration (astro:config:setup + injectScript automatic pageview tracking) for typetrack.

## Install

```sh
bun add typetrack @typetrack/astro
```

Requires Astro 6/7.

## Usage

```ts
// src/lib/analytics.ts
import { createAnalytics } from "typetrack";

export default createAnalytics();
```

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import typetrackAstro from "@typetrack/astro";

export default defineConfig({
  integrations: [
    typetrackAstro({ analyticsModule: "/src/lib/analytics.ts" }),
  ],
});
```

`analyticsModule` must point at an app-authored file that default-exports
a `createAnalytics(...)`-constructed instance — Astro ships zero client JS
by default (islands architecture), so this integration injects a script
tag that imports and uses that module directly, rather than relying on a
persistent component tree/context. Automatic pageview tracking is on by
default (`autoPageViews: false` to disable).

See [`docs/README.md`](https://github.com/DevKovan/typetrack/blob/main/docs/README.md) for the full documentation index.
