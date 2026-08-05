/** @jsxImportSource solid-js */
// A realistic consumer component: reads `useAnalytics()` and wires each
// method up to a button's `onClick`, the way an app would. Mirrors
// `packages/react/src/AnalyticsProvider.test.tsx`'s/`packages/svelte/src/
// __fixtures__/ConsumerFixture.svelte`'s own `ConsumerComponent`/
// `ConsumerFixture` precedent exactly.
//
// Kept in its own file (a `.tsx` fixture, loaded via a *dynamic*
// `await import(...)` from the test file, never a static one), not written
// inline as JSX in the test file itself -- see
// `AnalyticsProvider.test.ts`'s own header comment for why: this package's
// `.tsx` files (this one included) are only correctly compiled into Solid's
// real, fine-grained-reactive output by `@dschz/bun-plugin-solid`
// (registered in `../testSetup.ts`), and that registration only takes
// effect for modules resolved *after* it runs -- a `bun test` *entry* file
// (which this is not) has its own top-level JSX already parsed by Bun's
// native (React-shaped, automatic-runtime) JSX transform before any of its
// own top-level code -- including a `plugin(...)` registration call --
// ever executes, confirmed by hand.
import { useAnalytics } from "../useAnalytics";
import type { EventMap } from "typetrack";

export interface TestEvents extends EventMap {
  button_clicked: { label: string };
}

export default function ConsumerFixture() {
  const analytics = useAnalytics<TestEvents>();

  return (
    <div>
      <button onClick={() => analytics.track("button_clicked", { label: "cta" })}>track</button>
      <button onClick={() => analytics.identify("user_1", { plan: "pro" })}>identify</button>
      <button onClick={() => analytics.page("home", { referrer: "google" })}>page</button>
      <button onClick={() => void analytics.flush()}>flush</button>
    </div>
  );
}
