# Mystery content package contract (schema version 1)

**Current state:** The schema, canonical SHA-256 sealing, validator, private Storage bucket, immutable Postgres registry, trusted server-only loader and operator publishing CLI are implemented. A dedicated, MFA-protected publisher is active in Production; the first **synthetic** package was published and verified against registry/Storage metadata on November 26, 2026. **No real Blackwood content has been published.** This module is not wired to host/guest routes or dossier/act gameplay. Consult [Production operations](../production-operations.md) for status, credentials, publication and recovery.

This is the code contract for [`src/lib/mystery-content/`](../../src/lib/mystery-content/), under the [accepted architecture](mystery-content-architecture.md) and [product decisions](../product/decisions-and-open-questions.md).

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

## Private persistence and authorized publication

The domain validator and canonical serializer contain no database or network access. The separate persistence layer stores immutable canonical JSON bytes under a `mystery/version/digest` private Storage key and registers the exact `PublishedVersionRef`, rule set, provenance, and approval metadata in `private_mystery.published_versions`. The authoritative code and SQL live in `src/lib/mystery-content/`, `supabase/migrations/`, and the operator CLIs.

- The `mystery_operator` role cannot log into Postgres and has only the guarded Storage object and registration RPC capabilities; it cannot directly update/delete registry rows or existing objects. The **enabled** Custom Access Token Hook maps a single, owner-authorized Auth UUID to this role.
- The guard and restrictive Storage policy independently require the current identity mapping and an MFA-verified JWT (`aal2`). Normal `anon`, `authenticated` and `service_role` identities do not inherit operator membership; administrative and trusted signing principals remain an infrastructure boundary.
- The operator authenticates with password, Cloudflare Turnstile, and TOTP; the Production CLI verifies signed-in identity, issuer, role and freshness and requires exact interactive `PUBLISH` confirmation for the approved project, version, rule set and canonical digest. The password is stored in a project-scoped macOS Keychain entry; neither token nor TOTP secret is persisted.
- The publisher uploads, independently downloads and checks canonical bytes, then registers the immutable record. Upload and registration are **not atomic**; a failure may leave an unregistered orphan. Retry only identical bytes after inspecting the object and registry. Never replace an existing published version or auto-delete objects.
- The trusted loader fetches only an exact published reference and fails closed with `CONTENT_UNAVAILABLE` on missing, invalid or mismatching bytes, schema, rules or registry data. It does **not** grant permission to display the package. A future player flow must re-check party pin, current membership, character assignment and phase before constructing a minimal own-dossier projection.
- Existing parties pinned to `blackwood-affair/first-playtest-placeholder-v1` remain public-lobby-only; a released mystery requires a **new** party pin. Never migrate or repin existing parties silently.
- `npm run publish:mystery:local` and local JWT signing are **disposable integration-test tools**, not Production credentials or release procedures. Production uses `npm run mystery:publish -- --target production --keychain /absolute/path/outside/repo.json` **only with separate owner approval**.

The current synthetic Production record is `synthetic-mystery/1.0.0-test.1`, canonical digest `b08af09b4470c30f6471b78ee3a3e3aa29a62f25d363fb1b803cf54c9170cdc2`. It remains private and immutable. The unauthenticated Storage download was denied; a real ordinary-host JWT denial request has **not** been completed. Backups must include both registry and exact object bytes; see [Production operations](../production-operations.md).

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
