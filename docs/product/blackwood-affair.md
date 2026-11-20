# The Blackwood Affair — Complete Prototype Mystery Baseline

**Status:** Draft, **NOT yet playtest-certified** · v0.3 · 2026-11-20  
**Classification:** **CONTAINS FULL MURDERER AND SOLUTION SPOILERS.** This is **author/developer documentation**. Do **not** serve this file to guest or operating-host browsers, import it into a client-side bundle, or expose it in public deployment builds.  
**Related:** [Gameplay](gameplay-specification.md) · [Content model](mystery-content-model.md) · [Flows](host-and-player-flows.md) · [Decisions](decisions-and-open-questions.md)

> This document preserves the authored storyline, details and draft scripts from the prior design conversation. It is a **complete baseline of the story information agreed so far**, **not** a claim that every playable dialogue, optional objective, relationship, alternate suspect arc or clue artifact has been finalized. Sections 11–13 list the gaps and consistency issues explicitly; don't auto-fill them without review.

## 1. Public setup (safe for prospective hosts and guests)

**Title:** The Blackwood Affair  
**Working subtitle:** An evening of secrets, scandal, and murder at Blackwood Manor  
**Setting:** Blackwood Manor, 1928  
**Players:** Exactly **8 playable characters** in the first fully authored prototype  
**Victim:** Edmund Blackwood, a **non-playable** wealthy industrialist  
**Expected duration:** About 90 minutes, including 20/25/25 minutes across three acts and ~20 minutes for accusations/reveal; flexible, host-controlled  
**Style:** Balanced theatrical—mostly informal in-character mingling with short public host read-alouds  
**Delivery:** In-person gathering with mobile web companions; no required props beyond phones

**Spoiler-free invitation copy:**

> It's 1928. Eight guests have gathered at Blackwood Manor at the invitation of wealthy industrialist Edmund Blackwood. Edmund has promised a shocking announcement that will change several lives. But before he can deliver it, he's discovered dead in his study. Every guest has a motive. Everyone has a secret. And one of them knows exactly what happened.

**Authoring note:** The public invitation mentions an impending murder; characters' initial in-story knowledge before the Act II reveal remains an open chronology detail.

## 2. Public cast and role assignment cards (spoiler-safe)

The host assigns **these public identities only**; there must be no `isMurderer`, guilty flag, solution-only relationship or other spoiler field in the host's assignment response.

| ID | Public name | Archetype | Public description |
|---|---|---|---|
| `vivienne` | Vivienne Blackwood | The Disgraced Heiress | Edmund's estranged daughter, recently returned to reclaim her place in the family. |
| `theodore` | Theodore Vale | The Ambitious Partner | Edmund's business associate, whose fortunes are closely tied to the Blackwood empire. |
| `margot` | Margot Sinclair | The Society Darling | A glamorous guest whose connection to Edmund has long fueled rumors. |
| `arthur` | Arthur Pembroke | The Family Solicitor | Keeper of the Blackwood family's legal affairs and uncomfortable secrets. |
| `clara` | Clara Whitmore | The Loyal Housekeeper | Keeper of the manor for twenty years, with knowledge of everyone's habits. |
| `julian` | Julian Cross | The Investigative Journalist | A newspaper reporter invited under circumstances nobody quite understands. |
| `eleanor` | Dr. Eleanor Finch | The Family Physician | Edmund's longtime doctor, familiar with his declining health and personal affairs. |
| `sebastian` | Sebastian Reed | The Decorated Veteran | A family friend whose loyalty to Edmund has recently come into question. |

No assignment preferences by gender, costume availability, acting experience or character intimacy boundaries have been selected. Costume suggestions were mentioned as a potential enhancement, but not authored.

## 3. AUTHOR / SERVER ONLY — canonical solution

**Murderer:** Theodore Vale (`theodore`).  
**Motive:** Cover up embezzlement/unauthorized transfers from Blackwood Industries after Edmund discovered the fraud.  
**Method:** Fatal blunt-force blow with a heavy brass horse statuette.  
**Crime location:** Edmund's study at Blackwood Manor.  
**Escape:** Through the study's garden door, then back into the drawing-room social area via the conservatory.  
**Cover story:** Theodore claims to have been in the conservatory throughout 9:00–9:20 p.m. reviewing business correspondence.  
**Proposed answer-key IDs:** `theodore` / `financial` / `blunt` (IDs in example UI, not final persisted schema).

