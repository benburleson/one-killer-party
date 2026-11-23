import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CanonicalJsonError,
  canonicalJsonBytes,
  MAX_CANONICAL_BYTES,
  parseCanonicalJsonBytes,
} from "../../src/lib/mystery-content/canonical-json.ts";
import { isCanonicalId, isCanonicalVersion, isSha256Digest } from "../../src/lib/mystery-content/ids.ts";
import { loadVerifiedMysteryDefinition, sealMysteryDefinition, sha256Hex } from "../../src/lib/mystery-content/integrity.ts";
import { formatIssue, MAX_REPORTED_ISSUES } from "../../src/lib/mystery-content/issues.ts";
import { CONTENT_LIMITS } from "../../src/lib/mystery-content/schema.ts";
import {
  EIGHT_ROLE_PROTOTYPE_RULES,
  RESERVED_LEGACY_PINS,
  validateMysteryDefinition,
} from "../../src/lib/mystery-content/validate.ts";
import { SYNTHETIC_SENTINELS, syntheticMysteryPackage } from "./fixtures/synthetic-mystery-package.mjs";

const rules = EIGHT_ROLE_PROTOTYPE_RULES;
const utf8 = (text) => new TextEncoder().encode(text);
const sentinelPattern = new RegExp(Object.values(SYNTHETIC_SENTINELS).join("|"));

// Assertions below compare codes, paths and booleans only, so that a failing
// test never prints a package or its private text.
const flat = (result) => (result.ok ? ["(ok)"] : result.issues.map(formatIssue));

function validated(mutate) {
  const input = syntheticMysteryPackage();
  mutate?.(input);
  return validateMysteryDefinition(input, rules);
}

function rejected(mutate, ...expected) {
  const result = validated(mutate);
  assert.equal(result.ok, false);
  assert.deepEqual(flat(result), expected);
  assert.doesNotMatch(JSON.stringify(result), sentinelPattern);
}

function sealed(mutate) {
  const input = syntheticMysteryPackage();
  mutate?.(input);
  const result = sealMysteryDefinition(input, rules);
  assert.deepEqual(flat(result), ["(ok)"]);
  return result;
}

/** Rebuilds a value with every object's keys inserted in the opposite order. */
function reversedKeys(value) {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversedKeys(child)]));
}

function canonicalCode(run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof CanonicalJsonError);
    assert.equal(error.message, error.code);
    return error.code;
  }
  return "(ok)";
}

test("the synthetic eight-role package validates and is returned as a detached frozen copy", () => {
  const input = syntheticMysteryPackage();
  const result = validateMysteryDefinition(input, rules);
  assert.deepEqual(flat(result), ["(ok)"]);
  assert.equal(result.definition.characters.length, 8);
  assert.equal(result.definition.startingDossiers.length, 8);
  assert.notEqual(result.definition, input);
  assert.ok(Object.isFrozen(result.definition) && Object.isFrozen(result.definition.items[0].audience));
  input.solution.culpritCharacterId = "role-1";
  assert.equal(result.definition.solution.culpritCharacterId, "role-3");
});

test("canonical IDs, versions and digests are lowercase ASCII with one spelling", () => {
  for (const id of ["a", "role-1", "blackwood-affair", "item-07", "a".repeat(64)]) assert.equal(isCanonicalId(id), true, id);
  for (const id of ["", "Role-1", "P01", "1-role", "-role", "role-", "role--1", "role_1", "role 1", " role", "role\n",
    "rôle", "role/1", "role.1", "a".repeat(65), 1, null, undefined, ["a"]]) {
    assert.equal(isCanonicalId(id), false, String(id));
  }
  for (const version of ["1", "1.0.0", "1.0.0-rc.1", "0.1-draft", "first-playtest-placeholder-v1", "2026-11-23"]) {
    assert.equal(isCanonicalVersion(version), true, version);
  }
  for (const version of ["", "V1", "1..0", "1.", ".1", "1.0+build", "1/0", "..", "1 0", "latest\n", "1".repeat(65), 1]) {
    assert.equal(isCanonicalVersion(version), false, String(version));
  }
  assert.equal(isSha256Digest("0".repeat(64)), true);
  for (const digest of ["", "0".repeat(63), "0".repeat(65), "A".repeat(64), "g".repeat(64), `sha256:${"0".repeat(57)}`, null]) {
    assert.equal(isSha256Digest(digest), false);
  }
});

