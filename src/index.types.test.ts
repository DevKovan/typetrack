// Compile-time typing tests for `track()`'s generic `Events` map.
//
// These assertions are enforced at *compile time* (via `bun run typecheck` /
// `typecheck:tsc`, both of which include this file through tsconfig's
// `include`): a `// @ts-expect-error` comment fails the build if the next
// line does *not* produce a type error, and any type error not covered by
// a `@ts-expect-error` also fails the build. The lone runtime `it` below
// just gives this file a visible presence in `bun test` output; it performs
// no assertions of its own.
import { describe, it } from "bun:test";
import { createAnalytics } from "./index";

type SampleEvents = {
  signup_completed: { plan: "free" | "pro" };
  page_viewed: undefined;
};

function typeLevelAssertions() {
  const analytics = createAnalytics<SampleEvents>();

  // Valid: correctly-shaped payload for a payload-bearing event.
  analytics.track("signup_completed", { plan: "pro" });

  // Valid: no second argument for a no-payload event.
  analytics.track("page_viewed");

  // @ts-expect-error unknown event name
  analytics.track("nope", {});

  // @ts-expect-error wrong-shaped payload for a known event
  analytics.track("signup_completed", { plan: "enterprise" });

  // @ts-expect-error missing required payload
  analytics.track("signup_completed");
}
void typeLevelAssertions;

describe("track() typing", () => {
  it("is enforced at compile time (see @ts-expect-error assertions above)", () => {
    // No runtime behavior to assert; this file's value is purely in
    // whether it typechecks. See `typeLevelAssertions` above.
  });
});
