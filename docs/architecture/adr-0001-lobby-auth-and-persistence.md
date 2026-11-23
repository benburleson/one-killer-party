# ADR-0001: Lobby authentication and persistence

**Status: Partially approved — D-020–D-025 confirmed; infrastructure/content decisions remain open**

The M1.3 schema boundary, local commands, and deliberate no-browser-access
policy are documented in [Lobby persistence and local database](lobby-persistence.md).

## Product-owner decisions recorded 2026-11-20

The following decisions are now **CONFIRMED** in [the decision register](../product/decisions-and-open-questions.md), superseding the original "Awaiting owner approval" language where it refers to these exact policy choices:

- `D-020 / O-001`: Supabase **email magic-link** host authentication. Email delivery and safe redirect/callback implementation remain technical work.
- `D-021 / O-002`: individual low-friction authenticated guest identity and **host-assisted recovery** for a lost session. Never transfer membership on name or join code alone. Secure one-time credentials, host verification, audit and session revocation are mandatory security design work; exact mechanics are not yet approved as product policy.
- `D-022 / O-003`: the host may participate or organize without playing. The initial Blackwood story has **eight total playable character slots**, whether or not the host plays. Host and participant scopes remain independent.
- `D-023 / O-006`: public role shown upon assignment; **starting private dossier** accessible to its assigned player before the game starts; all future-act content remains phase-gated. Do not reveal murderer/solution information through host controls.
- `D-024 / O-004`: one reusable party invitation link and equivalent eight-character human-readable code valid while lobby admission is open; host may revoke/regenerate. Cryptographically strong random generation, verifiers, rate limits and generic failures mandatory; distinct single-use recovery tokens.
- `D-025 / O-004,O-005`: exactly eight playable Blackwood slots; host counts only if playing; duplicate display names allowed with host-side disambiguation; before start host may remove/replace participants and change assignments with confirmation. After start no new participants or ordinary role changes, but existing members can reconnect or use approved recovery.

Still **OPEN**: O-025 environment/operations authorization; O-026 content storage; O-027 public story disclosure. The exact invitation alphabet, abuse thresholds, session revocation and recovery credential mechanics require secure implementation and testing, but the policy in D-024/D-025 is confirmed. A shared multi-guest party invite must not be confused with a single-use participant recovery credential.

This ADR proposes a security and persistence boundary for the multiplayer
lobby. It does not approve any open product decision, define a migration, or
authorize a Supabase project change. Recommendations marked **Awaiting owner
approval** must remain proposals until the product owner records a decision in
the [decision register](../product/decisions-and-open-questions.md).

## Context and invariants

M1.1 defines a party pinned to a mystery ID/version, a host authenticated
principal, a party version and an opaque join-code reference. A participant has
its own ID and authenticated principal; a host is a participant only when a
separate participant record exists. Its explicit `HostLobbyView` and
`ParticipantLobbyView` projections expose only safe party metadata, public
character information and the authorized assignment.

Those projections are filters, **not authentication or server authorization**.
Every server entry point must verify the authenticated principal and durable
party/host/participant membership. A party join credential is an entry
reference, not authority to assume a participant identity, read private role
data, or operate host controls. Enforce unique `(party_id, principal_id)`
membership and `(party_id, character_id)` assignment constraints in the
database, and use atomic mutations with an optimistic party-version check.

Terms in this ADR:

- **Join credential:** a party invitation/code used to request entry. It does
  not identify or authenticate an existing participant.
- **Participant session:** an authenticated principal and its separately
  persisted participant membership. It is the basis for own-participant reads.
- **Recovery credential:** a separate, revocable credential for restoring one
  participant membership. It must not be the join credential or display name.

## 1. Host authentication — O-001

### Options