test("only the supported schema version is interpreted", () => {
  const only = "schemaVersion: UNSUPPORTED_SCHEMA_VERSION";
  rejected((p) => { p.schemaVersion = 2; }, only);
  rejected((p) => { p.schemaVersion = 0; }, only);
  rejected((p) => { p.schemaVersion = "1"; }, only);
  rejected((p) => { p.schemaVersion = null; }, only);
  rejected((p) => { delete p.schemaVersion; }, "schemaVersion: REQUIRED");
  // An unsupported version is reported alone: no other field is read under the wrong schema.
  rejected((p) => { p.schemaVersion = 2; p.characters = "nonsense"; p.extra = true; }, only);
  for (const input of [null, undefined, "text", 1, [], [syntheticMysteryPackage()]]) {
    assert.deepEqual(flat(validateMysteryDefinition(input, rules)), ["(package): INVALID_TYPE"]);
  }
});

test("required fields, types, bounds and unknown fields are reported by path and code", () => {
  rejected((p) => { delete p.title; }, "title: REQUIRED");
  rejected((p) => { delete p.solution; }, "solution: REQUIRED");
  rejected((p) => { delete p.objectives; }, "objectives: REQUIRED");
  rejected((p) => { delete p.items[0].essential; }, "items[0].essential: REQUIRED");
  rejected((p) => { p.title = 7; }, "title: INVALID_TYPE");
  rejected((p) => { p.items[1].essential = "true"; }, "items[1].essential: INVALID_TYPE");
  rejected((p) => { p.publicEvents[0].order = 1.5; }, "publicEvents[0].order: INVALID_TYPE");
  rejected((p) => { p.publicEvents[0].order = 0; }, "publicEvents[0].order: OUT_OF_RANGE");
  rejected((p) => { p.supportedPlayerCounts = []; }, "supportedPlayerCounts: TOO_SHORT");
  rejected((p) => { p.solution.supportingItemIds = []; }, "solution.supportingItemIds: TOO_SHORT");
  rejected((p) => { p.title = "x".repeat(CONTENT_LIMITS.shortText + 1); }, "title: TOO_LONG");
  rejected((p) => { p.items[0].text = "x".repeat(CONTENT_LIMITS.longText + 1); }, "items[0].text: TOO_LONG");
  rejected((p) => { p.startingDossiers[2].biography = " \n\t"; }, "startingDossiers[2].biography: BLANK_TEXT");
  rejected((p) => { p.title = "e\u0301"; }, "title: NON_CANONICAL_TEXT");
  rejected((p) => { p.title = "x\ud800"; }, "title: NON_CANONICAL_TEXT");
  rejected((p) => { p.mysteryId = "Synthetic Mystery"; }, "mysteryId: INVALID_ID");
  rejected((p) => { p.version = "1.0.0+build"; }, "version: INVALID_VERSION");
  rejected((p) => { p.characters[4].id = "Role-5"; }, "characters[4].id: INVALID_ID");
  rejected((p) => { p.motiveIds[0] = "motive a"; }, "motiveIds[0]: INVALID_ID");

  rejected((p) => { p.digestSha256 = "0".repeat(64); }, "digestSha256: UNKNOWN_FIELD");
  rejected((p) => { p.publication = { publishedAt: "2026-01-01" }; }, "publication: UNKNOWN_FIELD");
  rejected((p) => { p.characters[0].isMurderer = false; }, "characters[0].isMurderer: UNKNOWN_FIELD");
  rejected((p) => { p.items[3].audience.note = "x"; }, "items[3].audience.note: UNKNOWN_FIELD");
  rejected((p) => { p.items[0].audience.characterId = "role-1"; }, "items[0].audience.characterId: UNKNOWN_FIELD");
  rejected((p) => { p.solution.hint = "x"; }, "solution.hint: UNKNOWN_FIELD");
  // Several problems are all reported, each with its own location.
  rejected((p) => { p.title = ""; p.extra = 1; p.items[0].id = "X"; },
    "title: BLANK_TEXT", "items[0].id: INVALID_ID", "extra: UNKNOWN_FIELD");
});

test("starting dossiers cannot carry murderer fields and the briefing is ACT_1 only", () => {
  for (const field of ["guiltNotice", "motive", "method", "timeline", "coverStory", "isMurderer", "releasePhase"]) {
    rejected((p) => { p.startingDossiers[2][field] = p.murdererBriefing.guiltNotice; },
      `startingDossiers[2].${field}: UNKNOWN_FIELD`);
  }
  for (const phase of ["LOBBY", "ACT_2", "ACT_3", "REVEAL", "act_1", null]) {
    rejected((p) => { p.murdererBriefing.releasePhase = phase; }, "murdererBriefing.releasePhase: INVALID_VALUE");
  }
  rejected((p) => { delete p.murdererBriefing.releasePhase; }, "murdererBriefing.releasePhase: REQUIRED");
  rejected((p) => { delete p.murdererBriefing; }, "murdererBriefing: REQUIRED");
  rejected((p) => { p.murdererBriefing = [p.murdererBriefing, p.murdererBriefing]; }, "murdererBriefing: INVALID_TYPE");
  rejected((p) => { p.murdererBriefing.characterId = "role-4"; }, "murdererBriefing.characterId: BRIEFING_CULPRIT_MISMATCH");
  rejected((p) => { p.solution.culpritCharacterId = "role-4"; }, "murdererBriefing.characterId: BRIEFING_CULPRIT_MISMATCH");
  rejected((p) => { p.murdererBriefing.characterId = "role-9"; p.solution.culpritCharacterId = "role-9"; },
    "solution.culpritCharacterId: UNRESOLVED_REFERENCE", "murdererBriefing.characterId: UNRESOLVED_REFERENCE");
});

