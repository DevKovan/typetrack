// End-to-end check of the real, on-disk IIFE/global build artifact: runs the
// actual root `tsup` build (the real 3-entry `tsup.config.ts`, exactly what
// `bun run build` runs, not a hand-written stand-in or an isolated
// single-entry config), then loads the real `dist/index.global.js` it
// produces into a genuine global (browser-like) environment and exercises it
// as a `<script src="https://unpkg.com/typetrack">` consumer would.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { beforeAll, describe, expect, it } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..");
const DIST_GLOBAL = join(REPO_ROOT, "dist", "index.global.js");
const DIST_ESM = join(REPO_ROOT, "dist", "index.js");

let globalSource: string;

beforeAll(async () => {
  const build = Bun.spawn({
    cmd: ["bun", "run", "build"],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(build.stderr).text();
    throw new Error(`root \`bun run build\` failed with exit code ${exitCode}:\n${stderr}`);
  }

  globalSource = readFileSync(DIST_GLOBAL, "utf8");
}, 30_000);

describe("root `bun run build` IIFE/global output, real build artifact", () => {
  it("produces dist/index.global.js alongside the untouched ESM/CJS/d.ts/CLI outputs", () => {
    expect(existsSync(DIST_GLOBAL)).toBe(true);
    expect(existsSync(join(REPO_ROOT, "dist", "index.js"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "dist", "index.cjs"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "dist", "index.d.ts"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "dist", "cli.js"))).toBe(true);
  });

  it("is meaningfully minified: no newlines beyond a trailing sourcemap comment, well under the unminified ESM build's size", () => {
    // The build's last line is a `//# sourceMappingURL=...` comment -- one
    // newline separating it from the single minified code line is expected;
    // anything more means `minify: true` silently stopped taking effect.
    const newlineCount = (globalSource.match(/\n/g) ?? []).length;
    expect(newlineCount).toBeLessThanOrEqual(1);

    const globalSize = statSync(DIST_GLOBAL).size;
    const esmSize = statSync(DIST_ESM).size;
    expect(globalSize).toBeLessThan(esmSize);
  });

  it("never bundles chokidar (CLI/dev-server-only) into the browser global", () => {
    expect(globalSource).not.toContain("chokidar");
    // `readdirp` is chokidar's own directory-walking dependency -- a cheap
    // extra guard that nothing chokidar pulls in transitively leaked in
    // either, not just the literal string "chokidar" (e.g. via a package
    // comment or path).
    expect(globalSource).not.toContain("readdirp");
  });

  it("evaluated in a genuine global (browser-like) environment, defines a working Typetrack global", async () => {
    GlobalRegistrator.register({
      settings: {
        enableJavaScriptEvaluation: true,
        suppressInsecureJavaScriptEnvironmentWarning: true,
      },
    });

    try {
      // happy-dom compiles every `<script>` body into its own wrapper
      // function (see its `JavaScriptCompiler`) rather than executing it as
      // real global "Script" code -- so a bare `var Typetrack = ...`, though
      // it genuinely executes, lands on that wrapper function's local scope,
      // not on `globalThis`. Appending one line, in the *same* script (so it
      // shares that scope and can still see the `Typetrack` local), that
      // explicitly assigns `window.Typetrack` bridges it onto the real
      // global -- `window === globalThis` here since
      // `GlobalRegistrator.register()` aliases the two. This is a
      // happy-dom-specific accommodation, not a rewrite of the build
      // artifact under test: everything through the appended line is the
      // real, unmodified `dist/index.global.js` content.
      //
      // Accessed off `globalThis` via a minimal ad-hoc type (rather than a
      // bare `document`/`window` reference) because this package's root
      // `tsconfig.json` deliberately has no `"dom"` in `lib` -- core ships
      // with zero DOM/browser-API surface, and this is the one test file in
      // the whole package that needs a document, purely as a happy-dom test
      // harness detail, not something the package itself depends on.
      type MinimalDomGlobal = {
        document: {
          createElement(tagName: string): { textContent: string };
          body: { appendChild(node: unknown): void };
        };
      };
      const { document: happyDomDocument } = globalThis as unknown as MinimalDomGlobal;
      const script = happyDomDocument.createElement("script");
      script.textContent = `${globalSource}\nwindow.Typetrack = Typetrack;\n`;
      happyDomDocument.body.appendChild(script);

      const Typetrack = (globalThis as unknown as { Typetrack?: { createAnalytics?: unknown } }).Typetrack;
      expect(Typetrack).toBeDefined();
      expect(typeof Typetrack?.createAnalytics).toBe("function");

      const createAnalytics = Typetrack?.createAnalytics as () => {
        track: (event: string, payload?: Record<string, unknown>) => unknown;
        identify: (...args: unknown[]) => unknown;
        page: (...args: unknown[]) => unknown;
        flush: (...args: unknown[]) => unknown;
      };
      const analytics = createAnalytics();

      expect(typeof analytics.track).toBe("function");
      expect(typeof analytics.identify).toBe("function");
      expect(typeof analytics.page).toBe("function");
      expect(typeof analytics.flush).toBe("function");
      expect(() => analytics.track("some_event", { foo: "bar" })).not.toThrow();
    } finally {
      await GlobalRegistrator.unregister();
    }
  });

  it("package.json's unpkg/jsdelivr fields point at the real build output", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

    expect(pkg.unpkg).toBe("./dist/index.global.js");
    expect(pkg.jsdelivr).toBe("./dist/index.global.js");
    expect(existsSync(join(REPO_ROOT, pkg.unpkg))).toBe(true);
  });

  it("existing core tests' resolution path is unaffected: `typetrack`'s own self-reference (exercising exports[\".\"].import, distinct from the new `default` condition) still resolves to a working createAnalytics", async () => {
    const { createAnalytics } = (await import("typetrack")) as typeof import("./index");

    const analytics = createAnalytics();
    expect(() => analytics.track("some_event", { foo: "bar" })).not.toThrow();
  });
});