| Option | Delivery and callback | Recovery and rate limits | Preview and operations |
|---|---|---|---|
| Supabase email magic link | Low-friction email; requires reliable delivery and a callback URL allowlist. Link scanners, delayed mail, expired links and opening on another device can complicate completion. | No password to reset, but account recovery depends on access to the registered mailbox. Throttle requests and verify provider limits and email configuration. | Each environment needs correct redirect URLs; arbitrary preview URLs should not be broadly allowlisted. Requires configured email delivery, templates and monitoring. |
| Supabase email/password | No magic-link delivery at sign-in, but requires password setup, secure reset email and password handling. | Familiar reset flow; password stuffing, reuse and reset abuse require rate limiting and recovery controls. | Same redirect and email-delivery concerns for reset confirmation. Password policy and support expectations add operational work. |
| OAuth provider | Redirects to a provider and returns through an auth callback; provider-specific consent and account linking affect onboarding. | Recovery is delegated to the provider; account changes and provider outages become dependencies. | Requires provider app registration, secrets, callback and preview configuration, plus review of provider availability and terms. |

### Recommendation

**Proposed default: Supabase email magic link for hosts**, with explicit
environment-specific callback URLs, throttling, and a tested recovery path.
This keeps host onboarding passwordless while retaining an individual
authenticated principal. Email delivery and cross-device callback behavior are
real dependencies, so a failed/delayed email must not silently create a party
under an unverified identity.

Do not treat a Vercel preview hostname as automatically trusted: allow only
approved preview callback patterns or use a stable, controlled preview domain.
Keep local, preview, and production auth configuration separate. Never put
provider or service-role credentials in browser code.

**Approved — D-020 (formerly O-001):** use Supabase email magic links. Confirm email provider/delivery and redirect security during M1.4 implementation.

## 2. Guest identity and recovery — O-002

### Identity options and behavior

| Option | Refresh and same-device return | New browser / lost device | Logout, expiry and theft |
|---|---|---|---|
| Supabase anonymous authenticated principal | An auth session can survive refresh and same-device return if the SDK persists its cookie/storage and refresh token. Browser storage clearing, private browsing or expiry can lose it. | It does not automatically transfer to another browser/device. A lost session cannot be reconstructed from a display name or party code. | Logout removes the local session; expiry/refresh behavior must be tested. A stolen active session can act as that principal until revoked/expired. |
| Conventional guest account (email/password or OAuth) | Reauthentication can restore identity on the same or another browser. | Account recovery can restore identity, but adds registration friction and email/provider dependencies. | Logout is conventional; stolen credentials or active sessions remain a risk and need revocation/recovery controls. |
| Host-issued persistent participant credential | A participant can restore membership by presenting a separate high-entropy secret, subject to its storage and expiry policy. | It can work across browsers, but loss of both the credential and original session still needs a recovery process. | Logout should invalidate the local session, not necessarily the recovery credential. Theft enables impersonation until the credential is revoked or rotated. |

### Recommendation and mandatory boundary

**Proposed default: Supabase anonymous authenticated principal per guest, plus
an owner-approved recovery process.** The server creates a participant row
bound to that principal after a successful join. Refresh/reconnect uses that
authenticated principal to find the same membership; it does not use a party
code, display name, participant ID supplied by the browser, or a guessed role.
A new browser/device is a new principal unless an approved recovery flow
explicitly transfers the existing membership.

Join code + display name must **never** let a person take over another
participant's identity or access their assignment, dossier, clues or session.
Use nonrevealing errors for invalid/expired credentials, avoid confirming
whether a participant name exists, and rate-limit attempts. A join credential
may establish a new participant only while policy allows; it must not attach an
existing participant membership by name or ID.

### Recovery choices for owner review

1. **No recovery / rejoin as a new guest:** simplest and avoids a recovery
   secret, but can leave a disconnected participant's role stranded. It must
   not permit silently taking over that role.
2. **Participant-held recovery secret:** issue an independent, high-entropy,
   single-use credential at enrollment, show it once, store only a verifier,
   and provide a controlled rotation/revocation flow. Recovery must be
   single-use, expire, and invalidate the prior recovery credential. Lost
   storage still means loss.