test("released items keep explicit phases, audiences and epistemic kinds", () => {
  for (const phase of ["LOBBY", "ACCUSATIONS", "REVEAL", "COMPLETE", "ACT_4", 1]) {
    rejected((p) => { p.items[0].releasePhase = phase; }, "items[0].releasePhase: INVALID_VALUE");
    rejected((p) => { p.publicEvents[0].releasePhase = phase; }, "publicEvents[0].releasePhase: INVALID_VALUE");
    rejected((p) => { p.objectives[0].releasePhase = phase; }, "objectives[0].releasePhase: INVALID_VALUE");
  }
  for (const kind of ["SOLUTION_ONLY", "HOST", "ALL", "character"]) {
    rejected((p) => { p.items[0].audience = { kind }; }, "items[0].audience.kind: INVALID_VALUE");
  }
  for (const kind of ["SOLUTION_ONLY", "PUBLIC_EVENT", "CLUE", "evidence"]) {
    rejected((p) => { p.items[0].kind = kind; }, "items[0].kind: INVALID_VALUE");
  }
  rejected((p) => { p.items[3].audience = { kind: "CHARACTER" }; }, "items[3].audience.characterId: REQUIRED");
  rejected((p) => { p.items[3].audience = "PUBLIC"; }, "items[3].audience: INVALID_TYPE");
  rejected((p) => { p.items[3].audience.characterId = "role-9"; }, "items[3].audience.characterId: UNRESOLVED_REFERENCE");

  const { definition } = validated();
  assert.deepEqual(definition.items.map(({ kind }) => kind),
    ["EVIDENCE", "EVIDENCE", "EVIDENCE", "PERSONAL_KNOWLEDGE", "RUMOR"]);
});

test("IDs are unique per namespace and every reference resolves", () => {
  rejected((p) => { p.characters[5].id = "role-1"; },
    "characters[5].id: DUPLICATE_ID",
    // Renaming role-6 away also orphans everything that referred to it.
    "startingDossiers[4].relationships[0].characterId: UNRESOLVED_REFERENCE",
    "startingDossiers[5].characterId: UNRESOLVED_REFERENCE");
  rejected((p) => { p.items[4].id = "public-item-1"; }, "items[4].id: DUPLICATE_ID");
  rejected((p) => { p.publicEvents[3].id = "event-1"; }, "publicEvents[3].id: DUPLICATE_ID");
  rejected((p) => { p.objectives[1].id = "objective-1"; }, "objectives[1].id: DUPLICATE_ID");
  rejected((p) => { p.motiveIds[2] = "motive-a"; }, "motiveIds[2]: DUPLICATE_ID");
  rejected((p) => { p.methodIds[1] = "method-a"; }, "methodIds[1]: DUPLICATE_ID");
  // Namespaces are separate: an item may share a spelling with an event.
  assert.equal(validated((p) => { p.items[0].id = "event-1"; p.solution.supportingItemIds = ["public-item-2"]; }).ok, true);

  rejected((p) => { p.startingDossiers.pop(); }, "characters[7].id: MISSING_STARTING_DOSSIER");
  rejected((p) => { p.startingDossiers = []; }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `characters[${i}].id: MISSING_STARTING_DOSSIER`));
  rejected((p) => { p.startingDossiers.push({ ...p.startingDossiers[0] }); },
    "startingDossiers[8].characterId: DUPLICATE_REFERENCE");
  rejected((p) => { p.startingDossiers.push({ ...p.startingDossiers[0], characterId: "role-9" }); },
    "startingDossiers[8].characterId: UNRESOLVED_REFERENCE");
  rejected((p) => { p.startingDossiers[1].relationships[0].characterId = "role-9"; },
    "startingDossiers[1].relationships[0].characterId: UNRESOLVED_REFERENCE");
  rejected((p) => { p.startingDossiers[1].relationships[0].characterId = "role-2"; },
    "startingDossiers[1].relationships[0].characterId: SELF_REFERENCE");
  rejected((p) => { p.startingDossiers[1].relationships.push({ ...p.startingDossiers[1].relationships[0] }); },
    "startingDossiers[1].relationships[1].characterId: DUPLICATE_REFERENCE");

  rejected((p) => { p.objectives[0].characterId = "role-9"; }, "objectives[0].characterId: UNRESOLVED_REFERENCE");
  rejected((p) => { p.objectives[0].targetCharacterId = "role-9"; }, "objectives[0].targetCharacterId: UNRESOLVED_REFERENCE");
  rejected((p) => { p.objectives[0].targetCharacterId = "role-1"; }, "objectives[0].targetCharacterId: SELF_REFERENCE");
  rejected((p) => { p.objectives[0].type = "INVESTIGATIVE"; }, "objectives[0].type: UNKNOWN_FIELD");

  rejected((p) => { p.solution.motiveId = "motive-z"; }, "solution.motiveId: UNRESOLVED_REFERENCE");
  rejected((p) => { p.solution.methodId = "motive-a"; }, "solution.methodId: UNRESOLVED_REFERENCE");
  rejected((p) => { p.solution.supportingItemIds[1] = "event-1"; }, "solution.supportingItemIds[1]: UNRESOLVED_REFERENCE");
  rejected((p) => { p.solution.supportingItemIds[1] = "public-item-2"; }, "solution.supportingItemIds[1]: DUPLICATE_REFERENCE");
});

