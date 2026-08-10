import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { buildEventJsonSchemas } from "./schemaExport";

describe("buildEventJsonSchemas", () => {
  it("returns { events: {} } when given undefined (no config loaded)", () => {
    expect(buildEventJsonSchemas(undefined)).toEqual({ events: {} });
  });

  it("returns { events: {} } when given an empty schema map", () => {
    expect(buildEventJsonSchemas({})).toEqual({ events: {} });
  });

  it("converts a single schema into its JSON Schema shape, keyed by event name", () => {
    const result = buildEventJsonSchemas({
      signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
    });

    expect(Object.keys(result.events)).toEqual(["signup_completed"]);
    const jsonSchema = result.events.signup_completed as { type?: string; properties?: unknown };
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toBeDefined();
  });

  it("converts multiple schemas, including one with nested object properties", () => {
    const result = buildEventJsonSchemas({
      page_viewed: z.object({ path: z.string() }),
      purchase_completed: z.object({
        orderId: z.string(),
        address: z.object({ city: z.string(), zip: z.string() }),
      }),
    });

    expect(Object.keys(result.events).sort()).toEqual(["page_viewed", "purchase_completed"]);
    const nested = result.events.purchase_completed as {
      properties?: { address?: { type?: string; properties?: unknown } };
    };
    expect(nested.properties?.address?.type).toBe("object");
    expect(nested.properties?.address?.properties).toBeDefined();
  });

  it("does not throw for a z.undefined() (no-payload event) schema", () => {
    expect(() => buildEventJsonSchemas({ app_opened: z.undefined() })).not.toThrow();
    const result = buildEventJsonSchemas({ app_opened: z.undefined() });
    expect(Object.keys(result.events)).toEqual(["app_opened"]);
  });
});
