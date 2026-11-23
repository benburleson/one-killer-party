# Mystery content package contract (schema version 1)

**Status: M2.1a contract and M2.1b persistence are implemented.** The owner
reports the package migration applied to Production; this is not independently
verified. No Production publisher, operator credential, publication,
rehearsal or gameplay is authorized by this contract. The pure domain files
remain isolated; the trusted loader is not wired to application routes, server
components, host operations or gameplay.
This document describes the code in [`src/lib/mystery-content/`](../../src/lib/mystery-content/). The
[mystery content architecture](mystery-content-architecture.md) (D-026–D-028)
remains the governing design.

## What the module provides

| File | Purpose |
| --- | --- |
| `ids.ts` | Canonical rules for IDs, versions and digests |
| `schema.ts` | Schema version 1, exported domain types, resource limits |
| `validate.ts` | `validateMysteryDefinition(input, rules)`, rule sets, reserved legacy pins |
| `canonical-json.ts` | Canonical JSON encoding and strict parsing |
| `integrity.ts` | `sealMysteryDefinition`, `loadVerifiedMysteryDefinition`, `sha256Hex` |
| `issues.ts` | Value-free `{ code, path }` diagnostics |

The module depends only on Zod and `node:crypto`. It reads no files,
environment variables or network, and has no Supabase or Next.js imports.

M2.1b persistence is separate from that pure contract:
`publication.ts` orchestrates sealing, immutable upload, read-back verification
and registration through an injected store; `trusted-loader-core.ts` validates
an exact registry result and bytes; `trusted-loader.ts` is the `server-only`
Supabase adapter. No application code calls the loader yet.

There is deliberately **no `index.ts` barrel**. `MysteryDefinition` is the
complete private authoring package: it is not a response type and must never be
passed to a client component or returned from a route. Browser-facing
projections are separate allowlisted types to be defined in M2.2. A unit test
fails if any client component imports this module or if any application file
starts importing it without that test being updated.

## Package shape

`MysteryDefinition` is the **hashable payload**: the whole private package and
nothing else. Every object is strict, so an unknown field is an error.

| Field | Contents |
| --- | --- |
| `schemaVersion` | `1` |
| `mysteryId`, `version` | Identity of this immutable package |
| `title`, `publicSynopsis`, `supportedPlayerCounts` | Public metadata |
| `characters[]` | `id`, `publicName`, `archetype`, `description` |
| `startingDossiers[]` | `characterId`, `biography`, `interpersonalPrompts[]`, `relationships[]` (`characterId`, `perspective`) |
| `murdererBriefing` | `characterId`, `releasePhase: "ACT_1"`, `guiltNotice`, `motive`, `method`, `timeline`, `coverStory` |
| `items[]` | `id`, `releasePhase`, `audience`, `kind`, `text`, `essential`, `provenance` |
| `publicEvents[]` | `id`, `releasePhase`, `order`, `script` |
| `objectives[]` | `id`, `characterId`, `releasePhase`, `description`, optional `targetCharacterId` |
| `solution` | `culpritCharacterId`, `motiveId`, `methodId`, `narrative`, `timeline`, `supportingItemIds[]` |
| `motiveIds[]`, `methodIds[]` | Answer-option identifiers |

- `releasePhase` is `ACT_1`, `ACT_2` or `ACT_3`. `LOBBY` is not a release
  phase, so nothing act-gated can be marked for pre-start release.
- `audience` is `{ kind: "PUBLIC" }` or `{ kind: "CHARACTER", characterId }`.
  `SOLUTION_ONLY` is not an audience: solution material lives only in `solution`.
- `kind` is `EVIDENCE`, `PERSONAL_KNOWLEDGE` or `RUMOR`. Public events are a
  separate collection, not an item kind.
- **D-023 and D-028 are separated by shape.** A starting dossier has no field
  for guilt, method, timeline or cover story, and the single murderer briefing
  only accepts `releasePhase: "ACT_1"`. This prevents structural mistakes. It
  does not show that dossier prose is spoiler-safe; only editorial review can.

### Identifiers and versions

| Value | Rule | Examples |
| --- | --- | --- |
| ID | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, at most 64 characters | `role-1`, `blackwood-affair` |
| Version | `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`, at most 64 characters | `1.0.0`, `1.0.0-rc.1` |
| Digest | `^[0-9a-f]{64}$` | lowercase hexadecimal SHA-256 |

