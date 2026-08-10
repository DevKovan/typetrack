import { z } from "zod";

export interface EventJsonSchemas {
  events: Record<string, unknown>;
}

// Pure: converts a loaded schema map into the same { events: { [name]:
// JSONSchema } } shape `GET /schema` has always returned. `undefined`
// (no config loaded) yields `{ events: {} }`, matching the dev server's
// existing schema-less passthrough behavior. `unrepresentable: "any"` is
// passed to `z.toJSONSchema()` so a no-payload event's `z.undefined()`
// schema (see `src/schema.ts`'s documented `page_viewed: z.undefined()`
// convention) never throws -- it has no effect on any otherwise-
// representable schema's output shape.
export function buildEventJsonSchemas(schemas: Record<string, z.ZodType> | undefined): EventJsonSchemas {
  const events: Record<string, unknown> = {};
  if (schemas) {
    for (const [name, schema] of Object.entries(schemas)) {
      events[name] = z.toJSONSchema(schema, { unrepresentable: "any" });
    }
  }
  return { events };
}
