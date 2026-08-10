import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Publishes every publishable typetrack package to npm, in dependency
 * order. `npm` (not `bun publish`) does the actual registry write --
 * `bun publish` has no `--provenance` flag (oven-sh/bun#15601), and npm
 * understands neither the `workspace:*` nor `file:` protocols used by
 * this repo's local-dev dependency wiring, so both are rewritten to real
 * `^x.y.z` semver ranges here (read from each package's own on-disk
 * `package.json`, never from `bun.lock`, which can silently cache a
 * stale workspace version) immediately before each `npm publish` call,
 * then restored immediately after.
 */

const ROOT = join(import.meta.dir, "..");

const PUBLISH_ORDER = [
  "",
  "packages/react",
  "packages/vue",
  "packages/svelte",
  "packages/solid",
  "packages/astro",
  "packages/next",
  "packages/remix",
  "packages/nuxt",
] as const;

interface PackageInfo {
  relDir: string;
  name: string;
  version: string;
}

function readPackageInfo(relDir: string): PackageInfo {
  const raw = readFileSync(join(ROOT, relDir, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { name: string; version: string };
  return { relDir, name: parsed.name, version: parsed.version };
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteDependencies(
  raw: string,
  versionByName: ReadonlyMap<string, string>,
): string {
  let rewritten = raw;
  for (const [name, version] of versionByName) {
    const escapedName = escapeForRegex(name);
    const replacement = `"${name}": "^${version}"`;
    rewritten = rewritten.replace(
      new RegExp(`"${escapedName}"\\s*:\\s*"file:[^"]*"`, "g"),
      replacement,
    );
    rewritten = rewritten.replace(
      new RegExp(`"${escapedName}"\\s*:\\s*"workspace:\\*"`, "g"),
      replacement,
    );
  }
  return rewritten;
}

async function publishPackage(
  pkg: PackageInfo,
  versionByName: ReadonlyMap<string, string>,
  dryRun: boolean,
): Promise<boolean> {
  const cwd = join(ROOT, pkg.relDir);
  const pkgJsonPath = join(cwd, "package.json");
  const original = readFileSync(pkgJsonPath, "utf8");
  const rewritten = rewriteDependencies(original, versionByName);

  try {
    if (rewritten !== original) {
      writeFileSync(pkgJsonPath, rewritten);
    }

    const args = ["publish", "--access", "public", "--provenance"];
    if (dryRun) args.push("--dry-run");

    const proc = Bun.spawn(["npm", ...args], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } finally {
    if (rewritten !== original) {
      writeFileSync(pkgJsonPath, original);
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const packages = PUBLISH_ORDER.map(readPackageInfo);
  const versionByName = new Map(packages.map((p) => [p.name, p.version]));

  const results: { name: string; ok: boolean }[] = [];

  for (const pkg of packages) {
    console.log(
      `\n=== ${pkg.name}@${pkg.version}${dryRun ? " (dry run)" : ""} ===`,
    );
    const ok = await publishPackage(pkg, versionByName, dryRun);
    console.log(ok ? `${pkg.name}: OK` : `${pkg.name}: FAILED`);
    results.push({ name: pkg.name, ok });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} packages ${dryRun ? "dry-run " : ""}published successfully.`,
  );
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }
}

await main();