test("public events are listed in play order with unique positions", () => {
  rejected((p) => { p.publicEvents[2].order = 1; }, "publicEvents[2].order: EVENT_ORDER_INVALID");
  rejected((p) => { p.publicEvents.reverse(); },
    "publicEvents[1].order: EVENT_ORDER_INVALID", "publicEvents[2].order: EVENT_ORDER_INVALID", "publicEvents[3].order: EVENT_ORDER_INVALID");
  rejected((p) => { p.publicEvents[3].releasePhase = "ACT_1"; }, "publicEvents[3].order: EVENT_ORDER_INVALID");
  // Gaps are allowed; only the relative order has meaning.
  assert.equal(validated((p) => { p.publicEvents[2].order = 40; }).ok, true);
  assert.equal(validated((p) => { p.publicEvents = []; }).ok, true);
});

test("the first-prototype rule set requires exactly eight roles and supported counts [8]", () => {
  rejected((p) => { p.characters.pop(); p.startingDossiers.pop(); p.startingDossiers[6].relationships = []; },
    "characters: ROLE_COUNT_NOT_ALLOWED");
  rejected((p) => {
    p.characters.push({ ...p.characters[0], id: "role-9" });
    p.startingDossiers.push({ ...p.startingDossiers[0], characterId: "role-9" });
  }, "characters: ROLE_COUNT_NOT_ALLOWED");
  for (const counts of [[6], [7, 8], [8, 9], [6, 7, 8, 9, 10]]) {
    rejected((p) => { p.supportedPlayerCounts = counts; }, "supportedPlayerCounts: PLAYER_COUNTS_NOT_ALLOWED");
  }
  rejected((p) => { p.supportedPlayerCounts = [8, 8]; }, "supportedPlayerCounts[1]: NOT_STRICTLY_ASCENDING");
  rejected((p) => { p.supportedPlayerCounts = [10, 8]; }, "supportedPlayerCounts[1]: NOT_STRICTLY_ASCENDING");
  rejected((p) => { p.supportedPlayerCounts = [8.5]; }, "supportedPlayerCounts[0]: INVALID_TYPE");

  assert.deepEqual(rules, { id: "eight-role-prototype-v1", playableRoleCount: 8, supportedPlayerCounts: [8] });
  assert.ok(Object.isFrozen(rules) && Object.isFrozen(rules.supportedPlayerCounts));
});

test("the model is not tied to eight roles: another explicit rule set accepts another cast size", () => {
  const input = syntheticMysteryPackage();
  input.characters.length = 2;
  input.startingDossiers.length = 2;
  input.startingDossiers[1].relationships[0].characterId = "role-1";
  input.supportedPlayerCounts = [2];
  input.murdererBriefing.characterId = "role-2";
  input.solution.culpritCharacterId = "role-2";
  input.items = input.items.slice(0, 3);
  input.objectives = [];
  const twoRoleRules = Object.freeze({ id: "two-role-test-v1", playableRoleCount: 2, supportedPlayerCounts: [2] });
  assert.deepEqual(flat(validateMysteryDefinition(input, twoRoleRules)), ["(ok)"]);
  assert.deepEqual(flat(validateMysteryDefinition(input, rules)),
    ["characters: ROLE_COUNT_NOT_ALLOWED", "supportedPlayerCounts: PLAYER_COUNTS_NOT_ALLOWED"]);
});

