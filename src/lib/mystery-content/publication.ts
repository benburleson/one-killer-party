import { loadVerifiedMysteryDefinition, sealMysteryDefinition } from "./integrity.ts";
import type { PublishedVersionRef } from "./schema.ts";
import type { PackageRuleSet } from "./validate.ts";

export type PublicationMetadata = Readonly<{
  provenance: string;
  approvedBy: string;
  approvalReference: string;
}>;

export type PublicationStore = Readonly<{
  upload(path: string, bytes: Uint8Array): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  register(ref: PublishedVersionRef, path: string, rulesId: string, metadata: PublicationMetadata):
    Promise<"published" | "already_published">;
}>;

export type PublicationFailureCode =
  | "INVALID_APPROVAL"
  | "INVALID_PACKAGE"
  | "OBJECT_CONFLICT"
  | "OBJECT_WRITE_FAILED"
  | "READBACK_FAILED"
  | "READBACK_MISMATCH"
  | "REGISTRATION_FAILED";

export type PublicationResult =
  | Readonly<{ ok: true; ref: PublishedVersionRef; status: "published" | "already_published" }>
  | Readonly<{ ok: false; code: PublicationFailureCode }>;

const SAFE_METADATA = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,127}$/;
const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

export function privateMysteryObjectPath(ref: PublishedVersionRef): string {
  return `${ref.mysteryId}/${ref.version}/${ref.digestSha256}.json`;
}

export async function publishMysteryDefinition(
  input: unknown,
  rules: PackageRuleSet,
  metadata: PublicationMetadata,
  store: PublicationStore,
): Promise<PublicationResult> {
  if (!metadata || !SAFE_METADATA.test(metadata.provenance) ||
      !SAFE_METADATA.test(metadata.approvedBy) ||
      !SAFE_METADATA.test(metadata.approvalReference)) {
    return { ok: false, code: "INVALID_APPROVAL" };
  }
  if (rules.id !== "eight-role-prototype-v1") return { ok: false, code: "INVALID_PACKAGE" };

  const sealed = sealMysteryDefinition(input, rules);
  if (!sealed.ok) return { ok: false, code: "INVALID_PACKAGE" };
  const path = privateMysteryObjectPath(sealed.ref);

  try {
    await store.upload(path, sealed.bytes);
  } catch {
    try {
      const existing = await store.download(path);
      if (!equalBytes(existing, sealed.bytes)) return { ok: false, code: "OBJECT_CONFLICT" };
    } catch {
      return { ok: false, code: "OBJECT_WRITE_FAILED" };
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await store.download(path);
  } catch {
    return { ok: false, code: "READBACK_FAILED" };
  }

  const verified = loadVerifiedMysteryDefinition(bytes, sealed.ref, rules);
  if (!verified.ok || !equalBytes(bytes, sealed.bytes)) {
    return { ok: false, code: "READBACK_MISMATCH" };
  }

  try {
    const status = await store.register(sealed.ref, path, rules.id, metadata);
    if (status !== "published" && status !== "already_published") {
      return { ok: false, code: "REGISTRATION_FAILED" };
    }
    return { ok: true, ref: sealed.ref, status };
  } catch {
    return { ok: false, code: "REGISTRATION_FAILED" };
  }
}
