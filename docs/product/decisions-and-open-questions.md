# One Killer Party — Decisions and Open Questions

**Status:** Decision register · v0.3 · 2026-11-20  
**Purpose:** The guardrail for autonomous issue-to-PR development. Clarifies **what was selected**, **what was proposed**, and **what remains undecided**.  
**Related:** [Vision](product-vision.md) · [Gameplay](gameplay-specification.md) · [Flows](host-and-player-flows.md) · [Content model](mystery-content-model.md) · [Blackwood affair](blackwood-affair.md)

## 1. Interpretation rules for implementation agents

- `CONFIRMED`: User explicitly chose the option, provided a setup fact, or unequivocally accepted the direction. Implement as documented, subject to engineering/security feasibility.
- `BASELINE PROPOSAL`: Assistant offered a concrete recommendation and built on it in subsequent drafts; **not an irreversible user decision**. An agent may implement a narrowly scoped proposal when its issue explicitly adopts it, but must not represent it as a user requirement.
- `OPEN`: Missing, inconsistent, unvalidated or awaiting business approval. Do not fill silently with invented story, user expectations, cost ceilings, governance or data handling.
- `DEFERRED`: Intentionally out of MVP. Do not add unless a new issue is explicitly approved.
- `USER-REPORTED DONE`: Infrastructure condition user said is complete. Verify actual live behavior when integration tasks depend on it; do not infer credentials, deployment health or service access.

For every scope-bearing issue/PR, reference relevant decision IDs and acceptance tests. If a choice is unresolved, write a short ADR/decision proposal and ask for product-owner review, or use a clearly labeled test-only placeholder without expanding production behavior.

## 2. Confirmed decisions

| ID | Decision | Source of authority / implication |
|---|---|---|
| `D-001` | Product is **One Killer Party**, an app-based murder mystery party platform | User's product concept |
| `D-002` | Primary audience: **adults hosting parties with friends** | Explicit user selection |
| `D-003` | Guest participation: primarily **in person**, phones as companion devices | Explicit user selection |
| `D-004` | **App guides** the game; **host can intervene** | Explicit user selection |
| `D-005` | **Minimal AI in MVP**; great playable game first | Explicit user selection |
| `D-006` | **Murderer knows** they committed the murder | Explicit user selection |
| `D-007` | **Host assigns characters** before the party | Explicit user selection |
| `D-008` | First mystery is a **placeholder** to build/test mechanics | Explicit user selection |
| `D-009` | **Hybrid clue discovery** | Explicit user selection |
| `D-010` | **Balanced theatrical** experience: natural mingling plus short public dramatic moments | Explicit user selection |
| `D-011` | Host can participate as a player without host control inherently revealing answer | Accepted design direction throughout refinement; implement as core privacy goal |
| `D-012` | Essential evidence is released by progression rather than gated behind social-mission completion | Recurring agreed design rule of hybrid gameplay |
| `D-013` | Guests may lie/bluff/conceal but must not alter authentic app-issued evidence | Repeated established rule |
| `D-014` | Mac + VS Code + AI coding tools for development | Explicit user selection |
| `D-015` | User owns a domain and prefers **marketing root + app subdomain** | Explicit user choice |
| `D-016` | DNS for that domain was reported configured | User report; exact string/provider/verification not recorded |
| `D-017` | The user reported all eight initial setup tasks completed (local Next.js, GitHub, Supabase dev, env vars, landing page, Vercel) | User report; integration functionality not independently tested here |
| `D-018` | GitHub is to support an autonomous **issue → implementation → PR → review/merge** portfolio workflow, with spec in repo | User's explicit goal in this request and project context |
| `D-019` | Keep this product spec as six version-controlled Markdown files under `docs/product/` | Explicit user request |
| `D-020` | Host authentication uses **Supabase email magic links**. Redirects and email-delivery configuration must be environment-scoped. | Product owner selection, 2026-11-20; resolves `O-001`; implementation remains subject to security testing |
| `D-021` | Guests use independent low-friction authenticated identities and **host-assisted recovery** when an existing guest session is lost; joining by code/name never transfers an existing membership. | Product owner selection, 2026-11-20; resolves recovery direction in `O-002`; exact token/session mechanics remain engineering design |
| `D-022` | Host **may choose to play or not play**; the first Blackwood mystery has **eight player-character slots total**, including the host only when explicitly enrolled as a player. Host operational privileges must not expose solution/private dossiers. | Product owner selection, 2026-11-20; resolves `O-003` and adopts exactly-eight Blackwood first-playtest scope from `P-001` |
| `D-023` | Public character identity is visible on assignment; the assigned guest receives their **starting private dossier before the game starts**. Future-act clues, knowledge and revelations remain gated by authored release phase. | Product owner selection, 2026-11-20; resolves `O-006` at the policy level; exact preparation lead time is not fixed |
| `D-024` | For the first Blackwood lobby, share one **reusable invitation link and equivalent eight-character easy-to-type code**. Valid only while party admission is open (until game start); host may revoke/regenerate it. Use cryptographically random code selection, rate limiting, nonrevealing failures and server-side verifiers. The join credential may enroll multiple distinct guests but cannot recover/take over an existing guest; recovery credentials are distinct, short-lived and single-use. | Product owner approval, 2026-11-20; resolves invitation policy of `O-004`. Exact alphabet, entropy safeguards and throttling are security implementation details |
| `D-025` | First Blackwood game admits eight player participants, host counted only when playing; guest identities are unique independently of names. Duplicate display names are allowed, but disambiguated in host UI. Host may remove/replace guests and change role assignments **before** game start with confirmation when affecting an assigned role. Once started, deny new participants and ordinary role changes; existing authenticated members may reconnect or use approved host-assisted recovery. | Product owner approval, 2026-11-20; resolves `O-004` and `O-005` for first prototype, not a platform-wide limit or later-game recovery/replacement policy |

