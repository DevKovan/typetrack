// A health-check dependency: resolves when `port` is confirmed live,
// rejects (failure or timeout, indistinguishable here) otherwise. Kept as a
// bare function type -- rather than any concrete implementation -- so
// `checkPortFileStatus` is testable with a fake, with no real network or
// process involved.
export type HealthCheck = (port: number) => Promise<void>;

export type PortFileStatus = "live" | "stale";

// Decides whether a `.typetrack/port` file found on disk still points at a
// genuinely running `typetrack dev` instance ("live") or is left over from a
// crashed/killed process ("stale"). Never throws -- a rejecting/timing-out
// `healthCheck` is itself the signal for "stale", not an error condition for
// this function's caller.
export async function checkPortFileStatus(port: number, healthCheck: HealthCheck): Promise<PortFileStatus> {
  try {
    await healthCheck(port);
    return "live";
  } catch {
    return "stale";
  }
}
