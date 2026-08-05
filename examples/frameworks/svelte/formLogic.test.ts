import { describe, expect, test } from "bun:test";
import { buildIdentifyTraits, buildUserSignedUpProperties, isValidSignUpEmail } from "./formLogic";

// Unit tests for this example's pure, non-trivial logic -- no I/O, no
// Svelte, no `typetrack`/`@typetrack/svelte` involved at all, unlike this
// example's integration tests. Mirrors
// `examples/frameworks/vue/formLogic.test.ts`'s own convention.

describe("buildIdentifyTraits", () => {
  test("returns plan + a fixed 'signup_form' source", () => {
    expect(buildIdentifyTraits({ email: "ada@example.com", plan: "free" })).toEqual({
      plan: "free",
      source: "signup_form",
    });
  });

  test("passes a 'pro' plan through unchanged", () => {
    expect(buildIdentifyTraits({ email: "grace@example.com", plan: "pro" })).toEqual({
      plan: "pro",
      source: "signup_form",
    });
  });
});

describe("buildUserSignedUpProperties", () => {
  test("returns exactly {plan}, dropping email/source", () => {
    expect(buildUserSignedUpProperties({ email: "ada@example.com", plan: "free" })).toEqual({ plan: "free" });
  });
});

describe("isValidSignUpEmail", () => {
  test("accepts a realistic email address", () => {
    expect(isValidSignUpEmail("ada@example.com")).toBe(true);
  });

  test("rejects an empty string", () => {
    expect(isValidSignUpEmail("")).toBe(false);
  });

  test("rejects a string with no '@'", () => {
    expect(isValidSignUpEmail("ada.example.com")).toBe(false);
  });

  test("rejects a string starting with '@'", () => {
    expect(isValidSignUpEmail("@example.com")).toBe(false);
  });

  test("rejects a string ending with '@'", () => {
    expect(isValidSignUpEmail("ada@")).toBe(false);
  });

  test("rejects whitespace-only input", () => {
    expect(isValidSignUpEmail("   ")).toBe(false);
  });
});