Lowercase ASCII gives each value exactly one spelling, so equality is plain
string equality and each value is safe as one object-key segment. IDs are unique
within their own namespace (characters, items, events, objectives, motives,
methods). Versions are opaque: compared for equality only, never ordered, and
never resolved to "latest".

## Hash scope and the digest self-reference

The earlier illustrative type put `digestSha256`, `publishedAt` and
`provenanceRef` inside the package as `publication: PublishedVersion`. A digest
cannot cover bytes that contain it, and an approval cannot be recorded inside
the bytes it approves. The implemented contract therefore splits them:

| Where | Fields | Why |
| --- | --- | --- |
| **Package bytes** (hashed) | `schemaVersion`, `mysteryId`, `version` and all content | The package states what it is, so bytes cannot be registered under another identity |
| **`PublishedVersionRef`** (pin) | `mysteryId`, `version`, `schemaVersion`, `digestSha256` | What a party pin or registry row must supply to load |
| **Registry record** (M2.1b, not defined here) | Publication time, provenance, approvals, object locator, rule-set ID | Facts about the act of publishing, recorded after the bytes are fixed |

**Digest = lowercase hex SHA-256 of the canonical JSON bytes of the complete
`MysteryDefinition`.** No field is excluded, because the digest is not a field.

A matching digest proves the bytes are the pinned bytes. It does **not** prove
who published them or that anyone approved them. Authenticity and approval come
from the private registry and its publication permissions in M2.1b.

## Canonical encoding