**Caution on D-011–D-013:** They are stable, repeatedly stated design requirements, but specific UI details, automatic gates and exact schema remain proposals/open items.

## 3. Baseline proposals already discussed

| ID | Proposal | What it implies / what is NOT yet confirmed |
|---|---|---|
| `P-001` | First full Blackwood prototype is **exactly 8 players** | **Adopted for first Blackwood game via D-022**; 6–10 remains future roadmap without authored variants |
| `P-002` | Game lasts ~90 minutes, Act I 20, Act II 25, Act III 25, finale 20 | Suggested pacing only; no forced automatic transitions |
| `P-003` | Three acts, accusation phase, reveal, completion | Specific phase enum and locking implementation open |
| `P-004` | One authored Blackwood mystery, Edmund as NPC victim, Theodore as culprit | Story draft created in conversation; needs narrative/editorial signoff |
| `P-005` | Three short host-readable public events plus theatrical final reveal | Scripts are draft content, subject to playtest |
| `P-006` | Each character gets 2–3 social missions per act, roughly one investigative, one interpersonal, one personal | Only initial mission examples are authored; full matrix not done |
| `P-007` | Six public and eight private clue/knowledge cards in draft Blackwood | Content exists but epistemic labels and continuity need review |
| `P-008` | Guests join by link / six-character code without email registration | **Superseded by D-024:** an eight-character, easy-to-type code and reusable invitation link; guest auth direction D-021 |
| `P-009` | Host uses email login and guests use anonymous authenticated sessions | Host magic-link authentication and low-friction guest identity/recovery direction adopted via D-020/D-021; specific guest Supabase auth/session implementation remains to be validated |
| `P-010` | Use Next.js/React/TypeScript, Tailwind, Supabase/Postgres/Auth/Realtime, Vercel, GitHub | Stack selected in setup dialogue; detailed deployment/data model open |
| `P-011` | Server-side state machine with optimistic version and transactional, idempotent releases | Core engineering direction; exact implementation/API contract open |
| `P-012` | Guest sections My Character, My Clues, Party, Accusation; host adds Control | UI design proposal; routes, styling and navigation open |
| `P-013` | Host can start/pause/resume/advance/extend/launch accusations/reveal | Intervention direction confirmed; exact controls, permissions and pause semantics proposed |
| `P-014` | Accusation chooses suspect, motive, method; one final immutable submission | Form and lock policy not separately approved |
| `P-015` | Detective score = 5 murderer + 3 motive + 2 method; murderer excluded | Provisional, not evaluated against mystery difficulty |
| `P-016` | Murderer wins if no nonkiller identifies them; optional end awards | Outcomes not finalized |
| `P-017` | Versioned content packages, server-only solution and a public/role/host projection model | Architecture direction; storage mechanism open |
| `P-018` | Local + PR preview + production-facing web deployment, separate dev/prod Supabase projects | Only a Supabase **development** project was reported set up |
| `P-019` | Public root marketing site and `app.` gameplay subdomain | Structure preferred; separate deployments/codebases not required |
| `P-020` | Content review, authorization tests and eight-person playtest before calling mystery ready | Quality gate proposed and strongly recommended |
| `P-021` | Dark charcoal/gold/burgundy visual direction with optional Art Deco / 1920s aesthetic | Visual concept, no finalized brand system |
| `P-022` | A guest uses app only ~5–10 minutes in a 90-minute party | An experiment target, not observed or enforceable |
| `P-023` | Host setup under 10 minutes | An experiment target, not observed |
| `P-024` | Public repo eventually to showcase technical and AI-augmented workflow abilities | Visibility date, asset/license/public content strategy OPEN |