**True sequence:** Edmund learned Theodore had embezzled from the company. Edmund planned to announce an independent audit and remove Theodore. Theodore confronted him in the study at 9:10 p.m., struck him at 9:12 with the statuette, wiped and concealed the weapon behind a study curtain, left through the study's garden door at about 9:14, and returned via the conservatory at 9:20. His alleged uninterrupted presence in the conservatory is false.

**Intended deduction:** Motive (audit memo/shell-company link) + opportunity (sighting near study and compromised alibi) + means (forensic blunt-force evidence and hidden statuette) + physical route (unlocked garden door, muddy footprints, study–garden–conservatory connection) form the cumulative case. No single private eyewitness must be trusted blindly. **Warning:** The current content is not yet proven to be sufficiently independent if the strongest eyewitnesses remain silent.

## 4. AUTHOR / SERVER ONLY — fictional event timeline

These are **story-clock times**, not real-world minutes after a host clicks Start.

| Fictional time | Canonical event | Witness/known source |
|---|---|---|
| 8:30 p.m. | Guests gather at Blackwood Manor | Public context |
| 8:40 p.m. | Eleanor consults with Edmund, observes him alive and alert | Eleanor private knowledge |
| 8:45 p.m. | Edmund tells Arthur that an audit will be announced | Arthur private knowledge |
| 8:55 p.m. | Vivienne argues with Edmund over her inheritance | Vivienne private knowledge |
| 8:58 p.m. | Vivienne leaves Edmund alive | Vivienne private knowledge |
| 9:00 p.m. | Edmund retreats to his study | Canonical timeline |
| 9:05 p.m. | Margot sees Theodore heading toward the study corridor | Margot private knowledge |
| 9:10 p.m. | Theodore confronts Edmund in the study | Murderer truth |
| 9:12 p.m. | Theodore strikes Edmund with brass statuette, killing him | Murderer truth |
| ~9:14 p.m. | Theodore exits study through garden door; weapon concealed behind curtain | Murderer truth |
| ~9:16 p.m. | Clara hears garden door latch and notices muddy footprints near study | Clara private knowledge |
| ~9:20 p.m. | Theodore returns through conservatory toward drawing room | Sebastian and Clara recollections (details below) |
| 9:25 p.m. | Clara discovers Edmund's body in study | Clara / public report |
| 9:30 p.m. | Murder is announced to assembled guests | Public narrated event |

**Continuity issue requiring author review:** The table says Clara “notices muddy footprints near study” at 9:16, while P03 claims footprints lead *from study toward garden* and some narrative descriptions imply the tracks lead back toward the conservatory. Directionality, physical footprint evidence and exact location should be reconciled before writing an official P03 card. Distinguish investigator inference from a verified physical observation.

**Continuity issue:** If Act I opens with guests mingling at fictional 8:30 but their dossiers already contain memories from 9:05–9:25, players could mention future events. Need explicit **pre-party vs per-act knowledge release gating** or a framing statement that each act stages a retrospective reveal rather than live clock time. See [decision register](decisions-and-open-questions.md).

## 5. The eight character-private dossiers (current canonical drafts)

### Vivienne Blackwood (`vivienne`)

- **Private secret:** Threatened to expose Edmund's treatment of her mother unless he restored her inheritance; had a heated argument with him at 8:55 p.m.
- **Personal knowledge:** Edmund planned a major change to his will. She saw him alive when she left the study at 8:58.
- **Current authored objectives:** Conceal the argument; question Arthur about the will; convince another guest she deserves her inheritance.
- **Later knowledge / Act III:** Learns the financial audit could have affected someone outside the family.
- **Act II assigned card:** C01, a copy of the will showing Edmund planned to reduce her inheritance.
- **Motive for suspicion:** Financial motive and public dispute, but she did not commit the murder.
- **OPEN:** How/when her Act III insight is delivered and its exact source; full per-act social mission list.

### Theodore Vale (`theodore`) — MURDERER; do not show host operations

- **Private truth:** Killed Edmund at 9:12 p.m. to prevent exposure of embezzlement.
- **Actual actions:** Used brass horse statuette, concealed it behind curtain, exited through garden, re-entered via conservatory.
- **Cover story:** Was in conservatory from 9:00–9:20 p.m. reviewing business correspondence.
- **Current authored objectives:** Protect alibi; persuade another guest to suspect Vivienne; stop others connecting the audit to him.
- **Act II assigned card:** C02, his memory of hiding the weapon (must be typed personal knowledge, not independent official evidence).
- **Act III knowledge:** A recovered audit document will directly implicate him; he must explain without confessing.
- **Allowed improvisation:** Claim to have taken fresh air; suggest Vivienne planted incriminating evidence; argue that fraud evidence doesn't by itself prove murder.
- **Forbidden:** Alter/forge official clue cards, change canonical events or claim fabricated output came from the app.
- **OPEN:** Exact timing of murderer disclosure and whether the murderer knows which third-party cards will be released before their acts.

