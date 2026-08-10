# 004 — Package READMEs + root SEO pass

## Context

Read `plan/phase-21-npm-publish-seo/BRIEF.md` in full first — this issue
implements its "Package READMEs + root SEO pass" scope bullet and Design
decision 4 (bundle-size badge deferred). Can be done independently of
issues 002/003 (no dependency), but should land after issue 001 so the
badges/links reference the correct `0.1.0` version where relevant.

## Per-package READMEs (8 new files)

None of `packages/{react,next,vue,nuxt,svelte,solid,astro,remix}` has a
`README.md` today — confirmed in BRIEF research. npm displays a package's
*own* `README.md` on its registry page (not the repo root's), so all 8
currently would show npm's generic empty-readme placeholder.

Add `packages/<name>/README.md` for each of the 8, consistent shape,
short (this is a supporting doc, not the primary docs site — link out to
`docs/` for depth, don't duplicate it):

1. One-line title + the same one-sentence description already in that
   package's `package.json`.
2. Install snippet: `` ```sh\nbun add @typetrack/<name> typetrack\n``` ``
   (every framework package needs root `typetrack` too — reflect the real
   peer/dependency relationship, don't just show the sub-package).
3. A minimal, real usage example for that specific package/framework —
   read that package's actual exported API from its `src/index.ts` (or
   equivalent entry point) before writing the example; do not invent API
   shapes. Keep it to the smallest snippet that demonstrates the
   package's reason to exist (e.g. `packages/react`: `AnalyticsProvider` +
   `useAnalytics`; `packages/astro`: the integration's `astro.config.mjs`
   usage). Match the style of any existing usage examples already in root
   `README.md` or `docs/` for that framework, if one exists — don't
   contradict documented usage.
4. A closing line linking to `docs/README.md` (root docs index) for full
   documentation, and noting peer dependency requirements (read the
   package's own `peerDependencies` field for the accurate version range
   to state, e.g. "requires React 19+").

Do not add READMEs to the 4 private, unpublished `provider-*`/
`provider-contract-kit` packages.

## Root `README.md` SEO pass

1. **Badges row**, added near the top (directly under the `# typetrack`
   H1, before the "Install" section) — shields.io badges:
   - npm version: `https://img.shields.io/npm/v/typetrack`
   - npm downloads: `https://img.shields.io/npm/dm/typetrack`
   - license: `https://img.shields.io/npm/l/typetrack`
   Each badge links to `https://www.npmjs.com/package/typetrack`. Per
   BRIEF Design decision 4, **do not** add a bundle-size badge this
   phase — the endpoint needs the package live on the registry to compute
   against; note this as a `RELEASING.md` follow-up instead (issue 005
   owns that file, but leave a one-line comment or note here if it reads
   naturally, otherwise trust issue 005 to record it).
2. **"Status" section update**: currently reads "Pre-1.0, not yet
   published to npm." Replace with an accurate statement now that CI is
   built but the real publish hasn't happened yet — do not claim it's
   live before it is (e.g. something like "Pre-1.0. The npm publish
   pipeline (`release.yml`) is built and dry-run verified; the first real
   publish is a pending manual step — see `RELEASING.md`." Adjust wording
   to fit the surrounding paragraph's existing voice, and only reference
   `RELEASING.md` if issue 005 has landed by the time this is written; if
   done out of order, phrase it without a dangling link and let issue 005
   add the cross-link when it lands).
3. Root `package.json`'s own `"keywords"` field is issue 001's job, not
   this issue's — don't duplicate that work here.

## Verification

- Every new `packages/*/README.md` renders as valid Markdown (no broken
  fence blocks — check by eye, no automated Markdown linter exists in
  this repo's toolchain).
- Every code snippet's imports/API calls match that package's actual
  exported symbols (spot-check against `src/index.ts` for at least the
  packages whose APIs you're least familiar with).
- `bun run knip` still passes (new `README.md` files aren't source code
  and shouldn't trip it, but confirm).
- Root README's badge markdown is syntactically valid (`![alt](url)` /
  `[![alt](badge-url)](link-url)` — standard shields.io + npm badge
  pattern, no typos in the shields.io URL query params).

Run the full `qa.yml` step sequence locally before committing.