## 4. Open questions — prioritize before engineering work

### Resolved lobby/auth decisions (2026-11-20)

Owner-approved decisions: `O-001` → `D-020` (host email magic links), `O-002` → `D-021` (guest identity with host-assisted recovery), `O-003` → `D-022` (optional playing host, eight Blackwood player slots), `O-006` → `D-023` (public assignment and pre-start private dossier; future-act material remains gated), `O-004` → `D-024` and `D-025` (shared invitation and capacity/names), and `O-005` → `D-025` (join/removal/reassignment policy). These supersede the corresponding awaiting-approval entries in the proposed ADR in PR #14. Invitation/capacity and lifecycle policies in `O-004` and `O-005` were subsequently approved as `D-024` and `D-025`; see above. Technical implementation must still be reviewed and tested.

### Remaining blockers for lobby/auth implementation

| ID | Question | Why it matters | Proposed default for discussion (NOT decided) |
|---|---|---|---|
| `O-007` | Is the app subdomain live via HTTPS and which production Supabase project, if any, backs it? | Deployment and secret scopes | Verify without changing DNS |
| `O-008` | Exactly which existing GitHub workflows, branch protections and CI checks must a new PR satisfy? | Autonomous coding agents must follow established repo process | Inspect repository workflow/docs first |

### Blockers for full mystery and state engine

