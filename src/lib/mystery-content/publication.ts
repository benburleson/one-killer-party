import { loadVerifiedMysteryDefinition, sealMysteryDefinition } from "./integrity.ts";
import type { PublishedVersionRef } from "./schema.ts";
import type { PackageRuleSet } from "./validate.ts";

export type PublicationMetadata = Readonly<{
  provenance: string;
  approvedBy: string;
  approvalReference: string;
}>;

export type PublicationTarget = "local" | "production";

export type PublicationBinding = Readonly<{
  target: PublicationTarget;
  mysteryId: string;
  version: string;
  schemaVersion: number;
  digestSha256: string;
  ruleSetId: string;
}>;

export type VerifiedPublicationApproval = PublicationMetadata & Readonly<{
  binding: PublicationBinding;
  approvedAt: string;
  expiresAt: string;
}>;

export type PublicationAuthorization = Readonly<{
  target: PublicationTarget;
  artifact: unknown;
  verify(
    artifact: unknown,
    binding: PublicationBinding,
  ): Promise<VerifiedPublicationApproval | null>;
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

const SAFE_PROVENANCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SAFE_APPROVER = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,79}$/;
const SAFE_APPROVAL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._#:/-]{0,119}$/;
const MAX_APPROVAL_LIFETIME_MS = 15 * 60 * 1000;
const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

function validApproval(
  approval: VerifiedPublicationApproval | null,
  binding: PublicationBinding,
  now: number,
): approval is VerifiedPublicationApproval {
  if (!approval || typeof approval !== "object" || !approval.binding ||
      typeof approval.binding !== "object" ||
      Object.keys(binding).some((key) =>
        approval.binding[key as keyof PublicationBinding] !== binding[key as keyof PublicationBinding])) {
    return false;
  }
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  return SAFE_PROVENANCE.test(approval.provenance) &&
    SAFE_APPROVER.test(approval.approvedBy) &&
    SAFE_APPROVAL_REFERENCE.test(approval.approvalReference) &&
    Number.isFinite(approvedAt) && Number.isFinite(expiresAt) &&
    approvedAt <= now && expiresAt > now &&
    expiresAt > approvedAt && expiresAt - approvedAt <= MAX_APPROVAL_LIFETIME_MS;
}

export function privateMysteryObjectPath(ref: PublishedVersionRef): string {
  return `${ref.mysteryId}/${ref.version}/${ref.digestSha256}.json`;
}

export async function publishMysteryDefinition(
  input: unknown,
  rules: PackageRuleSet,
  authorization: PublicationAuthorization,
  store: PublicationStore,
): Promise<PublicationResult> {
  if (rules.id !== "eight-role-prototype-v1") return { ok: false, code: "INVALID_PACKAGE" };

  const sealed = sealMysteryDefinition(input, rules);
  if (!sealed.ok) return { ok: false, code: "INVALID_PACKAGE" };

  if (!authorization || !["local", "production"].includes(authorization.target) ||
      typeof authorization.verify !== "function") {
    return { ok: false, code: "INVALID_APPROVAL" };
  }
  const binding: PublicationBinding = {
    target: authorization.target,
    ...sealed.ref,
    ruleSetId: rules.id,
  };
  let approval: VerifiedPublicationApproval | null;
  try {
    approval = await authorization.verify(authorization.artifact, binding);
  } catch {
    return { ok: false, code: "INVALID_APPROVAL" };
  }
  if (!validApproval(approval, binding, Date.now())) {
    return { ok: false, code: "INVALID_APPROVAL" };
  }
  const metadata: PublicationMetadata = {
    provenance: approval.provenance,
    approvedBy: approval.approvedBy,
    approvalReference: approval.approvalReference,
  };
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
