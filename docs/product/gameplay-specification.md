# One Killer Party — Gameplay Specification

**Status:** Draft implementation baseline · v0.3 · 2026-11-20  
**Dependencies:** [Product vision](product-vision.md) · [User flows](host-and-player-flows.md) · [Content model](mystery-content-model.md) · [Blackwood story](blackwood-affair.md) · [Decision register](decisions-and-open-questions.md)

## 1. Scope and rules of authority

This document specifies how the **in-person, phone-companion, app-guided, host-intervenable** game functions. **CONFIRMED:** Hybrid clue discovery, host-assigned characters, a murderer who knows their guilt, a balanced theatrical experience, and no required AI. Other details below are baseline proposals as identified in the [decision register](decisions-and-open-questions.md), particularly timing, scoring, exact buttons and automatic transitions.

A single game **session** (here called a *party*) instantiates one immutable version of a mystery. **Players** are participants with one assigned playable character each. The host may also be a player (supported design requirement); a nonplaying host remains a possible UI scenario but its exact admission/role-count rules are open.

## 2. Core loop

**Receive an objective or clue → approach someone in person → question, persuade, bluff or bargain → share/conceal information → revise deductions → repeat when the next act changes what is known.** The application delivers prompts, never transcribes or verifies real-world conversations in the MVP.

### Player rules (shown before Act I)

1. Remain in character as much as is fun; no acting experience or scripted performance required.
2. You may **lie**, bluff, hide personal information, negotiate, form alliances and accuse others.
3. **Official evidence is authoritative.** Do not forge/edit official cards, claim a fabricated card came from the app, or alter the canonical story. Character speech and personal recollections may be misleading.
4. Players may share or show **their own** dossiers/clues voluntarily. No one may access another player's private account/device without permission.
5. Social objectives are prompts, **not pass/fail tasks**. No essential clue requires an objective to be completed.
6. Every player should aim to identify the murderer, motive and method; the murderer separately aims to avoid identification.

### Information taxonomy

| Class | Who may view? | Truth/usage rule | Example |
|---|---|---|---|
| Public identity / setting | Everyone, including host during assignment | Official authored information | “Margot Sinclair, Society Darling” |
| Public announcement | All participants after its release | Canonical event | “Edmund was found dead in his study” |
| Public evidence | All participants after release | Official evidence; literal text immutable | Study floor plan |
| Character-private background | Assigned character only; authorized story author/admin separately | Character's authored knowledge; may include biases and secrets | Vivienne threatened Edmund |
| Character-specific evidence | Assigned character only until voluntarily shared in person | Official evidence, if typed `EVIDENCE` | Copy of a will |
| Personal recollection / rumor | Assigned character and people they tell | May be mistaken/deceptive; not independent proof | Theodore's memory of hiding the weapon |
| Host operations | Host only | State/attendance, not solution knowledge | “7 of 8 have joined” |
| Solution / answer key / unreleased truth | Privileged server-side game engine only until reveal, and authorized editorial tools | Canonical mystery truth; never sent prematurely | Murderer is Theodore |

**Nuance:** An authentic official clue need not imply that all characters interpreting it are honest. Evidence artifacts are fixed; character claims about them may be false. This distinction should be communicated in onboarding.

## 3. Phase model and suggested durations

| Phase | Goal and content | Suggested time | Advancement |
|---|---|---:|---|
| `LOBBY` | Guests join, host assigns one role each, prepares party | Flexible | Host `START_GAME` after readiness |
| `ACT_1` — The Gathering | Introduce roles, relationships, personal secrets and social objectives; scripted welcome | 20 minutes | Host `ADVANCE_ACT` |
| `ACT_2` — The Murder | Scripted discovery; initial public/private evidence; alibis and interrogations | 25 minutes | Host `ADVANCE_ACT` |
| `ACT_3` — The Reckoning | Deeper evidence, audit revelation and public confrontation; revisit suspicions | 25 minutes | Host `OPEN_ACCUSATIONS` |
| `ACCUSATIONS` | Each player independently submits final suspect, motive and method | Part of 20-minute finale | Host locks when ready, with readiness safeguards |
| `REVEAL` | Narrative reconstruction; answer key and optional scores | Part of finale | Host completes after reveal |
| `COMPLETE` | Finished, optional retrospective/awards | No duration | Terminal for prototype |

