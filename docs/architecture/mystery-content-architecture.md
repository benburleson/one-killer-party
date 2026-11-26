# Versioned mystery content and spoiler-safe projections

**Accepted architecture (D-026–D-028).** The private immutable package and registry, MFA-guarded Production publisher and synthetic rehearsal are implemented. The application still supports **LOBBY only**; character-specific dossier delivery and game progression remain future work. This document is a design contract, **not** permission to publish real story content or expose a full package to players. Read [Production operations](../production-operations.md) for live configuration and maintenance, and the [package contract](mystery-content-package.md) for actual implementation details.

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

**Selected: private-object-store + Postgres hybrid**, not Copilot's initial server-bundled hybrid. Use an access-controlled **private Supabase Storage bucket** for versioned, immutable JSON mystery packages; a **restricted Postgres registry** stores only package identifiers, schema versions, SHA-256 digests, private object locators, publication provenance and approval metadata. Parties, assignments, identities, phases, releases and accusations remain authoritative in Postgres. Trusted operators publish package bytes; at runtime the Next.js server accesses them only through a trusted loader and must construct allowlisted public/host/participant projections after fresh database authorization.

| Alternative | Strength | Reason not selected for the first prototype |
| --- | --- | --- |
| Complete private package in server-only source files in the existing public repo | Simple TypeScript authoring/build validation | Public repository and Git history expose spoilers; server deployments must carry old packages |
| Private authoring repo injected into Vercel build + Postgres state | Private edits and deterministic deployment | Requires coordinating packages with each build and retaining old versions across deployment rollbacks |
| Fully normalized private Postgres content tables | SQL constraints, one persistence system | More tables, RLS/RPC authoring surface and migration coupling than needed for one mystery |
| **Private Supabase Storage immutable object + Postgres state (selected)** | Story is outside public Git, unchanged across app deploys, package publication separated from gameplay transactions | Requires trusted publication tool, object/DB backup compatibility and server-only access |
| New third-party private CMS/object store | Useful for a future authoring platform | Additional vendor/operational overhead and security boundary |

**Private-source policy (D-026):** Do not commit new private dossiers, murderer revelations, solution text or future clues to this public repo, SQL migrations, test fixtures, issues or PR discussions. Author them in an access-controlled private editorial source, reviewed by an authorized editor. The exact private editor/repository is an operational choice, not a dependency on the runtime. This repo may retain **synthetic** test packages and spoiler-free public metadata.

**Publication security design:** A dedicated MFA-authenticated operator can publish only through a narrow guarded RPC and private object policy. Exact-reference publication validates canonical bytes, requires explicit project/version/digest approval, and never overwrites a published identity. Storage upload and registry registration are not atomic, so recovery must account for orphan objects. Infrastructure administrators and trusted signing authorities remain trusted. For executable behavior consult the [CLI](../../scripts/mystery-publish.mjs), [migrations](../../supabase/migrations/) and [Production operations](../production-operations.md).

**Preserved versions (D-027):** Every party keeps its exact pinned **published version and digest for its lifetime**, unaffected by new packages or Vercel releases. Corrections become new versions; do not mutate or upgrade existing parties, and do not fall back to latest if pinned object is missing. New parties can pin a newly approved version at creation. Retain published objects while referenced, including across deploy rollback, with durable object + database backup and restore, hash verification and schema compatibility checks. A missing/mismatched object fails closed with a safe unavailable response. Cache verified immutable package bytes only inside a trusted server, keyed by immutable version+digest; never cache user-specific authorization results across callers. For old application deployments unable to interpret a newer schema, prevent creating new parties using that schema until deployed code supports it, while existing party versions remain retrievable.

**Existing placeholder parties:** `blackwood-affair / first-playtest-placeholder-v1` is a **public roster placeholder**, not a published private mystery package. Keep such parties in their existing public lobby and deny private dossier/game-start reads. For a playable version create a **new party** pinned to an approved published package; do not silently repin existing parties or overwrite that identifier. Any exceptional upgrade/recreation policy would need a new owner-approved decision.

**Public-repo history cannot be retroactively private:** `docs/product/blackwood-affair.md` already includes spoiler text in public Git and historical commits. The decision protects **future private content**; it does not make those existing spoilers secret. Any removal/redaction from the public repository, handling of clones/caches or transfer to private editorial source is a **separate explicitly reviewed task**. Do not delete or rewrite existing canonical story in this ADR.

**Current Production operations, publication evidence and remaining maintenance:** [Production operations](../production-operations.md). This ADR states design intent; it does not duplicate mutable environment status or test results.

## Implemented package contract

Do not duplicate executable type definitions, validation constraints or encoding rules in this architecture decision record. See [the package implementation guide](mystery-content-package.md), which links to the authoritative source in `src/lib/mystery-content/` and its tests. The essential architectural choice is the split between canonical private payload bytes, an exact content identity/digest reference, and privately registered publication metadata; none of these grants authorization to disclose a dossier.

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

## M2.2 — Approved private dossier delivery (2026-11-26)

**Implementation in progress; not ready for activation or deployment.** D-030–D-035 in the [decision register](../product/decisions-and-open-questions.md) govern this slice. M2.2 remains LOBBY-only.

### Published party creation