| ID | Question | Why it matters | Proposed default for discussion (NOT decided) |
|---|---|---|---|
| `O-009` | How do fictional timeline (8:30–9:30) and real Act I mingling coexist? | Dossiers mention future fictional events | Treat fictional events as already occurred for retrospection, or gate recollections by act |
| `O-010` | Exact layout/direction of garden footprints and conservatory route? | P03 and witness statements need consistency | Author a simple canonical map before locking clue text |
| `O-011` | When/where does Eleanor obtain authoritative injury findings? | Plausibility of forensic content by Act II | Make a defensible medical observation or later report |
| `O-012` | Why is Clara's 9:20 sighting revealed to her at Act III and not earlier? | A role cannot forget something it witnessed | Deliver newly contextualized recollection with explanation |
| `O-013` | Are C03/C05/C06/C07/C08 evidence cards, rumor or character knowledge? | Truth claims and UI label | Prefer typed knowledge unless a verifiable artifact exists |
| `O-014` | Is the chain of evidence fair if key witnesses withhold information? | Essential solvability | Playtest and author independent corroboration if needed |
| `O-015` | Does Act III expose Theodore too decisively? | Mystery tension | Playtest and add only approved, truthful alternative suspicions |
| `O-016` | What are complete per-act objectives and relationships for eight roles? | Repeated interaction and equality of participation | Author in a dedicated content issue before playtest |
| `O-017` | How is missing-vote/abandoned-device handling performed? | Accusation lock and ending | Host sees pending count and explicit force-lock only with warning |
| `O-018` | Are accusation answers irrevocable? Can host undo a phase or reveal? | Data model, UI states and fairness | Irrevocable submission, one-way reveal |
| `O-019` | What is the minimal set of motive/method options and final scoring? | Multiple-choice hints risk spoiling deduction | Start with 5/3/2, evaluate after playtest |
| `O-020` | Should optional side clues or public confrontation choices affect game state? | Branching complexity | No branching state in v0.1; social-only optional objectives |
| `O-021` | Is a pause allowed during accusations/reveal? What do clocks do? | State machine precision | Pause affects pacing in acts only |
| `O-022` | What should players do if content or social interaction becomes uncomfortable? | Accessibility and participant trust | Add out-of-character safety/opt-out norm |

### Infrastructure, product and governance questions

| ID | Question | Why it matters | Proposed default for discussion (NOT decided) |
|---|---|---|---|
| `O-023` | Full owned domain name, DNS provider and future marketing site architecture? | Avoid disruptive DNS edits | Keep app subdomain and current Vercel project |
| `O-024` | Does Vercel plan permit the intended noncommercial/commercial usage and what budget applies? | Hosting/license/expense | Confirm current plan before paid use |
| `O-025` | Separate production Supabase, migration strategy, backups and failure recovery? | Real party reliability | Use separate dev/prod projects before public live play |
| `O-026` | Mystery package storage: server-only JSON, SQL normalized tables or hybrid? | Secret deployment, authoring, schema migration | Pick a server-authoritative storage plan in ADR |
| `O-027` | What should be public in portfolio repo vs private story/brand/IP? | Show technical ability without leaking the killer or original story asset rights | Make explicit public-release/redaction decision |
| `O-028` | Whether the wife/product co-creator has editorial approval over gameplay/story/branding? | Product ownership and expectations | Establish named content reviewer |
| `O-029` | Will data retention, analytics and guest privacy policies be needed at MVP? | Trust and commercial readiness | Minimize PII and set a basic retention policy |
| `O-030` | Accessibility baseline and supported devices/browser versions? | Broad mobile usability | Define minimum modern mobile browser matrix |
| `O-031` | How does an agent obtain permission for production schema changes and live deployments? | Autonomous issue-to-PR guardrail | Require PR review + migration review |
| `O-032` | What commercial model and audience expansion are desired? | Later architecture and product scope | Defer until first playtest |

## 5. Deferred by choice

| ID | Deferred feature |
|---|---|
| `F-001` | AI-generated mystery or fully personalized canon |
| `F-002` | AI game master, chatbot/narrator/hint bot |
| `F-003` | In-app payments, monetization, subscriptions |
| `F-004` | Native iOS/Android clients |
| `F-005` | Remote-only online gameplay |
| `F-006` | In-app guest messaging/trading/proof of completed social missions |
| `F-007` | Physical scavenger hunts, QR clue triggers, geolocation |
| `F-008` | Broad library/marketplace or author-facing CMS |
| `F-009` | Sophisticated social scoring, competitive leaderboards and engagement analytics |
| `F-010` | Mandatory TV / shared-screen game interface |
| `F-011` | Fully supported variable party sizes 6–10 for *The Blackwood Affair* |

## 6. Known narrative and technical risks