test("the legacy placeholder pin still names the lobby catalog and can never be claimed by a package", () => {
  const catalog = readFileSync(new URL("../../src/lib/lobby/public-characters.ts", import.meta.url), "utf8");
  assert.deepEqual(RESERVED_LEGACY_PINS, [{ mysteryId: "blackwood-affair", version: "first-playtest-placeholder-v1" }]);
  const [pin] = RESERVED_LEGACY_PINS;
  assert.ok(catalog.includes(`BLACKWOOD_MYSTERY_ID = "${pin.mysteryId}"`));
  assert.ok(catalog.includes(`BLACKWOOD_MYSTERY_VERSION = "${pin.version}"`));

  rejected((p) => { p.mysteryId = pin.mysteryId; p.version = pin.version; }, "version: RESERVED_LEGACY_VERSION");
  assert.equal(validated((p) => { p.mysteryId = pin.mysteryId; }).ok, true);
});

test("canonical JSON has one byte form regardless of key insertion order", () => {
  assert.equal(new TextDecoder().decode(canonicalJsonBytes({ b: [1, true, null, -7], a: "é\n\"\u0001", "": {}, B: [] })),
    "{\"\":{},\"B\":[],\"a\":\"é\\n\\\"\\u0001\",\"b\":[1,true,null,-7]}");
  // Keys sort by UTF-16 code unit, not by code point or locale.
  assert.equal(new TextDecoder().decode(canonicalJsonBytes({ "\u{1F600}": 1, "\uFF21": 2, z: 3, Z: 4, 10: 5, 9: 6 })),
    "{\"10\":5,\"9\":6,\"Z\":4,\"z\":3,\"\u{1F600}\":1,\"\uFF21\":2}");

  const first = sealed();
  const input = reversedKeys(syntheticMysteryPackage());
  assert.notDeepEqual(Object.keys(input), Object.keys(syntheticMysteryPackage()));
  const second = sealMysteryDefinition(input, rules);
  assert.equal(second.ok, true);
  assert.equal(second.ref.digestSha256, first.ref.digestSha256);
  assert.equal(Buffer.compare(second.bytes, first.bytes), 0);
  assert.match(first.ref.digestSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.ref.digestSha256, createHash("sha256").update(first.bytes).digest("hex"));
  assert.deepEqual({ ...first.ref, digestSha256: "" },
    { mysteryId: "synthetic-mystery", version: "1.0.0-test.1", schemaVersion: 1, digestSha256: "" });
  // The package bytes never contain their own digest.
  assert.equal(Buffer.from(first.bytes).includes(first.ref.digestSha256), false);
});

test("canonical encoding rejects values without a stable JSON form", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [1, , 3];
  const tagged = Object.assign([1], { extra: 1 });
  const cases = [
    ["UNSUPPORTED_NUMBER", [1.5, NaN, Infinity, -Infinity, -0, 2 ** 53, 1e21]],
    ["UNSUPPORTED_VALUE", [undefined, 1n, Symbol("s"), () => 1, new Date(0), new Map(), new Set(), /x/, new (class Box {})(),
      new Uint8Array(1), sparse, tagged, { get a() { return 1; } }, Object.defineProperty({}, "a", { value: 1 }),
      { toJSON() { return 1; } }]],
    ["NON_CANONICAL_TEXT", ["e\u0301", "\ud800", "x\udc00y"]],
    ["UNSAFE_KEY", [{ "e\u0301": 1 }, { "\ud800": 1 }, { [Symbol("s")]: 1 }, JSON.parse('{"__proto__":1}')]],
    ["TOO_DEEP", [cyclic, JSON.parse("[".repeat(17) + "]".repeat(17))]],
  ];
  for (const [code, values] of cases) {
    for (const value of values) {
      assert.equal(canonicalCode(() => canonicalJsonBytes(value)), code);
      assert.equal(canonicalCode(() => canonicalJsonBytes({ nested: [value] })), code);
    }
  }
  assert.equal(canonicalCode(() => canonicalJsonBytes("x".repeat(MAX_CANONICAL_BYTES))), "PACKAGE_TOO_LARGE");
  assert.equal(canonicalCode(() => canonicalJsonBytes(JSON.parse("[".repeat(16) + "]".repeat(16)))), "(ok)");
  assert.equal(canonicalCode(() => canonicalJsonBytes(Object.assign(Object.create(null), { a: 1 }))), "(ok)");
});

