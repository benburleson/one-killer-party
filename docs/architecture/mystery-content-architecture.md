# Versioned mystery content and spoiler-safe projections

**Status: Accepted design direction — owner decisions 2026-11-22 (D-026–D-028).** This is an implementation contract, NOT authorization to provision storage, publish private content, migrate a database, implement gameplay, or deploy. Confirmed product decisions and the
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
release engine or reveal exists today. Production status is recorded in
[production operations](../production-operations.md).

**Public source is a separate boundary from runtime access.** The public
repository's [Blackwood draft](../product/blackwood-affair.md) already contains
the answer key and private dossiers. Anyone can read it on GitHub regardless of
server-only imports, and repository history and copies may persist. Server-only
execution protects browsers from accidental runtime delivery; it does not make
public source secret. Do not copy the full Markdown into runtime or remove,
move, encrypt or redact it as part of this ADR.

```text
private editorial source -> validate + approve -> private immutable object
                                                    |
                                       trusted server-side package loader
                                                    |
browser <- allowlisted authorized projection <- server auth + party DB snapshot
   ^                                          |
   +-- authenticated polling: invalidation ---+
```

The browser, including a host's browser, is untrusted. The server and its
service-role database access are privileged; neither a route parameter, a
client-supplied role/phase/version, a JWT alone, nor an invitation proves
access to private content. Editors and deployment operators who can read the
package are trusted with spoilers; operational host privileges are not editorial
privileges.

## Architecture decision: private immutable packages, Postgres runtime state

**Selected: private-object-store + Postgres hybrid**, not Copilot's initial server-bundled hybrid. Use an access-controlled **private Supabase Storage bucket** for versioned, immutable JSON mystery packages; a **restricted Postgres registry** stores only package identifiers, schema versions, SHA-256 digests, private object locators, publication provenance and approval metadata. Parties, assignments, identities, phases, releases and accusations remain authoritative in Postgres. The Next.js server alone accesses package bytes and constructs allowlisted public/host/participant projections after fresh database authorization.

| Alternative | Strength | Reason not selected for the first prototype |
| --- | --- | --- |
| Complete private package in server-only source files in the existing public repo | Simple TypeScript authoring/build validation | Public repository and Git history expose spoilers; server deployments must carry old packages |
| Private authoring repo injected into Vercel build + Postgres state | Private edits and deterministic deployment | Requires coordinating packages with each build and retaining old versions across deployment rollbacks |
| Fully normalized private Postgres content tables | SQL constraints, one persistence system | More tables, RLS/RPC authoring surface and migration coupling than needed for one mystery |
| **Private Supabase Storage immutable object + Postgres state (selected)** | Story is outside public Git, unchanged across app deploys, package publication separated from gameplay transactions | Requires trusted publication tool, object/DB backup compatibility and server-only access |
| New third-party private CMS/object store | Useful for a future authoring platform | Additional vendor/operational overhead and security boundary |

**Private-source policy (D-026):** Do not commit new private dossiers, murderer revelations, solution text or future clues to this public repo, SQL migrations, test fixtures, issues or PR discussions. Author them in an access-controlled private editorial source, reviewed by an authorized editor. The exact private editor/repository is an operational choice, not a dependency on the runtime. This repo may retain **synthetic** test packages and spoiler-free public metadata.

**Publication path:** A trusted, operator-invoked publishing tool validates schema, eight-role references, act/audience classifications and editorial approval; canonicalizes exact package bytes; computes digest; uploads to a **private, non-overwriting object key** (mystery/version/digest); independently reads back and verifies checksum; then registers/publishes the version in Postgres. Registration and party pins are database-transactional; object upload itself is not, so failed registration leaves a nonpublished orphan for privileged cleanup. Never serve unpublished versions. No public bucket, browser read grant, browser signed URL, client-visible object locator or publicly exposed publishing endpoint. Restrict publishing permissions separately from normal game reads, audit publications, and prevent editing/replacing a published key even by application service code. Supabase service credentials can bypass RLS and require tight server/operator protection.

**Preserved versions (D-027):** Every party keeps its exact pinned **published version and digest for its lifetime**, unaffected by new packages or Vercel releases. Corrections become new versions; do not mutate or upgrade existing parties, and do not fall back to latest if pinned object is missing. New parties can pin a newly approved version at creation. Retain published objects while referenced, including across deploy rollback, with durable object + database backup and restore, hash verification and schema compatibility checks. A missing/mismatched object fails closed with a safe unavailable response. Cache verified immutable package bytes only inside a trusted server, keyed by immutable version+digest; never cache user-specific authorization results across callers. For old application deployments unable to interpret a newer schema, prevent creating new parties using that schema until deployed code supports it, while existing party versions remain retrievable.

**Existing placeholder parties:** `blackwood-affair / first-playtest-placeholder-v1` is a **public roster placeholder**, not a published private mystery package. Keep such parties in their existing public lobby and deny private dossier/game-start reads. For a playable version create a **new party** pinned to an approved published package; do not silently repin existing parties or overwrite that identifier. Any exceptional upgrade/recreation policy would need a new owner-approved decision.

