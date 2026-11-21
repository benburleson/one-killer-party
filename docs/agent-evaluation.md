# Autonomous development experiment: evidence and metrics

We want to show **what the system actually accomplished**, including failures, rather than merely claiming an autonomous pipeline exists.

## Per-issue trial record

Record the following in each agent-generated PR or linked issue:

| Field | What to capture |
| --- | --- |
| Trigger | Human report, Vercel alert, Supabase alert, or synthetic test |
| Issue quality | Acceptance criteria and reproduction steps available at dispatch |
| Agent/environment | Agent name, runtime, branch and execution limits |
| Human interventions | Number and nature of clarifications, restarts, and manual changes |
| Completion | Draft PR opened, blocked, or abandoned |
| CI evidence | Links and pass/fail outcome for lint, types, build and tests |
| Browser evidence | Screenshots, traces, browser/version and target URL where applicable |
| Preview verification | Working Vercel preview link and any manual verification |
| Safety | Data/security/production concerns, violations or mitigations |
| Review outcome | Approved, revisions requested, rejected or merged by a human |
| Learning | Failure mode and workflow improvement to make next |

## Suggested showcase KPIs

- **Issue-to-PR rate:** agent-dispatched issues producing a reviewable draft PR.
- **First-pass CI rate:** PRs passing required checks without follow-up fixes.
- **Human intervention rate:** count of substantive human actions per task.
- **End-to-end elapsed time:** issue assignment to draft PR ready for review.
- **Review rework:** reviewer-requested changes per PR.
- **Reproduction coverage:** bug-fix PRs with a test or repeatable repro.
- **Environment reliability:** sessions reaching a usable test environment.
- **Safety:** number of secret exposures, production writes, permission bypasses (target zero).

Report denominators and failed trials; do not calculate success percentages from cherry-picked examples. Track trend over multiple issues, and distinguish subjective human review from deterministic CI results.

## Graduation criteria for more autonomy

Advance from human-created issues to automated issue creation only after the agent can complete several scoped tasks with credible tests and evidence. Advance from human agent-dispatch to automatic dispatch only for pre-approved, low-risk issue categories with deduplication, rollback/stop mechanisms, and explicit limits on execution cost and privileges. **Never graduate to automatic merge as part of this experiment.**

## Trial 1 — Issue #2: Playwright landing-page smoke test (2026-11-20)

