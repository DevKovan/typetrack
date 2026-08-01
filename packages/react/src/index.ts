export { AnalyticsProvider, type AnalyticsProviderProps } from "./AnalyticsProvider";
export { useAnalytics } from "./useAnalytics";

// Re-exported (not redefined) so a consumer can type its own `Events` map
// against `useAnalytics<MyEvents>()`/`<AnalyticsProvider analytics={...}>`
// without a separate direct dependency on `typetrack`.
export type { Analytics, EventMap } from "typetrack";
