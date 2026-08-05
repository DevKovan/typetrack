// Fallback ambient type declaration for `.svelte` imports that have no
// per-file colocated companion (unlike `../AnalyticsProvider.svelte`, which
// has its own precise `AnalyticsProvider.svelte.d.ts` right next to it --
// see that file's header comment for why one exists at all). Test-only
// fixture components below (`ConsumerFixture.svelte`,
// `ProviderHarnessFixture.svelte`) are never re-exported from this package's
// public `src/index.ts`, so a precise per-fixture declaration is not worth
// hand-maintaining -- this wildcard, resolved by TypeScript only when no
// more specific match exists (per TS's own "Arbitrary Extensions" module
// resolution: a colocated `<name>.svelte.d.ts` always wins over this
// pattern), is enough for `bun run typecheck`/`typecheck:tsc` to type-check
// the test files that import these fixtures via
// `import ... from "./__fixtures__/ConsumerFixture.svelte"`.
declare module "*.svelte" {
  import type { Component } from "svelte";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: Component<any>;
  export default component;
}
