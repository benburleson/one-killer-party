import { z } from "zod";
import { isCanonicalText } from "./canonical-json.ts";
import { isCanonicalId, isCanonicalVersion, isSha256Digest } from "./ids.ts";
import type { ContentIssueCode } from "./issues.ts";

/**
 * Mystery package schema, version 1: the privileged authoring contract.
 *
 * These types describe the complete private package. They are not a response
 * shape: a browser-facing projection must be a separate allowlisted type built
 * on the server, never this object or a subset picked from it at render time.
 *
 * Every object is strict. An unknown field is an error, because it would be
 * unreviewed data travelling inside an approved package.
 */
export const MYSTERY_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = Object.freeze([MYSTERY_SCHEMA_VERSION]);

/**
 * Resource bounds, not editorial rules. They keep validation and hashing cost
 * predictable; none of them states how much content a mystery should have.
 * Text lengths count UTF-16 code units.
 */
export const CONTENT_LIMITS = Object.freeze({
  shortText: 200,
  longText: 20_000,
  characters: 32,
  playerCounts: 16,
  maxPlayerCount: 32,
  promptsPerDossier: 32,
  items: 500,
  publicEvents: 100,
  maxEventOrder: 1_000,
  objectives: 500,
  answerOptions: 32,
  supportingItems: 100,
});

/** Zod messages carry our issue code; all other Zod message text is discarded. */
const code = (value: ContentIssueCode) => value;

const id = z.string().refine(isCanonicalId, code("INVALID_ID"));
const version = z.string().refine(isCanonicalVersion, code("INVALID_VERSION"));
const text = (max: number) =>
  z.string().max(max).regex(/\S/u, code("BLANK_TEXT")).refine(isCanonicalText, code("NON_CANONICAL_TEXT"));
const shortText = text(CONTENT_LIMITS.shortText);
const longText = text(CONTENT_LIMITS.longText);

/** Phases in which authored content can be released. `LOBBY` is deliberately not one of them. */
export const RELEASE_PHASES = Object.freeze(["ACT_1", "ACT_2", "ACT_3"] as const);
const releasePhase = z.enum(RELEASE_PHASES);

const publicCharacter = z.strictObject({
  id,
  publicName: shortText,
  archetype: shortText,
  description: longText,
});

/** The assigned player's view of one other character. Reciprocal text may differ, so each direction is authored separately. */
const relationship = z.strictObject({
  characterId: id,
  perspective: longText,
});

/**
 * Pre-start material for one role (D-023). The shape has no field for guilt,
 * method, crime timeline or cover story, so those cannot be carried here by
 * accident. Whether the prose itself is spoiler-safe is an editorial review
 * question that no schema can answer.
 */
const startingDossier = z.strictObject({
  characterId: id,
  biography: longText,
  interpersonalPrompts: z.array(longText).max(CONTENT_LIMITS.promptsPerDossier),
  relationships: z.array(relationship).max(CONTENT_LIMITS.characters),
});

/** Murderer-only truth, released at ACT_1 and never earlier (D-028). */
const murdererBriefing = z.strictObject({
  characterId: id,
  releasePhase: z.literal("ACT_1"),
  guiltNotice: longText,
  motive: longText,
  method: longText,
  timeline: longText,
  coverStory: longText,
});

/** `SOLUTION_ONLY` is not an audience: solution material is never a released item. */
const audience = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PUBLIC") }),
  z.strictObject({ kind: z.literal("CHARACTER"), characterId: id }),
]);

/**
 * `EVIDENCE` is an official artifact or observation. `PERSONAL_KNOWLEDGE` and
 * `RUMOR` are not proof and must not be presented as evidence. Public events
 * are a separate collection, not an item kind.
 */
export const ITEM_KINDS = Object.freeze(["EVIDENCE", "PERSONAL_KNOWLEDGE", "RUMOR"] as const);

const releasedItem = z.strictObject({
  id,
  releasePhase,
  audience,
  kind: z.enum(ITEM_KINDS),
  text: longText,
  essential: z.boolean(),
  provenance: longText,
});

const publicEvent = z.strictObject({
  id,
  releasePhase,
  order: z.int().min(1).max(CONTENT_LIMITS.maxEventOrder),
  script: longText,
});

/** An optional, nonblocking social prompt for one character in one act. */
const characterObjective = z.strictObject({
  id,
  characterId: id,
  releasePhase,
  description: longText,
  // Absent or a valid ID; an explicit `undefined` has no JSON form and is rejected.
  targetCharacterId: id.exactOptional(),
});

const solution = z.strictObject({
  culpritCharacterId: id,
  motiveId: id,
  methodId: id,
  narrative: longText,
  timeline: longText,
  supportingItemIds: z.array(id).min(1).max(CONTENT_LIMITS.supportingItems),
});

/**
 * The hashable package payload. It names its own identity and schema version
 * and contains no digest, publication time, approval or storage locator: those
 * describe the act of publishing these bytes and belong to the registry record.
 */
export const mysteryDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(MYSTERY_SCHEMA_VERSION),
  mysteryId: id,
  version,
  title: shortText,
  publicSynopsis: longText,
  supportedPlayerCounts: z.array(z.int().min(1).max(CONTENT_LIMITS.maxPlayerCount)).min(1).max(CONTENT_LIMITS.playerCounts),
  characters: z.array(publicCharacter).min(1).max(CONTENT_LIMITS.characters),
  startingDossiers: z.array(startingDossier).max(CONTENT_LIMITS.characters),
  murdererBriefing,
  items: z.array(releasedItem).max(CONTENT_LIMITS.items),
  publicEvents: z.array(publicEvent).max(CONTENT_LIMITS.publicEvents),
  objectives: z.array(characterObjective).max(CONTENT_LIMITS.objectives),
  solution,
  motiveIds: z.array(id).min(1).max(CONTENT_LIMITS.answerOptions),
  methodIds: z.array(id).min(1).max(CONTENT_LIMITS.answerOptions),
});

/**
 * What a party pin or registry row must supply to load a package: the exact
 * identity and the digest of its canonical bytes. Publication time, provenance
 * and approvals are registry-record fields defined with the registry.
 */
export const publishedVersionRefSchema = z.strictObject({
  mysteryId: id,
  version,
  schemaVersion: z.int().min(1),
  digestSha256: z.string().refine(isSha256Digest, code("INVALID_DIGEST")),
});

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type MysteryDefinition = DeepReadonly<z.infer<typeof mysteryDefinitionSchema>>;
export type PublishedVersionRef = DeepReadonly<z.infer<typeof publishedVersionRefSchema>>;
export type ReleasePhase = (typeof RELEASE_PHASES)[number];
export type ItemKind = (typeof ITEM_KINDS)[number];
export type PublicCharacter = MysteryDefinition["characters"][number];
export type StartingDossier = MysteryDefinition["startingDossiers"][number];
export type Relationship = StartingDossier["relationships"][number];
export type MurdererBriefing = MysteryDefinition["murdererBriefing"];
export type ReleasedItem = MysteryDefinition["items"][number];
export type Audience = ReleasedItem["audience"];
export type PublicEvent = MysteryDefinition["publicEvents"][number];
export type CharacterObjective = MysteryDefinition["objectives"][number];
export type Solution = MysteryDefinition["solution"];
