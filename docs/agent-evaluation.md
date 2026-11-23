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

## M1.5–M1.7 rollout and handoff evidence (2026-11-23)

**Evidence:** [guest UX PR #32](https://github.com/benburleson/one-killer-party/pull/32) · [M1.6 PR #34](https://github.com/benburleson/one-killer-party/pull/34) · [M1.7 PR #36](https://github.com/benburleson/one-killer-party/pull/36) · [merged-main CI run #90](https://github.com/benburleson/one-killer-party/actions/runs/45087065308)

- PR #32 records a guest-join failure-classification fix: an earlier generic
  error mislabeled all anonymous sign-in failures as an existing account.
  The owner later reported a production anonymous-sign-in configuration
  failure that produced this misleading symptom. PR #32 says the setting was
  enabled when that PR was checked; the current production setting is not
  independently verified. Do not infer the original Auth cause from the UI
  message. Turnstile issues a browser token; Supabase Auth validates/consumes
  it server-side. Join and recovery render one widget at a time.
- M1.6 CI run [#83](https://github.com/benburleson/one-killer-party/actions/runs/45082762821)
  failed desktop/mobile integration at the safe stage label “stale version is
  rejected.” The wrapper deliberately omitted raw Playwright details; the
  workflow uploaded only allowlisted screenshots. M1.7 integration runs
  [#87](https://github.com/benburleson/one-killer-party/actions/runs/45084529130)
  and [#88](https://github.com/benburleson/one-killer-party/actions/runs/45085144146)
  later exposed safe stage labels for assignment confirmation and stale
  version rejection; the final PR CI [#89](https://github.com/benburleson/one-killer-party/actions/runs/45086012751)
  passed. The merged `main` SHA then passed CI run #90. These failures are
  evidence of debugging iterations, not a basis for claiming older-SHA runs
  validate a later commit.
- Promotion is **not verified working**: PR #36 had successful CI run #89 and
  a nonempty evidence artifact, but promotion [run #89](https://github.com/benburleson/one-killer-party/actions/runs/45086128314)
  logged a skip claiming no successful current CI run with evidence. The
  Actions artifact list for CI [run #89](https://github.com/benburleson/one-killer-party/actions/runs/45086012751)
  shows that artifact existed; the mismatch is unexplained. A human later
  merged PR #36. A later PR #34 promotion [run #90](https://github.com/benburleson/one-killer-party/actions/runs/45086384293)
  failed with `Resource not accessible by integration`. Its cause remains
  unconfirmed; permissions were not broadened. Do not rely on automation for
  readiness or merge.
- The CI workflow's Supabase startup output was fully suppressed, preventing
  diagnosis of an intermittent startup failure reported by the owner. No
  startup failure was established in the runs reviewed here; the workflow now
  emits only failure-only Docker reachability and container-state categories.
  Integration screenshot upload now warns if an earlier failure produced no
  allowlisted screenshots. No DOM, trace, credentials, or raw CLI output is
  added to the artifact.
- Production status remains unverified: the repo and CI establish merged code
  and tests, not M1.5/M1.6 remote migration application, production deployment,
  or a post-M1.7 production smoke test. PR #36's Vercel check was not verified
  as a production deployment. See the production-operations status table.

## Automatic draft promotion retired (2026-11-23)

The owner retired `promote-agent-pr.yml`, its mock unit test and
`docs/pr-auto-promotion.md`; all three remain in Git history.

- Promotion runs [#90](https://github.com/benburleson/one-killer-party/actions/runs/45086384293)
  and [#99](https://github.com/benburleson/one-killer-party/actions/runs/45090733134)
  reached the ready-for-review mutation and GitHub answered
  `FORBIDDEN: Resource not accessible by integration`. Run #94 also failed;
  its log was not read. No successful live promotion was recorded. The cause
  of the rejection was not established and permissions were never broadened.
- The earlier "unexplained evidence mismatch" for PR #36 is explained by run
  timestamps: the edit-triggered promotion job ran at 23:59:09 UTC while CI
  run #89 for that SHA did not complete until 00:01:45 UTC, so no successful
  CI run existed yet and the skip was correct. PR #40 showed the same order
  (promotion 01:05:58, CI complete 01:10:25). Whether the later
  CI-completion trigger would then have promoted those PRs was not examined.
- Marking a draft ready is now a human step, alongside human review and merge.
