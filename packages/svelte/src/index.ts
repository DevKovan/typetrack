export { default as AnalyticsProvider } from "./AnalyticsProvider.svelte";
export { useAnalytics, type AnalyticsProviderProps } from "./context";

// Re-exported (not redefined) so a consumer can type its own `Events` map
// against `useAnalytics<MyEvents>()`/`<AnalyticsProvider analytics={...}>`
// without a separate direct dependency on `typetrack`.
export type { Analytics, EventMap } from "typetrack";
