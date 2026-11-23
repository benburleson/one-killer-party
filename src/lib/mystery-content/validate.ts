import type { z } from "zod";
import { type ContentFailure, type ContentIssue, type ContentIssueCode, failure, issue } from "./issues.ts";
import {
  type MysteryDefinition,
  mysteryDefinitionSchema,
  RELEASE_PHASES,
  SUPPORTED_SCHEMA_VERSIONS,
} from "./schema.ts";

/**
 * Constraints that are true of a particular product stage rather than of every
 * mystery. A rule set is named and immutable: a different player count is a new
 * rule set with a new ID, not an edit to this one. The caller always chooses the
 * rule set explicitly; there is no default.
 */
export type PackageRuleSet = Readonly<{
  id: string;
  playableRoleCount: number;
  supportedPlayerCounts: readonly number[];
}>;

/** First Blackwood prototype: exactly eight playable roles, supported counts `[8]` (D-022). */
export const EIGHT_ROLE_PROTOTYPE_RULES: PackageRuleSet = Object.freeze({
  id: "eight-role-prototype-v1",
  playableRoleCount: 8,
  supportedPlayerCounts: Object.freeze([8]),
});

/**
 * Identities that name the public roster placeholder pinned by existing
 * parties. They are not published private versions and no package may ever
 * claim them (D-027).
 */
export const RESERVED_LEGACY_PINS: readonly Readonly<{ mysteryId: string; version: string }>[] = Object.freeze([
  Object.freeze({ mysteryId: "blackwood-affair", version: "first-playtest-placeholder-v1" }),
]);

export type ValidationResult = Readonly<{ ok: true; definition: MysteryDefinition }> | ContentFailure;

const issueCodes = new Set<string>([
  "INVALID_ID",
  "INVALID_VERSION",
  "INVALID_DIGEST",
  "BLANK_TEXT",
  "NON_CANONICAL_TEXT",
] satisfies ContentIssueCode[]);

/** True when the path names an own property, whatever its value. */
function isPresent(root: unknown, path: readonly PropertyKey[]): boolean {
  let current = root;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) return false;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return true;
}

