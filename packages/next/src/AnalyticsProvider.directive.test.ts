// Plain-text (not type-level) assertion that `AnalyticsProvider.tsx`'s
// `"use client"` directive is still the file's literal first line, before
// any import statement. Next.js's compiler keys off of this exact string in
// this exact position to decide a module is a Client Component boundary --
// TypeScript has no concept of this directive at all, so an accidental
// reorder (e.g. an import hoisted above it by an editor/formatter) would
// silently break real Next.js builds with zero type error. No DOM/happy-dom
// setup is needed here: this only ever reads the file's raw source text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const SOURCE_PATH = join(import.meta.dir, "AnalyticsProvider.tsx");

describe("AnalyticsProvider.tsx `\"use client\"` boundary directive (unit)", () => {
  it("has `\"use client\";` as its exact, literal first line", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    const firstLine = source.split("\n")[0];

    expect(firstLine).toBe('"use client";');
  });

  it("places the directive before any import statement", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    const directiveIndex = source.indexOf('"use client";');
    const firstImportIndex = source.indexOf("import ");

    expect(directiveIndex).toBe(0);
    // `firstImportIndex` being `-1` (no import statements at all, e.g. a
    // pure `export { ... } from "..."` re-export) is also acceptable --
    // there is simply nothing that could come before the directive.
    expect(firstImportIndex === -1 || directiveIndex < firstImportIndex).toBe(true);
  });
});