test("parsing accepts only bytes that are already canonical", () => {
  const { bytes } = sealed();
  const roundTrip = canonicalJsonBytes(parseCanonicalJsonBytes(bytes));
  assert.equal(Buffer.compare(roundTrip, bytes), 0);

  const cases = {
    '{"a":1,"b":2}': "(ok)",
    '{"b":2,"a":1}': "NON_CANONICAL_ENCODING",
    '{"a":1,"a":1}': "NON_CANONICAL_ENCODING",
    '{"a":1,"a":2}': "NON_CANONICAL_ENCODING",
    '{"a":1, "b":2}': "NON_CANONICAL_ENCODING",
    '{"a":1,"b":2}\n': "NON_CANONICAL_ENCODING",
    ' {"a":1,"b":2}': "NON_CANONICAL_ENCODING",
    '{"a":"\\u0041"}': "NON_CANONICAL_ENCODING",
    '{"a":"\\/"}': "NON_CANONICAL_ENCODING",
    '{"a":1E0}': "NON_CANONICAL_ENCODING",
    '{"a":1.0}': "NON_CANONICAL_ENCODING",
    '{"a":-0}': "UNSUPPORTED_NUMBER",
    '{"a":0.1}': "UNSUPPORTED_NUMBER",
    '{"a":1e400}': "UNSUPPORTED_NUMBER",
    '{"a":9007199254740993}': "UNSUPPORTED_NUMBER",
    '{"a":"e\u0301"}': "NON_CANONICAL_TEXT",
    '{"a":"\\ud800"}': "NON_CANONICAL_TEXT",
    '{"__proto__":{"a":1}}': "UNSAFE_KEY",
    '\ufeff{"a":1}': "INVALID_JSON",
    '{"a":1,}': "INVALID_JSON",
    "{'a':1}": "INVALID_JSON",
    '{"a":NaN}': "INVALID_JSON",
    '{"a":undefined}': "INVALID_JSON",
    "": "INVALID_JSON",
    [`${"[".repeat(100_000)}`]: "INVALID_JSON",
  };
  for (const [text, code] of Object.entries(cases)) {
    assert.equal(canonicalCode(() => parseCanonicalJsonBytes(utf8(text))), code, text.slice(0, 24));
  }
  for (const invalid of [[0xff], [0xc0, 0x80], [0x22, 0xed, 0xa0, 0x80, 0x22], [0x7b, 0x22, 0xe9, 0x22, 0x3a, 0x31, 0x7d]]) {
    assert.equal(canonicalCode(() => parseCanonicalJsonBytes(Uint8Array.from(invalid))), "INVALID_UTF8");
  }
  assert.equal(canonicalCode(() => parseCanonicalJsonBytes(new Uint8Array(MAX_CANONICAL_BYTES + 1))), "PACKAGE_TOO_LARGE");
  assert.equal(canonicalCode(() => parseCanonicalJsonBytes('{"a":1}')), "INVALID_TYPE");
});

