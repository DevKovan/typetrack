import { describe, expect, it } from "bun:test";
import type { z } from "zod";
import { formatSuccessLine, formatValidationDiff } from "./format";

function issue(partial: Partial<z.ZodIssue>): z.ZodIssue {
  return {
    code: "custom",
    path: [],
    message: "message",
    ...partial,
  } as z.ZodIssue;
}

describe("formatValidationDiff", () => {
  it("includes the path and message for a missing required field", () => {
    const issues = [issue({ path: ["plan"], message: "Required" })];
    const output = formatValidationDiff("signup_completed", issues);

    expect(output).toContain("plan");
    expect(output).toContain("Required");
  });

  it("includes the path and message for a wrong-primitive-type issue", () => {
    const issues = [issue({ path: ["age"], message: "Expected number, received string" })];
    const output = formatValidationDiff("profile_updated", issues);

    expect(output).toContain("age");
    expect(output).toContain("Expected number, received string");
  });

  it("includes the path and message for an invalid enum value", () => {
    const issues = [issue({ path: ["plan"], message: "Invalid enum value" })];
    const output = formatValidationDiff("signup_completed", issues);

    expect(output).toContain("plan");
    expect(output).toContain("Invalid enum value");
  });

  it("dots into a nested object path", () => {
    const issues = [issue({ path: ["address", "zip"], message: "Required" })];
    const output = formatValidationDiff("order_placed", issues);

    expect(output).toContain("address.zip");
  });

  it("uses (root) for an issue with an empty path", () => {
    const issues = [issue({ path: [], message: "Invalid input" })];
    const output = formatValidationDiff("page_viewed", issues);

    expect(output).toContain("(root)");
  });

  it("produces output for every issue given", () => {
    const issues = [
      issue({ path: ["a"], message: "first message" }),
      issue({ path: ["b"], message: "second message" }),
    ];
    const output = formatValidationDiff("multi_field_event", issues);

    expect(output).toContain("a");
    expect(output).toContain("first message");
    expect(output).toContain("b");
    expect(output).toContain("second message");
  });

  it("is not a raw ZodError-style stringification", () => {
    const issues = [issue({ path: ["plan"], message: "Required" })];
    const output = formatValidationDiff("signup_completed", issues);

    // A raw `String(zodError)`/`error.toString()` dump renders as JSON-ish
    // array-of-objects text (`[\n  {\n    "code":`); this formatter's output
    // must not look like that.
    expect(output).not.toContain('"code"');
    expect(output).not.toContain("[\n");
  });
});

describe("formatSuccessLine", () => {
  it("produces a single line", () => {
    const output = formatSuccessLine("page_viewed");
    expect(output.split("\n")).toHaveLength(1);
  });

  it("is distinct in shape from the failure formatter's output", () => {
    const issues = [issue({ path: ["plan"], message: "Required" })];
    const failureOutput = formatValidationDiff("signup_completed", issues);
    const successOutput = formatSuccessLine("signup_completed");

    expect(successOutput).not.toEqual(failureOutput);
    expect(successOutput.split("\n").length).toBeLessThan(failureOutput.split("\n").length);
  });
});
