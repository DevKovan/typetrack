// Unit + integration tests for `typetrackAstro()`'s `astro:config:setup`
// hook. The hook is called directly against a minimal, hand-written stub
// standing in for Astro's real `HookParameters<"astro:config:setup">`
// object (a spied `injectScript`, plus whatever other fields the type
// mandates, stubbed minimally) -- NOT through a real `astro build`/`astro
// dev` invocation (this repo's toolchain deliberately does not run a real
// Astro build in CI -- see this issue's plan doc's "Explicitly not
// covered by automated tests" section). Mirrors `@typetrack/nuxt`'s
// `module.test.ts` header comment's identical reasoning for its own
// stubbed `@nuxt/kit` functions.
import { describe, expect, it, mock } from "bun:test";
import type { HookParameters } from "astro";
import typetrackAstro, { type TypetrackAstroOptions } from "./index";
import { buildPageLoadScript } from "./buildPageLoadScript";

type ConfigSetupParams = HookParameters<"astro:config:setup">;

// A minimal stand-in for Astro's real `astro:config:setup` hook
// parameters -- only `injectScript` is exercised by this package's own
// hook handler, so every other field is a harmless, unused stub (cast
// through `unknown`, mirroring `@typetrack/nuxt`'s own `as unknown as
// Nuxt` stub-typing technique for the identical "no real framework
// instance in a bun test process" reason).
function createStubParams(): { params: ConfigSetupParams; injectScript: ReturnType<typeof mock> } {
  const injectScript = mock((_stage: string, _content: string) => undefined);

  const params = {
    config: {},
    command: "dev",
    isRestart: false,
    updateConfig: () => ({}),
    addRenderer: () => undefined,
    addWatchFile: () => undefined,
    injectScript,
    injectRoute: () => undefined,
    addClientDirective: () => undefined,
    addDevToolbarApp: () => undefined,
    addMiddleware: () => undefined,
    createCodegenDir: () => new URL("file:///virtual/.astro/"),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  } as unknown as ConfigSetupParams;

  return { params, injectScript };
}

describe("typetrackAstro (unit)", () => {
  it("throws a descriptive error identifying the missing option when analyticsModule is omitted", () => {
    expect(() => typetrackAstro({} as TypetrackAstroOptions)).toThrow(/analyticsModule/);
  });

  it("throws when analyticsModule is an empty string", () => {
    expect(() => typetrackAstro({ analyticsModule: "" })).toThrow(/analyticsModule/);
  });

  it("returns an AstroIntegration-shaped object named @typetrack/astro when analyticsModule is valid", () => {
    const integration = typetrackAstro({ analyticsModule: "/src/lib/analytics.ts" });

    expect(integration.name).toBe("@typetrack/astro");
    expect(typeof integration.hooks["astro:config:setup"]).toBe("function");
  });
});

describe("typetrackAstro astro:config:setup hook (integration, spied injectScript standing in for a real Astro build)", () => {
  it("calls injectScript with stage 'page' and buildPageLoadScript's own output for the same analyticsModule, by default", () => {
    const { params, injectScript } = createStubParams();
    const integration = typetrackAstro({ analyticsModule: "/src/lib/analytics.ts" });

    integration.hooks["astro:config:setup"]?.(params);

    expect(injectScript).toHaveBeenCalledTimes(1);
    expect(injectScript).toHaveBeenCalledWith("page", buildPageLoadScript("/src/lib/analytics.ts"));
  });

  it("calls injectScript when autoPageViews is explicitly true", () => {
    const { params, injectScript } = createStubParams();
    const integration = typetrackAstro({ analyticsModule: "/src/lib/analytics.ts", autoPageViews: true });

    integration.hooks["astro:config:setup"]?.(params);

    expect(injectScript).toHaveBeenCalledTimes(1);
  });

  it("does not call injectScript when autoPageViews is false", () => {
    const { params, injectScript } = createStubParams();
    const integration = typetrackAstro({ analyticsModule: "/src/lib/analytics.ts", autoPageViews: false });

    integration.hooks["astro:config:setup"]?.(params);

    expect(injectScript).not.toHaveBeenCalled();
  });
});
