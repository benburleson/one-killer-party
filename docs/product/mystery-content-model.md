# One Killer Party — Mystery Content Model

**Status:** Draft data contract and validation requirements · v0.3 · 2026-11-20  
**Related:** [Vision](product-vision.md) · [Gameplay](gameplay-specification.md) · [Flows](host-and-player-flows.md) · [Blackwood content](blackwood-affair.md) · [Decision register](decisions-and-open-questions.md)

The [proposed mystery content ADR](../architecture/mystery-content-architecture.md)
details implementation boundaries and tradeoffs; storage and source visibility
remain open pending owner review.

## 1. Intent and separation

**CONFIRMED direction:** Mysteries are authored, structured, versioned data interpreted by a reusable game engine. The first mystery is **a placeholder**, not an AI-generated story or a requirement for a mystery editor. The first complete playtest is **exactly eight playable characters**. The previously described 6–10 player support is a future capability without authored character variants.

This specification describes **semantic content objects**, their permissions and validation. It is not an exact database migration or API schema; table names and field encodings are **baseline proposals**. An agent may choose implementation details consistent with these invariants but must not invent missing gameplay canon.

Separate at least four surfaces:

1. **Authoring package (privileged, version-controlled):** Complete source content including solution, all role dossiers and future clues.
2. **Public metadata projection:** Safe title, synopsis, supported player count(s), duration, public character descriptions and nonspoiler event setup.
3. **Participant projection:** Only current public content, participant's own private data and their released items.
4. **Host operations projection:** Public roster, membership, assignments, phase, readiness and spoiler-free scripts; **not** a complete authoring package.

The game engine **must never serialize the entire authoring object to a client** and rely on CSS/UI to hide secret fields.

## 2. Content package and version lifecycle

A `MysteryDefinition` has a stable `mysteryId` and immutable `version` (semantic version or version string; precise format OPEN). It includes declared player counts, authoring metadata, cast, ordered acts, events, clues, objectives, relationships, solution and validation information.

**Required invariants:**

- Each `party` references a specific **published immutable content version** so mid-party author edits cannot change the solution.
- Draft content may be edited; changing released/published canon produces a new version.
- All references (character IDs, act IDs, clue IDs, objective targets, motive/method IDs) must resolve within the same package version.
- Content may include spoiler-only fields, but these must be physically inaccessible to unauthorized guest/host-facing API/database queries.
- Data-driven story operation must not require hardcoded Blackwood character names in rendering or core engine logic.
- Public and private content types must have explicit release and projection rules.

**Open storage decision:** Store published definitions as server-only JSON/TypeScript data, normalized Postgres rows, or a hybrid. The earlier architecture described `mysteries`, `characters`, `acts`, `clues`, `parties`, etc. as conceptual entities, not finalized migration files. Regardless of format, do not ship the full solution in a frontend source import.

## 3. Semantic entities

| Entity | Required conceptual fields | Meaning / constraints |
|---|---|---|
| `Mystery` | ID, version, title, public synopsis, supported player counts, expected duration, status | One immutable authored game definition |
| `Character` | Stable ID, public identity, public archetype, private dossier, relationships, personal knowledge, murder-role payload if applicable | Exactly one playable guest per instance in prototype |
| `Act` | Stable ID, ordinal, public title, expected duration, suggested host instruction | Three investigation acts, with separate lobby/finale phases |
| `PublicEvent` | ID, act, public host-readable script, triggering rule, priority/order | Theatrical shared moment, spoiler-free at time of delivery |
| `Clue` | ID, act/release phase, visibility/recipient, kind, content, essential flag, provenance | Released at the proper moment to the intended audience |
| `CharacterObjective` | ID, character, act, type, description, optional target character | Nonblocking in-person social prompt |
| `CharacterKnowledge` | ID, character, release act, text, epistemic kind | Private secret, recollection or fact; not automatically public evidence |
| `Relationship` | Character IDs, player-facing perspective, public/private visibility | Motives for interaction; reciprocal text may differ |
| `Solution` | Culprit character ID, motive ID, method ID, narrative, fictional event timeline, supporting clue references | Author-only until reveal; not distributed to host controls |
| `AccusationOptions` | Candidate character IDs, motive options, method options | Do not encode correct answer in client metadata |
| `ContentValidation` | Checks, warnings, coverage matrix and playtest status | Authoring QA; not player state |