**Important timeline distinction:** *The Blackwood Affair* gives clock times (8:30–9:30 p.m.) for **fictional events**, while 0–90 minutes is **real party progression**. The murder is not enacted live at minute 20; the Act II narrator declares that the fictional murder has occurred. Exact framing of pre-murder recollections versus Act I mingling is an [open narrative continuity issue](decisions-and-open-questions.md).

### Pause, extension and timing

- **CONFIRMED direction:** Host can intervene; app suggests timing but does not auto-advance acts by default.
- **BASELINE PROPOSAL:** `paused` is an orthogonal state flag, not a new story phase. Pause suspends countdown/pacing prompts, **not** visibility of previously released content or ordinary social conversation.
- **BASELINE PROPOSAL:** Extend act updates suggested schedule, not clue release conditions.
- Automatically scheduled events and host-only re-send notification behavior remain proposals, not validated MVP requirements.

## 4. Transition rules and game engine invariants

Represent phase changes as an explicit **server-authoritative state machine**; client navigation does not change gameplay. A proposed TypeScript phase union is `LOBBY | ACT_1 | ACT_2 | ACT_3 | ACCUSATIONS | REVEAL | COMPLETE` with `paused` and an integer optimistic `version`.

| Action | Allowed when | Actor | Required guarantees |
|---|---|---|---|
| `CREATE_PARTY` | Authenticated authorized host | Host | Persist mystery ID + **content version**, new party and join code; no solution in response |
| `JOIN_PARTY` | Lobby open; join credential valid | Guest | Issue individual identity/session, not another player's role or secret |
| `ASSIGN_CHARACTER` | Lobby; valid unassigned unique character | Host | Assignment uses public roster; enforce unique role per party; never disclose killer status to host |
| `START_GAME` | Lobby; ready participant/role set | Host | Atomic transition to `ACT_1`; one logical release of Act I content |
| `ADVANCE_ACT` | `ACT_1` or `ACT_2`, not paused | Host | Atomic phase change + authorized releases; reject skipped/replayed transitions |
| `PAUSE_GAME` / `RESUME_GAME` | Active game (specific allowable phases open) | Host | Change pacing flag only; do not retract revealed clues |
| `OPEN_ACCUSATIONS` | `ACT_3`, not paused | Host | Move to `ACCUSATIONS`; no premature reveal |
| `SUBMIT_ACCUSATION` | `ACCUSATIONS`, player eligible, phase open | Player | Exactly one **final** accusation per participant; immutable on acceptance unless a later explicit rule changes this |
| `LOCK_ACCUSATIONS` | `ACCUSATIONS` | Host | Prevent new submissions; behavior for missing participants remains OPEN |
| `REVEAL_SOLUTION` | Locked accusations; authorized host | Host | One-way unlock of solution for eligible audience; no pre-reveal leak |
| `COMPLETE_GAME` | `REVEAL` | Host | Mark finished, preserve record, no further act changes |

**OPEN:** Whether accusation-lock is modeled as a flag on `ACCUSATIONS` or a separate `ACCUSATIONS_LOCKED` state; whether host can undo phase changes, reassign roles after start, close/reopen joining, or force start with missing players. These must not be implicitly implemented.

**Engineering invariants:**

