import assert from "node:assert/strict";
import { test } from "node:test";
import { appOrigin, generateCode, hostService, hostPageUrl, originMismatchDetails, parsePartyVersion, safeAuthErrorDetails, validEmail, verifiedEmailHost, verifier } from "../../src/lib/host/core.ts";
import { normalizeInvitationCode } from "../../src/lib/lobby/invite-code.ts";

const host = "a0000000-0000-4000-8000-000000000001";
const other = "a0000000-0000-4000-8000-000000000002";
const id = "b0000000-0000-4000-8000-000000000001";

test("host identity requires a verified non-anonymous email user", () => {
  const confirmed = { id: host, email: "host@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false };
  assert.equal(verifiedEmailHost(confirmed), host);
  for (const user of [
    null, { ...confirmed, is_anonymous: true }, { ...confirmed, is_anonymous: undefined },
    { ...confirmed, email_confirmed_at: undefined }, { ...confirmed, email_confirmed_at: "" },
    { ...confirmed, email: undefined }, { ...confirmed, id: "forged" },
  ]) assert.equal(verifiedEmailHost(user), null);
});

test("email validation and exact, secure callback origins", () => {
  assert.equal(validEmail("host@example.test"), true);
  for (const email of ["", "a@b", "a @b.test", null, "x".repeat(255) + "@x.test"]) {
    assert.equal(validEmail(email), false);
  }
  assert.equal(appOrigin("https://forwarded.example.test/"), "https://forwarded.example.test");
  assert.equal(appOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const origin of [undefined, "http://example.test", "https://example.test/path", "https://user@example.test", "https://example.test/?x=1"]) {
    assert.throws(() => appOrigin(origin));
  }
});

test("host CTA uses APP_URL, including a distinct app subdomain, with local fallback", () => {
  assert.equal(hostPageUrl("https://app.onekillerparty.com"), "https://app.onekillerparty.com/host");
  assert.equal(hostPageUrl("https://app.onekillerparty.com/"), "https://app.onekillerparty.com/host");
  assert.equal(hostPageUrl("http://localhost:3000"), "http://localhost:3000/host");
  assert.equal(hostPageUrl(undefined), "/host");
  assert.throws(() => hostPageUrl("https://example.com/redirect"));
  assert.throws(() => hostPageUrl("http://untrusted.example.com"));
});

test("origin mismatch diagnostics report only fixed comparisons, not arbitrary headers", () => {
  assert.deepEqual(originMismatchDetails("https://app.onekillerparty.com", "https://onekillerparty.com"), {
    requestOriginPresent: true,
    requestOriginIsCanonicalApp: true,
    configuredOriginIsCanonicalApp: false,
  });
  assert.deepEqual(originMismatchDetails(null, "https://app.onekillerparty.com"), {
    requestOriginPresent: false,
    requestOriginIsCanonicalApp: false,
    configuredOriginIsCanonicalApp: true,
  });
  const details = originMismatchDetails("https://attacker.example/?secret=token", "https://app.onekillerparty.com");
  assert.equal(JSON.stringify(details).includes("secret"), false);
  assert.equal(details.configuredOriginIsCanonicalApp, true);
});

test("authentication diagnostics whitelist only safe provider error details", () => {
  assert.deepEqual(safeAuthErrorDetails({ status: 429, code: "over_email_send_rate_limit" }),
    { status: 429, code: "over_email_send_rate_limit" });
  assert.deepEqual(safeAuthErrorDetails({ status: 200, code: "private_secret_or_email" }),
    { status: null, code: "other" });
  assert.deepEqual(safeAuthErrorDetails({ status: "403", code: "email_address_not_authorized" }),
    { status: null, code: "email_address_not_authorized" });
  assert.deepEqual(safeAuthErrorDetails({ status: 500, code: "address@example.com" }),
    { status: 500, code: "other" });
});

test("codes use an unambiguous alphabet and SHA-256 bytea format", () => {
  for (let i = 0; i < 100; i++) {
    const code = generateCode();
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.equal(normalizeInvitationCode(code), code, "issued codes must be accepted by guest parsing");
  }
  assert.equal(verifier("ABCDEFGH"), "\\x9ac2197d9258257b1ae8463e4214e4cd0a578bc1517f2415928b91be4283fc48");
});

test("each command and read verifies user before calling the privileged RPC", async () => {
  let calls = 0;
  const service = hostService({ user: async () => null, rpc: async () => { calls++; } });
  for (const operation of [() => service.list(), () => service.get(id), () => service.create(id), () => service.rotate(id, 0)]) {
    await assert.rejects(operation, /Unauthorized/);
  }
  assert.equal(calls, 0);
});

test("reads use only the verified host and project allowlisted data", async () => {
  const calls = [];
  const record = { party_id: id, status: "LOBBY", version: 0, mystery_id: "blackwood-affair", verifier_hash: "secret", solution: "spoiler", host_principal_id: other };
  const service = hostService({
    user: async () => host,
    rpc: async (name, args) => { calls.push({ name, args }); return { data: [record], error: null }; },
  });
  assert.deepEqual(await service.get(id), { partyId: id, status: "LOBBY", version: 0, mysteryId: "blackwood-affair" });
  assert.deepEqual(await service.list(), [{ partyId: id, status: "LOBBY", version: 0 }]);
  assert.deepEqual(calls, [
    { name: "get_host_party", args: { p_host: host, p_party_id: id } },
    { name: "list_host_parties", args: { p_host: host } },
  ]);
  assert.equal(await service.get("forged"), null);
});

test("foreign and malformed party reads fail closed", async () => {
  const missing = hostService({ user: async () => other, rpc: async () => ({ data: [], error: null }) });
  assert.equal(await missing.get(id), null);
  const contaminated = hostService({ user: async () => host, rpc: async () => ({ data: [{ party_id: id, status: "secret", version: 0 }], error: null }) });
  await assert.rejects(() => contaminated.get(id), /Unavailable/);
});

test("create retries collisions, sends only verifier, and does not reveal a replacement on idempotent retry", async () => {
  const codes = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
  const calls = [];
  let created = false;
  let attempts = 0;
  const service = hostService({
    user: async () => host,
    code: () => codes.shift(),
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "get_host_party") return { data: created ? [{ party_id: id, status: "LOBBY", version: 0, mystery_id: "blackwood-affair" }] : [], error: null };
      if (name === "get_active_mystery") return { data: [{ mystery_id: null, version: null, schema_version: null, digest_sha256: null }], error: null };
      if (++attempts === 1) return { data: null, error: { code: "23505" } };
      created = true;
      return { data: [{ party_id: id, created: true }], error: null };
    },
  });
  assert.deepEqual(await service.create(id), { kind: "issued", partyId: id, code: "JKLMNPQR" });
  assert.deepEqual(await service.create(id), { kind: "existing", partyId: id });
  assert.deepEqual(calls[2], { name: "create_pinned_host_party", args: {
    p_host: host, p_party_id: id, p_verifier_hash: verifier("ABCDEFGH"),
    p_mystery_id: null, p_version: null, p_schema_version: null, p_digest_sha256: null, p_character_ids: null,
  } });
  assert.equal(JSON.stringify(calls).includes("ABCDEFGH"), false);
  assert.equal(JSON.stringify(calls).includes("STUVWXYZ"), false);
});

