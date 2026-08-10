import { describe, expect, it } from "bun:test";
import { renderInspectorPage } from "./inspectorPage";

// Extracts the inline <script> block's contents so assertions about "must
// be referenced in the script" are checked against the actual script body,
// not just anywhere in the returned HTML string.
function extractScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match || match[1] === undefined) {
    throw new Error("renderInspectorPage() output has no inline <script> block");
  }
  return match[1];
}

describe("renderInspectorPage", () => {
  it("returns a string starting with <!doctype html>", () => {
    const html = renderInspectorPage();
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("contains no external http:// or https:// references", () => {
    const html = renderInspectorPage();
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("references /events, /events/stream, and /schema in the inline script", () => {
    const script = extractScript(renderInspectorPage());
    expect(script).toContain("/events");
    expect(script).toContain("/events/stream");
    expect(script).toContain("/schema");
  });

  it("is a pure function returning identical output on repeated calls", () => {
    expect(renderInspectorPage()).toBe(renderInspectorPage());
  });
});