3. **Host-assisted reissue:** an authenticated host initiates a one-time,
   short-lived reissue for a participant, but must not see the participant's
   prior secret or private data. Require a deliberate out-of-band identity
   check, audit the action, revoke prior recovery credentials and sessions
   where supported, and notify the affected guest through an independent
   channel when possible.

Host-assisted reissue has residual social-engineering risk: a host can be
deceived about who is present, and the platform cannot prove in-person identity
from a display name. It must not allow the host to read or impersonate the
participant's content. A stolen active browser session can still impersonate
that guest until the session is revoked or expires. Host logout must end host
authority; if the host also plays, it must not implicitly log in or out the
separate participant membership.

**Approved direction — D-021 (formerly O-002):** support low-friction independent guest authentication with host-assisted identity recovery. M1.5 must specify and test host verification, one-time reissue, audit and token/session revocation before shipping.

## 3. Host as player — O-003

Keep party host authority and participant membership as **separate records and
scopes**. A host may play only when an explicit participant membership exists;
the host's participant access is then limited to that participant's own
assigned role, like any other player. Do not infer participant membership from
the host principal or host status.

Host operations may return membership, public roster, assignments and safe
readiness state. Host authority grants no access to the solution, culprit
marker, another participant's dossier, private clues or unreleased truth. If a
host's own legitimately assigned character contains private information, it
must be read only through the participant scope and the approved release
schedule. There is no host-as-player secret bypass.

Whether a nonplaying host is allowed and whether the host counts toward any
participant capacity remain **unresolved product choices**, not platform
defaults.

**Approved — D-022 (formerly O-003):** the host may be nonplaying or one of the eight playable Blackwood characters. Readiness counts eight assigned player-character slots, not a mandatory host membership.

## 4. Other lobby policy choices — O-004, O-005 and O-006

These policies are explicitly not settled here:

| Decision | Still open (do not encode as a default) | First implementation issue requiring approval |
|---|---|---|
| O-004 | Capacity; duplicate-name behavior; invitation/code format, entropy and expiry; whether invitation links and codes differ; rotation/revocation. | **M1.4 party creation** needs invitation issuance; **M1.5 guest joining** needs code validation, capacity and duplicate handling. |
| O-005 | New late joins; removal; replacement; whether a participant can change identity or role; behavior before and after game start. | **M1.5 guest joining** must know who may join and when. **M1.6 assignment** must know removal/reassignment behavior; post-start changes require a separate gameplay-state decision before implementation. |
| O-006 | When private role/background, murderer information and other private knowledge become visible: on assignment, game start, or act-by-act. | **M1.6 assignment** can create assignments without releasing secrets; private content delivery in **M1.7 realtime/reconnect** or a later content issue must wait for the owner-approved release rule. |

**Approved:** D-024/D-025 resolve O-004/O-005 for the first Blackwood experience. The party invitation is multi-use during lobby admission, while recovery is participant-specific and single-use. D-023 resolves O-006: expose public role at assignment and starting private dossier before play; future-act releases stay gated. Exact secure token/randomness/rate-limit implementations and later-game exceptions remain engineering/future product work.

## 5. Persistence and spoiler safety — O-025, O-026 and O-027

The following is a **logical model only**, mapped to M1.1 TypeScript contracts.
It is not SQL, a migration, a settled naming scheme, or authorization to create
or modify a database.

