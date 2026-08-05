// Hand-written companion type declaration for `AnalyticsProvider.svelte`,
// resolved by TypeScript's "Arbitrary Extensions" feature (stable since
// TS 5.0: a `<name>.svelte.d.ts` file colocated with `<name>.svelte` is used
// as that exact module's type declaration for any
// `import ... from "./AnalyticsProvider.svelte"` specifier, transparently,
// with no `declare module "*.svelte"` ambient wildcard needed).
//
// This file exists because `tsc`/`tsgo` never parse `.svelte` syntax at all
// (confirmed via research -- there is no `include` glob or compiler flag
// that makes them understand it); `AnalyticsProvider.svelte`'s own real
// type is verified instead by Svelte's own `svelte-check` tool, via this
// package's separate `bun run typecheck:svelte` script. Without this file,
// `src/index.ts`'s `export { default as AnalyticsProvider } from
// "./AnalyticsProvider.svelte"` re-export -- and `tsup`'s `dts: true`
// bundling of that re-export into `dist/index.d.ts` -- would have no type
// to resolve at all.
//
// Kept in sync by hand with `AnalyticsProvider.svelte`'s actual runtime
// props (`analytics`, `children`) -- both files import the same
// `AnalyticsProviderProps` type from `./context` (a plain `.ts` file) as
// their single source of truth, so this declaration and the component's own
// `$props()` destructuring cannot independently drift out of sync on shape,
// only on the fact that this file exists at all (a real, accepted
// hand-maintenance cost of this package's tsup + esbuild-svelte build,
// versus the official `@sveltejs/package` tool, which generates this kind
// of declaration automatically -- not used here per this issue's own
// acceptance criteria).
import type { Component } from "svelte";
import type { AnalyticsProviderProps } from "./context";

// No explicit `<EventMap>` type argument -- `AnalyticsProviderProps`'s own
// default (`Events extends EventMap = EventMap`) already resolves to it, so
// there is no need to import `EventMap` from `typetrack` here too.
declare const AnalyticsProvider: Component<AnalyticsProviderProps>;

export default AnalyticsProvider;