The encoding is the [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JSON
Canonicalization Scheme form of a restricted value domain:

1. Values are `null`, booleans, strings, arrays and plain objects.
2. Numbers must be safe integers and not `-0`, written as decimal digits.
   Fractions, exponents, `NaN` and infinities are rejected.
3. Strings and keys must be well-formed Unicode already in NFC. Lone
   surrogates and non-NFC text are rejected, not repaired.
4. Object keys are sorted by UTF-16 code unit. Array order is preserved and is
   part of the content.
5. No insignificant whitespace; strings use ECMAScript `JSON.stringify` escaping.
6. Output is UTF-8 without a byte order mark, at most 1 MiB and 16 levels deep.

Anything else (`undefined`, `bigint`, dates, maps, class instances, sparse
arrays, accessors, symbol keys, a `__proto__` key, cycles) is rejected.

**Parsing accepts only bytes that are already canonical.** Bytes are decoded as
strict UTF-8, parsed, re-encoded and compared with the input. Different key
order, whitespace, a byte order mark, alternative escapes, alternative number
spellings and duplicate keys all fail this comparison.

## Validation layers

`validateMysteryDefinition(input, rules)` runs three layers and stops at the
first that fails. It returns a deep-frozen copy that shares nothing with the input.

1. **Structure.** Supported `schemaVersion` (checked before any other field is
   read), required fields, types, bounds, ID format, no unknown fields.
2. **References.** Unique IDs per namespace; exactly one starting dossier per
   character; every character reference in dossiers, relationships, item
   audiences and objectives resolves; no self-relationship or self-targeted
   objective; the briefing character is the solution culprit; solution motive,
   method and supporting items resolve; events are listed by phase and then by
   strictly increasing `order`; `supportedPlayerCounts` is strictly ascending;
   the identity is not a reserved legacy pin.
3. **Rule set.** Constraints for a product stage, always passed explicitly.
   `EIGHT_ROLE_PROTOTYPE_RULES` (`eight-role-prototype-v1`) requires exactly
   eight characters and `supportedPlayerCounts` equal to `[8]`. A different cast
   size is a new named rule set, not a change to the schema or to this one.

**Not validated, by design.** Whether public text or a starting dossier is
spoiler-safe, whether classifications are right, whether the chronology is
consistent or the mystery solvable. Passing validation means the package is
well formed, not that it is approved.

`RESERVED_LEGACY_PINS` contains `blackwood-affair` /
`first-playtest-placeholder-v1`. No package may claim that identity, so the
public roster placeholder can never be turned into a private published version
(D-027). The lobby catalog and its pin are unchanged.

### Diagnostics

Failures are `{ ok: false, issues, truncated }`. Each issue is `{ code, path }`,
for example `startingDossiers[2].coverStory: UNKNOWN_FIELD` via `formatIssue`.
Issues never contain authored text, received values or parser messages. An
unknown key is named only if it looks like a field name; otherwise the path
stops at its parent. At most 100 issues are returned.

### Limits

`CONTENT_LIMITS` and the canonical size and depth bounds exist to keep
validation and hashing cost predictable. They are resource bounds, not
editorial rules, and can be raised in a later schema version: short text 200
and long text 20,000 UTF-16 code units; 32 characters; 500 items; 100 events;
500 objectives; 32 prompts per dossier; 32 answer options per list.

## Usage

```ts
import { loadVerifiedMysteryDefinition, sealMysteryDefinition } from "@/lib/mystery-content/integrity";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "@/lib/mystery-content/validate";

// Publishing side: validate, then obtain the exact bytes and their reference.
const sealed = sealMysteryDefinition(draft, EIGHT_ROLE_PROTOTYPE_RULES);
if (!sealed.ok) return sealed.issues; // safe to show an operator
// sealed.bytes -> private object; sealed.ref -> registry row and party pin

// Loading side: fail closed unless everything matches the pin.
const loaded = loadVerifiedMysteryDefinition(bytes, pinnedRef, EIGHT_ROLE_PROTOTYPE_RULES);
if (!loaded.ok) throw new Error("content unavailable"); // never fall back to another version
```

`loadVerifiedMysteryDefinition` checks, in order: the reference is well formed;
the input is a `Uint8Array` within the size bound; the SHA-256 of the raw bytes
equals the pinned digest; the bytes are canonical; the package validates; its
`mysteryId`, `version` and `schemaVersion` equal the reference. Bytes that do
not match the pin are never parsed.

## Choices that need owner review

These were needed to implement the contract but are not settled product
decisions. Each can be changed in a later schema version without affecting
published version 1 packages.

1. **Version format.** The content model leaves this open. The implemented rule
   is lexical only and accepts semantic-version core and prerelease forms but
   not `+build` metadata. No ordering is defined.
2. **Lowercase IDs.** The content model's illustrative `P01` and `C02` would be
   written `p01` and `c02`.
3. **Relationships** are modelled inside the starting dossier, so they are
   owner-only and pre-start, following the gameplay specification's pre-start
   background. The content model's public/private relationship visibility and
   any act-gated relationships are not modelled.
4. **Objectives** have no `type` field, because the investigative, interpersonal
   and personal taxonomy is a baseline proposal (P-006). No minimum number of
   objectives, prompts or relationships is enforced (O-016).
5. **Not modelled:** the finale script, act titles and durations (P-002),
   expected duration, the victim, and labels for motive and method options
   (O-019). Motives and methods are identifiers only.
6. **Content minimums** from the content model (six public and eight
   character items, an event in every act) are not enforced. `essential` and
   `provenance` are stored but not interpreted.
7. **The rule set is chosen by the caller**, not declared in the bytes. M2.1b
   should record the rule-set ID in the registry. The alternative, a rule-set
   field inside the package, would let a package choose its own constraints.
8. **Provenance and approval are outside the bytes** (see hash scope). If
   authoring metadata inside the bytes is wanted, it needs a new schema version.
9. **Text must be NFC** and numbers must be integers. Editorial tooling has to
   normalize text before sealing.
10. **Dependencies and configuration.** `zod` is a direct dependency again
    (the previous cleanup removed it as unused; the lockfile already carried
    the same version transitively). `tsconfig.json` enables
    `allowImportingTsExtensions` so the module's files can import each other
    under both Node's type stripping in unit tests and the Next.js build.
11. **The module is not marked `server-only`**, so that unit tests can execute
    it directly. A unit test guards the client boundary instead. The M2.1b
    loader that wraps it must be `server-only`.

## Handoff to M2.1b

M2.1b implements the local infrastructure below without changing this
contract:

- **Trusted loader.** Server-only. Reads the party's pinned `mysteryId`,
  `version`, `schemaVersion` and digest from Postgres, fetches the private
  object, and calls `loadVerifiedMysteryDefinition` on every cold load. Any
  failure is a safe "unavailable" response; never fall back to another version.
  Cache verified packages only inside the server, keyed by version and digest.
- **Immutable private object and registry.** Non-overwriting object key derived
  from `mysteryId`, `version` and digest. The registry row holds the
  `PublishedVersionRef` fields plus publication time, provenance, approvals,
  locator and rule-set ID. Enforce uniqueness and immutability in the database.
- **Operator-only publication.** A trusted tool runs `sealMysteryDefinition`,
  uploads `sealed.bytes`, reads them back, verifies them with
  `loadVerifiedMysteryDefinition`, then registers. No CI or agent publishing
  and no automatic publication.
- **Legacy pin.** Placeholder parties stay as they are. The loader must deny
  private-content reads for them; this module already refuses a package that
  claims that identity.
- **Approval boundary.** Bucket creation, migrations and any production change
  need specific human approval under
  [production operations](../production-operations.md).

## M2.1b private persistence (local only)

Migration `20261123010000_private_mystery_packages.sql` creates the private
`private-mystery-packages` bucket and a `private_mystery.published_versions`
registry. The immutable unique key is `(mystery_id, version)`; the row also
stores `schema_version`, `digest_sha256`, the canonical `object_path`,
`rule_set_id`, `published_at`, `provenance`, `approved_by` and
`approval_reference`. It contains no package content. The identity
`blackwood-affair / first-playtest-placeholder-v1` is prohibited. Existing
party pins and lobby tables are unchanged.

The only object key is
`{mysteryId}/{version}/{digestSha256}.json` in the fixed private bucket. Its
segments come from the canonical M2.1a identity and digest. Storage upload uses
`upsert: false`; SQL triggers reject object updates/deletes and registry
updates/deletes, including attempts made with the Supabase `service_role`.
The registry itself has no direct table grants. Browser roles receive no
package bucket listing or object operation; restrictive storage policies also
deny a future permissive browser policy for this bucket. The narrow registration
RPC is callable only as `mystery_operator`; the exact-reference lookup RPC is
callable only by `service_role` and the operator. Storage credentials never
produce signed URLs.

`mystery_operator` is a non-login Postgres role granted only package-bucket
object `SELECT`/`INSERT` and publication RPC execution. The local CLI derives a
short-lived JWT for that role from the **local** JWT secret; it does not use or
receive the runtime `SUPABASE_SERVICE_ROLE_KEY`. Never generalize the local
signing-secret pattern to Production. The runtime server loader uses the app's
existing service-role client for the exact-reference RPC and private object
download. Supabase service-role credentials still bypass RLS and have broad
Storage API powers; application code must not use them outside the server-only
loader and narrow RPCs. Triggers protect against API-level overwrite/deletion,
but a database owner/superuser can disable triggers or alter the schema.
Production needs a separately controlled operator signing credential and
privileged database administrators remain trusted.

### Local operator publishing and trust boundary

Only a disposable local Supabase target is implemented. Keep the synthetic or
private JSON input **outside this repository** and expose local credentials
only to the operator process. The CLI refuses a non-loopback URL, requires
`--target local`, `--confirm-approval` and non-secret metadata, accepts only
the named `eight-role-prototype-v1` rules, and logs only status, identity and
digest. It does not report file paths, payloads, provider errors or
credentials. Local `--approved-by` and `--approval-reference` values are
provenance labels, not proof of an independent approval; the local adapter
exists only for disposable synthetic work. A production verifier must
independently authenticate and authorize an approval before bytes are uploaded.
Example (the variables must be set from the disposable local stack's status in
a private shell environment; never copy status output into a PR or log):

```sh
npm run publish:mystery:local -- \
  --target local \
  --input /secure/outside-repository/synthetic-package.json \
  --provenance synthetic:owner-review \
  --approved-by local-operator \
  --approval-reference issue-45 \
  --confirm-approval
```

The sequence is upload exact sealed canonical bytes → independently download
and call `loadVerifiedMysteryDefinition` → register the immutable identity.
Identical retries re-read and verify existing bytes and return
`already_published`; a differing digest for an existing version is rejected.
The reusable publisher requires an injected verifier to return a fresh
approval bound to the explicit environment, exact project reference, package
ID/version/schema, canonical digest and rule-set ID. The core rejects
mismatched, expired, future-dated or over-15-minute approvals before upload.
A production verifier is not
implemented. When selected, it must verify a tamper-resistant owner-approved
artifact, distinct approver and operator identities (or an owner-approved
equivalent), MFA, revocation and expiry, and one-time or same-binding retry
semantics; record its stable approval reference and audit identity/time.
Metadata-only approval is not accepted as production authorization.
Because object storage and Postgres are not one transaction, a failed readback
or registration can leave an unregistered orphan. Such an object is not
returned by the trusted loader. Retry only with identical bytes; if cleanup is
needed, a privileged operator must first verify there is no registry reference
then perform an audited manual cleanup under an approved maintenance procedure.
There is deliberately no cleanup command in the app or publisher. A schema
validator result proves format/rules only, not editorial correctness,
spoiler-safety, provenance authenticity or human approval.

`loadPublishedMysteryDefinition` accepts an exact `PublishedVersionRef`, looks
up only that full identity, checks the registered rule set and canonical
locator, downloads only the matching registry object, and reuses the M2.1a
digest/canonical/schema validator. Invalid references, missing or malformed
registry rows, missing objects, unsupported rules and any storage or content
mismatch return only `{ ok: false, code: "CONTENT_UNAVAILABLE" }`. It never
resolves latest. This loader is **not authorization to disclose**: M2.2 must
first re-read the party's pin and status and authenticate the caller's current
party membership/role from trusted database state, then construct a distinct
allowlisted own-dossier projection with phase rules. It must not pass through
the complete `MysteryDefinition`. No route, server action, server component,
host flow or browser component invokes this loader in M2.1b.

### Verification and production boundary

`npm run test:integration:mystery` runs only after a disposable local Supabase
stack is started. It invokes the operator CLI on synthetic fixtures, exercises
concurrent identical publication, multiple versions, conflicts, failed
registration/orphans, readback/loading, attempts to overwrite/delete with both
operator and service-role credentials, and direct anon/authenticated Storage
requests. `npx supabase test db` additionally checks grants, RLS, RPC roles,
legacy exclusion and registry immutability. Tests must never use linked or
production credentials.

Production credential options, permissions, backup/restore, orphan
reconciliation, incidents, release rollback, owner-operated read-only
preflight and separately approved synthetic rehearsal gates are documented in
[production operations](../production-operations.md#private-mystery-package-storage-and-publishing-m21bm21c).
The migration application status there is owner-attested, not independently
verified. No production issuer, approval verifier, publisher target, or
rehearsal is approved by this package contract.

Back up Postgres registry state and private Storage objects together and
restore them to the same point-in-time set. After restore, verify each registry
digest against its object and retain every version pinned by a party. Orphans
are excluded from loader lookup and require separately audited manual cleanup.
The local integration check exports exact registry rows and bytes from
disposable local Supabase into an isolated test adapter, then independently
loads two versions and verifies missing/tampered bytes fail closed. This tests
the registry/object consistency boundary, not a physical `pg_dump` restore or
Storage-provider restore; that isolated full-stack rehearsal remains
unverified.

The owner reports that both current migrations, including
`20261123010000_private_mystery_packages.sql`, have been applied to Production.
This is owner attestation, not independent verification. Before any future
production publication, an owner must separately approve: (1) exact-target
read-only preflight and migration/grant verification; (2) private bucket,
restrictive browser policies, registry/RPC grants and immutable triggers; (3)
a separate operator credential issuance/rotation/revocation design and audit
trail; (4) encrypted backup, retention and full restore rehearsal; and (5) an
explicitly approved synthetic publication rehearsal. Apply no migration
without its own approval. Verify migration history, object digest/retention,
deployment SHA and production smoke test separately. None is implied by these
local tests.

## What the tests do and do not show

The unit tests in `tests/unit/mystery-content.test.mjs` use a fully synthetic
eight-role fixture with fabricated identifiers and filler text. They cover
schema and canonical integrity. `tests/unit/mystery-publication.test.mjs`
checks exact sealing, retries, conflicts, orphan behavior and fail-closed
loader validation. `tests/integration/mystery-content-local.test.mjs` uses
disposable local Supabase to exercise the actual operator CLI, Storage policies,
readback, service/operator write boundaries, expired and untrusted JWT denial,
direct anon/authenticated Storage requests and the registry/object snapshot
round-trip adapter check. pgTAP validates grants, RLS, RPC roles and immutable
rows.

These local tests do not establish production configuration, editorial
approval, authorization to disclose content to a party member, or secrecy of
future HTTP/RSC/player projections. The loader is not wired to those surfaces.
M2.2 must add fresh membership/assignment/phase authorization and allowlisted
projections before any dossier delivery.
