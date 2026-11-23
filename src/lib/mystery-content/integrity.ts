import { createHash } from "node:crypto";
import { CanonicalJsonError, canonicalJsonBytes, MAX_CANONICAL_BYTES, parseCanonicalJsonBytes } from "./canonical-json.ts";
import { type ContentFailure, failure, issue } from "./issues.ts";
import { type MysteryDefinition, type PublishedVersionRef, publishedVersionRefSchema } from "./schema.ts";
import { type PackageRuleSet, structuralIssues, validateMysteryDefinition } from "./validate.ts";

/**
 * Integrity for mystery packages.
 *
 * The digest is the lowercase hexadecimal SHA-256 of the package's canonical
 * JSON bytes: the complete `MysteryDefinition` and nothing else. The digest is
 * not a field of the package, so it never hashes itself.
 *
 * A matching digest proves the bytes are the ones that were pinned. It says
 * nothing about who published them or whether anyone approved them; that is
 * the job of the private registry and its publication permissions.
 */
export type SealedPackage = Readonly<{ ok: true; bytes: Uint8Array; ref: PublishedVersionRef; definition: MysteryDefinition }>;
export type VerifiedPackage = Readonly<{ ok: true; ref: PublishedVersionRef; definition: MysteryDefinition }>;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalFailure(error: unknown): ContentFailure {
  // Anything unexpected is rethrown: only known, value-free failures become results.
  if (!(error instanceof CanonicalJsonError)) throw error;
  return failure([issue(error.code, error.path)]);
}

/**
 * Validates a package and produces its canonical bytes and the reference that
 * pins them. This performs no IO and publishes nothing.
 */
export function sealMysteryDefinition(input: unknown, rules: PackageRuleSet): SealedPackage | ContentFailure {
  const validated = validateMysteryDefinition(input, rules);
  if (!validated.ok) return validated;
  const { definition } = validated;
  let bytes: Uint8Array;
  try {
    bytes = canonicalJsonBytes(definition);
  } catch (error) {
    return canonicalFailure(error);
  }
  const ref: PublishedVersionRef = Object.freeze({
    mysteryId: definition.mysteryId,
    version: definition.version,
    schemaVersion: definition.schemaVersion,
    digestSha256: sha256Hex(bytes),
  });
  return Object.freeze({ ok: true, bytes, ref, definition });
}

/**
 * Loads a package only if every check passes; any doubt is a failure.
 *
 * Order matters. The expected reference is checked first, then the digest of
 * the raw bytes, and only bytes that match the pin are decoded, parsed and
 * validated. The package must then name the same identity and schema version
 * as the pin and re-encode to exactly the bytes that were hashed.
 */
export function loadVerifiedMysteryDefinition(
  bytes: unknown,
  expected: unknown,
  rules: PackageRuleSet,
): VerifiedPackage | ContentFailure {
  const expectedRef = publishedVersionRefSchema.safeParse(expected);
  if (!expectedRef.success) return failure(structuralIssues(expectedRef.error, expected));
  const ref: PublishedVersionRef = Object.freeze(expectedRef.data);

  if (!(bytes instanceof Uint8Array)) return failure([issue("INVALID_TYPE")]);
  if (bytes.length > MAX_CANONICAL_BYTES) return failure([issue("PACKAGE_TOO_LARGE")]);
  if (sha256Hex(bytes) !== ref.digestSha256) return failure([issue("DIGEST_MISMATCH")]);

  let parsed: unknown;
  try {
    parsed = parseCanonicalJsonBytes(bytes);
  } catch (error) {
    return canonicalFailure(error);
  }
  const validated = validateMysteryDefinition(parsed, rules);
  if (!validated.ok) return validated;
  const { definition } = validated;

  const mismatches = (["mysteryId", "version", "schemaVersion"] as const).filter((key) => definition[key] !== ref[key]);
  if (mismatches.length > 0) return failure(mismatches.map((key) => issue("IDENTITY_MISMATCH", [key])));

  // Guards against any field the validator might have ignored instead of rejecting.
  let reencoded: Uint8Array;
  try {
    reencoded = canonicalJsonBytes(definition);
  } catch (error) {
    return canonicalFailure(error);
  }
  if (sha256Hex(reencoded) !== ref.digestSha256) return failure([issue("NON_CANONICAL_ENCODING")]);
  return Object.freeze({ ok: true, ref, definition });
}