## 4. Clue typing and release model

**Visibility** should be modeled explicitly:

- `PUBLIC`: appears to everyone after its release condition.
- `CHARACTER`: appears only to the one participant assigned a named character after release.
- `SOLUTION_ONLY`: creator/server-only material, **not** a player-facing released clue.

**Epistemic kind** should be explicit and presented differently in UI:

- `EVIDENCE`: authoritative, fixed document or official forensic/environmental observation.
- `PERSONAL_KNOWLEDGE`: what a character remembers, did, believes or has been told; may be biased, unverified or deliberately false when spoken.
- `RUMOR`: assertion circulating among characters; truth not guaranteed.
- `PUBLIC_EVENT`: canonical announcement or scene, not interchangeable with a clue card.

**Important content correction:** The Blackwood prototype initially calls its deck “six public clues and eight private clues”, but some private entries (notably Theodore's memory of hiding the weapon, Margot's sighting and Sebastian's recollection) are **personal knowledge**, not forensic documents. Preserve them in the first package with proper types; don't present them all as proof.

**Release trigger — confirmed design direction:** By **act/phase**, not by mission completion. At host advancement the engine authorizes items for that phase. Technical delivery can be realtime or fetch-on-demand, but should remain idempotent.

**Future release conditions:** Social actions, branching choices, scavenger hunts, puzzle completions are intentionally **out of MVP**. A generic condition DSL should not be required before the first playable game exists.

**Accessibility:** Once released, a clue remains accessible in later phases. Pause/extend must not remove it. A guest may voluntarily show their own card to others; that does not grant those others automatic API access.

## 5. Authoring constraints for eight-player Blackwood prototype

The first package needs:

- Exactly **8 playable roles**, one canonical murderer and one **non-playable victim**.
- Three ordered acts plus finale presentation.
- 3 short public event scripts (Act I, II, III), plus finale script.
- A precommitted murderer, motive, method, fictional timeline, cover story and explanation.
- Minimum **6 public** and **8 character-specific** content items in current draft, accurately classified by evidence/knowledge type.
- Character-specific objectives, with no mandatory completion gates.
- All core clues accessible without optional discoveries or any player volunteering a secret.
- No impossible chronology, missing references or contradiction between official documents and canonical timeline.

**Not yet achieved:** Fully authored per-act objectives for all eight roles, complete relationship graph, verified solvability under withheld testimony, detailed costume suggestions, exact motive/method answer choices, and content balancing. The available dossier information is captured in [blackwood-affair.md](blackwood-affair.md), and these gaps must not be filled silently.

## 6. Static validation (implementable quality gates)

An authoring-package validator should check at minimum:

1. `mysteryId`, version, title and supported count exist, and all IDs are unique.
2. Number of characters matches a declared supported player count; for Blackwood v0.1, exactly eight and one murderer.
3. Every character has a public label, own private dossier, at least one interaction hook and a reference to all authored objectives/items.
4. Every clue/event references a valid act and audience; no future-phase material appears in any public pre-release projection.
5. Every `CHARACTER` item references an existing character; every target relationship/objective resolves.
6. The solution references a valid playable murderer, listed motive and method and known fictional timeline events.
7. Each public event is spoiler-safe when read at its phase; no act-specific item requires a later event to make sense unless explicitly authored as foreshadowing.
8. Public roster/metadata contains no `murderer`, solution, hidden `roleType`, sensitive exact chronology or direct answer key.
9. All content marked `essential` is released without requiring social interaction or third-party consent.
10. No contradictory statement is labeled simultaneously as immutable **official evidence** and false in solution canon without explicit explanation (e.g., forgery disclosed as an in-world artifact).
11. Every release is stable across retries and reconnects; logically identical items have stable IDs.
12. Authoring package includes a spoiler-free public teaser and a solution explanation connecting at least some evidence to culprit, motive and method.

**Not mechanically provable without editorial review:** Whether a mystery is fair, pleasantly challenging, appropriately paced, not reliant on one player speaking, and fun for everyone. Add a reviewer/playtest signoff step rather than pretending static schema validates logical deduction.

## 7. Candidate persistence model (not a prescribed migration)

Earlier architecture named these concepts. Keep content-definition tables distinct from party runtime state:

| Content/catalog | Runtime |
|---|---|
| `mysteries` | `parties` |
| `characters` | `participants` |
| `acts` | `party_state` (may live in parties) |
| `clues` | `clue_releases` / authorized projections |
| `public_events` | `game_events` (audit log) |
| `character_objectives` | `accusations` |
| `solution` in protected storage | `host_permissions` / guest sessions |

**Proposed runtime fields:** Party ID, host ID, join code/hash, pinned mystery ID/version, phase, paused state, optimistic version, created/start/completed times; participant ID, session/auth principal ID, display name, party ID, assigned character ID, join/connected state; immutable release IDs with phase/version and audience; accusation IDs and selected answer options; audit event IDs, type, actor and timestamp.

**Required uniqueness and authorization properties:** One character per party; one assignment per eligible participant; participant principal cannot claim another participant; one accepted final accusation per participant/party; idempotent phase transition and clue release; host changes must be authorized on the server. Use database unique constraints and transactions where possible, not just UI checks.

## 8. Example authoring shape (illustrative, NOT approved executable schema)

```json
{
  "id": "blackwood-affair",
  "version": "0.1-draft",
  "title": "The Blackwood Affair",
  "supportedPlayerCounts": [8],
  "acts": [
    { "id": "act-1", "suggestedMinutes": 20 },
    { "id": "act-2", "suggestedMinutes": 25 },
    { "id": "act-3", "suggestedMinutes": 25 }
  ],
  "characters": [
    { "id": "vivienne", "publicName": "Vivienne Blackwood" },
    { "id": "theodore", "publicName": "Theodore Vale" }
  ],
  "clues": [
    {
      "id": "P01",
      "releaseAct": "act-2",
      "visibility": "PUBLIC",
      "kind": "EVIDENCE",
      "essential": true
    },
    {
      "id": "C02",
      "releaseAct": "act-2",
      "visibility": "CHARACTER",
      "recipientCharacterId": "theodore",
      "kind": "PERSONAL_KNOWLEDGE"
    }
  ],
  "solution": "<SERVER_ONLY_EDITORIAL_CONTENT>"
}
```

The characters and clues here are **deliberately incomplete**; use the full [Blackwood story document](blackwood-affair.md) for the baseline authored text. Do not use this snippet as the production game fixture.

## 9. Acceptance criteria for a reusable content engine

- A new mystery package can be introduced without editing the engine's phase or authorization logic (assuming the same supported phase model).
- Starting a party pins one known published content version.
- Requesting public synopsis or host assignment roster does not reveal any killer identity.
- Assigning a role gives the player access only to their role's currently allowed data.
- Advancing acts authorizes exactly the public and specific role releases declared for that act.
- Accusation grading occurs only server-side after allowed reveal, against the pinned answer key.
- Import validation rejects broken IDs, duplicate roles, missing release phases and out-of-scope player counts.
- Client assets never include the unpublished answer key in any response accessible to a non-author, even when minified or viewed in network tools.

## 10. Open content-model questions

- Content versioning and migration strategy: semantic version format, published immutable snapshot form, migration of drafts.
- Store authoring definitions in files vs Postgres; limits of row-level security and deployment bundle separation.
- Exact `EVIDENCE` vs `PERSONAL_KNOWLEDGE` taxonomy for all Blackwood C01–C08 items.
- Whether host may view a spoiler-free role preview **before** assigning and whether guests may see full private dossiers pre-party.
- Minimum objective count and per-act relationship coverage; required validator vs editorial checklist.
- Whether optional discoveries exist at all in first complete game or only in its design model.
- How to provide motive/method option menus without leaking plot structure before the reveal.