Use a restricted database-backed singleton active-version pointer for the first mystery experience. Publication and activation are separate owner-approved operations: a published test package is not automatically eligible for ordinary Production party creation. Activation references the complete immutable registry key and is permitted only for a verified, supported, explicitly approved package. No host/guest/browser activation API or runtime service-role activation grant; use a narrow owner-controlled operational path with exact target and reference verification. Local/CI may activate synthetic packages in disposable environments.

An explicitly absent active pointer permits legacy lobby creation; lookup errors, malformed pointers, missing objects or integrity failures must fail closed, never silently create a placeholder. Existing legacy parties retain their original pin and public functionality. New published parties pin mystery ID, version, schema version and digest, with an exact registry foreign key and immutable pin protection. Null schema/digest are allowed only together for the exact legacy pin. Activation changes affect new parties only.

The server verifies the active package and constructs a public roster projection. In the creation transaction, validate that the selected active reference is still current (including the absent-pointer case), persist the pin, register verified playable character IDs and create the invitation atomically. Serialize activation and creation or use equivalent atomic compare-and-retry semantics. A same-host idempotent creation retry returns the existing party before resolving current activation or loading content; never repin, regenerate its invitation or disclose another host's party. Preserve collision handling. If activation changes mid-create, safely retry or report unavailable. The server is trusted to supply IDs from the verified package; browser input is not authoritative.

Adapt all placeholder-specific reads, assignment restrictions and capacity checks, including guest join and explicit host enrollment, to the supported eight-role rule set. Preserve uniqueness, registered-character foreign keys, version checks and existing lobby behavior. Resolve public labels from the exact pinned package, not the active pointer. Legacy catalog is only for the exact legacy pin. Do not persist authored text in runtime tables.

### Dossier delivery

Reuse the trusted loader and separate server-only allowlisted response types. Verify the current Auth principal and obtain a party-scoped membership/assignment/phase/pin snapshot from a service-only read. Require an enrolled assigned participant in LOBBY with a published pin. After asynchronous package verification, repeat authorization and compare the relevant snapshot (including party version to detect intervening changes); deny or retry safely on mismatch. No character ID supplied by the caller selects private content. A playing host uses this same participant path. Host operations never contain private dossiers.

Construct only the assigned public identity, starting biography, relationship perspectives with public labels and interpersonal prompts; never spread the full definition or branch on murderer identity. No act items, objectives, briefing, solution, private object locator or registry metadata in browser responses. Fetch on deliberate My Character open, not in lobby polling or prefetch. No persistent package cache in this slice; all personalized delivery is private/no-store and dynamic. Reuse existing polling for invalidation, discard late responses, clear private view on authorization/assignment changes and revalidate on foreground/reconnect/back navigation. Do not retain offline dossier access. Reassignment and removal remain permitted with a warning that previously read secrets cannot be recalled. Recovery rebinds the same participant and assignment; old principal loses subsequent reads even with a valid JWT. No read receipts or additional readiness state.

### Delivery sequence and acceptance

1. Published-party creation and activation, immutable pins, public projections and legacy regressions.
2. Server-only authorized dossier service, including race and negative tests.
3. Player/playing-host UI and lifecycle reconciliation.
4. Production-build browser isolation, serialization, cache and end-to-end milestone validation.

Each slice includes its own security tests and independent CI; the last slice supplements rather than substitutes for those tests. Use distinct synthetic sentinels for each dossier and every unreleased content class. Assert both authorized content presence and unauthorized absence, including murderer in LOBBY. No game start or later phase implementation. Engineering completion uses synthetic content and disposable local/CI services; real Blackwood editorial completion, publication and activation are separate owner-approved work. Maintain real authored packages in a separate private GitHub repository, never a public build dependency. Existing public spoiler history remains O-033. No Production migration, activation or publication is authorized by this decision.

## Editorial gates and implementation roadmap

The [Blackwood draft](../product/blackwood-affair.md) contains draft, not
automatically approved canon. Resolve **O-009–O-016**: chronology and Act I
timing, location/footprint consistency, injury findings, delayed recollection,
clue classification, independent solvability, reveal balance, and incomplete
objectives/relationships. Motive/method choices and related gameplay questions
remain open. No new clues, answer options, objectives or story text are specified
by this ADR. Owner decisions D-026–D-028 settle private future content, preserved versions and ACT_1 murderer timing; they **do not authorize private content publication, migration, or production setup**. Narrative/editorial signoff for O-009–O-016 remains separate.

1. **Package boundary and private persistence:** *Split into M2.1a and M2.1b.
   M2.1a's schema, validation, canonical encoding and digest remain a pure
   module with synthetic fixtures; M2.1b adds local-only private storage,
   immutable registry, operator publisher and exact-reference server loader.
   See the [package contract](mystery-content-package.md). No projections,
   party digest pin, game start, Production credential issuance, publication
   or rehearsal are implemented or authorized.*
   Local pgTAP and Storage integration verify browser denial, immutable
   registration and objects, safe retry/orphans, exact-version loading, and
   placeholder compatibility. M2.2 remains responsible for fresh party/member/
   assignment authorization and allowlisted own-dossier projections. It must
   not expose full packages through host operations, logs, bundles or responses.
2. **Own pre-start dossier (M2.2):** Follow the approved M2.2 sequence above. Real editorial approval is a separate publication gate, not an engineering dependency.
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
