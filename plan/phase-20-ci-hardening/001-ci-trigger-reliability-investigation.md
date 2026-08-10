# Issue 001: CI-trigger reliability investigation

## Why

Phases 16-19's own "A note on CI" sections have repeatedly asserted, on
each occasion without hard evidence attached, that GitHub Actions
intermittently fails to trigger `qa.yml` runs on pushes to `main`, and
told the worker not to chase it. Phase 20 is explicitly the phase to
chase it properly: confirm whether it's real, measure the actual rate,
and rule in/out plausible causes (misconfigured trigger, rate limiting,
Actions minutes/billing, GitHub-side infra) with evidence, not repetition
of the same unverified claim.

## What was done

All investigation used `gh api` against `DevKovan/typetrack` (this
session's authenticated `gh` account: `Ajith-Pandian`, `pull: true`,
`push: false`, `admin: false` on this repo — see "Limitation" below).

1. **Naive commit-vs-run diff (rejected as a method, evidence recorded
   for the record)**: `git log` / `gh api repos/DevKovan/typetrack/commits`
   gave 158 commits on `main`; `gh api repos/DevKovan/typetrack/actions/runs`
   gave 70 recorded workflow runs. Diffing commit SHAs against run
   `head_sha`s found 90/158 "runless" commits — but commit *author*
   timestamps (all this endpoint exposes) record local commit creation
   time, not push time, and a single `git push` covering several
   already-created commits produces one push event/run for the batch's
   final SHA by design. This method conflates "expected, by-design
   non-trigger for an intermediate commit in a multi-commit push" with
   "a push that should have triggered a run but didn't" and cannot tell
   them apart. Superseded by the method below.
2. **Real method: GitHub Events API.**
   `gh api "repos/DevKovan/typetrack/events?per_page=100"` (paginated;
   this endpoint is retention-limited and returned 80 total `PushEvent`s,
   covering 2026-08-01 through 2026-08-10) gives one entry per actual
   `git push`, with a real push timestamp (`created_at`) and the pushed
   `head_sha` (`payload.head`) — the correct unit of comparison against
   workflow runs.
3. Cross-referenced all 80 real push `head_sha`s against the 70 recorded
   run `head_sha`s (`gh api "repos/DevKovan/typetrack/actions/runs?per_page=100&event=push"`,
   paginated). **Result: 11 of 80 pushes (13.75%) have no matching
   workflow run at all** — confirmed missing triggers, not an artifact of
   the diff method.
4. The 11 misses are not evenly distributed — they fall into exactly two
   clustered windows:
   - 2026-08-01T11:57:12Z – 2026-08-01T12:13:21Z (5 consecutive pushes
     over 16 minutes, all missing)
   - 2026-08-06T18:36:12Z – 2026-08-06T19:48:53Z (6 consecutive pushes
     over 72 minutes, all missing)

   Every other push in the 10-day window (69 of 80) triggered a run
   normally, including pushes immediately before and after both windows.
5. Ruled out as causes, with direct evidence:
   - **Rate limiting**: `gh api rate_limit -q '.resources.core'` showed
     4,976/5,000 requests remaining at time of investigation — nowhere
     near exhausted, and this endpoint isn't even the one Actions
     triggers consume.
   - **Actions minutes/billing**: `gh api repos/DevKovan/typetrack -q
     .private` confirms this is a **public** repo
     (`"visibility": "public"`); GitHub Actions minutes are free/unmetered
     for public repositories regardless of usage, so a billing/minutes
     cause is structurally impossible here, not merely "not observed."
   - **`qa.yml` misconfiguration**: the workflow's `on: push: branches:
     [main]` trigger is straightforward and syntactically correct
     (confirmed by reading the file — see `.github/workflows/qa.yml`),
     and 69/80 pushes in the same window triggered it correctly. A config
     bug would fail every push, not 2 short bursts out of 80.
6. **Limitation, flagged per this phase's task instructions rather than
   silently skipped**: deeper root-causing (webhook delivery logs,
   org-level Actions incident history) needs repo-admin-level access.
   This session's `gh` auth is a personal account (`Ajith-Pandian`) with
   only read access to this repo:
   ```
   $ gh api repos/DevKovan/typetrack -q '.permissions'
   {"admin":false,"maintain":false,"pull":true,"push":false,"triage":false}
   $ gh api repos/DevKovan/typetrack/hooks
   gh: This API operation needs the "admin:repo_hook" scope.
   ```
   The actual push/commit identity for this repo (`DevKovan`, via a
   separate SSH key — `git@github-devkovan:DevKovan/typetrack.git`) has
   no corresponding `gh`/REST token available in this session. A future
   session with an admin-scoped token for `DevKovan` (or another
   repo-admin account) could check `GET /repos/{owner}/{repo}/hooks/
   {hook_id}/deliveries` for the webhook that fires Actions runs, which
   would be the one remaining avenue toward an exact root cause beyond
   "GitHub-side, transient, evidenced but not root-caused."

## Conclusion

The flakiness is real (13.75% silent-trigger-failure rate in the
investigated window), clustered in two short bursts rather than spread
evenly (the fingerprint of a transient GitHub-side event-delivery hiccup,
not a per-push code/config defect), and not fixable from this repo's own
configuration — `qa.yml` is correctly written and the large majority of
pushes trigger it correctly. No further action is recommended beyond what
this issue already did (document the evidence, rule out local causes).
Continuing to "just retry the push" (this repo's prior-phase workaround)
remains the correct practical response when it's next observed, now with
actual numbers behind why that's reasonable instead of an unverified
assumption.

## Deliverable

New root `CONTRIBUTING.md`, "Continuous Integration" section, containing:
the reproducible `gh api` commands above, the two burst windows with
exact timestamps, what was ruled out and how, and the gh-auth-scope
limitation — written so a future session can re-run the same commands and
compare against a fresh window rather than needing to redo this
investigation from scratch.

## Acceptance criteria

- [x] `CONTRIBUTING.md` exists at repo root with a "Continuous
      Integration" section covering the investigation above.
- [x] The section includes the exact `gh api` commands used (copy-pasteable,
      not paraphrased), so a future phase can re-run them.
- [x] The gh-auth-scope limitation is stated explicitly, including which
      permission was missing and what it blocked (webhook delivery logs).
- [x] README.md's "Building from source" section gets a one-line pointer
      to `CONTRIBUTING.md` (full cross-link wiring is issue 003's job
      alongside the CHANGELOG entry, but this issue's own doc should not
      ship as an orphaned, unlinked file even before issue 003 lands —
      add the pointer here).
