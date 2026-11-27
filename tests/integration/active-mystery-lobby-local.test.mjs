import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test } from "node:test";
import { generateCode, hostService, verifier } from "../../src/lib/host/core.ts";
import { publishMysteryDefinition } from "../../src/lib/mystery-content/publication.ts";
import { loadTrustedPublicMystery } from "../../src/lib/mystery-content/trusted-loader-core.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";
import { SYNTHETIC_SENTINELS, syntheticMysteryPackage } from "../unit/fixtures/synthetic-mystery-package.mjs";

test("local published versions create pinned lobbies and project only public metadata", async () => {
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }));
  assert.equal(status.API_URL, "http://127.0.0.1:54321");
  assert.match(status.DB_URL, /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated", exp: now + 300, iat: now, iss: "supabase", role: "mystery_operator",
    sub: "00000000-0000-4000-8000-000000000001",
  })}`;
  const token = `${unsigned}.${createHmac("sha256", status.JWT_SECRET).update(unsigned).digest("base64url")}`;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const operator = createClient(status.API_URL, status.ANON_KEY, {
    ...options, global: { headers: { Authorization: "Bearer " + token } },
  });
  const runtime = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const guestUnsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated", exp: now + 300, iat: now, iss: "supabase", role: "authenticated",
    sub: "00000000-0000-4000-8000-000000000002",
  })}`;
  const guestToken = `${guestUnsigned}.${createHmac("sha256", status.JWT_SECRET).update(guestUnsigned).digest("base64url")}`;
  const browserClients = [
    createClient(status.API_URL, status.ANON_KEY, options),
    createClient(status.API_URL, status.ANON_KEY, {
      ...options, global: { headers: { Authorization: "Bearer " + guestToken } },
    }),
  ];
  const approvedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  const authorization = {
    target: "local", projectRef: "local", artifact: {},
    async verify(_artifact, binding) {
      return { binding, approvedAt, expiresAt, provenance: "synthetic:test",
        approvedBy: "local-test", approvalReference: "issue-65" };
    },
  };
  const store = {
    async upload(path, bytes) {
      const { error } = await operator.storage.from("private-mystery-packages").upload(path, bytes, {
        contentType: "application/json", upsert: false,
      });
      if (error) throw new Error("upload unavailable");
    },
    async download(path) {
      const { data, error } = await runtime.storage.from("private-mystery-packages").download(path);
      if (error || !data) throw new Error("download unavailable");
      return new Uint8Array(await data.arrayBuffer());
    },
    async register(ref, path, rules, metadata) {
      const { data, error } = await operator.rpc("publish_mystery_version", {
        p_mystery_id: ref.mysteryId, p_version: ref.version, p_schema_version: ref.schemaVersion,
        p_digest_sha256: ref.digestSha256, p_object_path: path, p_rule_set_id: rules,
        p_provenance: metadata.provenance, p_approved_by: metadata.approvedBy,
        p_approval_reference: metadata.approvalReference,
      });
      if (error) throw new Error("registration unavailable");
      return data;
    },
    async lookup(ref) {
      const { data, error } = await runtime.rpc("get_published_mystery", {
        p_mystery_id: ref.mysteryId, p_version: ref.version,
        p_schema_version: ref.schemaVersion, p_digest_sha256: ref.digestSha256,
      });
      if (error) throw new Error("lookup unavailable");
      return data;
    },
  };
  const mysteryId = `synthetic-${randomUUID()}`;
  const one = syntheticMysteryPackage();
  one.mysteryId = mysteryId;
  one.version = "v1";
  const two = JSON.parse(JSON.stringify(one).replaceAll('"role-', '"second-role-'));
  two.version = "v2";
  two.title = "Second synthetic public title";
  const first = await publishMysteryDefinition(one, EIGHT_ROLE_PROTOTYPE_RULES, authorization, store);
  const second = await publishMysteryDefinition(two, EIGHT_ROLE_PROTOTYPE_RULES, authorization, store);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const host = randomUUID();
  const guest = randomUUID();
  const extraGuests = Array.from({ length: 7 }, () => randomUUID());
  const recoveryPrincipal = randomUUID();
  const firstCode = generateCode();
  let secondCode = generateCode();
  while (secondCode === firstCode) secondCode = generateCode();
  let legacyCode = generateCode();
  while (legacyCode === firstCode || legacyCode === secondCode) legacyCode = generateCode();
  const joinBucket = `\\x${randomBytes(32).toString("hex")}`;
  const psql = (sql) => execFileSync("docker", ["exec", "supabase_db_one-killer-party", "psql",
    "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql],
  { stdio: ["ignore", "ignore", "ignore"] });
  psql(`INSERT INTO auth.users (id,aud,role,email) VALUES ('${host}','authenticated','authenticated','${host}@test.invalid'),
    ('${guest}','authenticated','authenticated','${guest}@test.invalid');
    INSERT INTO auth.users (id,aud,role,email,is_anonymous) VALUES
    ${[...extraGuests, recoveryPrincipal].map((id) => `('${id}','authenticated','authenticated','${id}@test.invalid',true)`).join(",")}`);
  const activate = (ref) => execFileSync("node", ["--experimental-strip-types", "scripts/activate-mystery-local.mjs",
    "--local", ref.mysteryId, ref.version, String(ref.schemaVersion), ref.digestSha256, "--confirm-local-activation"],
  { stdio: ["ignore", "ignore", "pipe"] });
  const service = hostService({
    user: async () => host,
    code: () => firstCode,
    rpc: async (name, args) => runtime.rpc(name, args),
    loadPublic: (ref) => loadTrustedPublicMystery(ref, store),
  });
  const snapshot = async (partyId, principal) => {
    const result = await runtime.rpc("get_dossier_authorization_snapshot", {
      p_party_id: partyId, p_principal_id: principal,
    });
    assert.equal(result.error, null);
    return result.data;
  };
  try {
    const legacyParty = randomUUID();
    const legacyService = hostService({
      user: async () => host, code: () => legacyCode, rpc: async (name, args) => runtime.rpc(name, args),
      loadPublic: (ref) => loadTrustedPublicMystery(ref, store),
    });
    assert.equal((await legacyService.create(legacyParty)).kind, "issued");
    const legacyEnrollment = await runtime.rpc("enroll_host_participant", {
      p_host: host, p_party_id: legacyParty, p_display_name: "Legacy host",
    });
    assert.equal(legacyEnrollment.data[0].outcome, "joined");
    const legacySnapshot = (await snapshot(legacyParty, host))[0];
    assert.equal(legacySnapshot.mystery_id, "blackwood-affair");
    assert.equal(legacySnapshot.mystery_version, "first-playtest-placeholder-v1");
    assert.equal(legacySnapshot.digest_sha256, null);
    activate(first.ref);
    const party1 = randomUUID();
    assert.equal((await service.create(party1)).kind, "issued");
    activate(second.ref);
    const retry = await service.create(party1);
    assert.deepEqual(retry, { kind: "existing", partyId: party1 });
    const party2 = randomUUID();
    const service2 = hostService({
      user: async () => host, code: () => secondCode, rpc: async (name, args) => runtime.rpc(name, args),
      loadPublic: (ref) => loadTrustedPublicMystery(ref, store),
    });
    assert.equal((await service2.create(party2)).kind, "issued");
    const pin1 = await runtime.rpc("get_lobby_party_pin", { p_party_id: party1, p_principal: host });
    const pin2 = await runtime.rpc("get_lobby_party_pin", { p_party_id: party2, p_principal: host });
    assert.equal(pin1.data[0].digest_sha256, first.ref.digestSha256);
    assert.equal(pin2.data[0].digest_sha256, second.ref.digestSha256);
    const public1 = await loadTrustedPublicMystery(first.ref, store);
    const public2 = await loadTrustedPublicMystery(second.ref, store);
    assert.equal(public1.ok, true);
    assert.equal(public2.ok, true);
    assert.equal(public1.projection.characters[0].id, "role-1");
    assert.equal(public2.projection.characters[0].id, "second-role-1");
    assert.equal(public2.projection.title, "Second synthetic public title");
    for (const sentinel of Object.values(SYNTHETIC_SENTINELS)) {
      assert.equal(JSON.stringify([public1, public2, pin1.data, pin2.data]).includes(sentinel), false);
    }
    const joined = await runtime.rpc("join_party", {
      p_principal: guest, p_verifier_hash: verifier(firstCode),
      p_display_name: "Synthetic guest", p_rate_bucket_hash: joinBucket,
    });
    assert.equal(joined.error, null);
    assert.equal(joined.data[0].outcome, "joined");
    assert.equal((await snapshot(party1, guest))[0].assigned_character_id, null);
    assert.deepEqual(await snapshot(party1, host), []);
    assert.deepEqual(await snapshot(party2, guest), []);
    for (const browser of browserClients) {
      const denied = await browser.rpc("get_dossier_authorization_snapshot", {
        p_party_id: party1, p_principal_id: guest,
      });
      assert.ok(denied.error);
      assert.equal(denied.data, null);
    }
    const assigned = await runtime.rpc("assign_public_character", {
      p_host: host, p_party_id: party1, p_participant_id: joined.data[0].participant_id,
      p_character_id: "role-1", p_expected_version: 1, p_confirm_change: false,
    });
    assert.equal(assigned.error, null);
    assert.equal(assigned.data[0].outcome, "changed");
    const guestSnapshot = (await snapshot(party1, guest))[0];
    assert.equal(guestSnapshot.participant_id, joined.data[0].participant_id);
    assert.equal(guestSnapshot.assigned_character_id, "role-1");
    assert.equal(guestSnapshot.mystery_version, "v1");
    assert.equal(guestSnapshot.digest_sha256, first.ref.digestSha256);
    const enrolled = await runtime.rpc("enroll_host_participant", {
      p_host: host, p_party_id: party1, p_display_name: "Playing host",
    });
    assert.equal(enrolled.data[0].outcome, "joined");
    assert.equal((await snapshot(party1, host))[0].assigned_character_id, null);
    const members = [];
    for (const principal of extraGuests.slice(0, 6)) {
      const result = await runtime.rpc("join_party", {
        p_principal: principal, p_verifier_hash: verifier(firstCode), p_display_name: "Another guest",
        p_rate_bucket_hash: joinBucket,
      });
      assert.equal(result.data[0].outcome, "joined");
      members.push(result.data[0].participant_id);
    }
    const overflow = await runtime.rpc("join_party", {
      p_principal: extraGuests[6], p_verifier_hash: verifier(firstCode), p_display_name: "Overflow",
      p_rate_bucket_hash: joinBucket,
    });
    assert.equal(overflow.data[0].outcome, "full");
    const assign = async (participant, character, version, confirm) => {
      const result = await runtime.rpc("assign_public_character", {
        p_host: host, p_party_id: party1, p_participant_id: participant, p_character_id: character,
        p_expected_version: version, p_confirm_change: confirm,
      });
      assert.equal(result.error, null);
      return result.data[0].outcome;
    };
    assert.equal(await assign(members[0], "role-1", 9, false), "occupied");
    assert.equal(await assign(members[0], "role-2", 8, false), "conflict");
    assert.equal(await assign(joined.data[0].participant_id, null, 9, false), "confirmation_required");
    assert.equal(await assign(joined.data[0].participant_id, null, 9, true), "changed");
    assert.equal((await snapshot(party1, guest))[0].assigned_character_id, null);
    assert.equal(await assign(members[0], "role-1", 10, false), "changed");
    const removed = await runtime.rpc("remove_host_participant", {
      p_host: host, p_party_id: party1, p_participant_id: joined.data[0].participant_id,
    });
    assert.equal(removed.data, true);
    assert.deepEqual(await snapshot(party1, guest), []);
    const recoveryHash = `\\x${randomBytes(32).toString("hex")}`;
    const bucket = `\\x${randomBytes(32).toString("hex")}`;
    const issued = await runtime.rpc("initiate_participant_recovery", {
      p_host: host, p_party_id: party1, p_participant_id: members[0],
      p_verifier_hash: recoveryHash, p_rate_bucket_hash: bucket,
    });
    assert.equal(issued.data, true);
    const recovered = await runtime.rpc("redeem_participant_recovery", {
      p_new_principal: recoveryPrincipal, p_verifier_hash: recoveryHash, p_rate_bucket_hash: bucket,
    });
    assert.equal(recovered.data[0].outcome, "recovered");
    assert.deepEqual(await snapshot(party1, extraGuests[0]), []);
    const recoveredSnapshot = (await snapshot(party1, recoveryPrincipal))[0];
    assert.equal(recoveredSnapshot.participant_id, members[0]);
    assert.equal(recoveredSnapshot.assigned_character_id, "role-1");
    assert.equal(recoveredSnapshot.digest_sha256, first.ref.digestSha256);
    const membership = await runtime.rpc("get_guest_membership", { p_principal: recoveryPrincipal });
    assert.equal(membership.data[0].assigned_character_id, "role-1");
    assert.equal(membership.data[0].mystery_version, "v1");
  } finally {
    psql("UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton");
  }
});