test("a sealed package loads only against its exact pinned reference", () => {
  const { bytes, ref } = sealed();
  const loaded = loadVerifiedMysteryDefinition(bytes, ref, rules);
  assert.deepEqual(flat(loaded), ["(ok)"]);
  assert.equal(loaded.definition.solution.culpritCharacterId, "role-3");
  assert.ok(Object.isFrozen(loaded.definition) && Object.isFrozen(loaded.definition.startingDossiers[0].relationships));
  assert.equal(Buffer.compare(canonicalJsonBytes(loaded.definition), bytes), 0);

  const load = (b, r) => flat(loadVerifiedMysteryDefinition(b, r, rules));
  const withRef = (change) => { const copy = { ...ref, ...change }; for (const k in copy) if (copy[k] === undefined) delete copy[k]; return copy; };

  // Missing, malformed or wrong digests never pass.
  assert.deepEqual(load(bytes, withRef({ digestSha256: undefined })), ["digestSha256: REQUIRED"]);
  for (const digest of ["", ref.digestSha256.toUpperCase(), ref.digestSha256.slice(1), `${ref.digestSha256} `, `sha256:${ref.digestSha256}`]) {
    assert.deepEqual(load(bytes, withRef({ digestSha256: digest })), ["digestSha256: INVALID_DIGEST"]);
  }
  for (const digest of [null, 0, true, [ref.digestSha256]]) {
    assert.deepEqual(load(bytes, withRef({ digestSha256: digest })), ["digestSha256: INVALID_TYPE"]);
  }
  assert.deepEqual(load(bytes, withRef({ digestSha256: "0".repeat(64) })), ["(package): DIGEST_MISMATCH"]);
  assert.deepEqual(load(bytes, undefined), ["(package): REQUIRED"]);
  assert.deepEqual(load(bytes, ref.digestSha256), ["(package): INVALID_TYPE"]);
  assert.deepEqual(load(bytes, withRef({ publishedAt: "now" })), ["publishedAt: UNKNOWN_FIELD"]);
  assert.deepEqual(load(bytes, withRef({ version: "LATEST" })), ["version: INVALID_VERSION"]);

  // Any changed, added or removed byte is detected before the bytes are parsed.
  for (const index of [0, 1, Math.floor(bytes.length / 2), bytes.length - 1]) {
    const tampered = Uint8Array.from(bytes);
    tampered[index] ^= 1;
    assert.deepEqual(load(tampered, ref), ["(package): DIGEST_MISMATCH"]);
  }
  assert.deepEqual(load(bytes.subarray(0, bytes.length - 1), ref), ["(package): DIGEST_MISMATCH"]);
  assert.deepEqual(load(Uint8Array.from([...bytes, 0x20]), ref), ["(package): DIGEST_MISMATCH"]);
  assert.deepEqual(load(new Uint8Array(0), ref), ["(package): DIGEST_MISMATCH"]);
  assert.deepEqual(load(new Uint8Array(MAX_CANONICAL_BYTES + 1), ref), ["(package): PACKAGE_TOO_LARGE"]);
  for (const notBytes of [undefined, null, new TextDecoder().decode(bytes), [...bytes], bytes.buffer]) {
    assert.deepEqual(load(notBytes, ref), ["(package): INVALID_TYPE"]);
  }

  // Bytes of another valid package do not satisfy this pin, and a pin for one identity does not accept another's bytes.
  const other = sealed((p) => { p.version = "1.0.0-test.2"; });
  assert.notEqual(other.ref.digestSha256, ref.digestSha256);
  assert.deepEqual(load(other.bytes, ref), ["(package): DIGEST_MISMATCH"]);
  assert.deepEqual(load(other.bytes, withRef({ digestSha256: other.ref.digestSha256 })), ["version: IDENTITY_MISMATCH"]);
  assert.deepEqual(load(bytes, withRef({ mysteryId: "another-mystery", schemaVersion: 2 })),
    ["mysteryId: IDENTITY_MISMATCH", "schemaVersion: IDENTITY_MISMATCH"]);
});