- Server enforces all authorizations and preconditions, including direct API requests that bypass UI buttons.
- Phase transition + event record + clue availability change are committed atomically, or via an equivalent idempotent transactional mechanism.
- Retry/double-click cannot release the same logical clue twice or skip phases; use party version/concurrency checks and stable release IDs.
- Clients may receive realtime **change notices** but must fetch content under their own authorization; notifications must never carry private spoilers.
- A reconnecting guest can retrieve only their assigned character's legitimately released content and current public phase.
- Host's operational privilege is not permission to view solution-only or another character's private data.
- Do not place future clue text or canonical culprit in publicly downloaded client bundles, HTML, embedded JSON, localStorage or anonymous-readable database tables.

## 5. Character preparation and objectives

**CONFIRMED:** Host assigns characters before the party rather than letting the app choose randomly or based on guest preferences. Pre-party character previews, costume suggestions and invitation theming are baseline proposals.

Every character's authoring packet contains:

- Public identity: name, archetype, background and potentially costume direction.
- **Pre-start private background:** only approved nonspoiler biography, relationships and preparation prompts for the assigned role; **no guilt or murderer crime truth in LOBBY**. The murderer-only truth, method and cover story belong to a separately gated ACT_1 briefing (D-028).
- Character relationships: the people to seek out or avoid, reasons and conflicts.
- Objectives: small, legible conversation catalysts refreshed by act.
- Clues and recollections released by act; no preloading of later content.

### Social mission categories

| Type | Goal | Example |
|---|---|---|
| `INVESTIGATE` | Ask and corroborate | “Ask Theodore why he visited the study.” |
| `PERSUADE` | Win someone to a claim | “Convince Margot you're innocent.” |
| `CONCEAL` | Keep a personal secret | “Protect your debt from the others.” |
| `ALLY` | Build a temporary pact | “Recruit someone to investigate Arthur.” |
| `CONFRONT` | Publicly or privately challenge someone | “Challenge Theodore's alibi.” |
| `MISDIRECT` | Encourage suspicion of an alternate suspect | “Persuade someone to investigate Vivienne.” |

**BASELINE PROPOSAL:** Give each character ~2–3 objectives per act, including an investigative, interpersonal and personal angle. The current authored dossiers do **not** yet contain a complete 8 × 3 × 3 objective matrix. Do not generate missing missions as canonical without review.

Objectives are **optional**; no requirement for players to tap Complete, scan codes, log conversations or earn essential evidence. No objective point economy in MVP.

### Murderer-specific play

- **CONFIRMED D-028:** Murderer is informed of guilt, motive, method, real chronology and cover story **only when the host starts ACT_1**; the LOBBY dossier for that same character does not reveal guilt or contain indirect spoilers. The briefing is private to the assigned player (including a host only when explicitly enrolled as that player).
- May knowingly lie about actions, location, intentions or impressions; may use existing information to sow doubt.
- May **not** alter official evidence, forge app output or change authoritatively defined events.
- May submit an ordinary accusation as camouflage; whether they are ranked as a detective is proposed **no**.
- **BASELINE PROPOSAL:** Murderer “wins” if no non-murderer correctly identifies them. Whether motive/method also count toward murderer defeat is unresolved.

## 6. Hybrid discovery

**CONFIRMED:** Core clues are released by act and never depend on completing social tasks. Social objectives, conflicting testimony and **optional** discoveries encourage further conversations.

**Core path (MVP):** Host advances → server applies author-defined release conditions → public cards appear to everyone and private cards to assigned characters → guests talk, bargain, show authentic cards or conceal their knowledge. The app may nudge people to question specific guests but does not enforce conversations.

**Optional discovery (future or limited authored MVP proposal):** A character may pursue an optional clue or background detail that enriches the story without being necessary to reach a fair verdict. If implemented, authoring validation must prove the essential solution remains accessible without that optional path.

**Baseline anti-fragility rule:** For each critical deduction, aim for at least two independent supporting sources/pathways. This is a content-writing quality goal, **not yet proven for Blackwood**. If key participants withhold testimony, the game should remain reasonably solvable; a rigorous assessment belongs in playtesting.