| Logical entity | Minimal proposed fields and constraints | M1.1 mapping / boundary |
|---|---|---|
| `parties` | `id`; `host_principal_id`; `mystery_id`, immutable `mystery_version`; `status`; monotonic integer `version`; timestamps. Index host and status/time as needed for host party listing. | `LobbyPartyRecord.id`, `hostPrincipalId`, `mysteryId`, `mysteryVersion`, `status`, `version`. The join credential itself is not part of a client projection. |
| `participants` | `id`; `party_id` FK; `principal_id` (auth provider identity); `display_name`; nullable `assigned_character_id`; timestamps/state only when approved. Unique `(party_id, principal_id)` and unique `(party_id, assigned_character_id)` when assigned; index `(principal_id, party_id)` for identity-scoped lookup and `(party_id, id)` for roster projection. | `LobbyParticipantRecord.id`, `partyId`, `principalId`, `displayName`, optional `assignedCharacterId`. A participant is not implied by the host row. |
| `public_character_roster` (optional reference) | Stable character ID plus approved public name/archetype, keyed by immutable mystery/version and character ID. No private dossier or culprit marker in the public table. | `PublicCharacterRosterEntry.id`, `publicName`, `publicArchetype`. May be derived from a safe server-side content projection instead of persisted separately. |
| `invitation_credentials` | Credential ID; `party_id` FK; verifier/hash; purpose; created/expiry/revocation timestamps; optional nonsecret audit metadata. Shared invitation codes are reusable while admission is open; single-use consumption applies to recovery credentials only. Index unique active verifier and `(party_id, expires_at)` for lookup/cleanup. Do not store raw bearer codes. | Resolves the M1.1 `joinCodeReference` to a credential record; neither raw code nor reference is returned in `HostLobbyView` or `ParticipantLobbyView`. |

Unique constraints are required even when server checks exist: one principal's
membership per party, one participant per character assignment per party, and
one active invitation credential verifier (plus approved accusation/release
uniqueness in later slices). Use foreign keys and party-scoped composite
constraints where needed to prevent cross-party assignment references. Make
`mystery_id` + `mystery_version` immutable for a party. Use a compare-and-swap
predicate on party version for concurrent mutations; commit the mutation,
incremented version and any audit/release event atomically. Duplicate retries
must be idempotent and a stale version must return a safe conflict plus
authoritative-state refresh instructions.

### Invitation credential recommendation

The public code format is approved as eight easy-to-type characters (D-024). Independently of
that choice, recommend a cryptographically random, high-entropy invitation
secret, stored server-side only as a verifier/hash; return the raw value only
at issuance and never log it. Use rate limits and generic failures to reduce
enumeration. If a human-readable short code is selected, it has lower entropy
and requires stricter throttling, monitoring, short lifetime and rotation. Do
not assume that hashing alone makes a low-entropy code resistant to offline
guessing. Keep any re-entry/recovery credential separate, participant-specific,
single-use, expiring and revocable.

### Data lifecycle and private-content placement

- Store only the minimum host/participant identity and party runtime data needed
  for play. Do not add analytics, guest contact details or retention periods
  without resolving O-029.
- Expire or revoke invitation and recovery credentials on consumption,
  rotation, party closure or approved recovery as applicable. Define record
  deletion/archive and backup restoration behavior in the authorized migration
  and operations work; do not invent a retention duration here.
- Never include auth tokens, raw invitation/recovery secrets, private dossiers
  or solution material in logs, error responses, telemetry, screenshots or
  CI artifacts. Use synthetic fixtures only.
- Keep the authored mystery definition, character-private payloads and
  solution/answer key in a server-only boundary. A public roster is a strict
  allowlist; do not put a culprit flag or private columns in a table accessible
  to browser roles.
- M1.1 host and participant projections must remain explicit safe projections.
  Principal IDs, invitation references, private role data, the solution and
  unreleased truth are absent.

**Awaiting owner approval — O-025:** separate production environment, backups,
retention, migration and recovery expectations. Migration implementation is complete, but future deployments require separately authorized
isolated test database setup.

**Awaiting owner approval — O-026:** choose server-only content storage (versioned
JSON, normalized tables, or hybrid), publishing/versioning and deployment
boundary before the first private-content implementation (**M1.6/M1.7 or a
dedicated content-delivery issue**).

**Awaiting owner approval — O-027:** decide public repository/story/IP and
spoiler disclosure before any release, artifact or deployment can expose
authored mystery material; this is a gate for public-content deployment and
portfolio disclosure, not a reason to include spoilers in lobby views.

## 6. Access control recommendation