test("rotation retries collisions and only issues for an authorized atomic success", async () => {
  let calls = 0;
  const service = hostService({
    user: async () => host, code: () => "ABCDEFGH",
    rpc: async (name, args) => {
      assert.equal(name, "rotate_host_invite");
      assert.deepEqual(args, { p_host: host, p_party_id: id, p_verifier_hash: verifier("ABCDEFGH"), p_expected_version: 3 });
      calls++;
      return calls === 1 ? { data: null, error: { code: "23505" } } : { data: calls === 2, error: null };
    },
  });
  assert.deepEqual(await service.rotate(id, 3), { kind: "issued", partyId: id, code: "ABCDEFGH" });
  assert.deepEqual(await service.rotate(id, 3), { kind: "unavailable" });
  for (const version of [-1, 0.1, NaN, 2147483648, "3"]) {
    assert.deepEqual(await service.rotate(id, version), { kind: "unavailable" });
  }
  assert.equal(calls, 3);
});

test("collision retries are bounded and other errors never expose provider details", async () => {
  let calls = 0;
  const service = hostService({ user: async () => host, code: () => "ABCDEFGH", rpc: async (name) => {
    if (name === "get_host_party") return { data: [], error: null };
    if (name === "get_active_mystery") return { data: [{ mystery_id: null, version: null, schema_version: null, digest_sha256: null }], error: null };
    calls++;
    return { data: null, error: { code: "23505", message: "private" } };
  } });
  assert.deepEqual(await service.create(id), { kind: "unavailable" });
  assert.equal(calls, 5);
  assert.deepEqual(await service.rotate("invalid", 0), { kind: "unavailable" });
});

