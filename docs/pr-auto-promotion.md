# Automatically marking agent PRs ready for human review

## Purpose and triggers

[`promote-agent-pr.yml`](../.github/workflows/promote-agent-pr.yml) rechecks an agent draft when successful `CI` pull-request `workflow_run` completes **or** when an open draft is edited using `pull_request_target` (`edited` only). An edit before CI succeeds does not promote; a later successful CI completion rechecks. If CI passes while the title is WIP, a subsequent title/body edit rechecks without a CI rerun.

Both paths use the same eligibility checks against live GitHub metadata:

1. Exactly one open draft for a same-repository `copilot/` branch targets `main`; on an edit its number must match the event.
2. Its title does not start with the existing WIP/Draft markers or report a blocker. Its body has nonempty Validation, Screenshots and browser evidence, and Human verification steps sections. Headings hidden in comments, quotes or fenced code do not count.
3. A completed successful pull-request run of `.github/workflows/ci.yml` belongs to this repository and branch and matches the current head SHA or current GitHub-generated merge SHA. The CI event uses its own run; the edit event searches that CI workflow. An edit alone is never CI evidence.
4. That exact run has a nonempty, unexpired `playwright-evidence` artifact. Only artifact metadata is inspected.
5. Immediately before mutation, the PR is re-fetched and its open/draft state, identity, head, base, merge SHA, title and body are compared. Any change causes a skip.

The workflow never reviews, approves or merges a PR. Human review and `main` branch protections remain mandatory.

## Security evaluation and limitations

`pull_request_target` is privileged and can be triggered by an edit to a fork PR. It is appropriate here **only** because the workflow is loaded from the trusted base/default branch, does not check out any code, does not interpolate event fields into the script, and never downloads or executes artifacts. It uses `actions: read`, `contents: read` and `pull-requests: write`; the only intended write is `markPullRequestReadyForReview`. Forks, non-Copilot branches, other bases and mismatched PRs are rejected using live metadata. Production secrets are not used. Changes to this trigger, workflow and permissions require explicit human security review before merge.

The branch prefix and PR text are **heuristics**, not authentication of the agent or independent proof that the handoff is true. Authorized contributors can create `copilot/` branches or write misleading text, and PR CI itself runs PR-controlled code. The artifact's name, size and expiry do not prove its contents or browser coverage. Review the PR, CI changes and evidence independently; this is not a security approval.

Concurrency serializes promotion jobs by branch without cancelling an in-progress job. GitHub retains at most one pending job per group, replacing older pending jobs with newer ones; each surviving job re-reads current state. Already-ready PRs are skipped, including a concurrent manual transition. The final re-fetch narrows but **cannot eliminate** a race: GitHub's ready-for-review mutation has no conditional head/body/state argument, so an edit or push between the last read and mutation can still race. The workflow cannot guarantee atomic unchanged state at mutation time.

A previous attempt to perform the mutation with the existing token failed with `Resource not accessible by integration` ([run](https://github.com/benburleson/one-killer-party/actions/runs/44843152918)). The edit trigger does not resolve such a permission/ownership restriction. Do not expand permissions or bypass approval gates to force it; investigate with a human if it recurs.

## Verification plan and manual matrix

Unit tests (`npm run test:unit`) execute the workflow's inline script with mocked GitHub APIs; they do **not** exercise GitHub event delivery, token authorization, actual artifacts or concurrent GitHub mutations. The following matrix is a reproducible **planned manual test**, not an observed result. Perform it only after human security review and merge, with an independent subsequent Copilot PR and appropriate isolated test PRs. Record PR/run/artifact links, timestamps, state transitions and any human intervention in [agent-evaluation.md](agent-evaluation.md). Do not merge automatically.

| Setup/action | Expected observation |
| --- | --- |
| Edit an eligible WIP draft before CI completes; then finalize it before successful CI finishes | Edit leaves Draft; successful CI event promotes after evidence appears. |
| Let CI pass while title is WIP; then finalize title and complete handoff | CI event skips; edit event promotes without a CI rerun. |
| Edit with WIP/blocked title or an empty, commented-out, quoted or fenced handoff | Remains Draft. |
| Edit with failed/pending CI, stale head/merge SHA, or missing, empty or expired artifact | Remains Draft. |
| Edit fork, non-`copilot/`, wrong-base, closed, or unrelated PR | Remains unchanged. |
| Trigger overlapping CI and edit rechecks; change head/body during verification or mark ready manually | No duplicate transition; changed state is skipped if observed by the final read. Record any narrower last-read/mutation race. |
| Inspect workflow logs and PR | Only intended mutation occurs; no checkout, approval, merge or protection changes. |

If GitHub suppresses an edit event, rejects the mutation, or evidence expires before finalization, record the failure; a human can review and mark the PR ready. No independent post-merge demonstration of this change has yet been observed.