/** Maps Zod issues to value-free issues. Zod's own messages are never forwarded. */
export function structuralIssues(error: z.ZodError, input: unknown): ContentIssue[] {
  return error.issues.flatMap((zodIssue): ContentIssue[] => {
    const path = zodIssue.path;
    if (issueCodes.has(zodIssue.message)) return [issue(zodIssue.message as ContentIssueCode, path)];
    if (zodIssue.code === "unrecognized_keys") return zodIssue.keys.map((key) => issue("UNKNOWN_FIELD", [...path, key]));
    if (!isPresent(input, path)) return [issue("REQUIRED", path)];
    switch (zodIssue.code) {
      case "invalid_type":
        return [issue("INVALID_TYPE", path)];
      case "too_big":
      case "too_small": {
        const sized = zodIssue.origin === "string" || zodIssue.origin === "array";
        return [issue(!sized ? "OUT_OF_RANGE" : zodIssue.code === "too_big" ? "TOO_LONG" : "TOO_SHORT", path)];
      }
      default:
        return [issue("INVALID_VALUE", path)];
    }
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function referenceIssues(definition: MysteryDefinition): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (code: ContentIssueCode, ...path: (string | number)[]) => void issues.push(issue(code, path));

  /** Reports repeats and returns the set, so each namespace has exactly one meaning per ID. */
  const unique = <T>(values: readonly T[], code: ContentIssueCode, path: (index: number) => (string | number)[]) => {
    const seen = new Set<T>();
    values.forEach((value, index) => (seen.has(value) ? add(code, ...path(index)) : seen.add(value)));
    return seen;
  };

  const characterIds = unique(definition.characters.map(({ id }) => id), "DUPLICATE_ID", (i) => ["characters", i, "id"]);
  const itemIds = unique(definition.items.map(({ id }) => id), "DUPLICATE_ID", (i) => ["items", i, "id"]);
  unique(definition.publicEvents.map(({ id }) => id), "DUPLICATE_ID", (i) => ["publicEvents", i, "id"]);
  unique(definition.objectives.map(({ id }) => id), "DUPLICATE_ID", (i) => ["objectives", i, "id"]);
  const motiveIds = unique(definition.motiveIds, "DUPLICATE_ID", (i) => ["motiveIds", i]);
  const methodIds = unique(definition.methodIds, "DUPLICATE_ID", (i) => ["methodIds", i]);
  const character = (characterId: string, ...path: (string | number)[]) => {
    if (!characterIds.has(characterId)) add("UNRESOLVED_REFERENCE", ...path);
  };

  // One representation only: a count list is a set, so it is written in ascending order without repeats.
  definition.supportedPlayerCounts.forEach((count, index, counts) => {
    if (index > 0 && count <= counts[index - 1]) add("NOT_STRICTLY_ASCENDING", "supportedPlayerCounts", index);
  });

  // Exactly one starting dossier per character: none missing, repeated or for an unknown role.
  const dossierOwners = unique(
    definition.startingDossiers.map(({ characterId }) => characterId),
    "DUPLICATE_REFERENCE",
    (i) => ["startingDossiers", i, "characterId"],
  );
  definition.characters.forEach(({ id }, index) => {
    if (!dossierOwners.has(id)) add("MISSING_STARTING_DOSSIER", "characters", index, "id");
  });
  definition.startingDossiers.forEach((dossier, index) => {
    character(dossier.characterId, "startingDossiers", index, "characterId");
    const at = (i: number) => ["startingDossiers", index, "relationships", i, "characterId"];
    unique(dossier.relationships.map(({ characterId }) => characterId), "DUPLICATE_REFERENCE", at);
    dossier.relationships.forEach(({ characterId }, i) => {
      character(characterId, ...at(i));
      if (characterId === dossier.characterId) add("SELF_REFERENCE", ...at(i));
    });
  });

  definition.items.forEach(({ audience }, index) => {
    if (audience.kind === "CHARACTER") character(audience.characterId, "items", index, "audience", "characterId");
  });

  definition.objectives.forEach((objective, index) => {
    character(objective.characterId, "objectives", index, "characterId");
    if (objective.targetCharacterId === undefined) return;
    character(objective.targetCharacterId, "objectives", index, "targetCharacterId");
    if (objective.targetCharacterId === objective.characterId) add("SELF_REFERENCE", "objectives", index, "targetCharacterId");
  });

  // Events are listed in play order: by release phase, then strictly increasing `order` within a phase.
  definition.publicEvents.forEach((event, index, events) => {
    if (index === 0) return;
    const previous = events[index - 1];
    const phaseStep = RELEASE_PHASES.indexOf(event.releasePhase) - RELEASE_PHASES.indexOf(previous.releasePhase);
    if (phaseStep < 0 || (phaseStep === 0 && event.order <= previous.order)) add("EVENT_ORDER_INVALID", "publicEvents", index, "order");
  });

  const { solution, murdererBriefing } = definition;
  character(solution.culpritCharacterId, "solution", "culpritCharacterId");
  character(murdererBriefing.characterId, "murdererBriefing", "characterId");
  if (murdererBriefing.characterId !== solution.culpritCharacterId) add("BRIEFING_CULPRIT_MISMATCH", "murdererBriefing", "characterId");
  if (!motiveIds.has(solution.motiveId)) add("UNRESOLVED_REFERENCE", "solution", "motiveId");
  if (!methodIds.has(solution.methodId)) add("UNRESOLVED_REFERENCE", "solution", "methodId");
  unique(solution.supportingItemIds, "DUPLICATE_REFERENCE", (i) => ["solution", "supportingItemIds", i]);
  solution.supportingItemIds.forEach((itemId, index) => {
    if (!itemIds.has(itemId)) add("UNRESOLVED_REFERENCE", "solution", "supportingItemIds", index);
  });

  if (RESERVED_LEGACY_PINS.some((pin) => pin.mysteryId === definition.mysteryId && pin.version === definition.version)) {
    add("RESERVED_LEGACY_VERSION", "version");
  }
  return issues;
}

function ruleIssues(definition: MysteryDefinition, rules: PackageRuleSet): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (definition.characters.length !== rules.playableRoleCount) issues.push(issue("ROLE_COUNT_NOT_ALLOWED", ["characters"]));
  const counts = definition.supportedPlayerCounts;
  if (counts.length !== rules.supportedPlayerCounts.length || counts.some((count, index) => count !== rules.supportedPlayerCounts[index])) {
    issues.push(issue("PLAYER_COUNTS_NOT_ALLOWED", ["supportedPlayerCounts"]));
  }
  return issues;
}

/**
 * Validates untrusted input as a mystery package in three layers, stopping at
 * the first layer that fails:
 *
 * 1. structure: supported schema version, required fields, types, bounds, no unknown fields;
 * 2. references: unique IDs, resolvable references, dossier and briefing consistency, event order;
 * 3. rule set: the explicit stage constraints passed by the caller.
 *
 * Success means the package is well formed. It does not mean the story is
 * spoiler-safe, fair or approved; those are editorial decisions.
 *
 * The returned definition is a deep-frozen copy that shares nothing with `input`.
 */
export function validateMysteryDefinition(input: unknown, rules: PackageRuleSet): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return failure([issue("INVALID_TYPE")]);
  // Never guess at a package written for another schema: stop before reading any other field.
  const schemaVersion = Object.hasOwn(input, "schemaVersion") ? (input as { schemaVersion: unknown }).schemaVersion : undefined;
  if (schemaVersion === undefined) return failure([issue("REQUIRED", ["schemaVersion"])]);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion as number)) {
    return failure([issue("UNSUPPORTED_SCHEMA_VERSION", ["schemaVersion"])]);
  }

  const parsed = mysteryDefinitionSchema.safeParse(input);
  if (!parsed.success) return failure(structuralIssues(parsed.error, input));
  const definition: MysteryDefinition = deepFreeze(parsed.data);

  const references = referenceIssues(definition);
  if (references.length > 0) return failure(references);
  const ruleViolations = ruleIssues(definition, rules);
  if (ruleViolations.length > 0) return failure(ruleViolations);
  return Object.freeze({ ok: true, definition });
}
