# 004 -- Bundle-size checks via `size-limit`

## Context

Independent of every other issue in this phase. Adds `size-limit` and
`@size-limit/file` as root `devDependencies` (per
`plan/phase-16-testing-infrastructure/BRIEF.md`'s research-grounding
section: `@size-limit/file` checks already-built `dist/` files directly,
gzip or brotli, with no bundler dependency -- composes with this repo's
existing `tsup` output instead of re-bundling it). Read `tsup.config.ts`
(root -- three build targets: ESM+CJS+dts at `dist/index.{js,cjs}`, the
CLI at `dist/cli.js`, and the IIFE global build at
`dist/index.global.js`) and each of `packages/{react,next,vue,nuxt,svelte,
solid,astro,remix}/package.json`'s own `"build": "tsup"` script/output
before choosing exactly which artifacts to track.

## Scope of this issue

1. Add `size-limit` and `@size-limit/file` to root `package.json`
   `devDependencies`.
2. Add a new root `.size-limit.json` (sibling to `.oxlintrc.json`/
   `knip.json`, matching this repo's existing config-file convention),
   with one entry per tracked artifact -- at minimum:
   - Core: `dist/index.js` (ESM) and `dist/index.global.js` (IIFE, the
     unpkg/jsdelivr CDN artifact) -- both meaningfully different bundle
     shapes worth tracking separately; `dist/index.cjs` is the same
     source as the ESM build under a different module format and can be
     skipped if the implementor judges it redundant.
   - Each of `packages/{react,next,vue,nuxt,svelte,solid,astro,remix}`'s
     own primary built entry (check each package's `tsup.config.ts`/
     `package.json` `"exports"` for the exact output filename -- do not
     assume they all match `dist/index.js`).
   - `provider-ga4`/`provider-posthog`/`provider-segment` are **not**
     tracked -- they have no `tsup` build/`dist` output at all (source-only
     packages, per issue 001's own context note), so there is nothing for
     `@size-limit/file` to check.
3. **Limits must be set from real, measured numbers, not guessed.** Run
   `bun run build:all` on a clean tree first, measure each tracked
   artifact's actual current gzip size (`size-limit`'s own dry-run output,
   or `gzip -9c <file> | wc -c` as a cross-check), and set each `.size-
   limit.json` entry's `"limit"` at roughly the measured size plus 20-30%
   headroom -- tight enough to catch a real regression (e.g. an
   accidentally-bundled vendor dependency, a lost `sideEffects`/
   tree-shaking property), loose enough that routine, expected growth
   (a new feature's few added lines) doesn't produce false-positive CI
   failures requiring a config bump on every unrelated PR.
4. Add a root `package.json` script: `"size": "size-limit"`. Document (in
   this issue's implementation, a short root-`README.md` note if one
   exists and covers scripts, otherwise a comment in `.size-limit.json`
   itself) that this script requires `bun run build:all` to have already
   run -- `size-limit`/`@size-limit/file` checks already-built files, it
   does not build them itself.

Note: wiring `bun run size` into `.github/workflows/qa.yml` is issue 007's
job (after this issue and issue 006 both exist, so 007 can wire both new
CI steps together) -- this issue only adds the script and config, it does
not touch `qa.yml`.

## Testing

No `bun test` unit tests are appropriate for this issue (there is nothing
to unit-test -- `size-limit` is a CLI tool operating on already-built
files, not library code this repo owns). Verification is: `bun run
build:all` followed by `bun run size` succeeds (exits 0) against the
just-built `dist/` outputs on a clean tree, and, as a negative-path sanity
check, temporarily lowering one `.size-limit.json` entry's limit below
the measured size and re-running confirms `size-limit` correctly exits
non-zero (then restore the real limit before committing).

## Out of scope

Wiring into `qa.yml` (issue 007). Any bundler-plugin-based size check
(`@size-limit/webpack`/`@size-limit/esbuild`) -- `@size-limit/file` is
sufficient and simpler, per BRIEF.md's research finding. Tree-shaking
analysis / per-export size breakdown -- Phase 19 territory.
