# Versioned mystery content and spoiler-safe projections

**Status: Proposed — owner review required.** This is an implementation
contract, not permission to publish content, implement gameplay, migrate a
database, or deploy. [O-026 and O-027](../product/decisions-and-open-questions.md)
remain open. Confirmed product decisions and the
[content model](../product/mystery-content-model.md) take precedence over this
proposal; the [gameplay specification](../product/gameplay-specification.md)
and [flows](../product/host-and-player-flows.md) describe intended behavior,
not the current runtime.

## Context and trust boundaries

The current app is `LOBBY` only. The server-only
[`public-characters.ts`](../../src/lib/lobby/public-characters.ts) contains
eight public identities, not private packages. Party creation pins
`blackwood-affair` / `first-playtest-placeholder-v1`; assignment migrations
register those public IDs. [Lobby persistence](lobby-persistence.md) describes
service-role RPCs, authenticated polling, removal and recovery. No dossier,
release engine or reveal exists today. Remote rollout status is not inferred
from merged code; see [production operations](../production-operations.md).

**Public source is a separate boundary from runtime access.** The public
repository's [Blackwood draft](../product/blackwood-affair.md) already contains
the answer key and private dossiers. Anyone can read it on GitHub regardless of
server-only imports, and repository history and copies may persist. Server-only
execution protects browsers from accidental runtime delivery; it does not make
public source secret. Do not copy the full Markdown into runtime or remove,
move, encrypt or redact it as part of this ADR.

```text
editor/source -> validated immutable package -> trusted server-only loader
                                                   |
browser <- minimal authorized projection <- server authorization <- party DB
   ^                                          |
   +-- authenticated polling: invalidation ---+
```

The browser, including a host's browser, is untrusted. The server and its
service-role database access are privileged; neither a route parameter, a
client-supplied role/phase/version, a JWT alone, nor an invitation proves
access to private content. Editors and deployment operators who can read the
package are trusted with spoilers; operational host privileges are not editorial
privileges.

## Storage and source options (O-026 / O-027)

| Dimension | Server-only immutable versioned JSON/data module | Private normalized Postgres tables | Hybrid: server-only package + Postgres party/release state |
| --- | --- | --- | --- |
| Spoiler isolation | Server-only import and explicit projections required; full package in server deployment | Private tables, restrictive grants/RLS and narrow trusted RPCs; privileged DB access sees all | Package stays server-only; DB stores no dossier or solution. Both boundaries must be secured |
| Public source / IP | Public repo exposes any committed content; server-only does not change that | Can keep data outside public Git, but SQL seeds/migrations or backups may expose it | Same public-source risk as module unless package is supplied from controlled source |
| Immutable pinning | Version and digest indexed in package registry; retain old artifacts | Versioned rows plus constraints and publication immutability | Registry and DB pin version **and** digest; fail closed on mismatch |
| Atomic releases | DB transition controls release; application must check state before projection | State and content can be read/updated in one transaction | DB atomically changes phase/releases; immutable package mapped only after authorized snapshot |
| Migrations | No content-table migration; state/pin changes still need migrations | Content schema, grants, publication and data migrations per evolution | State/pin/release schema migrations; package schema evolves separately |
| Editing / review | Simple diffs and validation, but spoilers visible to repo readers | Editors/import tooling and DB diffs add complexity | Simple package review plus explicit state schema; two deployment artifacts |
| Backup / rollback | Retain and restore exact versioned deployment artifacts; app rollback must retain all active versions | DB backups and tested restore; rollback must not mutate published rows | Back up DB state and retain matching packages/digests; rollback both compatibly |
| Testing / Vercel | Easy fixture tests; server bundle grows and all active versions must ship with each compatible deployment | Real DB integration/permission tests; Vercel depends on DB availability | Fixture and local DB tests; Vercel must include or securely retrieve every active package |

**Recommendation for the first prototype:** hybrid with an immutable,
server-only versioned data package and Postgres as authority for parties,
membership, phase and releases. Keep package contents out of browser-facing
queries and store only identifiers/digests in state. This avoids an authoring
database and makes content review and validation straightforward, at the cost
of coordinating two artifacts and retaining old versions in every compatible
deployment. A `server-only` marker is a guardrail, not an authorization system.
Do not treat this recommendation as an accepted decision.

