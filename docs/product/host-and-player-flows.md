# One Killer Party — Host and Player Flows

**Status:** Draft implementation baseline · v0.3 · 2026-11-20  
**Related:** [Vision](product-vision.md) · [Gameplay rules](gameplay-specification.md) · [Content model](mystery-content-model.md) · [Open decisions](decisions-and-open-questions.md)

## 1. Principles of the user experience

**CONFIRMED:** In-person adults; phones are companions; the **host assigns** roles, and the **host can also play**. The host can intervene in pacing without seeing the solution through operational controls. **CONFIRMED:** The murderer knows; hybrid clue release, balanced public scenes. **BASELINE PROPOSAL:** Host signs in with email, guests join without email registration and can rejoin their session.

Do not confuse these three identities/scopes:

- **Application host:** Authorized to configure/manage the *party*, not edit mystery truth or view all private content.
- **Participant:** Authorized to view their own assigned character, current public content and personally released cards.
- **Mystery content author/admin:** Outside normal party controls; may edit canon and therefore can know the solution. A host should **not** be granted author access just to run a party.

If one person is host **and** participant, they hold separate scopes and should see a clear switch between *Host Control* and *My Character*. The player's own assigned murderer information is visible only if they legitimately play the murderer.

## 2. Primary screen inventory

| Route/screen (illustrative; URL not confirmed) | Audience | Purpose / data needed | Spoiler discipline |
|---|---|---|---|
| Marketing landing `/` | Anyone | Product promise, create/join entry | No private/game truth |
| Host sign-in | Prospective host | Authenticate host | No game truth |
| Create Party | Host | Choose available mystery, create instance | Public mystery metadata only |
| Invite/Share | Host | Share code/link, see invited/joined guests | Do not embed private player credentials in public invite |
| Lobby / Host Control | Host | Attendance, public character roster, assignments, readiness, start | No killer flag, solution or unreleased clues |
| Join Party | Guest | Enter code (or follow link) and display name | No guest list secrets |
| Waiting Lobby | Guest | Confirmation and safe pre-party status | Do not show others' private profiles |
| My Character | Assigned guest | Own public/private profile, objectives, knowledge | Never preload other roles |
| Party / Current Act | All participants | Phase, released public announcement and public evidence | Never preload future content |
| My Clues | Assigned guest | Own released clues/knowledge with provenance labels | Filter per role and release state |
| Host Controls | Host | Pause/resume, time suggestion, advance, readiness, accusation control | Operational only |
| Accusation | Each participant | Choose suspect, motive, method; submit | No feedback or answer before reveal |
| Reveal / Results | Participants after gate | Canon, timeline, optional scores/awards | Only after authorized reveal |
| Shared display *(optional)* | Guests looking at a communal device | Public announcement/reveal | No private guest or solution before reveal |

Actual routing, component naming and whether host/guest share the same session shell remain implementation choices. Do not create a mandatory dedicated-TV experience.

## 3. Host journey — happy path

### Flow H1: Create and prepare

1. Host opens the deployed web app on Mac or phone, signs in using the proposed host authentication method.
2. Host selects *The Blackwood Affair* from the available mystery catalog (only one in first prototype).
3. App displays **public** synopsis, intended exactly-eight-player count, duration estimate and play format. The host must not see the private killer/answer key.
4. Host creates a party. Backend creates a party with pinned mystery version, status `LOBBY`, host ID and a unique invitation code/link.
5. Host shares link/code through any external messaging channel (in-app messaging is not MVP).
6. Guests join and appear as separate participants. Host can see display names and connection/ready state (if implemented).
7. Host assigns exactly one **unique** public character identity to each guest. The assignment interface may list all eight roles and their spoiler-safe public profiles.
8. The app checks readiness: eight distinct roles assigned to eight eligible participants, including the host if they are playing.
9. Host opens a spoiler-free host guide, reads the Act I welcome script and starts the game.

**Acceptance:** Host can create a party and invite by link/code; no host-only API request can retrieve the murderer, solution or other characters' private dossiers; conflicting role assignments are rejected server-side; lobby state stays synchronized across devices.

### Flow H2: Run a party while participating

1. After `START_GAME`, `ACT_1` public content is released and private role content is visible only to assigned players.
2. Host switches from operations view to their own character screen for ordinary play.
3. App shows **suggested**, not mandatory, pacing and a spoiler-free “next scene” action.
4. At a convenient moment, host gathers guests, reads a short public script, and advances to Act II. Atomic release makes Act II public/private content available to permitted viewers.
5. Host can pause/resume pacing or extend suggested act duration if mingling is lively; no unreleased clue becomes visible due merely to pause/extend.
6. Host repeats process for Act III, then opens accusations when ready.
7. After accusation handling and locking, host triggers finale; reveal is visible to everyone including the host.
8. Host marks the game complete and may solicit out-of-game feedback.