### Margot Sinclair (`margot`)

- **Private secret:** Had a romantic relationship with Edmund, which he recently ended.
- **Personal knowledge:** Saw Theodore head toward study corridor around 9:05; Edmund planned a public announcement.
- **Current authored objectives:** Conceal affair; question Theodore about movement; discover if Edmund had another romantic interest.
- **Act II assigned card:** C03, personal sighting of Theodore near study around 9:05.
- **Act III knowledge:** Learns Theodore's claimed conservatory alibi conflicts with Clara's account.
- **OPEN:** Source of her Act III knowledge and whether C03 is a recollection vs official recorded witness statement.

### Arthur Pembroke (`arthur`)

- **Private secret:** Prepared a revised will substantially reducing Vivienne's inheritance.
- **Personal knowledge:** At 8:45 Edmund reported financial misconduct and planned an audit.
- **Current authored objectives:** Protect attorney-client confidences; investigate who knew about audit; decide whether to disclose the will.
- **Act III assigned card:** C04, audit memorandum linking Theodore to unauthorized transfers.
- **OPEN:** How audit memo reaches Arthur, why a confidential file can legitimately be shared and how it relates to public P05.

### Clara Whitmore (`clara`)

- **Private secret:** Secretly sold minor household valuables to cover a family member's medical expenses.
- **Personal knowledge:** At ~9:16 heard garden door latch and found muddy footprints near study; found Edmund's body at 9:25.
- **Current authored objectives:** Conceal missing valuables; question guests about garden; protect family's reputation.
- **Act II assigned card:** C05, recollection of garden door latch at ~9:16.
- **Act III knowledge:** Remembers seeing Theodore enter conservatory from garden side at ~9:20.
- **OPEN:** Why Clara's 9:20 observation only surfaces in Act III; exact garden/door sight lines and footprint location; detailed timing of discovery.

### Julian Cross (`julian`)

- **Private secret:** Investigating corruption at Blackwood Industries; used a false pretext to obtain his invitation.
- **Personal knowledge:** His confidential source described suspicious payments to a shell company controlled by an unnamed senior executive.
- **Current authored objectives:** Identify executive; secure documentary proof; persuade someone to give an exclusive interview.
- **Act III assigned card:** C06, source confirms shell company belonged to Theodore.
- **OPEN:** Source provenance, how the confirmation reaches Julian without relying on a magical unexplained message, and relationship to audit memo.

### Dr. Eleanor Finch (`eleanor`)

- **Private secret:** Edmund threatened to expose her improper prescribing practices.
- **Personal knowledge:** At 8:40 Edmund was alive, alert, and not in immediately life-threatening decline.
- **Current authored objectives:** Conceal prescribing dispute; investigate death; challenge claims that Edmund died naturally.
- **Act II assigned card:** C07, documented injuries indicate fatal blunt-force trauma, not poisoning/natural causes.
- **OPEN:** Who performed a medical examination and when; whether the evidence is a public medical report, a clinician's private inference, or an official case file.

### Sebastian Reed (`sebastian`)

- **Private secret:** Owes Edmund gambling debt and intended to steal a valuable item to repay it.
- **Personal knowledge:** Was in drawing room 9:05–9:20; saw Theodore return from conservatory at ~9:20 with mud on one shoe.
- **Current authored objectives:** Conceal debt; investigate missing valuables; confront Theodore about movements.
- **Act II assigned card:** C08, personal sighting of Theodore returning with mud on shoe.
- **Act III knowledge:** Learns garden door connects study to conservatory.
- **OPEN:** Whether Sebastian's 9:20 claim is independently corroborated and whether his whereabouts can be checked.

### Dossier coverage warning

The previous concept proposed **three objectives per character per act** (investigative, interpersonal, personal), i.e. 72 authored objective slots for eight people across three acts. The above dossiers contain only **three initial objectives per character** plus a handful of later knowledge beats. They must **not** be represented as 72 finished, approved objectives. The goal is to author/review the missing act-specific objectives and relationship graph before a full playtest.

## 6. Public clue deck (six baseline items)