test("a matching digest does not excuse unsupported, invalid or non-canonical bytes", () => {
  const pinned = (bytes) => ({ mysteryId: "synthetic-mystery", version: "1.0.0-test.1", schemaVersion: 1, digestSha256: sha256Hex(bytes) });
  const load = (bytes, ref = pinned(bytes)) => flat(loadVerifiedMysteryDefinition(bytes, ref, rules));
  const encode = (mutate) => { const input = syntheticMysteryPackage(); mutate(input); return canonicalJsonBytes(input); };

  const future = encode((p) => { p.schemaVersion = 2; });
  assert.deepEqual(load(future), ["schemaVersion: UNSUPPORTED_SCHEMA_VERSION"]);
  assert.deepEqual(load(future, { ...pinned(future), schemaVersion: 2 }), ["schemaVersion: UNSUPPORTED_SCHEMA_VERSION"]);
  assert.deepEqual(load(encode((p) => { p.startingDossiers[2].coverStory = "x"; })), ["startingDossiers[2].coverStory: UNKNOWN_FIELD"]);
  assert.deepEqual(load(encode((p) => { p.murdererBriefing.releasePhase = "LOBBY"; })), ["murdererBriefing.releasePhase: INVALID_VALUE"]);
  assert.deepEqual(load(encode((p) => { p.characters.pop(); p.startingDossiers.pop(); p.startingDossiers[6].relationships = []; })),
    ["characters: ROLE_COUNT_NOT_ALLOWED"]);

  const pretty = utf8(JSON.stringify(syntheticMysteryPackage(), null, 2));
  assert.deepEqual(load(pretty), ["(package): NON_CANONICAL_ENCODING"]);
  const unsorted = utf8(JSON.stringify(reversedKeys(syntheticMysteryPackage())));
  assert.deepEqual(load(unsorted), ["(package): NON_CANONICAL_ENCODING"]);
  const { bytes } = sealed();
  const duplicated = utf8(new TextDecoder().decode(bytes).replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1'));
  assert.deepEqual(load(duplicated), ["(package): NON_CANONICAL_ENCODING"]);
  assert.deepEqual(load(utf8("not json")), ["(package): INVALID_JSON"]);
  assert.deepEqual(load(Uint8Array.from([0xff, 0xfe])), ["(package): INVALID_UTF8"]);
});

test("every meaningful change to a package changes its digest", () => {
  const base = sealed().ref.digestSha256;
  const changes = [
    (p) => { p.version = "1.0.0-test.2"; },
    (p) => { p.title += "."; },
    (p) => { p.characters.reverse(); },
    (p) => { p.startingDossiers[0].biography += " "; },
    (p) => { p.startingDossiers[0].interpersonalPrompts.push("Another placeholder prompt."); },
    (p) => { p.murdererBriefing.coverStory += "!"; },
    (p) => { p.items[0].essential = false; },
    (p) => { p.items[3].kind = "RUMOR"; },
    (p) => { p.items[3].releasePhase = "ACT_3"; },
    (p) => { p.items[3].audience = { kind: "PUBLIC" }; },
    (p) => { p.items[3].audience.characterId = "role-6"; },
    (p) => { p.publicEvents[2].order = 3; },
    (p) => { delete p.objectives[0].targetCharacterId; },
    (p) => { p.solution.motiveId = "motive-a"; },
    (p) => { p.solution.supportingItemIds.reverse(); },
    (p) => { p.methodIds.push("method-c"); },
  ];
  const digests = new Set([base, ...changes.map((change) => sealed(change).ref.digestSha256)]);
  assert.equal(digests.size, changes.length + 1);
  assert.equal(sealed().ref.digestSha256, base);
});

test("diagnostics never contain authored text, unsafe keys or unbounded output", () => {
  const S = SYNTHETIC_SENTINELS;
  const failures = [
    validated((p) => { p.startingDossiers[0][`${S.dossier} is a secret key`] = S.solution; }),
    validated((p) => { p.solution.narrative = { nested: S.solution }; }),
    validated((p) => { p.murdererBriefing.releasePhase = S.briefing; }),
    validated((p) => { p.items[0].kind = S.item; }),
    validated((p) => { p.solution.culpritCharacterId = S.solution; }),
    sealMysteryDefinition({ ...syntheticMysteryPackage(), title: `${S.solution}\ud800` }, rules),
    loadVerifiedMysteryDefinition(utf8(`{"x":"${S.solution}",}`), { mysteryId: "m", version: "1", schemaVersion: 1,
      digestSha256: sha256Hex(utf8(`{"x":"${S.solution}",}`)) }, rules),
    loadVerifiedMysteryDefinition(sealed().bytes, { mysteryId: S.solution, version: "1", schemaVersion: 1, digestSha256: S.solution }, rules),
  ];
  for (const result of failures) {
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result) + result.issues.map(formatIssue).join(), sentinelPattern);
    for (const { code, path, ...rest } of result.issues) {
      assert.match(code, /^[A-Z0-9_]+$/);
      assert.ok(path.every((segment) => Number.isInteger(segment) || /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(segment)));
      assert.deepEqual(rest, {});
    }
  }
  // A key that does not look like a field name is reported at its parent only.
  assert.deepEqual(flat(failures[0]), ["startingDossiers[0]: UNKNOWN_FIELD"]);

  const noisy = validated((p) => { for (const item of p.items) item.id = "X"; for (let i = 0; i < 300; i += 1) p[`extra_${i}`] = i; });
  assert.equal(noisy.issues.length, MAX_REPORTED_ISSUES);
  assert.equal(noisy.truncated, true);
  assert.equal(validated((p) => { p.title = ""; }).truncated, false);
});

test("the content module is pure, has no barrel and is not wired into the application", () => {
  const moduleUrl = new URL("../../src/lib/mystery-content/", import.meta.url);
  const files = readdirSync(moduleUrl).sort();
  assert.deepEqual(files, ["canonical-json.ts", "ids.ts", "integrity.ts", "issues.ts", "schema.ts", "validate.ts"]);
  const imports = files.flatMap((name) =>
    [...readFileSync(new URL(name, moduleUrl), "utf8").matchAll(/^import [^;]*?from "([^"]+)";$/gms)].map(([, target]) => target));
  assert.deepEqual([...new Set(imports.filter((target) => !target.startsWith("./")))].sort(), ["node:crypto", "zod"]);
  for (const name of files) {
    const source = readFileSync(new URL(name, moduleUrl), "utf8");
    assert.doesNotMatch(source, /"use client"|process\.env|console\.|\bfetch\(|node:fs|supabase|next\//i, name);
  }

  const srcUrl = new URL("../../src/", import.meta.url);
  const importers = readdirSync(srcUrl, { recursive: true })
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => /\.tsx?$/.test(name) && !name.startsWith("lib/mystery-content/"))
    .filter((name) => /mystery-content/.test(readFileSync(new URL(name, srcUrl), "utf8")));
  assert.deepEqual(importers, []);
});
