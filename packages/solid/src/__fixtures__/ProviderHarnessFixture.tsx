/** @jsxImportSource solid-js */
// A small `.tsx` harness, needed for the same reason
// `packages/svelte/src/__fixtures__/ProviderHarnessFixture.svelte` exists:
// `<AnalyticsProvider analytics={...}>{children}</AnalyticsProvider>` is
// literal JSX, and this package's test file (`AnalyticsProvider.test.ts`)
// is deliberately kept a plain `.ts` file with no JSX syntax of its own --
// see that file's own header comment. `props` is accessed directly
// (`props.analytics`), never destructured, mirroring `AnalyticsProvider.tsx`
// itself -- the same Solid reactivity constraint applies to every component
// in this package, fixtures included.
import { AnalyticsProvider } from "../AnalyticsProvider";
import ConsumerFixture, { type TestEvents } from "./ConsumerFixture";
import type { Analytics } from "typetrack";

export interface ProviderHarnessFixtureProps {
  analytics: Analytics<TestEvents>;
}

export default function ProviderHarnessFixture(props: ProviderHarnessFixtureProps) {
  return (
    <AnalyticsProvider analytics={props.analytics}>
      <ConsumerFixture />
    </AnalyticsProvider>
  );
}