**Recommendation:** deny by default; authenticate and authorize every request
server-side; enable and review Postgres RLS on browser-exposed tables; use
server-side transaction/RPC boundaries for multi-row mutations, invitation
consumption, assignment and version checks. RLS is defense in depth, not a
substitute for validating the request's operation and object ownership. Never
ship a Supabase service-role key to a browser. Because service-role access
bypasses RLS, privileged server code must independently authenticate, authorize
and project the response.

| Caller | Safe public party/roster data | Own membership / role data | Other participant private data | Host operations | Solution / unreleased truth |
|---|---|---|---|---|---|
| Visitor (no invitation) | Public catalog/approved public metadata only; no party lookup by arbitrary ID. | Deny. | Deny. | Deny. | Deny. |
| Unjoined invited visitor | Validate invitation and receive only the minimum join response; no guest list or party details before joining beyond approved public preview. | May create a new membership only through an authorized, unused invitation and approved join policy. Cannot select/claim an existing participant. | Deny. | Deny. | Deny. |
| Authenticated party member | Approved safe party metadata and public roster. | Own participant membership, public assignment and own content only when released. | Deny, including by changing participant/character IDs. | Deny unless independently authenticated as host. | Deny, except private truth intentionally assigned to this participant through the approved release channel; never via host authority. |
| Other party member | Same approved public metadata. | Their own membership only. | Deny direct access to this participant's private dossier, clues or session. Voluntary in-person sharing does not change API permissions. | Deny. | Deny. |
| Host (party host principal) | Host-safe roster, names, public assignments, status, readiness and public metadata. | Own host membership only if an explicit participant row exists. | Deny all participant-private data, including a host's player's data in host scope. | Allowlisted host operations after server verification, party ownership check and version/state preconditions. | Deny. Host controls never imply author/editor or solution access. |
| Host-as-player (both scopes, separately checked) | Host-safe data through host scope; own participant data through participant scope. | Own assigned character only through participant scope and approved release timing. | Deny all other participant-private data. | Host operations through host scope. | Deny solution/other-player secrets. If legitimately assigned the culprit, only that character's approved private payload is accessible through participant scope, not host scope. |
| Privileged server / content author | No browser-style blanket access is implied. | Access only as required for a specific authorized server operation. | Query narrowly and project for the authenticated caller. | Execute reviewed operation after explicit authorization. | The server-side content boundary may hold solution material for a narrowly authorized reveal/authoring operation; never serialize it early or send it to ordinary host/participant endpoints. |

`auth.uid()`/authenticated principal must be matched to durable membership in
the same party. Avoid policies that trust a caller-supplied party ID, participant
ID, role, host flag or client-side claim. Review RLS for both reads and writes,
including views, RPCs, storage objects and Realtime publication. For security
definer RPCs, restrict execution grants and pin a safe `search_path`; ensure
server-only solution tables are not exposed through browser-accessible schemas
or policies. Each migration needs negative cross-party and cross-participant
tests before merge.

## 7. Realtime, retries and reconnect

- Broadcast **nonsecret change signals only** (party ID or opaque event/version
  marker as authorized, changed version and event category). Do not broadcast
  names, assignments, invite codes, dossiers, clue text, recipient lists or
  solution fields unless each recipient-specific content path is separately
  authorized; the recommendation is to send none of those in broadcasts.
- On a signal, the client refetches canonical state using its current
  authenticated principal. Apply the same server authorization/RLS path used by
  direct fetches. Signal receipt is never an authorization grant.
- Reconnect reloads canonical party version and own permitted content; it must
  not rely on replaying an untrusted/local event queue. If auth is lost, require
  sign-in or the owner-approved guest recovery path. Never let a party code
  restore an old participant identity.
- Mutations carry an expected party version and stable idempotency/action key.
  Commit the state change, incremented version and event/release record
  atomically. On duplicate action return the original result or current safe
  state; on stale version reject and prompt authoritative refetch.
- Concurrent joins, credential consumption and assignments must be serialized
  or protected by database constraints/transactions. Do not rely on realtime
  message ordering, client locks or optimistic UI to prevent double joining or
  duplicate assignments.

