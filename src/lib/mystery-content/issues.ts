/**
 * Structured, value-free diagnostics for mystery content. An issue carries a
 * code and a location only: never authored text, received values or parser
 * messages, so issues are safe to log and to show an operator.
 */
export type ContentIssueCode =
  // Structure (schema) layer.
  | "REQUIRED"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "INVALID_ID"
  | "INVALID_VERSION"
  | "INVALID_DIGEST"
  | "BLANK_TEXT"
  | "NON_CANONICAL_TEXT"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "OUT_OF_RANGE"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  // Cross-reference layer.
  | "DUPLICATE_ID"
  | "DUPLICATE_REFERENCE"
  | "UNRESOLVED_REFERENCE"
  | "SELF_REFERENCE"
  | "MISSING_STARTING_DOSSIER"
  | "BRIEFING_CULPRIT_MISMATCH"
  | "NOT_STRICTLY_ASCENDING"
  | "EVENT_ORDER_INVALID"
  | "RESERVED_LEGACY_VERSION"
  // Rule-set layer.
  | "ROLE_COUNT_NOT_ALLOWED"
  | "PLAYER_COUNTS_NOT_ALLOWED"
  // Canonical encoding and integrity.
  | "UNSUPPORTED_VALUE"
  | "UNSUPPORTED_NUMBER"
  | "UNSAFE_KEY"
  | "TOO_DEEP"
  | "PACKAGE_TOO_LARGE"
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "NON_CANONICAL_ENCODING"
  | "DIGEST_MISMATCH"
  | "IDENTITY_MISMATCH";

export type ContentIssuePath = readonly (string | number)[];
export type ContentIssue = Readonly<{ code: ContentIssueCode; path: ContentIssuePath }>;
export type ContentFailure = Readonly<{ ok: false; issues: readonly ContentIssue[]; truncated: boolean }>;

/** Upper bound on reported issues, so a hostile input cannot produce unbounded output. */
export const MAX_REPORTED_ISSUES = 100;

const safeKeyPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Object keys are author-controlled. A path keeps a key only when it looks
 * like a field name; otherwise the path stops at the parent.
 */
export function safePath(path: readonly unknown[]): ContentIssuePath {
  const safe: (string | number)[] = [];
  for (const segment of path) {
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) safe.push(segment);
    else if (typeof segment === "string" && safeKeyPattern.test(segment)) safe.push(segment);
    else break;
  }
  return safe;
}

export function issue(code: ContentIssueCode, path: readonly unknown[] = []): ContentIssue {
  return Object.freeze({ code, path: Object.freeze(safePath(path)) });
}

export function failure(issues: readonly ContentIssue[]): ContentFailure {
  return Object.freeze({
    ok: false,
    issues: Object.freeze(issues.slice(0, MAX_REPORTED_ISSUES)),
    truncated: issues.length > MAX_REPORTED_ISSUES,
  });
}

/** `items[3].audience.characterId: UNRESOLVED_REFERENCE` */
export function formatIssue({ code, path }: ContentIssue): string {
  const location = path.reduce<string>(
    (text, segment) => (typeof segment === "number" ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment),
    "",
  );
  return `${location || "(package)"}: ${code}`;
}