**Acceptance:** All host operations use server-side authorization. An authorized act change does not require the host to know future content; double-clicks, browser refreshes and realtime retries do not skip an act.

### Flow H3: Host intervention and recovery

- **Pause:** Stop countdown/advisory prompts; current clues remain available. No retroactive concealment.
- **Extend:** Increase suggested schedule without altering canonical progression.
- **Resend/refresh:** The UI may re-alert participants to already-authorized information; it must never duplicate the underlying logical release.
- **Late guest / dropped connection:** Guest should rejoin the same identity without a new character assignment. Handling of **new** late participants after start is OPEN.
- **Missing vote:** Host needs a safe way to see count of submitted accusations **without** seeing suspect choices before lock/reveal. Whether force-lock is permitted is OPEN.
- **Host loses device:** Recovery requires reauthentication; knowing the invite code alone cannot confer host controls. Recovery UX is OPEN.

## 4. Guest journey — happy path

### Flow P1: Join and receive role

1. Guest taps invitation link or enters the confirmed **eight-character** reusable invitation code (D-024).
2. App requests a display name; guest does not need conventional account registration.
3. Guest receives an independent authenticated identity/session. An invite code by itself grants **party entry**, not permission to view a specific participant's secrets.
4. App confirms membership and displays waiting-lobby instructions.
5. When host assigns a character, guest sees **their own** public intro and an **approved spoiler-safe starting private dossier** during LOBBY; role-only future knowledge remains gated. Under D-028 even the murderer does **not** see guilt, method, real chronology or cover story until the host starts ACT_1. Current placeholder parties have no private dossiers; this applies once a published private package is deployed.
6. Guest is offered concise instructions: in-person play, lie/bluff allowed, official clues immutable, objectives optional, respect each other's devices.
7. Guest may view costume suggestions or opening conversation prompts if authored.

**Acceptance:** A second guest with the same party code cannot access the first guest's dossier or assume their identity. Refresh/reconnect restores the correct role using the guest's session (or safe recovery process).

### Flow P2: Play the three acts

1. At Act I start, guest reads an opening objective; moves around the physical party to talk to other characters.
2. Guest sees public announcements and their own unlocked knowledge on their phone; app remains otherwise quiet.
3. At Act II, a new public scene is announced; previously gated evidence is unlocked for the correct audience. Guest may compare evidence verbally or show their own clue card.
4. At Act III, guest receives additional facts/objectives and re-evaluates earlier claims. Public document reveal prompts renewed conversation.
5. Guest is not required to record completed objectives, reveal secrets, or stay on screen to progress.

**Acceptance:** Guest can navigate among **My Character**, **My Clues**, **Party**, and **Accusation** (accusation section gated until phase). App clearly differentiates official evidence, recollection and personal secret. No spoiler leaks on navigation/reload/direct URLs.

### Flow P3: Accuse and see reveal

1. Host opens accusation phase; guest sees eligible suspects and authored motive/method choices.
2. Guest submits one accusation selecting all required fields. The app confirms receipt **without grading**.
3. Guest waits while others finish; changing a submitted answer is disallowed under baseline rule.
4. Host locks phase, then triggers reveal; guest sees vote distribution, killer, motive, method, reconstruction and optional detective score.
5. After finale, guest can discuss performance and share memories; no required social metrics are recorded in-app.

**Acceptance:** A guest cannot submit prior to opening or after lock; cannot submit for another guest; cannot inspect secret correct choices before reveal. Retries do not generate duplicate submissions.

## 5. Murderer journey — additional considerations

- When the host starts ACT_1, the correctly assigned murderer receives an unmistakable **private** murderer notice, motive, method, real chronology and suggested cover story. Before ACT_1 the participant sees only an approved **nonrevealing** starting dossier.
- The murderer gets ordinary app navigation and public clues as any other guest.
- The murderer may lie in conversation; their private “remember hiding the statuette” is **personal knowledge**, not independently verified official evidence.
- Host **assigns Theodore via public profile** but should not be told Theodore is the murderer. The host may become the murderer if self-assigned; that is permitted as normal character access.
- **CONFIRMED D-028 (2026-11-22):** Murderer knowledge is released at the authorized ACT_1 start, never on role assignment or in the LOBBY dossier. Editorial review must revise/gate any existing draft dossier details that would reveal guilt before then; no text is silently rewritten in this architecture PR.

## 6. Error and edge-case behavior