The owner may deliberately leave the prototype draft openly documented and
accept that participants can find spoilers. For future copyrighted or
confidential assets, alternatives include a separately access-controlled
private source or controlled storage loaded only by trusted deployments.
Either requires approved access, licensing, provenance, review, version
retention, backup/restore and deployment/rotation procedures; private hosting
does not undo public history. Record source, author/rights approval, reviewer,
publication time and digest without publishing private text. No private source,
asset transfer or access policy is authorized here.

## Proposed immutable package contract

Illustrative domain types, **not existing runtime types**. IDs are stable,
nonempty canonical identifiers within a version, not authorization tokens.
Public text must be independently reviewed as spoiler-safe.

```ts
type Id = string;
type ReleasePhase = "ACT_1" | "ACT_2" | "ACT_3";
type PartyPhase = "LOBBY" | ReleasePhase | "ACCUSATIONS" | "REVEAL" | "COMPLETE";
type PublishedVersion = {
  mysteryId: Id; version: string; schemaVersion: number;
  digest: string; publishedAt: string; provenanceRef: string;
};
type PublicCharacter = {
  id: Id; publicName: string; archetype: string; description: string;
};
type StartingDossier = {
  characterId: Id; biography: string; interpersonalPrompts: string[];
};
type Audience = { kind: "PUBLIC" } | { kind: "CHARACTER"; characterId: Id };
type ReleasedItem = {
  id: Id; releasePhase: ReleasePhase; audience: Audience;
  kind: "EVIDENCE" | "PERSONAL_KNOWLEDGE" | "RUMOR";
  text: string; essential: boolean; provenance: string;
};
type PublicEvent = {
  id: Id; releasePhase: ReleasePhase; order: number; script: string;
};
type Solution = {
  culpritCharacterId: Id; motiveId: Id; methodId: Id;
  narrative: string; timeline: string; supportingItemIds: Id[];
};
type MysteryDefinition = {
  publication: PublishedVersion; title: string; publicSynopsis: string;
  supportedPlayerCounts: number[]; characters: PublicCharacter[];
  startingDossiers: StartingDossier[]; items: ReleasedItem[];
  publicEvents: PublicEvent[]; solution: Solution;
  motiveIds: Id[]; methodIds: Id[];
};
```

The private authoring package can include further editorial metadata, act
objectives and relationship references as specified in the content model; they
need explicit audience and release rules, not a generic blob passed to clients.
`StartingDossier` is deliberately separate from Act I items: under D-023 the
assigned player's approved starting biography and optional interpersonal
prompts are available in `LOBBY`. Only material editorially approved for
pre-start belongs there. Killer knowledge must be in the assigned role's
dossier **only if** its release point is owner-approved as pre-start;
otherwise it is a character-only item at its approved phase. D-006 requires the
murderer to know; it does not authorize inventing the timing or content.
Future-act evidence and the solution never appear in the starting dossier.
`EVIDENCE` means immutable official artifact/observation; personal knowledge
and rumor are not official proof. Public events are distinct announcements.
Solution-only material is not a released item; it is available solely through
the reveal projection after the reveal gate.

Before publication, validate the package schema, canonical ID format and
uniqueness in each namespace; exactly eight distinct playable Blackwood roles
and supported count `[8]`; one dossier per role; valid same-version character,
item, objective/relationship, culprit, motive and method references; allowed
audiences, classifications and release phases; valid event ordering; and
solution references. Reject unknown types/fields where they could introduce
unreviewed data. Verify digest over a defined canonical serialization of the
complete package excluding the digest field itself. Check public fields for
spoilers and review evidence classification, chronology, core clue coverage,
and solvability independently of optional missions; automated validation alone
cannot establish editorial truth or secrecy. The server-side package validator
owns these content checks and runs on import and as a publication gate; each
deployment must also verify the registered bytes and digest before serving a
version. Database constraints independently enforce pin and publication
integrity, not editorial validation.

A draft is mutable only before publication. Publication requires validation,
editorial and owner approval, an immutable unique `(mysteryId, version)` and
digest, and retained exact bytes. Never overwrite or reuse a published version,
even for a correction: publish a new version. Party creation pins the exact
published tuple and digest transactionally; a missing package or digest mismatch
fails closed, never falls back to latest. Retain active versions across Vercel
deployments and restore/rollback; prevent deletion while referenced. A future
schema must enforce immutability and referential integrity; service-role writes
must not bypass publication policy.