test("creation uses verified active reference and fails closed before mutation on invalid content", async () => {
  const active = { mystery_id: "synthetic", version: "v1", schema_version: 1, digest_sha256: "a".repeat(64) };
  let calls = [];
  const service = hostService({
    user: async () => host,
    code: () => "ABCDEFGH",
    loadPublic: async (ref) => {
      assert.equal(ref.digestSha256, active.digest_sha256);
      return { ok: true, projection: { characters: Array.from({ length: 8 }, (_, i) => ({ id: `role-${i + 1}` })) } };
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "get_host_party") return { data: [], error: null };
      if (name === "get_active_mystery") return { data: [active], error: null };
      return { data: [{ party_id: id, created: true }], error: null };
    },
  });
  assert.equal((await service.create(id)).kind, "issued");
  assert.deepEqual(calls[2].args.p_character_ids, Array.from({ length: 8 }, (_, i) => `role-${i + 1}`));
  assert.equal(calls[2].args.p_digest_sha256, active.digest_sha256);
  calls = [];
  const failed = hostService({
    user: async () => host, loadPublic: async () => ({ ok: false }),
    rpc: async (name) => {
      calls.push(name);
      return { data: name === "get_host_party" ? [] : [active], error: null };
    },
  });
  assert.equal((await failed.create(id)).kind, "unavailable");
  assert.deepEqual(calls, ["get_host_party", "get_active_mystery"]);
});

test("existing creation retry needs neither activation nor content, and malformed active state fails closed", async () => {
  const calls = [];
  const existing = hostService({
    user: async () => host,
    loadPublic: async () => { throw new Error("must not load"); },
    rpc: async (name) => {
      calls.push(name);
      return { data: [{ party_id: id, status: "LOBBY", version: 1, mystery_id: "synthetic" }], error: null };
    },
  });
  assert.deepEqual(await existing.create(id), { kind: "existing", partyId: id });
  assert.deepEqual(calls, ["get_host_party"]);

  for (const activeResponse of [
    { data: null, error: { code: "unavailable" } },
    { data: [], error: null },
    { data: [{ mystery_id: null, version: null, schema_version: 1, digest_sha256: null }], error: null },
    { data: [{ mystery_id: "synthetic", version: "v1", schema_version: 1, digest_sha256: "wrong" }], error: null },
  ]) {
    const calls = [];
    const failing = hostService({
      user: async () => host,
      rpc: async (name) => {
        calls.push(name);
        return name === "get_host_party" ? { data: [], error: null } : activeResponse;
      },
    });
    assert.equal((await failing.create(id)).kind, "unavailable");
    assert.deepEqual(calls, ["get_host_party", "get_active_mystery"]);
  }
});

test("concurrent rotation results reveal only the version-checked winner", async () => {
  let version = 0;
  const service = hostService({
    user: async () => host,
    code: () => "ABCDEFGH",
    rpc: async (_name, args) => {
      if (args.p_expected_version !== version) return { data: false, error: null };
      version++;
      return { data: true, error: null };
    },
  });
  const results = await Promise.all([service.rotate(id, 0), service.rotate(id, 0)]);
  assert.equal(results.filter((result) => result.kind === "issued").length, 1);
  assert.equal(results.filter((result) => result.kind === "unavailable").length, 1);
});

test("posted party versions parse only as canonical Postgres integers", () => {
  assert.equal(parsePartyVersion("0"), 0);
  assert.equal(parsePartyVersion("42"), 42);
  assert.equal(parsePartyVersion("2147483647"), 2147483647);
  for (const value of [null, undefined, 3, "", " 3", "3 ", "03", "-1", "+1", "1.0", "1e3", "0x10", "2147483648", "99999999999"]) {
    assert.equal(parsePartyVersion(value), null, JSON.stringify(value));
  }
});