**Public-repo history cannot be retroactively private:** `docs/product/blackwood-affair.md` already includes spoiler text in public Git and historical commits. The decision protects **future private content**; it does not make those existing spoilers secret. Any removal/redaction from the public repository, handling of clones/caches or transfer to private editorial source is a **separate explicitly reviewed task**. Do not delete or rewrite existing canonical story in this ADR.

**Operator prerequisites, not yet authorized:** create and secure the private storage bucket; define editorial source and publisher permissions; protect credentials; establish private test/preview isolation; backup/restore, retention and audit requirements; verify package registry/blob availability before rollout. No automatic CI or Copilot production publishing.

## Proposed immutable package contract

**Implemented contract:** schema version 1 exists as a pure domain module,
documented in [mystery content package contract](mystery-content-package.md).
That document and the code are authoritative for field names, ID and version
rules, canonical encoding and digest scope. The types below remain an
**illustrative summary** of the accepted direction; they are not the runtime
types and are not a client-facing shape. IDs are stable, nonempty canonical
identifiers within a version, not authorization tokens. Public text must be
independently reviewed as spoiler-safe.

**Digest scope refinement:** an earlier draft placed `digestSha256`,
`publishedAt` and `provenanceRef` inside the package, which would make the
digest cover itself. The package now carries only its own `schemaVersion`,
`mysteryId` and `version`; the digest is computed over the whole package and
held in the pin and registry (`PublishedVersionRef`). Publication time,
provenance and approvals are registry-record fields for M2.1b.