The existing placeholder is a **public roster pin, not a published private
version**. Existing parties remain pinned to it and retain their current lobby
behavior; do not attach a new solution to that identifier or silently repin.
Proposed default: deny private-content/game-start reads for placeholder parties
with a safe unavailable response. A separately reviewed migration or explicit
owner-approved party recreation/upgrade policy is required before any change,
including preserving assignments and handling already-disclosed dossiers.

## Server read and authorization contract

The following are proposed server functions; future routes may wrap them, but
must return only the named projection. Each request verifies a current
authenticated identity with the provider and freshly reads authoritative party,
membership/assignment, pinned version/digest and phase/release state. Host
ownership is checked independently. Never accept identity, character, phase or
version supplied by the browser as authority.

| Function | Caller / checks | Return |
| --- | --- | --- |
| `getPublicRoster(partyId)` | Authenticated current member **or** owning host; existing public catalog may remain separately public | Pinned public identities and descriptions only |
| `getHostOperations(partyId)` | Authenticated owning host | Safe roster, assignments, phase, readiness and released public scripts only; no dossiers, future text or solution |
| `getMyStartingDossier(partyId)` | Current enrolled member with current assignment, including a playing host; published matching pin | Own pre-start dossier in `LOBBY` and thereafter; no arbitrary character parameter |
| `getReleasedContent(partyId)` | Current member or owning host, matching published pin and committed release state | Released public events/items; additionally only the current assigned member's released private items. Unassigned members and nonplaying hosts get no private items |
| `getSolution(partyId)` | Current member or owning host, matching pin, committed authorized `REVEAL` or `COMPLETE` | Reveal projection only; not all dossiers or authoring package |

| Actor, after current server checks | Roster / host ops | Own starting dossier | Released public / own private | Solution |
| --- | --- | --- | --- | --- |
| Anonymous, invitation-only, removed, old recovered principal, wrong party | Deny party reads | Deny | Deny | Deny |
| Unassigned current member | Roster / no host ops | Deny | Public only / deny private | Only after reveal |
| Assigned current member | Roster / no host ops | Own only, including lobby | Public / own, after each committed release | Only after reveal |
| Owning host, not enrolled | Roster / host ops | Deny | Public / deny private | Only after reveal |
| Owning host, enrolled and assigned | Roster / host ops | Own only, including lobby | Public / own, after each committed release | Only after reveal |
| Authenticated non-owner, non-member | Deny party reads | Deny | Deny | Deny |

Even for a playing host, `getHostOperations` remains spoiler-free; the host
obtains their own dossier only through the separate participant-authorized
read. Neither host ownership nor a participant assignment expands the other
projection's privileges.

No phase check is satisfied by a URL, local clock, navigation, or mission
completion. `LOBBY` has no released act items; `ACT_1`–`ACT_3` expose only
committed releases through the current phase, retaining earlier releases during
pause and later phases. `ACCUSATIONS` does not expose solution; `REVEAL` and
`COMPLETE` do only after the authorized reveal transition. Reassignment/removal
invalidates subsequent reads of the old role. Lost-session recovery requires
the existing distinct, single-use host-assisted credential; successful rebind
makes the old principal ineligible even while its JWT is unexpired. Fresh
membership checks, not JWT claims or polling latency, enforce this. A response
already delivered or in flight cannot be recalled; document that revocation
limits future authorized reads, not knowledge already seen.

For phase mutations, a future service-role-only transaction locks the party,
checks host, expected version, readiness and allowed transition, records phase
and unique `(party, version, item)` release identities atomically, and handles
idempotent retries without duplicate releases or skipping phases. Read the
authorization facts and release set consistently in a DB transaction; map
only that snapshot to the matching immutable package on the trusted server.
Define and test ordering of concurrent removal/recovery and read transactions:
a read authorized before revocation may complete; reads authorized afterward
must fail. The client never receives the full package for filtering.

## Delivery threat model and verification

* **Server Components / client bundles:** Build explicit allowlisted DTOs before
  rendering or passing props to `use client`; inspect HTML, React Server
  Component payloads, serialized props, flight/prefetch responses and browser
  JS chunks. Never import full packages through a client dependency graph.
  Avoid static prerendering of user-specific pages or package data. Test a
  production build, not only development mode.
* **Direct requests and caching:** Authorize every route/action/server render
  independently, including direct URL, guessed party/character/item IDs and
  prefetch. Sensitive responses must be dynamic and use
  `Cache-Control: private, no-store, max-age=0`; configure framework fetch/data
  caches and CDN behavior to avoid shared or persistent personalized caching.
  Never depend on obscurity, client hiding or a cache key for authorization.