## 8. Environment isolation and deployment boundary

**Implemented:** M1.3 migrations/RLS and M1.4 host authentication/party commands are tested against disposable local Supabase in Codespaces and CI. The owner verified both migrations were subsequently applied to the linked production Supabase project. Magic-link host sign-in was smoke-tested on `https://app.onekillerparty.com/host`. Hosted Supabase custom SMTP was also configured by the owner for broader email delivery; operational settings and verification are recorded in [production operations](../production-operations.md).

- Local and CI tests must use isolated synthetic accounts/data, never production secrets or production resets.
- Privileged service-role credentials are server-only, scoped to each deployment environment; do not grant browser roles direct table access.
- Vercel previews must not use production database/auth/service credentials. Until a dedicated preview backing environment is configured, do not claim preview host-flow isolation or run real data mutations.
- Production migrations are separate, explicitly authorized operations: review project identity, backups/recovery requirements, and migration diffs before applying. A successful past migration is not permission to automatically apply future ones.
- **Still open (O-025):** production backup/restore rehearsals, data retention, disaster recovery and fully isolated preview/testing environments.

## 9. Threat model and mitigations

| Threat | Primary mitigation / verification |
|---|---|
| Join-code enumeration | High-entropy random invitation secret where product permits; verifier/hash at rest; throttling, abuse monitoring, generic failures, expiry/rotation. Validate short-code risk before approving O-004. |
| Stolen host or guest session | Secure session storage/cookie settings, short/appropriate expiry and refresh policy, reauthentication/revocation path, device-loss response; never treat recovery as proof of in-person identity. |
| Cross-party IDOR | Derive caller principal from auth, constrain every query and mutation by party membership, FK/unique constraints and RLS; test arbitrary party/participant IDs. |
| Host privilege escalation | Separate host and participant capabilities; allowlist host actions/views; no role-secret/solution access from host APIs; test direct server requests, not only UI. |
| Mistaken RLS policy | Enable/review RLS for every exposed table/view/storage/realtime path; default deny; run positive and negative DB integration tests using distinct caller roles. Review service-role bypass separately. |
| Concurrent assignment or double join | Transactional credential consumption and assignment, unique DB constraints, optimistic party-version check, idempotency keys; race tests with parallel requests. |
| Credential replay | Single-use/expiry/revocation state for invites or recovery credentials as approved; atomic consume; log nonsecret audit metadata and reject replay generically. |
| Secret bundling or unsafe projections | Keep authored solution and private dossiers server-only; explicit allowlisted projections; scan built/client responses and direct URLs for secret markers; no reliance on CSS. |
| Public-repo spoilers | O-027 approval before publication; separate/withhold private authoring data as selected; avoid spoiler content in issue text, source, fixtures, PR artifacts and logs. |
| CI screenshot/log leak | Synthetic fixtures only, no real sessions or production data; redact errors; artifact review and bounded retention; never capture credentials, private dossiers or actual party content. |
| Realtime leakage or forged events | Nonsecret notifications, authenticated channel controls and authoritative refetch; direct broadcast subscription must not bypass RLS or content authorization. |
| Lost anonymous session / social engineering | No identity recovery via name/code; explicit owner-approved recovery, one-time expiry/revocation, host action audit and clear residual impersonation risk. |

## 10. Decision register

Nothing below changes the product decision register. Every item marked
**Awaiting owner approval** remains OPEN until an owner review is recorded.

### (a) Owner decisions and remaining recommendations