**Evidence:** [Issue #2](https://github.com/benburleson/one-killer-party/issues/2) · [Copilot PR #3](https://github.com/benburleson/one-killer-party/pull/3) · [CI run #6](https://github.com/benburleson/one-killer-party/actions/runs/44832837014)

| Field | Observed |
| --- | --- |
| Trigger | Human-authored GitHub Issue #2, assigned to GitHub Copilot |
| Execution | Copilot worked in a dedicated branch and opened PR #3 |
| Delivery | Added Playwright landing-page test, Chromium CI job, screenshot/report artifacts, README commands |
| Verification | GitHub Actions lint/type/build job passed; Playwright browser-smoke job passed |
| Evidence | `playwright-evidence` artifact successfully uploaded; artifact image contents were not independently reviewed in this record |
| Preview | Vercel reported successful preview deployment; human confirmed opening a preview URL in browser |
| Human interventions | One manual approval of a Copilot-triggered workflow run, plus final human merge; issue creation and assignment also human-initiated |
| Outcome | PR #3 merged by human on 2026-11-20 |
| Open questions | Exact agent runtime reproducibility and complete absence of additional agent-internal retries have not been established |

**Bottleneck and change:** GitHub required a human to approve the agent-originated workflow. After the trial, the repository owner disabled Copilot's **Require approval for workflow runs** setting. This is a *user-reported configuration change*, not yet independently validated by another agent-triggered run.

**Trade-off:** New or changed agent-authored CI code can now execute without an individual workflow approval. Keep GitHub Actions permissions read-only by default, prevent PR access to production secrets, retain branch protection, and require human-controlled merging. Security-sensitive workflow changes should still receive careful human review before merge.

**Trial 2 hypothesis:** A fresh agent issue that changes CI should result in tests and screenshot artifacts without an intermediate **Approve and run workflows** prompt. Record whether that actually happens; do not infer it from settings alone.

## Repeated autonomy handoff failure — PRs #12 and #14 (2026-11-21)

- [PR #12](https://github.com/benburleson/one-killer-party/pull/12): [CI run 44841426299](https://github.com/benburleson/one-killer-party/actions/runs/44841426299) passed, but [promotion run 44841556142](https://github.com/benburleson/one-killer-party/actions/runs/44841556142) skipped the then-WIP title. The later title edit did not recheck. A human-triggered second CI attempt was recorded; its [promotion run 44843152918](https://github.com/benburleson/one-killer-party/actions/runs/44843152918) failed with `Resource not accessible by integration` at the ready mutation. The PR was ultimately merged by a human.
- [PR #14](https://github.com/benburleson/one-killer-party/pull/14): [CI run 44844288749](https://github.com/benburleson/one-killer-party/actions/runs/44844288749) passed with Playwright evidence, but [promotion run 44844408798](https://github.com/benburleson/one-killer-party/actions/runs/44844408798) skipped the WIP title. The final title edit did not recheck. The PR is now ready; the actor and exact action that changed its draft state have not been independently established in this record.
- **New human interventions:** the CI rerun and human merge for #12, plus reporting and dispatching [issue #15](https://github.com/benburleson/one-killer-party/issues/15) for the repeated handoff failure. Do not infer the full intervention count or count this as an autonomous success.
- **Next trial:** after human security review and merge, observe an independent agent PR completing both event orderings as feasible. Record event delivery, mutation authorization, CI and artifact links, and any human intervention. The proposed recheck and local mock tests are not proof of successful live promotion.

## Trial 3 — Issue #18: M1.3 local Supabase lobby persistence (2026-11-21)

**Evidence:** [Issue #18](https://github.com/benburleson/one-killer-party/issues/18) · [Draft PR #19](https://github.com/benburleson/one-killer-party/pull/19) · [CI run #42](https://github.com/benburleson/one-killer-party/actions/runs/44858549706) · [Playwright evidence artifact](https://github.com/benburleson/one-killer-party/actions/runs/44858549706/artifacts/14688876341)

| Field | Observed |
| --- | --- |
| Trigger | Human-authored Issue #18 with detailed schema, security, test, and CI acceptance criteria |
| Execution | Copilot worked in `copilot/m13-implement-local-supabase-lobby-schema`; one read-only repository exploration agent and one read-only security review agent were used |
| Delivery | Added local-only lobby migrations, deny-by-default RLS/grants, pgTAP coverage, an ephemeral Supabase CI job, and local/security documentation |
| Verification | Final CI run #42 passed: migration reset + all 52 pgTAP assertions + volume cleanup; lint/unit/typecheck/build passed; both desktop/mobile Chromium smoke tests passed |
| Local checks | `npx supabase db reset --no-seed`, `npx supabase test db` (52 assertions), `npx supabase db lint`, `npm run test:unit` (9 tests), `npm run lint`, and `npx tsc --noEmit` passed |
| Browser evidence | The existing landing-page smoke test passed on desktop and mobile Chromium. Its artifact was uploaded but not visually inspected; it is regression evidence, not proof of lobby behavior |
| Preview | No preview URL was recorded or manually verified; this database-only change adds no UI flow |
| Human interventions | After dispatch: no clarification, manual code change, workflow approval, or GitHub Actions retry |
| Agent-side iterations | Eight local pgTAP invocations; four early runs exposed missing plan/fixture issues that were corrected before the final 52-pass run. Two local Next.js build attempts could not fetch the repository's existing Google Fonts; the final hosted CI build passed |
| Safety | All database work used disposable local Supabase and deterministic synthetic identities. No hosted Supabase project, production data, or cloud credentials were used; generated local state was removed/ignored |
| Outcome | PR #19 remains a draft for human review and human-only merge |
| Learning | Keep startup output suppressed to protect generated local keys, and make the all-deny RLS decision explicit until reviewed server projections and commands exist |
