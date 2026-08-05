/** @jsxImportSource solid-js */
// The pragma above is load-bearing, not decorative: the shared root
// `tsconfig.json`'s `"jsx": "react-jsx"` compiler option (added by phase 4
// for `@typetrack/react`, and still required by that package/`@typetrack/
// next`/this phase's `@typetrack/remix`) stays untouched -- every other
// JSX-bearing package in this repo needs React's JSX runtime, not Solid's.
// This file's own JSX below is instead redirected, per-file, to
// `solid-js/jsx-runtime`'s own `JSX` namespace/factory types for
// type-checking purposes (stable since TS 4.1, made robust for exactly this
// "multiple JSX libraries in one project" case by TS 5.1's decoupled
// JSX-namespace resolution; this repo runs TypeScript 6.0.3). This is a
// type-checking-only fix -- the actual *compilation* of this file's JSX into
// Solid's fine-grained reactive DOM-update calls is handled at build time by
// `tsup-preset-solid` (see `tsup.config.ts`'s own header comment), since
// esbuild's own built-in JSX transform (what plain `tsup`/`esbuild` would
// otherwise use) cannot correctly compile Solid JSX -- it would silently
// compile it as if it were React's `createElement`/automatic-runtime output.
import { createContext } from "solid-js";
import type { JSX } from "solid-js";
import type { Analytics, EventMap } from "typetrack";

// `undefined` (not a fake no-op `Analytics`) is the sentinel here so that
// "no provider in the tree" is distinguishable from "a real provider
// supplying a no-op analytics instance" -- `useAnalytics` throws on
// `undefined` rather than silently handing back a no-op. Mirrors every
// other package's context sentinel in this phase exactly.
export const AnalyticsContext = createContext<Analytics<EventMap> | undefined>(undefined);

export interface AnalyticsProviderProps<Events extends EventMap = EventMap> {
  analytics: Analytics<Events>;
  children: JSX.Element;
}

// Named function declaration (not an arrow function), and `props` is
// intentionally never destructured -- a well-documented, current Solid
// gotcha, distinct from React/Vue's own conventions: Solid's fine-grained
// reactivity model means destructuring `props` at the top of a component
// function breaks reactivity, since it reads each property once at
// destructure time instead of preserving the live, reactive property
// accessor. `props.analytics`/`props.children` are accessed directly below
// instead. An `Analytics` instance itself needs no signal wrapping here (it
// is a stable, non-reactive value, constructed once by the app and never
// reassigned -- consistent with every other framework's context value in
// this phase) -- `props.analytics` is read once and passed straight into
// `AnalyticsContext.Provider`'s `value`.
//
// Note: Solid's `createContext` returns an object exposing a `.Provider`
// component -- this is the `Context.Provider` form (like React's *legacy*,
// pre-19 form). Solid has no React-19-style "context object directly as a
// JSX element" equivalent; that newer syntax does not apply here.
export function AnalyticsProvider<Events extends EventMap = EventMap>(
  props: AnalyticsProviderProps<Events>,
): JSX.Element {
  return (
    <AnalyticsContext.Provider value={props.analytics as Analytics<EventMap>}>
      {props.children}
    </AnalyticsContext.Provider>
  );
}
