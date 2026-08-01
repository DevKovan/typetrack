// Isolated shape check for the IIFE/global build's evaluated output. Builds
// just the third `tsup.config.ts` entry (the IIFE build of `src/index.ts`)
// in a scratch `outDir` via tsup's programmatic `build()` API -- "no full
// build required" per this issue's test requirements, i.e. this test never
// invokes the repo's full 3-entry `tsup.config.ts` (that's the integration
// test's job; see `index.global.integration.test.ts`). `config: false` stops
// tsup from picking up the repo's `tsup.config.ts` and building the other
// two entries alongside this one.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { build } from "tsup";

let source: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "typetrack-iife-unit-"));

  await build({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "Typetrack",
    minify: true,
    dts: false,
    clean: true,
    splitting: false,
    platform: "browser",
    sourcemap: true,
    outDir,
    config: false,
    silent: true,
  });

  source = readFileSync(join(outDir, "index.global.js"), "utf8");
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

// Extracts the `Typetrack` global's value via the `Function` constructor
// rather than `eval` (direct or indirect): the build output starts with a
// `"use strict"` directive, and per spec strict-mode `eval` code gets its
// own fresh variable environment rather than writing into the caller's
// scope -- `var Typetrack = ...` inside strict-mode eval'd code would never
// become observable to the caller at all. A `Function` constructor body has
// no such restriction: `var Typetrack` declared by the built source is an
// ordinary local variable of the constructed function, retrievable via the
// trailing `return Typetrack;` appended (on its own line, after a newline --
// the build output's last line is a `//# sourceMappingURL=...` comment with
// no trailing newline, so appending on the same line would silently comment
// out the `return`). This never touches the real process's global scope.
function extractTypetrackGlobal(): unknown {
  return new Function(`${source}\nreturn Typetrack;`)();
}

describe("dist/index.global.js (IIFE build) shape", () => {
  it("defines a Typetrack global with a createAnalytics function", () => {
    const Typetrack = extractTypetrackGlobal() as { createAnalytics?: unknown };

    expect(typeof Typetrack.createAnalytics).toBe("function");
  });

  it("createAnalytics() with no args returns an object with track/identify/page/flush, all callable", () => {
    const Typetrack = extractTypetrackGlobal() as {
      createAnalytics: () => Record<string, unknown>;
    };

    const analytics = Typetrack.createAnalytics();

    expect(typeof analytics.track).toBe("function");
    expect(typeof analytics.identify).toBe("function");
    expect(typeof analytics.page).toBe("function");
    expect(typeof analytics.flush).toBe("function");
  });

  it("calling .track(...) against the default noop-provider instance does not throw", () => {
    const Typetrack = extractTypetrackGlobal() as {
      createAnalytics: () => { track: (event: string, payload?: Record<string, unknown>) => unknown };
    };

    const analytics = Typetrack.createAnalytics();

    expect(() => analytics.track("some_event", { foo: "bar" })).not.toThrow();
  });
});