## 7. Public events and theatrical balance

**CONFIRMED direction:** Mostly natural socializing, punctuated by short shared scenes. Public event model:

- Event 1 / Act I: host reads a welcome note that Edmund has invited a remarkable group and plans an important announcement.
- Event 2 / Act II: host announces discovery of Edmund's body and calls for an investigation.
- Event 3 / Act III: host shares news of recovered business records and invites renewed questioning or a confrontation.
- Finale: app gives a theatrical killer and crime reconstruction reveal.

**BASELINE PROPOSAL:** One short major public event per act, host-triggered, approximately 30–45 seconds of narration. Guests do **not** need to deliver rehearsed speeches. The script text is in [blackwood-affair.md](blackwood-affair.md).

Optional app social nudges should be authored and context-aware (“You haven't asked Margot about the necklace”), infrequent, accessible and ignorable. No LLM required.

## 8. Accusation, outcome and awards

**BASELINE PROPOSAL:** Each player selects (a) murderer, (b) motive from authored choices, (c) method from authored choices; submission locks immediately; phase is globally locked before reveal. Accusation form must not show answer feedback before reveal.

**Proposed scoring:** Correct murderer = 5 points; correct motive = 3; correct method = 2; max 10. Exclude murderer from detective leaderboard. Distinguish **investigator score** from non-scored social objectives. At reveal, first show accusation breakdown, then murderer/motive/method/timeline/evidence; optionally celebrate best detective, best performance (peer vote) and deceiver.

**OPEN:** Scoring and reward scheme remain unplaytested; whether method and motive menus unintentionally reveal plot facts; whether optional awards or social voting belong in first full MVP; how to treat disconnected/non-voting players; exact vote lock and host participation.

## 9. Acceptance criteria (gameplay feature level)

| Feature | Acceptance criteria |
|---|---|
| Basic game start | Eight unique occupied assignments can enter Act I; unready start is rejected according to configured policy |
| Host-as-player | Host's operational control UI does not display murderer or solution except through the host's **own legitimate character** if assigned that role |
| Content delivery | Each act releases only its authored cards; players cannot retrieve later or other-character cards by changing URLs/API payloads |
| Realtime | Two open devices see changed phase/public releases without manual reload (or recover cleanly on reconnect) |
| Retry safety | Duplicate transition or submission does not duplicate a clue, advance twice or create two accusations |
| Objective freedom | Ignoring objectives does not block the story or prevent release of any essential clue |
| Evidence integrity | Official evidence displays immutable content and is visibly distinguished from character recollection |
| Murderer experience | Murderer sees role truth; others, including host controls, do not prematurely see it |
| Pause | Previously released content stays readable; automatic pacing pauses, then resumes normally |
| Finale | Accusations cannot be modified after accepted/locked; reveal inaccessible until permitted state; results match authored solution |
| In-person playtest | People understand rules, initiate conversations, remain active and find mystery satisfyingly deducible; findings documented |

## 10. Known gameplay risks

- **Social bottleneck:** Quieter players may not share essential testimony; add multiple paths and encouraging prompts, not forced phone checklists.
- **Overly obvious murderer:** Financial evidence may implicate Theodore decisively before finale; alternative motives and misleading but truthful evidence need balance review.
- **Theatrical mismatch:** Some guests dislike public performance; host should be able to read scripts, and confrontations should not demand acting skill.
- **Timeline ambiguity:** Fictional timestamps and real-time act progression must be explained in the story.
- **Host spoiler risk:** Assigning role packages and operating controls must not reveal the culprit; tester/author roles must be separated from host roles.
- **Phone friction:** Repeated prompts can undermine social play; measure actual screen time and trim where needed.
- **Social safety:** Role-play may introduce interpersonal discomfort; a clear out-of-character opt-out/safety norm is an **OPEN proposed addition**, not yet agreed.