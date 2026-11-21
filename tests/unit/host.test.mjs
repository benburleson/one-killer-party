import assert from "node:assert/strict";
import { test } from "node:test";
import { appOrigin, generateCode, hostService, validEmail, verifiedEmailHost, verifier } from "../../src/lib/host/core.ts";

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

test("codes use an unambiguous alphabet and SHA-256 bytea format", () => {
  for (let i = 0; i < 100; i++) assert.match(generateCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
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
  const record = { party_id: id, status: "LOBBY", version: 0, verifier_hash: "secret", solution: "spoiler", host_principal_id: other };
  const service = hostService({
    user: async () => host,
    rpc: async (name, args) => { calls.push({ name, args }); return { data: [record], error: null }; },
  });
  assert.deepEqual(await service.get(id), { partyId: id, status: "LOBBY", version: 0 });
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
  const service = hostService({
    user: async () => host,
    code: () => codes.shift(),
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (calls.length === 1) return { data: null, error: { code: "23505" } };
      return { data: [{ party_id: id, created: calls.length === 2 }], error: null };
    },
  });
  assert.deepEqual(await service.create(id), { kind: "issued", partyId: id, code: "JKLMNPQR" });
  assert.deepEqual(await service.create(id), { kind: "existing", partyId: id });
  assert.deepEqual(calls[0], { name: "create_host_party", args: { p_host: host, p_party_id: id, p_verifier_hash: verifier("ABCDEFGH") } });
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
  const service = hostService({ user: async () => host, code: () => "ABCDEFGH", rpc: async () => {
    calls++;
    return { data: null, error: { code: "23505", message: "private" } };
  } });
  assert.deepEqual(await service.create(id), { kind: "unavailable" });
  assert.equal(calls, 5);
  assert.deepEqual(await service.rotate("invalid", 0), { kind: "unavailable" });
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