| ID | Release | Draft public evidence | Content notes / review |
|---|---|---|---|
| `P01` | Act II | “Edmund was found dead in his study at 9:25 p.m.” | **Clarify:** 9:25 is **discovery time**, not necessarily time of death; this phrasing is valid if labeled discovery |
| `P02` | Act II | “The study's garden door was unlocked.” | Explain who discovered/verified; no culprit inference embedded |
| `P03` | Act II | “Muddy footprints lead from the study toward the garden.” | Direction/location currently ambiguous; **must reconcile** before marking official evidence |
| `P04` | Act III | “A brass horse statuette with blood traces was recovered behind the study curtain.” | Weapon recovered; ensure Act II medical evidence plausibly precedes it |
| `P05` | Act III | “A recovered letter announces an imminent audit of Blackwood Industries.” | Distinguish public announcement from specific C04 incriminating audit memorandum |
| `P06` | Act III | “A manor floor plan confirms a garden route between study and conservatory.” | Consistent with Theodore's escape; ensure floor plan geography supports witnesses |

No public clues are released through completion of objectives; they appear at the designated act transition.

## 7. Private clue / knowledge deck (eight baseline items)

| ID | Recipient | Release | Draft content | Recommended epistemic type |
|---|---|---|---|---|
| `C01` | Vivienne | Act II | Copy of revised will reduces her inheritance | `EVIDENCE`, provided authenticity is established |
| `C02` | Theodore | Act II | “You remember hiding the statuette behind the curtain.” | `PERSONAL_KNOWLEDGE` (killer-only truth) |
| `C03` | Margot | Act II | Saw Theodore head toward study at ~9:05 | `PERSONAL_KNOWLEDGE` (witness recollection) |
| `C04` | Arthur | Act III | Audit memo links Theodore to unauthorized transfers | `EVIDENCE` (document) |
| `C05` | Clara | Act II | Heard garden door latch around ~9:16 | `PERSONAL_KNOWLEDGE` |
| `C06` | Julian | Act III | Confidential source confirms Theodore controlled shell company | `PERSONAL_KNOWLEDGE` or verified message/document **OPEN** |
| `C07` | Eleanor | Act II | Injury report indicates fatal head blow | `EVIDENCE` if authentic report; medical observation otherwise **OPEN** |
| `C08` | Sebastian | Act II | Saw Theodore return at ~9:20 with mud on shoe | `PERSONAL_KNOWLEDGE` |

The table preserves the **eight** content-item count while correcting their conceptual classification; it does not silently upgrade all personal recollections into official evidence.

## 8. Public theatrical events — host-safe scripts

### Act I — Event 1: The Invitation (about 30 seconds)

> Welcome to Blackwood Manor. Tonight, Edmund Blackwood has gathered his closest associates, his family, and perhaps a few enemies.
>
> He has promised an announcement that will change everything.
>
> Until then, enjoy the evening. But choose your friends carefully.

**Host cue:** Read aloud; encourage in-character mingling and private social objectives. **No spoiler.**

### Act II — Event 2: A Body in the Study (about 45 seconds)

> Ladies and gentlemen, I have terrible news.
>
> Edmund Blackwood has been found dead in his study.
>
> The doors to the manor have been secured. No one is leaving until we understand what happened.
>
> One of you knows more than you're admitting.

**Host cue:** Read aloud; advance/release Act II clues. **Clarify in final content** whether narration comes before or after phase transition; it must not reveal clues out of order.

### Act III — Event 3: The Missing Accounts (about 45 seconds)

> A document has been recovered from Edmund's papers.
>
> It appears that money has been disappearing from Blackwood Industries, and Edmund intended to expose the person responsible.
>
> Perhaps tonight's tragedy was not about love, inheritance, or revenge after all.
>
> Perhaps it was about money.

**Host cue:** Read aloud; release Act III records; invite guests to revisit alibis and confront leading suspects. The script does not identify Theodore by name.

## 9. Accusation form and answer key

**Proposed form:**

- Murderer: one of the eight playable roles.
- Motive choices: `financial` = Cover up financial crimes; `inheritance` = Secure an inheritance; `romance` = Romantic revenge; `debt` = Escape a personal debt.
- Method choices: `blunt` = Blunt-force weapon; `poison` = Poison; `suffocation` = Suffocation.
- Correct answer: `theodore`, `financial`, `blunt`.

**Proposed detective scoring:** 5 points for murderer, 3 motive, 2 method (max 10); murderer excluded from detective rankings. The murderer may submit an accusation as camouflage. *Neither the scoring weights nor the exact options have been playtested or separately affirmed.*

**Open:** A menu including “blunt-force weapon” may make the method trivial given C07/P04. Options and grading should be checked for suspense and fairness. Missing-vote handling and host self-voting are unresolved.

## 10. Finale — full reveal text (author only until authorized)