* **Errors, artifacts and observability:** Return generic denials and
  nonrevealing errors; log only safe stage/category metadata, not content,
  request bodies, tokens, serialized errors or service credentials. Error pages,
  source maps, downloadable files, test traces and CI artifacts must not expose
  private packages. Use synthetic sentinel fixtures for scans; do not publish
  actual private payloads or arbitrary DOM/screenshots.
* **Invalidation:** Reuse M1.7 authenticated polling as a version/invalidation
  signal, not a content-bearing push event. On change, fetch a fresh authorized
  projection; do not send private content through notifications, Realtime or
  broadcast channels. Stop polling on denied access, and recheck on reconnect.
* **Privilege:** Service-role credentials stay server-only, never in
  `NEXT_PUBLIC_` variables, client bundles, logs or previews connected to
  production. Narrow RPCs/grants and input checks are required because service
  role bypasses RLS; direct browser database queries must not read private
  content or mutate releases.

Future automated negative tests use synthetic, unique spoiler sentinels. Check
unassigned guest and nonplaying host response bodies, HTML, RSC/prefetch and
all client chunks for all private sentinels; assigned players must see only
their own authorized subset. Exercise direct URLs/API calls with another
party's IDs, another role's IDs, guessed IDs, missing/invalid sessions, future
phases and early reveal. Test phase boundaries, repeat/concurrent transitions,
cache isolation across users, reassignment, removal, recovery and an old
unexpired JWT, including concurrent reads. Verify no private fields in polling
or error/log/artifact output; use desktop and mobile isolated host/guest browser
contexts and disposable Supabase. Scans support but do not replace review of
serialization/import boundaries.

## Editorial gates and proposed implementation slices

The [Blackwood draft](../product/blackwood-affair.md) contains draft, not
automatically approved canon. Resolve **O-009–O-016**: chronology and Act I
timing, location/footprint consistency, injury findings, delayed recollection,
clue classification, independent solvability, reveal balance, and incomplete
objectives/relationships. Motive/method choices and related gameplay questions
remain open. No new clues, answer options, objectives or story text are specified
by this ADR. Owner approval of O-026/O-027 and spoiler/IP implications is a
prerequisite to implementation; approval of content and release timing is
separate.

1. **Package boundary and validation:** After architecture/source approval,
   implement server-only version registry, schemas, digest and safe projections
   using synthetic fixtures, no real private publication. Specify published
   version/pin constraints in a reviewed migration if needed; retain placeholder
   behavior. Acceptance: validation rejects invalid references/counts/phases
   and mutations, host-only projections, logs, bundles and responses exclude
   synthetic dossiers, future text and solution, and old pins fail closed.
   Unit tests, build/chunk checks and local pgTAP for any migration.
2. **Own pre-start dossier:** After editorial approval of starting content and
   release timing, add server reads and UI for assigned participants only,
   including playing host. Add necessary version/digest and authorization RPC
   migration, not content in public SQL seeds. Acceptance: D-023, cross-role,
   host isolation, removal/recovery/stale-JWT and cache tests pass on disposable
   local Supabase and desktop/mobile Playwright. No start-game behavior.
3. **Start and Act I:** After readiness and Act I content approval, extend
   `LOBBY`-only schema with reviewed phase/release state and atomic idempotent
   host transition. Proposed minimum readiness: eight distinct current enrolled
   participants each assigned a different one of the eight roles, including the
   host only if enrolled; any additional readiness conditions need owner review.
   Acceptance: that minimum, no pre-start Act I leakage, concurrent/replayed
   transitions and public/private release isolation tested with pgTAP and
   browser integration. No mission gate.
4. **Later acts and reveal:** Separate small issues for each authorized phase
   and eventually reveal, after relevant content, accusation/lock and transition
   decisions are approved. Extend transition constraints and tests per slice;
   verify future-phase denial, retained prior releases, independent host/player
   views and no early solution. Do not assume undecided scoring or force-lock.

Each slice requires current-SHA independent CI, unit, lint, typecheck and build;
schema/auth changes additionally require local pgTAP and relevant desktop/mobile
Playwright. Review migrations, backups, exact target and rollback, then obtain
specific human approval before any production migration. Apply and verify
approved schema before an app that depends on it; coordinate package
availability/pins and retain rollback compatibility. Verify production
deployment and safe smoke test separately under
[production operations](../production-operations.md). No agent or CI production
migration, private publication or manual deployment is authorized by this ADR.
