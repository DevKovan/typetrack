// Unit tests (fast, no build/install required) for the monorepo's
// workspace-linking + build-orchestration invariants introduced in
// `plan/phase-4-build/002-workspace-linking-and-build-orchestration.md`.
//
// Regression guard rationale: `packages/react` and `packages/next` are both
// `"private": false` (intended to be published) -- a published tarball
// depending on `"file:../react"`/`"file:../.."` is broken on any other
// machine (a relative filesystem path meaningless outside this repo
// checkout). Every cross-package dependency on a *true* sibling workspace
// member (i.e. another package matched by root `package.json`'s
// `"workspaces": ["packages/*"]` glob) must use the `workspace:*` protocol
// instead, which gets rewritten to the real resolved semver version at
// publish time.
//
// One documented, empirically-verified exception: the monorepo *root*
// package (`typetrack`) is not itself matched by the `"packages/*"` glob,
// and Bun (verified against 1.3.14, the latest version as of this writing)
// cannot resolve `"workspace:*"` for a dependency on the workspace root --
// `bun install` fails outright with "Workspace dependency ... not found"
// regardless of how the root is named or whether it's redundantly added to
// the `"workspaces"` array. So `packages/react`, `packages/next`, and the
// `packages/provider-*` packages' dependency on root `typetrack` itself
// stays on `file:../..` -- see the comment on `KNOWN_FILE_PROTOCOL_ROOT_DEP`
// below and the "Cross-package deps" bullet in `CLAUDE.md`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

type PackageJson = {
  name: string;
  dependencies?: Record<string, string>;
};

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

const rootPackageJsonPath = join(REPO_ROOT, "package.json");
const rootPackageJson = readPackageJson(rootPackageJsonPath);

const packageDirNames = readdirSync(PACKAGES_DIR).filter((entry) =>
  statSync(join(PACKAGES_DIR, entry)).isDirectory(),
);

const allPackageJsons: { path: string; pkg: PackageJson }[] = [
  { path: rootPackageJsonPath, pkg: rootPackageJson },
  ...packageDirNames.map((dirName) => {
    const path = join(PACKAGES_DIR, dirName, "package.json");
    return { path, pkg: readPackageJson(path) };
  }),
];

// The set of package *names* that are true `packages/*` workspace members
// (glob-matched, so `workspace:*`-resolvable) -- as opposed to the
// monorepo root, which is not.
const siblingWorkspacePackageNames = new Set(allPackageJsons.filter(({ path }) => path !== rootPackageJsonPath).map(({ pkg }) => pkg.name));

// The one documented exception (see file-header comment): the root package
// can only ever be referenced via `file:`, never `workspace:*`, given
// current Bun behavior.
const KNOWN_FILE_PROTOCOL_ROOT_DEP = rootPackageJson.name;

describe("workspace cross-package dependency protocol (regression guard)", () => {
  it("no dependency on a true sibling packages/* workspace member uses the file: protocol", () => {
    const violations: string[] = [];

    for (const { path, pkg } of allPackageJsons) {
      for (const [depName, depValue] of Object.entries(pkg.dependencies ?? {})) {
        const isFileProtocol = depValue.startsWith("file:");
        const isTrueSibling = siblingWorkspacePackageNames.has(depName);

        if (isFileProtocol && isTrueSibling) {
          violations.push(`${path}: "${depName}": "${depValue}" -- must use "workspace:*"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("every file: dependency remaining anywhere is exactly the documented root-package exception", () => {
    const unexpectedFileDeps: string[] = [];

    for (const { path, pkg } of allPackageJsons) {
      for (const [depName, depValue] of Object.entries(pkg.dependencies ?? {})) {
        if (!depValue.startsWith("file:")) continue;
        if (depName === KNOWN_FILE_PROTOCOL_ROOT_DEP) continue;
        unexpectedFileDeps.push(`${path}: "${depName}": "${depValue}"`);
      }
    }

    expect(unexpectedFileDeps).toEqual([]);
  });

  it("@typetrack/react (a true sibling of packages/next, matched by the packages/* glob) uses workspace:*, not file:", () => {
    const nextPackageJson = allPackageJsons.find(({ pkg }) => pkg.name === "@typetrack/next")?.pkg;
    expect(nextPackageJson?.dependencies?.["@typetrack/react"]).toBe("workspace:*");
  });
});

describe("root package.json build:all script", () => {
  it("exists and is a non-empty string", () => {
    const scripts = (rootPackageJson as unknown as { scripts?: Record<string, string> }).scripts;
    expect(typeof scripts?.["build:all"]).toBe("string");
    expect(scripts?.["build:all"]?.length).toBeGreaterThan(0);
  });

  it("builds in the required dependency order: root, then packages/react, then packages/next", () => {
    const scripts = (rootPackageJson as unknown as { scripts?: Record<string, string> }).scripts;
    const buildAll = scripts?.["build:all"] ?? "";

    const reactIndex = buildAll.indexOf("packages/react");
    const nextIndex = buildAll.indexOf("next");

    expect(reactIndex).toBeGreaterThan(-1);
    expect(nextIndex).toBeGreaterThan(-1);
    expect(reactIndex).toBeLessThan(nextIndex);
  });
});