> **The Killer Was Theodore Vale**
>
> Theodore Vale had been stealing from Blackwood Industries for months.
>
> When Edmund discovered the fraud, Theodore knew his career, fortune, and reputation were finished.
>
> At 9:10 p.m., Theodore entered the study. Their confrontation turned violent. Theodore struck Edmund with a brass statuette, hid the weapon, and escaped through the garden.
>
> He returned through the conservatory, hoping his movements would go unnoticed.
>
> But the muddy footprints, the unlocked garden door, the recovered weapon, the financial records, and the testimony of other guests exposed his deception.
>
> **The evidence told the story. The murderer tried to rewrite it.**

**Reveal ordering (proposal):** Lock accusations → show distribution → identify murderer → reveal method/motive and reconstructed timeline → explain relevant clues → optionally celebrate top detective and most convincing performance. Avoid displaying answer or grading before lock.

**Murderer win condition (proposal):** Succeeds at deception if no eligible non-murderer correctly selects Theodore as culprit. Exact tie/motive/method rules remain OPEN.

## 11. Known contradictions and unapproved details — do not fix silently

1. **Act I versus chronology:** Initial concept calls Act I “The Gathering” before the murder but some dossiers reference events at 9:05–9:25; must formalize the timing of character knowledge and whether acts are retrospective narrative chapters.
2. **Garden route/footprint evidence:** Exact direction, origin and physical visibility of mud prints needs map or consistent descriptions. P03 is not yet a vetted forensic card.
3. **Clara's observation:** Her knowledge of Theodore at 9:20 is delayed to Act III without authored explanation; avoid forcing the player to pretend to forget a known fact.
4. **Eleanor's injury report:** Who examined the body and when is undefined; forensic certainty within minutes may require setting-specific explanation or reclassification.
5. **Audit evidence overlap:** P05 (imminent audit), C04 (specific embezzlement) and C06 (shell company) should be independently plausible and not redundant or contradictory.
6. **Role/knowledge timing:** Do guests see entire private dossier before party or are time-sensitive items released by act? Murderer must learn guilt before deception play, while guest should not know fictional future events in Act I.
7. **Physical evidence versus secret sharing:** If several strongest proofs are personal recollections, the ability to solve from public clues alone is uncertain. May need additional independently released evidence.
8. **Difficulty:** Act III evidence potentially makes Theodore too obvious. Add credible false leads only after editorial approval; do not invent new canonical culprit/weapon/motive.
9. **The will:** Vivienne's statement she deserves her inheritance, Arthur's changes and C01 are consistent but their precise legal/story implications need review.
10. **Alternative counts:** No six-, seven-, nine- or ten-character variant exists. Do not auto-generate extra characters.
11. **Objectives and relationships:** Full act-by-act objective matrix and relationship network not written; cannot claim “complete play-ready packets” yet.
12. **Participation boundaries:** Appropriate roleplay themes, comfort/safety controls and accessibility need a product decision before recruiting playtesters.

## 12. Required narrative QA and playtest protocol

### Editorial review checklist

- [ ] Separate knowledge available at each phase from eventual full canonical knowledge.
- [ ] Confirm fictional-time consistency and geography; produce single authoritative floor-plan description if needed.
- [ ] Ensure each evidence card can be sourced plausibly and has a clear evidence-vs-recollection label.
- [ ] Confirm nobody must fabricate an action or lie about a canonical official fact to follow their objective.
- [ ] Author objective matrix for all eight roles across three acts and complete character relationships.
- [ ] Verify independent proof routes, including cases where Margot, Sebastian, Clara, Arthur or Julian withholds information.
- [ ] Test that host-only assignments and control scripts are spoiler-safe.
- [ ] Test options/scoring for deductions that feel earned rather than menu-driven.
- [ ] Review emotional/social comfort of secrets, theft, infidelity and medical impropriety for target audience.

### In-person test goals

Recruit **eight adults**, assign roles in advance, and run one complete approximately 90-minute party. Observe: time spent in app, spontaneous conversations, distribution of social participation, confused instructions, ignored missions, clue utilization, success of deception, correctness of accusations, theatrical-event pacing, host burden and enjoyment. Collect **explicit debrief feedback** about clues or chronology that felt arbitrary. Track changes as a new authored content version after editorial approval.

## 13. Prototype completion criteria

This story can be considered **technically playable** after all eight roles have secure dossiers, every authored clue has a stable release assignment, each public event can be displayed, and the app can run the complete accusation/reveal lifecycle without leaks.

It should be considered **ready for a meaningful playtest** only after the continuity gaps and objective coverage in §§11–12 are addressed. It should be considered **commercially publishable** only after repeated real-world testing, content polish and explicit product/brand review; none of those conditions has yet been met.