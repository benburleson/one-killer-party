/**
 * Canonical identifier, version and digest rules for mystery content.
 *
 * All three are restricted to lowercase ASCII so that equality is plain string
 * equality: no case folding, Unicode normalization, trimming or path-separator
 * handling is ever needed, and each value is safe as one object-key segment.
 * Identifiers and versions are names, not authorization tokens.
 */
export const MAX_ID_LENGTH = 64;
export const MAX_VERSION_LENGTH = 64;

// Lowercase words joined by single hyphens, starting with a letter: `blackwood-affair`, `item-07`.
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// Lowercase alphanumeric runs joined by single `.` or `-`: `1.0.0`, `1.0.0-rc.1`, `first-playtest-placeholder-v1`.
const versionPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const sha256DigestPattern = /^[0-9a-f]{64}$/;

export function isCanonicalId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH && idPattern.test(value);
}

/** Versions are opaque: compared for equality only, never ordered or resolved to "latest". */
export function isCanonicalVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_VERSION_LENGTH && versionPattern.test(value);
}

export function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && sha256DigestPattern.test(value);
}