```ts
type Id = string;
type ReleasePhase = "ACT_1" | "ACT_2" | "ACT_3";
type PartyPhase = "LOBBY" | ReleasePhase | "ACCUSATIONS" | "REVEAL" | "COMPLETE";
// Held by a party pin and the registry, never inside the hashed package.
type PublishedVersionRef = {
  mysteryId: Id; version: string; schemaVersion: number; digestSha256: string;
};
type PublicCharacter = {
  id: Id; publicName: string; archetype: string; description: string;
};
type StartingDossier = {
  characterId: Id; biography: string; interpersonalPrompts: string[];
  // Explicitly exclude guilt, crime method, cover story and future clues.
};
type MurdererBriefing = {
  characterId: Id; releasePhase: "ACT_1";
  guiltNotice: string; motive: string; method: string;
  timeline: string; coverStory: string;
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
  schemaVersion: number; mysteryId: Id; version: string;
  title: string; publicSynopsis: string;
  supportedPlayerCounts: number[]; characters: PublicCharacter[];
  startingDossiers: StartingDossier[]; murdererBriefing: MurdererBriefing;
  items: ReleasedItem[];
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
pre-start belongs there. **D-028 fixes the murderer reveal at ACT_1 start.** The murderer receives an ordinary nonspoiler starting dossier in LOBBY under D-023. Guilt, motive, method, chronology and cover story reside in a **separate ACT_1-only MurdererBriefing**, withheld even from that character until the host's authorized ACT_1 transition commits its release. Editorial review must remove indirect guilt and future-act leaks from all pre-start fields. No operating-host projection includes a murderer identifier.
Future-act evidence and the solution never appear in the starting dossier.
`EVIDENCE` means immutable official artifact/observation; personal knowledge
and rumor are not official proof. Public events are distinct announcements.
Solution-only material is not a released item; it is available solely through
the reveal projection after the reveal gate.

Before publication, validate the package schema, canonical ID format and
uniqueness in each namespace; exactly eight distinct playable Blackwood roles
and supported count `[8]`; one spoiler-safe starting dossier per role; exactly one ACT_1-only murderer briefing for the canonical culprit; valid same-version character,
item, objective/relationship, culprit, motive and method references; allowed
audiences, classifications and release phases; valid event ordering; and
solution references. Reject unknown types/fields where they could introduce
unreviewed data. Verify the digest over the defined canonical serialization of the
complete package; the digest is not a package field. Check public fields for
spoilers and review evidence classification, chronology, core clue coverage,
and solvability independently of optional missions; automated validation alone
cannot establish editorial truth or secrecy. The private publishing validator
owns these content checks and runs before publication; the trusted server loader
revalidates package schema and verifies stored bytes against the pinned digest
before serving a version. Actual private content must not be imported by public source builds. Database constraints independently enforce pin and publication
integrity, not editorial validation.

A draft is mutable only before publication. Publication requires validation,
editorial and owner approval, an immutable unique `(mysteryId, version)` and
digest, and retained exact bytes. Never overwrite or reuse a published version,
even for a correction: publish a new version. Party creation pins the exact
published registry version and digest transactionally; a missing private object or digest mismatch
fails closed, never falls back to latest. Retain object versions independently of Vercel
deployments, coordinate DB+object restore/rollback, and prevent deletion while any party references them. A future
schema must enforce immutability and referential integrity; service-role writes
must not bypass publication policy.

The existing placeholder is a **public roster pin, not a published private
version**. Existing parties remain pinned to it and retain their current lobby
behavior; do not attach a new solution to that identifier or silently repin.
**Confirmed compatibility:** deny private-content/game-start reads for placeholder parties with a safe unavailable response. Create a separate new party for published private content; do not silently upgrade, repin or replace placeholder parties.

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
| `getMyMurdererBriefing(partyId)` | Currently assigned participant whose character is the canonical murderer; only after committed ACT_1 briefing release, including a host only when enrolled/assigned | Own briefing only; never from host operations or in LOBBY |
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

**Murderer briefing access:** every caller, including the murderer, is denied before the committed ACT_1 transition. At ACT_1 or later only the **current, legitimately assigned murderer participant** can read their briefing. An unassigned guest, nonplaying host or other participant cannot infer its existence or contents from public role lists, URLs, version identifiers or errors. This check belongs in the server-authorized projection, never client-side hiding.

Even for a playing host, `getHostOperations` remains spoiler-free; the host
obtains their own dossier only through the separate participant-authorized
read. Neither host ownership nor a participant assignment expands the other
projection's privileges.

No phase check is satisfied by a URL, local clock, navigation, or mission
completion. `LOBBY` has no released act items or murderer briefing; `ACT_1`–`ACT_3` expose only
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
* **Invalidation:** Reuse the lobby's authenticated polling as a version/invalidation
  signal, not a content-bearing push event. On change, fetch a fresh authorized
  projection; do not send private content through notifications, Realtime or
  broadcast channels. Stop polling on denied access, and recheck on reconnect.
* **Private storage and integrity:** Test that ordinary browser Supabase identities, hosts and guests cannot read package objects directly; no public object URLs/signed URLs or private paths in serialized responses. Verify immutable digest, missing-object fail-closed behavior and continued old-version availability across new publication and app rollback.
* **Privilege:** Service-role credentials stay server-only, never in
  `NEXT_PUBLIC_` variables, client bundles, logs or previews connected to
  production. Narrow RPCs/grants and input checks are required because service
  role bypasses RLS; direct browser database queries must not read private
  content or mutate releases.

Future automated negative tests include a unique synthetic murderer guilt/method sentinel that is **absent even for the murderer in LOBBY** but present for the correctly assigned murderer after an authorized ACT_1 start. Also test denied direct private storage reads and prior version preservation.

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
by this ADR. Owner decisions D-026–D-028 settle private future content, preserved versions and ACT_1 murderer timing; they **do not authorize private content publication, migration, or production setup**. Narrative/editorial signoff for O-009–O-016 remains separate.

1. **Package boundary and validation:** *Split into M2.1a and M2.1b. M2.1a
   (schema, validation, canonical encoding and digest as a pure module with
   synthetic fixtures) is implemented; see the
   [package contract](mystery-content-package.md). The loader, registry,
   projections and storage checks below are M2.1b and are not started.*
   With the approved architecture but without permission to provision production infrastructure,
   implement private object loader, published-version registry, schema validation, digest and safe projections
   using synthetic fixtures only, no real Blackwood publication; verify private bucket access and nonoverwriting publication behavior. Specify published
   version/pin constraints in a reviewed migration if needed; retain placeholder
   behavior. Acceptance: validation rejects invalid references/counts/phases
   and mutations, host-only projections, logs, bundles and responses exclude
   synthetic dossiers, future text and solution, and old pins fail closed.
   Unit tests, build/chunk checks and local pgTAP for any migration.
2. **Own pre-start dossier:** After editorial approval of spoiler-safe starting content, add server reads and UI for assigned participants only,
   including playing host. Add necessary version/digest and authorization RPC
   migration, not content in public SQL seeds. Acceptance: D-023, cross-role,
   host isolation, removal/recovery/stale-JWT and cache tests pass on disposable
   local Supabase and desktop/mobile Playwright. No start-game behavior.
3. **Start and Act I:** After readiness and Act I content approval, extend
   `LOBBY`-only schema with reviewed phase/release state and atomic idempotent
   host transition. Proposed minimum readiness: eight distinct current enrolled
   participants each assigned a different one of the eight roles, including the
   host only if enrolled; any additional readiness conditions need owner review.
   Acceptance: that minimum, no pre-start murderer guilt leakage, a committed ACT_1 briefing available only to the murderer, concurrent/replayed
   transitions and public/private release isolation tested with pgTAP and
   browser integration. No mission gate.
4. **Later acts and reveal:** Separate small issues for each authorized phase
   and eventually reveal, after relevant content, accusation/lock and transition
   decisions are approved. Extend transition constraints and tests per slice;
   verify future-phase denial, retained prior releases, independent host/player
   views and no early solution. Do not assume undecided scoring or force-lock.

Each slice requires current-SHA independent CI, unit, lint, typecheck and build;
schema/auth changes additionally require local pgTAP and relevant desktop/mobile
Playwright. Review private object-store privileges and retained versions, migrations, **DB and object backups**, exact target and rollback, then obtain
specific human approval before any production migration. Apply and verify
approved schema before an app that depends on it; coordinate package
availability/pins and retain rollback compatibility. Verify production
deployment and safe smoke test separately under
[production operations](../production-operations.md). No agent or CI production
migration, private publication or manual deployment is authorized by this ADR.
