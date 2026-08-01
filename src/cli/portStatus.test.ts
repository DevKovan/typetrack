import { describe, expect, it } from "bun:test";
import { checkPortFileStatus, type HealthCheck } from "./portStatus";

describe("checkPortFileStatus", () => {
  it('returns "live" when the health check resolves', async () => {
    const healthCheck: HealthCheck = async () => {
      // resolves -- a real instance answered.
    };

    await expect(checkPortFileStatus(4318, healthCheck)).resolves.toBe("live");
  });

  it('returns "stale" when the health check rejects (connection refused)', async () => {
    const healthCheck: HealthCheck = async () => {
      throw new Error("connection refused");
    };

    await expect(checkPortFileStatus(4318, healthCheck)).resolves.toBe("stale");
  });

  it('returns "stale" when the health check times out', async () => {
    const healthCheck: HealthCheck = () =>
      new Promise((_resolve, reject) => {
        reject(new Error("timed out"));
      });

    await expect(checkPortFileStatus(4318, healthCheck)).resolves.toBe("stale");
  });

  it("passes the candidate port through to the health-check function", async () => {
    let receivedPort: number | undefined;
    const healthCheck: HealthCheck = async (port) => {
      receivedPort = port;
    };

    await checkPortFileStatus(4999, healthCheck);

    expect(receivedPort).toBe(4999);
  });
});
