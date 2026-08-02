// Compile-time typing tests for `TrackArgs<V>`'s trailing `TrackOptions`
// argument (issue 001). Enforced at *compile time* (via `bun run typecheck`
// / `typecheck:tsc`, both of which include this file through tsconfig's
// `include`): a `// @ts-expect-error` comment fails the build if the next
// line does *not* produce a type error, and any type error not covered by
// a `@ts-expect-error` also fails the build. The lone runtime `it` below
// just gives this file a visible presence in `bun test` output; it performs
// no assertions of its own.
import { describe, it } from "bun:test";
import type { TrackArgs, TrackOptions } from "./schema";

function typeLevelAssertions() {
  const options: TrackOptions = { context: { locale: "en-US" } };

  // `TrackArgs<{ plan: "pro" }>` (a payload-bearing event):
  const withPayloadAndOptions: TrackArgs<{ plan: "pro" }> = [{ plan: "pro" }, options];
  void withPayloadAndOptions;

  const withPayloadOnly: TrackArgs<{ plan: "pro" }> = [{ plan: "pro" }];
  void withPayloadOnly;

  // @ts-expect-error a third, unexpected argument is not allowed
  const withExtraArg: TrackArgs<{ plan: "pro" }> = [{ plan: "pro" }, options, "extra"];
  void withExtraArg;

  // `TrackArgs<undefined>` (a no-payload event):
  const noArgs: TrackArgs<undefined> = [];
  void noArgs;

  const undefinedPayload: TrackArgs<undefined> = [undefined];
  void undefinedPayload;

  const undefinedPayloadWithOptions: TrackArgs<undefined> = [undefined, options];
  void undefinedPayloadWithOptions;
}
void typeLevelAssertions;

describe("TrackArgs<V> trailing TrackOptions typing", () => {
  it("is enforced at compile time (see @ts-expect-error assertions above)", () => {
    // No runtime behavior to assert; this file's value is purely in
    // whether it typechecks. See `typeLevelAssertions` above.
  });
});
