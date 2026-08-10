# Contributing

This repo currently pushes straight to `main` (no PRs, no lingering
branches — see `.claude/skills/git-discipline/SKILL.md`). This file
documents CI-reliability findings a contributor should know about, not a
PR process (there isn't one yet).

## Continuous Integration

`.github/workflows/qa.yml` runs on every push to `main` and on pull
requests: build, bundle-size check, e2e (Playwright/Chromium), lint,
typecheck (`tsgo`/`tsc`), Svelte typecheck, `bun test`, and `bunx knip`.

### Known issue: GitHub Actions intermittently fails to trigger a run

Confirmed via GitHub's Events API, investigated in
`plan/phase-20-ci-hardening/001-ci-trigger-reliability-investigation.md`:
**11 of 80 real pushes to `main` (13.75%) in the 2026-08-01–2026-08-10
window triggered no workflow run at all.** The misses aren't spread
evenly — they cluster into two short bursts:

- 2026-08-01T11:57:12Z – 2026-08-01T12:13:21Z (5 consecutive pushes over
  16 minutes, all missing)
- 2026-08-06T18:36:12Z – 2026-08-06T19:48:53Z (6 consecutive pushes over
  72 minutes, all missing)

Every other push in the window (69 of 80) triggered normally, including
pushes immediately before and after both bursts.

**Reproducing this check** (needs a `gh` session with at least read access
to the repo):

```sh
# Real push events (retention-limited, typically the most recent ~10 days),
# one entry per actual `git push`, with a real push timestamp and head SHA.
gh api "repos/DevKovan/typetrack/events?per_page=100" \
  -q '.[] | select(.type=="PushEvent") | [.created_at, .payload.head] | @tsv'

# Recorded workflow runs, for comparison.
gh api "repos/DevKovan/typetrack/actions/runs?per_page=100&event=push" \
  -q '.workflow_runs[] | .head_sha'
```

Diff the `head_sha`s from the first command against the second — any push
event SHA absent from the run list is a silently dropped trigger. Do
**not** diff commit SHAs (`git log` / `gh api .../commits`) against run
SHAs instead — a single `git push` covering several already-created local
commits produces exactly one push event/run for the final commit, so most
of the "missing" commits that method finds are an expected artifact of
multi-commit pushes, not a real miss. (An earlier, naive version of this
investigation made exactly that mistake — see the issue file above for
the full before/after.)

**What this rules out**, with evidence:

- **Rate limiting**: `gh api rate_limit -q '.resources.core'` showed
  4,976/5,000 requests remaining at investigation time.
- **Actions minutes/billing**: this is a public repo
  (`gh api repos/DevKovan/typetrack -q .visibility` → `"public"`), and
  GitHub Actions minutes are free/unmetered for public repos regardless
  of usage — structurally not a possible cause here.
- **`qa.yml` misconfiguration**: the trigger (`on: push: branches:
  [main]`) is straightforward and correct, and the large majority of
  pushes in the same window triggered it correctly. A config bug would
  fail every push, not two short bursts out of 80.

**What blocked deeper root-causing**: webhook delivery logs
(`GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries`) would be the
next place to look, but that needs repo-admin permission. The `gh`
session used for this investigation is a personal account with read-only
access to this repo (`gh api repos/DevKovan/typetrack -q .permissions` →
`{"admin":false,"push":false,"pull":true}`); the account that actually
pushes to this repo (a separate SSH identity) has no equivalent `gh`/REST
token available in that session. If you have repo-admin access, that
delivery-log check is the one remaining avenue toward an exact root
cause beyond "GitHub-side, transient, evidenced but not root-caused."

**Practical takeaway**: if a push doesn't show up in Actions after a few
minutes, it's very likely this — just re-push (an empty
`git commit --allow-empty` or any small follow-up commit) rather than
assuming `qa.yml` or the push itself is broken.