| Spec ID | Proposed recommendation / unresolved choice | Future blocked issue |
|---|---|---|
| O-001 → D-020 | **Approved:** host email magic link. Verify delivery and callback/preview configuration during implementation. | M1.4 party creation / host authentication |
| O-002 → D-021 | **Approved direction:** independent low-friction guest identity and host-assisted recovery; design and validate reissue, session loss, revocation and expiry. | M1.5 guest joining |
| O-003 → D-022 | **Approved:** optional host participation and eight Blackwood player roles total; independent scopes. | M1.4 creation and M1.6 assignment/readiness |
| O-004 → D-024/D-025 | **Approved:** eight Blackwood slots, duplicate names allowed with disambiguation, shared reusable eight-character invitation code/link while lobby open, host regeneration; cryptographic generation and abuse mitigation required. | M1.4 invitation creation and M1.5 joining |
| O-005 → D-025 | **Approved:** pre-start removal/replacement/reassignment with confirmation; no new participants or ordinary reassignment after start; existing guest reconnect/recovery allowed. | M1.5 joining; M1.6 assignment; later game-state implementation |
| O-006 → D-023 | **Approved:** public role at assignment, own starting private dossier before game starts; future-act content phase-gated. | M1.6 assignment/private content and M1.7 reconnect/realtime content |
| O-025 | **Partially implemented:** M1.3/M1.4 migrations are owner-reported as deployed and local/CI DB isolation is in place; M1.5/M1.6 rollout status is unverified. Backup/restore, retention, preview isolation and future deployment approval remain open. | Production operations and future migrations |
| O-026 | **Awaiting owner approval:** server-only mystery storage, publication/versioning and authoring access. | M1.6/M1.7 private-content delivery or a dedicated content issue |
| O-027 | **Awaiting owner approval:** public repository and story/IP/spoiler boundary. | Any public story/content release, deployment or portfolio disclosure |

### (b) Reversible engineering recommendations (not product policy)

- Implement explicit safe projections and server-side authorization in addition
  to deny-by-default RLS; keep service-role credentials server-only.
- Use unique constraints, foreign keys, transactional/idempotent mutations,
  optimistic party-version checks and nonsecret realtime signals.
- Store invitation/recovery bearer material as verifiers rather than plaintext;
  enforce expiry/revocation once the relevant product policy is approved.
- Pin each party to an immutable mystery ID/version and separate public,
  participant-private, host-operational and solution-only data boundaries.
- Use local disposable/synthetic test data or an explicitly approved isolated
  test database; never use production data for tests.

These recommendations can be revised in later architecture work without
changing product policy, but their security invariants require tests.

### (c) Deferred non-blockers

| Spec ID | Deferred choice | Future issue / condition |
|---|---|---|
| O-025 | Exact production backup retention, restoration objectives and record deletion schedule. | Operations/production-readiness issue; do not invent timing for M1.3. |
| O-026 | Final physical content schema, normalized-vs-file/hybrid encoding and authoring tooling. | Content implementation after owner approves storage boundary; not required to define M1.3 lobby tables. |
| O-027 | Portfolio redaction workflow and broader public-release policy beyond protecting current secrets. | Before publishing authored story materials or enabling public-facing content deployment. |
| O-029 | Guest privacy policy, analytics and exact data retention period. | Privacy/product-readiness issue; minimize stored data meanwhile. |

## References

- [Decision register](../product/decisions-and-open-questions.md) — D-003,
  D-007, D-011, D-018; P-001, P-008–P-011, P-017–P-018; O-001–O-006 and
  O-025–O-027.
- [Host and player flows](../product/host-and-player-flows.md) — H1, P1 and
  §§6–7; join code is not guest/host authentication.
- [Gameplay specification](../product/gameplay-specification.md) — §2
  information taxonomy and §§3–4 phase/access rules.
- [Mystery content model](../product/mystery-content-model.md) — §1
  projections and §7 conceptual persistence.
- [Product vision](../product/product-vision.md) — MVP and environment status.
- The M1.1 projection prototype (`src/lib/lobby/index.ts` and its
  `lobby-foundation.md` note) was never used at runtime and was removed on
  2026-11-23; the live projections are in
  [`src/lib/lobby/service.ts`](../../src/lib/lobby/service.ts).
- [Agent development lifecycle](../agent-development-lifecycle.md),
  [agent evaluation](../agent-evaluation.md), and
  [Copilot instructions](../../.github/copilot-instructions.md).
