import type { ContentIssueCode } from "./issues.ts";

/**
 * Canonical JSON for mystery packages.
 *
 * The encoding is the RFC 8785 (JSON Canonicalization Scheme) form of a
 * deliberately small value domain:
 *
 * - `null`, booleans, strings, arrays and plain objects;
 * - numbers only when they are safe integers other than `-0`, so their text is
 *   plain decimal digits on every runtime;
 * - strings and keys only when they are well-formed Unicode already in NFC, so
 *   one visible text has one byte sequence;
 * - object keys sorted by UTF-16 code unit, array order preserved, no
 *   insignificant whitespace, ECMAScript `JSON.stringify` string escaping;
 * - UTF-8 output without a byte order mark.
 *
 * Anything else is rejected, never coerced. Parsing accepts only bytes that
 * are already in this exact form, which also excludes duplicate keys,
 * alternative escapes and alternative number spellings.
 */
export const MAX_CANONICAL_BYTES = 1_048_576;
export const MAX_CANONICAL_DEPTH = 16;

/** Carries a code and a path only: never the offending value or a parser message. */
export class CanonicalJsonError extends Error {
  readonly code: ContentIssueCode;
  readonly path: readonly (string | number)[];

  constructor(code: ContentIssueCode, path: readonly (string | number)[] = []) {
    super(code);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = path;
  }
}

export function isCanonicalText(value: string): boolean {
  return value.isWellFormed() && value.normalize("NFC") === value;
}

function write(value: unknown, path: (string | number)[], out: string[]): void {
  if (value === null) {
    out.push("null");
  } else if (typeof value === "boolean") {
    out.push(value ? "true" : "false");
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new CanonicalJsonError("UNSUPPORTED_NUMBER", path);
    out.push(String(value));
  } else if (typeof value === "string") {
    if (!isCanonicalText(value)) throw new CanonicalJsonError("NON_CANONICAL_TEXT", path);
    out.push(JSON.stringify(value));
  } else if (Array.isArray(value)) {
    if (path.length >= MAX_CANONICAL_DEPTH) throw new CanonicalJsonError("TOO_DEEP", path);
    // Rejects sparse arrays and arrays carrying extra properties.
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new CanonicalJsonError("UNSUPPORTED_VALUE", path);
    out.push("[");
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new CanonicalJsonError("UNSUPPORTED_VALUE", path);
      if (index > 0) out.push(",");
      write(value[index], [...path, index], out);
    }
    out.push("]");
  } else if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new CanonicalJsonError("UNSUPPORTED_VALUE", path);
    if (path.length >= MAX_CANONICAL_DEPTH) throw new CanonicalJsonError("TOO_DEEP", path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (typeof key !== "string" || key === "__proto__" || !isCanonicalText(key)) {
        throw new CanonicalJsonError("UNSAFE_KEY", path);
      }
      const descriptor = descriptors[key];
      // Accessors could return a different value on each read; hidden properties would be skipped silently.
      if (!descriptor.enumerable || !("value" in descriptor)) throw new CanonicalJsonError("UNSUPPORTED_VALUE", [...path, key]);
    }
    out.push("{");
    // The default sort compares UTF-16 code units, as RFC 8785 requires.
    (keys as string[]).sort().forEach((key, index) => {
      if (index > 0) out.push(",");
      out.push(JSON.stringify(key), ":");
      write(descriptors[key].value, [...path, key], out);
    });
    out.push("}");
  } else {
    // undefined, bigint, symbol and function have no JSON form.
    throw new CanonicalJsonError("UNSUPPORTED_VALUE", path);
  }
}

/** @throws CanonicalJsonError */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  const out: string[] = [];
  write(value, [], out);
  const bytes = new TextEncoder().encode(out.join(""));
  if (bytes.length > MAX_CANONICAL_BYTES) throw new CanonicalJsonError("PACKAGE_TOO_LARGE");
  return bytes;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

/**
 * Parses bytes only if they are exactly the canonical encoding of the value
 * they contain.
 *
 * @throws CanonicalJsonError
 */
export function parseCanonicalJsonBytes(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array)) throw new CanonicalJsonError("INVALID_TYPE");
  if (bytes.length > MAX_CANONICAL_BYTES) throw new CanonicalJsonError("PACKAGE_TOO_LARGE");
  let text: string;
  try {
    // `ignoreBOM` keeps a leading byte order mark in the text so that it is rejected below.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new CanonicalJsonError("INVALID_UTF8");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // The native message can quote the input, so it is discarded.
    throw new CanonicalJsonError("INVALID_JSON");
  }
  if (!sameBytes(canonicalJsonBytes(value), bytes)) throw new CanonicalJsonError("NON_CANONICAL_ENCODING");
  return value;
}
