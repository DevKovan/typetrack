import { createContext, type ReactNode } from "react";
import type { Analytics, EventMap } from "typetrack";

// `undefined` (not a fake no-op `Analytics`) is the sentinel here so that
// "no provider in the tree" is distinguishable from "a real provider
// supplying a no-op analytics instance" -- `useAnalytics` throws on
// `undefined` rather than silently handing back a no-op.
export const AnalyticsContext = createContext<Analytics<EventMap> | undefined>(undefined);

export interface AnalyticsProviderProps<Events extends EventMap = EventMap> {
  analytics: Analytics<Events>;
  children: ReactNode;
}

// Named function declaration (not an arrow function) to avoid the `<T,>`
// generic-arrow-function/JSX ambiguity in `.tsx` files.
export function AnalyticsProvider<Events extends EventMap = EventMap>({
  analytics,
  children,
}: AnalyticsProviderProps<Events>) {
  // React 19's direct-context-as-provider JSX form (`<Context value={...}>`)
  // rather than the legacy `<Context.Provider value={...}>` form.
  return <AnalyticsContext value={analytics as Analytics<EventMap>}>{children}</AnalyticsContext>;
}