| Scenario | Required behavior / proposal | Status |
|---|---|---|
| Invalid/expired join code | Show nonrevealing error, allow retry | Baseline proposal |
| Two guests choose same display name | Preserve distinct auth identities; display-name uniqueness policy OPEN | Partly defined |
| Eight roles assigned, but fewer than eight distinct participants | Block first complete playtest start, rather than invent filler roles | Baseline proposal |
| Two hosts attempt same action | Server authorization plus atomic version check; one transition only | Required engineering invariant |
| Host assigns occupied role | Conflict; client refreshes authoritative roster | Required engineering invariant |
| Lost guest session | Do not reveal private role via public code; host-assisted recovery mechanism OPEN | Security requirement + open UX |
| Guest joins after start | Policy OPEN (deny, spectate or controlled late entry) | OPEN |
| Guest leaves game | Existing role persists; rejoin supported; replacement policy OPEN | Partly defined |
| Realtime temporarily unavailable | Refresh/fetch phase and authorized content; never depend on delivery ordering for secrecy | Required engineering invariant |
| Host pauses while clue visible | Content stays visible; pacing paused | Baseline proposal |
| Accusation incomplete | Reject, show field-level feedback; no partial submission accepted | Baseline proposal |
| Guest fails to vote | Host readiness shows pending count; timeout/force-lock policy OPEN | OPEN |
| Player navigates to `/reveal` early | Server denies before authorized state | Required |
| Same person host + guest | Respect both scopes separately; no unintended secret superuser privileges | Required |
| 6 or 10 players request Blackwood | Show unsupported player count for v0.1; do not silently scale cast | Baseline proposal |

## 7. Guest authentication / privacy boundary

**Selected direction, not finalized configuration:** Host email authentication; guest low-friction anonymous authenticated identity (Supabase Auth anonymous users proposed). Backend should issue an individual session and enforce access to a party/character. Credential persistence and recovery rules need explicit design before the feature ships.

- Party code is a **discovery/join token**, not a substitute for authenticated access to private information.
- Validate all party/role/phase claims against durable server state.
- Apply row-level security and/or server-side access enforcement consistently; privileged server credentials never enter browser bundles.
- Do not transmit secret character metadata via realtime broadcasts.
- Avoid unredacted logs, analytics payloads or error traces that include unpublished mystery solutions or player private dossiers.
- A host-facing roster must not include a boolean `is_murderer`, hidden role type or solution field.

## 8. Detailed acceptance scenarios for issue-to-PR development

1. **Create:** Given an authenticated host and a supported mystery, when host creates a party, then a unique code and pinned content version are stored, and a clean share link is returned.
2. **Join:** Given an active lobby and valid join credential, when a guest enters a display name, then one authenticated participant is created and becomes visible in the host lobby.
3. **Isolation:** Given two guests assigned different characters, when either requests the other's private data directly, then access is denied and no data is emitted.
4. **Assign:** Given host authority and one available character, assignment succeeds; duplicate or cross-party assignment is rejected.
5. **Host blind:** Given a host assigned a nonkiller role, when they operate their host controls, then their API responses and visible UI contain no killer indication.
6. **Start:** Given eight distinct occupied roles and readiness conditions, start creates Act I event and releases only permitted content once.
7. **Advance:** Given current Act I, when host advances, then Act II and all Act II-authorized content become visible; issuing the same request again cannot jump to Act III.
8. **Reconnect:** Given guest device disconnect, when session returns, their assigned role and released clues are identical to canonical state.
9. **Accuse:** Given open accusation phase, when guest submits valid fields, exactly one immutable accusation is stored; no pre-reveal correctness is returned.
10. **Reveal:** Given accusations locked and authorized host initiation, solution becomes available; before that point, direct access fails.

## 9. UI copy standards (proposals)

Use short plain-language actions: **Create a party**, **Join a party**, **Your character**, **Your clues**, **Current act**, **Host controls**, **Advance to Act II**, **Make your accusation**, **Reveal the truth**. Avoid labels that imply guests must complete social tasks. Use accessible contrast, touch-sized targets and graceful small-screen layouts. Creative noir/art-deco palette (dark charcoal, gold and burgundy) is a **visual proposal**, not an approved brand standard.

## Approved M2.2 lobby flow (D-030–D-035)

The host creates a party using the active published version, or a legacy lobby if no version is active. Existing parties never change pins. Once assigned in a published lobby, a participant can deliberately open **My Character** from the lobby to read their private starting biography, relationships and preparation prompts. Unassigned participants wait; legacy participants see public information and a neutral unavailable explanation. A playing host uses the same participant view; host controls remain public-only. Reassignment or clearing requires the existing confirmation with a warning that previously read secrets cannot be recalled. Removal, reassignment and recovery invalidate subsequent access; the UI clears stale private content on reconciliation. No read receipts, explicit dossier release step or game start in M2.2. See the [approved architecture](../architecture/mystery-content-architecture.md) for authorization and delivery rules.
