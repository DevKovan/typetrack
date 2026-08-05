// Unit tests for `setupTypetrackModule()` -- called directly, NOT through a
// real Nuxt build/`nuxi` invocation (this repo's toolchain deliberately
// does not add `nuxi` as a devDependency -- see this issue's plan doc's
// "Honest, documented testing limitation" section). Exercises the module's
// setup logic against a minimal hand-written `nuxt`/`@nuxt/kit`-function
// stand-in (a real `Nuxt` instance is never constructed), per this issue's
// own Test requirements. See `module.ts`'s header comment for the full
// "why this is dependency-injected, not `mock.module()`-d" reasoning.
import { describe, expect, it, mock } from "bun:test";
import type { Nuxt } from "@nuxt/schema";
import { ANALYTICS_MODULE_ALIAS, setupTypetrackModule, type ModuleKit, type ModuleOptions } from "./module";

function createMockNuxt(): Nuxt {
  return { options: { alias: {} as Record<string, string> } } as unknown as Nuxt;
}

interface MockKit extends ModuleKit {
  addPlugin: ReturnType<typeof mock>;
  addTemplate: ReturnType<typeof mock>;
  addImports: ReturnType<typeof mock>;
}

function createMockKit(): MockKit {
  const addTemplate = mock((template: { filename: string; getContents?: () => string }) => ({
    filename: template.filename,
    dst: `/virtual/.nuxt/${template.filename}`,
  }));
  const addPlugin = mock((plugin: unknown) => plugin);
  const addImports = mock((imports: unknown) => imports);

  return { addPlugin, addTemplate, addImports } as unknown as MockKit;
}

describe("setupTypetrackModule (unit, spied @nuxt/kit functions, no real Nuxt build)", () => {
  it("throws a descriptive error identifying the missing option when analyticsModule is omitted", () => {
    const nuxt = createMockNuxt();
    const kit = createMockKit();

    expect(() => setupTypetrackModule({} as ModuleOptions, nuxt, kit)).toThrow(/analyticsModule/);
  });

  it("throws when analyticsModule is an empty string", () => {
    const nuxt = createMockNuxt();
    const kit = createMockKit();

    expect(() => setupTypetrackModule({ analyticsModule: "" }, nuxt, kit)).toThrow(/analyticsModule/);
  });

  it("does not call any @nuxt/kit function before the analyticsModule validation throws", () => {
    const nuxt = createMockNuxt();
    const kit = createMockKit();

    expect(() => setupTypetrackModule({ analyticsModule: "" }, nuxt, kit)).toThrow();

    expect(kit.addTemplate).not.toHaveBeenCalled();
    expect(kit.addPlugin).not.toHaveBeenCalled();
    expect(kit.addImports).not.toHaveBeenCalled();
  });

  it("registers the analytics-module template, wires its dst into nuxt.options.alias, registers both runtime plugins, and registers useAnalytics as an auto-import", () => {
    const nuxt = createMockNuxt();
    const kit = createMockKit();

    setupTypetrackModule({ analyticsModule: "~/app/analytics" }, nuxt, kit);

    expect(kit.addTemplate).toHaveBeenCalledTimes(1);
    const templateArg = kit.addTemplate.mock.calls[0]![0] as {
      filename: string;
      getContents: () => string;
    };
    expect(templateArg.filename).toBe("typetrack-analytics-module.mjs");
    expect(templateArg.getContents()).toContain('"~/app/analytics"');

    expect(nuxt.options.alias[ANALYTICS_MODULE_ALIAS]).toBe(
      "/virtual/.nuxt/typetrack-analytics-module.mjs",
    );

    expect(kit.addPlugin).toHaveBeenCalledTimes(2);
    const pluginPaths = kit.addPlugin.mock.calls.map((call) => call[0]);
    expect(pluginPaths.some((p) => typeof p === "string" && p.includes("runtime/plugin"))).toBe(true);
    expect(pluginPaths.some((p) => typeof p === "string" && p.includes("runtime/pageview.client"))).toBe(
      true,
    );

    expect(kit.addImports).toHaveBeenCalledTimes(1);
    expect(kit.addImports).toHaveBeenCalledWith({ name: "useAnalytics", from: "@typetrack/vue" });
  });

  it("registers only the provide-registration plugin (not the pageview-tracking plugin) when autoPageViews is false", () => {
    const nuxt = createMockNuxt();
    const kit = createMockKit();

    setupTypetrackModule({ analyticsModule: "~/app/analytics", autoPageViews: false }, nuxt, kit);

    expect(kit.addPlugin).toHaveBeenCalledTimes(1);
    const pluginPaths = kit.addPlugin.mock.calls.map((call) => call[0]);
    expect(pluginPaths.some((p) => typeof p === "string" && p.includes("runtime/plugin"))).toBe(true);
    expect(pluginPaths.some((p) => typeof p === "string" && p.includes("runtime/pageview.client"))).toBe(
      false,
    );
  });

  it("registers both plugins when autoPageViews is explicitly true", () => {
    const nuxt = createMockNuxt();
    const kit = createMockKit();

    setupTypetrackModule({ analyticsModule: "~/app/analytics", autoPageViews: true }, nuxt, kit);

    expect(kit.addPlugin).toHaveBeenCalledTimes(2);
  });

  it("throws @nuxt/kit's own ambient-context error when called with the real (non-mock) kit default outside a real Nuxt build", () => {
    // Confirms `kit: ModuleKit = defaultKit`'s default parameter really is
    // wired to the real, imported `@nuxt/kit` functions (not silently
    // falling back to a no-op) -- calling `setupTypetrackModule` with no
    // third argument reaches real `addTemplate()`, which throws
    // `@nuxt/kit`'s own `NUXT_B8001` ("active Nuxt instance is unavailable")
    // error here, since this test process never runs a real Nuxt
    // build/dev-server. This is expected, not a bug in this package -- see
    // module.ts's header comment.
    const nuxt = createMockNuxt();

    expect(() => setupTypetrackModule({ analyticsModule: "~/app/analytics" }, nuxt)).toThrow();
  });
});
