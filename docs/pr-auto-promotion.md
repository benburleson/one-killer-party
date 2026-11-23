# Automatically marking agent PRs ready for human review

## Current status (2026-11-23)

**A successful live promotion has not been verified.** M1.7 PR
[#36](https://github.com/benburleson/one-killer-party/pull/36) passed current
PR CI [run #89](https://github.com/benburleson/one-killer-party/actions/runs/45086012751),
and that run has a nonempty `playwright-evidence` artifact. Promotion
[run #89](https://github.com/benburleson/one-killer-party/actions/runs/45086128314)
completed with a successful job status but its log says it skipped because it
found no successful current CI run with evidence. The artifact list contradicts
that skip reason; the cause is unresolved. PR #36 was subsequently merged by a
human, not promoted by this run.

The latest recorded permission failure was promotion
[run #90](https://github.com/benburleson/one-killer-party/actions/runs/45086384293)
for PR #34 on 2026-11-23: GitHub returned
`Resource not accessible by integration` at the ready-for-review mutation.
The cause remains unconfirmed and no token/permission workaround was applied.
The current workflow has both an unexplained eligibility/evidence mismatch and
a failed mutation; it must not be described as working reliably. See the
dated [agent evaluation](agent-evaluation.md). Retain human readiness and
merge control.

## Purpose and triggers

[`promote-agent-pr.yml`](../.github/workflows/promote-agent-pr.yml) rechecks an agent draft when successful `CI` pull-request `workflow_run` completes **or** when an open draft is edited using `pull_request_target` (`edited` only). An edit before CI succeeds does not promote; a later successful CI completion rechecks. If CI passes while the title is WIP, a subsequent title/body edit rechecks without a CI rerun.

Both paths use the same eligibility checks against live GitHub metadata:

1. Exactly one open draft for a same-repository `copilot/` branch targets `main`; on an edit its number must match the event.
2. Its title does not start with the existing WIP/Draft markers or report a blocker. Its body has nonempty Validation, Screenshots and browser evidence, and Human verification steps sections. Headings hidden in comments, quotes or fenced code do not count.
3. A completed successful pull-request run of `.github/workflows/ci.yml` belongs to this repository and branch and matches the current head SHA or current GitHub-generated merge SHA. The CI event uses its own run; the edit event searches that CI workflow. An edit alone is never CI evidence.
4. That exact run has a nonempty, unexpired `playwright-evidence` artifact. Only artifact metadata is inspected.
5. Immediately before mutation, the PR is re-fetched and its open/draft state, identity, head, base, merge SHA, title and body are compared. Any change causes a skip.

The workflow never reviews, approves or merges a PR. Human review and `main` branch protections remain mandatory.

For docs-only changes, the Screenshots and browser evidence section may
truthfully say that screenshots of changed UI are not applicable. A successful
CI run still needs a nonempty `playwright-evidence` artifact; CI's real,
credential-free landing-page smoke screenshot can satisfy that artifact
requirement. Do not fabricate a docs screenshot, claim the landing-page image
depicts the documentation, or bypass the gate. The workflow checks artifact
metadata only, not its visual content; the reviewer remains responsible for
evidence and change review.

## Security evaluation and limitations

`pull_request_target` is privileged and can be triggered by an edit to a fork PR. It is appropriate here **only** because the workflow is loaded from the trusted base/default branch, does not check out any code, does not interpolate event fields into the script, and never downloads or executes artifacts. It uses `actions: read`, `contents: read` and `pull-requests: write`; the only intended write is `markPullRequestReadyForReview`. Forks, non-Copilot branches, other bases and mismatched PRs are rejected using live metadata. Production secrets are not used. Changes to this trigger, workflow and permissions require explicit human security review before merge.

The branch prefix and PR text are **heuristics**, not authentication of the agent or independent proof that the handoff is true. Authorized contributors can create `copilot/` branches or write misleading text, and PR CI itself runs PR-controlled code. The artifact's name, size and expiry do not prove its contents or browser coverage. Review the PR, CI changes and evidence independently; this is not a security approval.

When GitHub reports a run's source head SHA rather than its merge SHA, a match establishes the current head but not that CI tested against the latest `main` commit. The live base is checked again for changes during verification, but base freshness since CI cannot be established from that head SHA alone. Human review and required CI/branch rules remain necessary.

Concurrency serializes promotion jobs by head repository and branch without cancelling an in-progress job; a fork cannot displace a same-named branch's pending job. GitHub retains at most one pending job per group, replacing older pending jobs with newer ones; each surviving job re-reads current state. Already-ready PRs are skipped, including a concurrent manual transition. The final re-fetch narrows but **cannot eliminate** a race: GitHub's ready-for-review mutation has no conditional head/body/state argument, so an edit or push between the last read and mutation can still race. The workflow cannot guarantee atomic unchanged state at mutation time.

A previous attempt to perform the mutation with the existing token failed with `Resource not accessible by integration` ([run](https://github.com/benburleson/one-killer-party/actions/runs/44843152918)). Similar token failures have been reported [upstream](https://github.com/cli/cli/issues/8910); their cause here is unconfirmed. The edit trigger does not resolve a token restriction. Do not expand permissions or bypass approval gates to force it; investigate with a human if it recurs.

## Verification plan and manual matrix

Unit tests (`npm run test:unit`) execute the workflow's inline script with mocked GitHub APIs; they do **not** exercise GitHub event delivery, token authorization, actual artifacts or concurrent GitHub mutations. The following matrix is a reproducible **planned manual test**, not an observed result. Run it only with human security review of the workflow and an independent Copilot PR plus appropriate isolated test PRs. Record PR/run/artifact links, timestamps, state transitions and any human intervention in [agent-evaluation.md](agent-evaluation.md). Do not merge automatically.

| Setup/action | Expected observation |
| --- | --- |
| Edit an eligible WIP draft before CI completes; then finalize it before successful CI finishes | Edit leaves Draft; successful CI event promotes after evidence appears. |
| Let CI pass while title is WIP; then finalize title and complete handoff | CI event skips; edit event promotes without a CI rerun. |
| Edit with WIP/blocked title or an empty, commented-out, quoted or fenced handoff | Remains Draft. |
| Edit with failed/pending CI, stale head/merge SHA, or missing, empty or expired artifact | Remains Draft. |
| Edit fork, non-`copilot/`, wrong-base, closed, or unrelated PR | Remains unchanged. |
| Trigger overlapping CI and edit rechecks; change head/body during verification or mark ready manually | No duplicate transition; changed state is skipped if observed by the final read. Record any narrower last-read/mutation race. |
| Inspect workflow logs and PR | Only intended mutation occurs; no checkout, approval, merge or protection changes. |

If GitHub suppresses an edit event, rejects the mutation, or evidence expires before finalization, record the failure; a human can review and mark the PR ready. Bot-authored commits may not trigger a fresh CI run. `workflow_dispatch` is available on CI for diagnosis, but its run is not accepted by the current promotion gate, which requires a successful `pull_request` CI event. Rerunning a workflow for an older SHA does not validate a newer commit; verify the run's head SHA against the current PR before reporting a pass.
