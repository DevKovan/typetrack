// Compile-time typing tests for `InferEvents<S>` and the `SchemaMap<Events>`
// constraint (issue 002). Enforced at *compile time* (via `bun run
// typecheck` / `typecheck:tsc`, both of which include this file through
// tsconfig's `include`): a `// @ts-expect-error` comment fails the build if
// the next line does *not* produce a type error, and any type error not
// covered by a `@ts-expect-error` also fails the build. The lone runtime
// `it` below just gives this file a visible presence in `bun test` output;
// it performs no assertions of its own.
import { describe, it } from "bun:test";
import { z } from "zod";
import type { InferEvents, SchemaMap } from "./schema";

// Minimal structural type-equality check (the common `Expect<Equal<A, B>>`
// pattern), distributing over unions so it can't be fooled by `any`.
type Equal<A, B> = (<T>() => T extends A ? 1 : 0) extends <T>() => T extends B ? 1 : 0
  ? true
  : false;
type Expect<T extends true> = T;

const eventSchemas = {
  signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
  page_viewed: z.undefined(),
} satisfies Record<string, z.ZodType>;

type Derived = InferEvents<typeof eventSchemas>;

// The type a caller would otherwise have to hand-write (issue 001 style).
type HandWritten = {
  signup_completed: { plan: "free" | "pro" };
  page_viewed: undefined;
};

// `InferEvents<typeof eventSchemas>` is type-identical to the hand-written
// `Events` map -- the payload shape lives in exactly one place (the schema).
type _AssertInferEventsMatchesHandWritten = Expect<Equal<Derived, HandWritten>>;

function typeLevelAssertions() {
  // Valid: a schema map whose per-event output matches `Events` satisfies
  // `SchemaMap<Events>`.
  const validSchemas: SchemaMap<HandWritten> = eventSchemas;
  void validSchemas;

  const mismatchedSchemas: SchemaMap<HandWritten> = {
    signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
    // @ts-expect-error `page_viewed`'s schema output (`{ ok: boolean }`) does not match `Events["page_viewed"]` (`undefined`)
    page_viewed: z.object({ ok: z.boolean() }),
  };
  void mismatchedSchemas;

  // Valid: `SchemaMap` is partial -- supplying a schema for only some events
  // is allowed.
  const partialSchemas: SchemaMap<HandWritten> = {
    signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
  };
  void partialSchemas;
}
void typeLevelAssertions;

describe("InferEvents<S> / SchemaMap<Events> typing", () => {
  it("is enforced at compile time (see assertions above)", () => {
    // No runtime behavior to assert; this file's value is purely in
    // whether it typechecks. See `typeLevelAssertions` above.
  });
});