| Risk | Severity (qualitative) | Mitigation / gating evidence |
|---|---|---|
| Premature solution access via client bundle/API/host privileges | Critical | Threat model; server-only projections; automated negative authorization tests |
| Lost anonymous session enables role impersonation | High | Per-guest credential, safe recovery workflow and tests |
| Unreliable clue release across reconnect/retries | High | Transactions, release IDs, idempotent transitions, state re-fetch |
| Story clock contradicts act/player knowledge | High for immersion | Editorial continuity review before full playtest |
| Players withhold key testimony, making solution impossible | High for game quality | Independent evidence paths; eight-person playtest |
| Act III too strongly reveals Theodore | Medium–high | Mystery balance review; track accusation accuracy and perceived fairness |
| Host burden distracts from participation | Medium–high | Spoiler-free controls, short scripts and minimal prompts |
| Too much screen time | Medium | Test screen-time goals, reduce UI demands |
| Unapproved scope creeps into agent PRs | High for execution | Small issues, spec references, review gates and explicit decision records |
| Public GitHub repo leaks proprietary or spoiler content | High for product/portfolio | Decide publication strategy; separate authoring content when required |
| Free hosting pauses or production failures disrupt a party | High when commercial | Hosting tier/ops planning and rehearsal before paid events |

## 7. Agent workflow and change-control conventions

1. **Read these six files before creating implementation issues.** Use product vision and gameplay spec for intent; flow spec for UX; content model for boundaries; Blackwood for authored data; this register for uncertainties.
2. **For each issue**, state the precise user story, acceptance criteria, required migrations, authorization checks, test plan, referenced decision IDs and out-of-scope behavior.
3. **Do not implement an open question by guesswork.** When an issue depends on it, flag the dependency and propose options in the PR/issue or write an ADR for explicit approval.
4. **PRs must include:** summary, tests performed, security/spoiler impact, migrations/deploy implications, relevant spec updates and unresolved limitations. Preserve repository CI, review and branch protections.
5. **Keep authored story content versioned and unspoiled.** A documentation repo may contain the full canonical spoilers (as this folder does); public access, deployed bundling and package disclosure require an explicit IP/security decision.
6. **After a product decision**, move it from OPEN/PROPOSAL to CONFIRMED with a dated rationale, update affected specs, and reference the reviewing issue/PR. Avoid contradictory parallel source-of-truth claims.
7. **After a playtest**, record observations separately from decisions; only change canonical content through reviewed versioned changes.

## 8. Suggested first issues (not code authorization)

| Priority | Issue scope | Dependencies and definition of done |
|---|---|---|
| 0 | Verify actual repo, preview/prod workflow, Vercel subdomain and Supabase env separation | Verify `O-007`, `O-008`, `O-025`, no secrets committed |
| 0 | Auth/guest recovery ADR | Resolve `O-001`, `O-002`, `O-003`, `O-004`, `O-005` enough for lobby |
| 1 | Party creation and basic lobby | Host creates + guest joins securely; no solution data in responses |
| 1 | Character assignment with public-only host roster | Unique assignments, safe projections, race-condition tests |
| 1 | Game state engine and release contract | Versioned transitions, public/private visibility tests |
| 2 | Player dossiers and current act/clue UI | Respect unlock schedule and typed evidence/knowledge |
| 2 | Accusation/reveal decision & implementation | Resolve `O-017`–`O-019`; test reveal gate |
| 2 | Blackwood content editorial pass | Resolve `O-009`–`O-016`; review canonical story and complete objective matrix |
| 3 | Eight-person real-world playtest | Record observed engagement, fairness, usability and revised content decision |

## 9. Summary of what's *not* decided yet

**Do not assume** the exact recovery-token mechanism or security parameters for invitation entropy/throttling, paid hosting tiers, production DB, exact root-domain name, handling missing voters, final scoring, fictional-time framing, complete cast objective matrix, forensic detail provenance, content storage design, public repo disclosure policy or commercial pricing have already been approved. Treat them as explicitly open until recorded otherwise.