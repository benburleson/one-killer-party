import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalFor, authenticate, createKeychain, localConfiguration, parseArguments, productionConfiguration, publicationStore, publish, readPackage, verifyIdentity, verifyProductionIdentity } from "../../scripts/mystery-publish.mjs";
import { syntheticMysteryPackage } from "./fixtures/synthetic-mystery-package.mjs";
import { publishMysteryDefinition } from "../../src/lib/mystery-content/publication.ts";
import { sealMysteryDefinition } from "../../src/lib/mystery-content/integrity.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";

const userId = "12345678-1234-4234-8234-123456789abc";
const env = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "local-key",
  MYSTERY_PUBLISHER_EMAIL: "owner@example.invalid", MYSTERY_PUBLISHER_USER_ID: userId };
const token = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const session = (overrides = {}) => ({ access_token: token({ sub: userId, aud: "authenticated",
  role: "mystery_operator", exp: Math.floor(Date.now() / 1000) + 60, ...overrides }) });
const productionEnv = { MYSTERY_PRODUCTION_PROJECT_REF: "exampleproject",
  MYSTERY_PRODUCTION_SUPABASE_URL: "https://exampleproject.supabase.co",
  MYSTERY_PRODUCTION_ANON_KEY: "sb_publishable_fake", MYSTERY_PUBLISHER_EMAIL: env.MYSTERY_PUBLISHER_EMAIL,
  MYSTERY_PUBLISHER_USER_ID: userId };

test("local target and authenticated identity fail closed", () => {
  assert.equal(localConfiguration(env).userId, userId);
  for (const url of ["https://example.invalid", "http://localhost:54321", "http://127.0.0.1:54321/"]) {
    assert.throws(() => localConfiguration({ ...env, SUPABASE_URL: url }), /LOCAL_CONFIGURATION_REQUIRED/);
  }
  assert.equal(verifyIdentity(session(), { id: userId }, userId), true);
  for (const claims of [{ role: "authenticated" }, { sub: "wrong" }, { aud: "anon" }, { exp: 1 }]) {
    assert.equal(verifyIdentity(session(claims), { id: userId }, userId), false);
  }
  assert.equal(verifyIdentity(session(), { id: "other" }, userId), false);
  assert.equal(verifyIdentity({ access_token: "bad" }, { id: userId }, userId), false);
});

test("input must resolve outside repository and validate without disclosure", async () => {
  const path = "/outside/package.json";
  const io = { realpath: async () => path, readFile: async () => JSON.stringify(syntheticMysteryPackage()) };
  assert.equal((await readPackage(path, io)).ref.schemaVersion, 1);
  await assert.rejects(readPackage("~/package.json"), /EXPAND_TILDE_IN_SHELL/);
  await assert.rejects(readPackage(path, { ...io, realpath: async () => new URL("../../package.json", import.meta.url).pathname }),
    /INPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  await assert.rejects(readPackage(path, { ...io, readFile: async () => '{"private":"SENTINEL"}' }), /INVALID_PACKAGE/);
});

test("cancel, EOF and authentication failure never write", async () => {
  const definition = syntheticMysteryPackage();
  let writes = 0;
  let text = "";
  const output = { isTTY: true, write: (s) => { text += s; } };
  const client = {
    auth: {
      signInWithPassword: async () => ({ data: { session: session() }, error: null }),
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    storage: { from: () => { writes++; } },
  };
  const options = { argv: ["/outside/package.json"], env, input: { isTTY: true }, output,
    loadPackage: async () => ({ input: definition, ref: sealMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES).ref }),
    makeClient: () => client, readPassword: async () => "password", confirm: async () => false };
  await assert.rejects(publish(options), /CANCELLED/);
  await assert.rejects(publish({ ...options, readPassword: async () => null }), /CANCELLED/);
  client.auth.getUser = async () => ({ data: { user: { id: "wrong" } }, error: null });
  await assert.rejects(publish(options), /PUBLISHER_IDENTITY_MISMATCH/);
  client.auth.getUser = async () => ({ data: { user: { id: userId } }, error: null });
  client.auth.signInWithPassword = async () => ({ error: { message: "private secret" } });
  await assert.rejects(publish(options), /AUTHENTICATION_FAILED/);
  assert.equal(writes, 0);
  assert.doesNotMatch(text, /SENTINEL|password|private secret/);
});

test("target selection is explicit and production configuration is required", async () => {
  assert.deepEqual(parseArguments(["--target", "local", "/outside/package.json"]),
    { target: "local", credential: "prompt", mfa: false, filename: "/outside/package.json" });
  assert.equal(parseArguments(["--enroll-keychain"]).mfa, true);
  assert.equal(parseArguments(["--keychain", "/outside/package.json"]).mfa, true);
  for (const args of [["--target", "invalid", "x"], ["--target", "local", "--target", "local", "x"],
    ["--keychain", "--enroll-keychain"], ["--enroll-keychain", "x"], ["--password", "secret"]]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(parseArguments(["--target", "production", "/outside/package.json"]).target, "production");
  await assert.rejects(publish({ argv: ["--target", "production", "/outside/package.json"],
    env, loadPackage: () => assert.fail("production package read") }), /INPUT_INVALID|production package read/);
  await assert.rejects(publish({ argv: ["--target", "production", "--enroll-keychain"], env }),
    /PRODUCTION_CONFIGURATION_REQUIRED/);
});

test("production configuration is target-bound and accepts only public API keys", () => {
  const config = productionConfiguration(productionEnv);
  assert.equal(config.issuer, "https://exampleproject.supabase.co/auth/v1");
  assert.equal(config.projectRef, "exampleproject");
  const legacy = token({ role: "anon", iss: "supabase", ref: "exampleproject" });
  assert.equal(productionConfiguration({ ...productionEnv, MYSTERY_PRODUCTION_ANON_KEY: legacy }).key, legacy);
  for (const change of [
    { MYSTERY_PRODUCTION_SUPABASE_URL: "http://exampleproject.supabase.co" },
    { MYSTERY_PRODUCTION_SUPABASE_URL: "https://exampleproject.supabase.co/" },
    { MYSTERY_PRODUCTION_SUPABASE_URL: "https://other.supabase.co" },
    { MYSTERY_PRODUCTION_PROJECT_REF: "exampleproject;other" },
    { MYSTERY_PRODUCTION_ANON_KEY: "sb_secret_fake" },
    { MYSTERY_PRODUCTION_ANON_KEY: token({ role: "service_role", iss: "supabase", ref: "exampleproject" }) },
    { MYSTERY_PRODUCTION_ANON_KEY: token({ role: "anon", iss: "supabase", ref: "other" }) },
    { MYSTERY_PUBLISHER_USER_ID: "not-a-uuid" },
  ]) assert.throws(() => productionConfiguration({ ...productionEnv, ...change }), /PRODUCTION_CONFIGURATION_REQUIRED/);
});

test("production identity binds verified user, issuer, role, audience, freshness and MFA", () => {
  const config = productionConfiguration(productionEnv);
  const now = Math.floor(Date.now() / 1000);
  const valid = { iss: config.issuer, aal: "aal2", iat: now,
    amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now }] };
  assert.equal(verifyProductionIdentity(session(valid), { id: userId }, config), true);
  for (const change of [{ iss: "https://other.supabase.co/auth/v1" }, { aal: "aal1" },
    { role: "authenticated" }, { aud: "anon" }, { sub: "wrong" }, { exp: now - 1 },
    { iat: now - 301 }, { iat: now + 60 }, { amr: [{ method: "totp", timestamp: now }] },
    { amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now - 301 }] }]) {
    assert.equal(verifyProductionIdentity(session({ ...valid, ...change }), { id: userId }, config), false);
  }
  assert.equal(verifyProductionIdentity(session(valid), { id: "other" }, config), false);
  assert.equal(verifyProductionIdentity(session(valid), { id: userId }, { ...config, projectRef: "other" }), false);
});

test("production authentication requires MFA and rejects identity mismatches", async () => {
  const config = productionConfiguration(productionEnv);
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: config.issuer, aal: "aal2", iat: now,
    amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now }] };
  let tokenAfterMfa = session(claims);
  let verifiedId = userId;
  const client = { auth: {
    signInWithPassword: async () => ({ data: { session: session() } }),
    getUser: async () => ({ data: { user: { id: verifiedId } } }),
    mfa: {
      listFactors: async () => ({ data: { totp: [{ id: "factor", status: "verified" }] } }),
      challengeAndVerify: async () => ({ data: tokenAfterMfa }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
    },
  } };
  const run = () => authenticate(client, config, "fake-password", false, {}, {}, async () => "123456");
  await run();
  verifiedId = "other";
  await assert.rejects(run(), /PUBLISHER_IDENTITY_MISMATCH/);
  verifiedId = userId;
  tokenAfterMfa = session({ ...claims, iss: "https://other.supabase.co/auth/v1" });
  await assert.rejects(run(), /PUBLISHER_IDENTITY_MISMATCH/);
});

test("production publication uses project-scoped credentials and revalidates before registration", async () => {
  const definition = syntheticMysteryPackage();
  const packageData = { input: definition, ref: sealMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES).ref };
  const config = productionConfiguration(productionEnv);
  const now = Math.floor(Date.now() / 1000);
  const productionSession = session({ iss: config.issuer, aal: "aal2", iat: now,
    amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now }] });
  const events = [];
  let bytes;
  const client = {
    auth: {
      signInWithPassword: async () => ({ data: { session: session() } }),
      getUser: async () => ({ data: { user: { id: userId } } }),
      signOut: async () => {},
      mfa: {
        listFactors: async () => ({ data: { totp: [{ id: "factor", status: "verified" }] } }),
        challengeAndVerify: async () => ({ data: productionSession }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
      },
    },
    storage: { from: () => ({
      upload: async (_path, value) => { events.push("upload"); bytes = value; return { error: null }; },
      download: async () => ({ data: new Blob([bytes]), error: null }),
    }) },
    rpc: async (_name, args) => { events.push(["register", args.p_approval_reference]); return { data: "published" }; },
  };
  await publish({
    argv: ["--target", "production", "/outside/package.json"], env: productionEnv,
    input: { isTTY: true }, output: { isTTY: true, write: () => {} },
    loadPackage: async () => packageData, makeClient: () => client,
    readPassword: async (_input, _output, label) => label === "Authenticator code" ? "123456" : "password",
    confirm: async () => true,
    credentialStore: { read: async (id, context) => {
      assert.equal(id, userId); assert.equal(context.projectRef, "exampleproject"); return "password";
    } },
  });
  assert.equal(events[0], "upload");
  assert.equal(events[1][0], "register");
  assert.match(events[1][1], /^local-attempt:[0-9a-f-]{36}$/);
});

test("keychain enrollment uses stdin only, refuses unsafe passwords, and verifies readback", async () => {
  const calls = [];
  const store = createKeychain({ platform: "darwin", run: async (args, stdin, capture) => {
    calls.push({ args, stdin, capture });
    return capture ? "fake-password_123\n" : "";
  } });
  await store.enroll(userId, "fake-password_123");
  assert.deepEqual(calls[0].args, ["-i"]);
  assert.match(calls[0].stdin, /fake-password_123/);
  assert.equal(calls[1].capture, true);
  assert.ok(calls.every(({ args }) => !args.join(" ").includes("fake-password_123")));
  await store.read(userId, { target: "production", projectRef: "exampleproject" });
  assert.ok(calls[2].args.includes("one-killer-party.mystery-publisher.production.exampleproject"));
  await assert.rejects(store.read(userId, { target: "production", projectRef: "bad;ref" }), /KEYCHAIN_FAILED/);
  await assert.rejects(store.enroll(userId, "invalid password\n"), /KEYCHAIN_PASSWORD_FORMAT/);
  await assert.rejects(createKeychain({ platform: "linux" }).read(userId), /KEYCHAIN_MACOS_REQUIRED/);
  const mismatch = createKeychain({ platform: "darwin", run: async () => "different\n" });
  await assert.rejects(mismatch.enroll(userId, "fake-password_123"), /KEYCHAIN_FAILED/);
});

test("MFA requires fresh password login, one verified TOTP, AAL2 and verified identity", async () => {
  const events = [];
  const freshSession = session();
  const client = { auth: {
    signInWithPassword: async () => { events.push("login"); return { data: { session: freshSession } }; },
    getUser: async (accessToken) => { events.push("identity"); assert.equal(accessToken, freshSession.access_token);
      return { data: { user: { id: userId } } }; },
    mfa: {
      listFactors: async () => { events.push("factors"); return { data: { totp: [{ id: "factor", status: "verified" }] } }; },
      challengeAndVerify: async ({ factorId, code }) => { events.push("challenge"); assert.equal(factorId, "factor");
        assert.equal(code, "123456"); return { data: freshSession }; },
      getAuthenticatorAssuranceLevel: async () => { events.push("assurance"); return { data: { currentLevel: "aal2" } }; },
    },
  } };
  const run = () => authenticate(client, localConfiguration(env), "fake-password", true, {}, {}, async () => "123456");
  await run();
  assert.deepEqual(events, ["login", "factors", "challenge", "assurance", "identity"]);
  client.auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: { currentLevel: "aal1" } });
  await assert.rejects(run(), /MFA_FAILED/);
  client.auth.mfa.listFactors = async () => ({ data: { totp: [{ id: "factor", status: "unverified" }] } });
  await assert.rejects(run(), /MFA_FACTOR_REQUIRED/);
  client.auth.mfa.listFactors = async () => ({ data: { totp: [] } });
  await assert.rejects(run(), /MFA_FACTOR_REQUIRED/);
});

test("enrollment requires MFA and identity before saving and never prints credentials", async () => {
  let saved = 0;
  let text = "";
  const client = { auth: {
    signInWithPassword: async () => ({ data: { session: session() } }),
    getUser: async () => ({ data: { user: { id: userId } } }),
    signOut: async () => {},
    mfa: {
      listFactors: async () => ({ data: { totp: [{ id: "factor", status: "verified" }] } }),
      challengeAndVerify: async () => ({ data: session() }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
    },
  } };
  const options = { argv: ["--enroll-keychain"], env, platform: "darwin", input: { isTTY: true },
    output: { isTTY: true, write: (s) => { text += s; } }, makeClient: () => client,
    readPassword: async (_input, _output, label) => label ? "987654" : "fake-password",
    credentialStore: { enroll: async (id, password) => { assert.equal(id, userId); assert.equal(password, "fake-password"); saved++; } } };
  client.auth.mfa.challengeAndVerify = async () => ({ error: { message: "secret" } });
  await assert.rejects(publish(options), /MFA_FAILED/);
  assert.equal(saved, 0);
  client.auth.mfa.challengeAndVerify = async () => ({ data: session() });
  await publish(options);
  assert.equal(saved, 1);
  assert.doesNotMatch(text, /fake-password|987654|secret/);
});

function productionEnrollment() {
  const config = productionConfiguration(productionEnv);
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: config.issuer, aal: "aal2", iat: now,
    amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now }] };
  const events = [];
  let text = "";
  const client = { auth: {
    signInWithPassword: async ({ email, password }) => {
      events.push("login");
      assert.equal(email, config.email);
      assert.equal(password, "fake-password_123");
      return { data: { session: session({ aal: "aal1" }) } };
    },
    getUser: async () => { events.push("identity"); return { data: { user: { id: userId } } }; },
    signOut: async () => { events.push("signout"); },
    mfa: {
      listFactors: async () => ({ data: { totp: [{ id: "factor", status: "verified" }] } }),
      challengeAndVerify: async ({ code }) => {
        events.push("mfa");
        assert.equal(code, "654321");
        return { data: session(claims) };
      },
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
    },
  },
  storage: { from: () => assert.fail("enrollment must not access Storage") },
  rpc: () => assert.fail("enrollment must not register") };
  const options = {
    argv: ["--target", "production", "--enroll-keychain"], env: { ...productionEnv },
    platform: "darwin", input: { isTTY: true },
    output: { isTTY: true, write: (s) => { text += s; } },
    makeClient: (url, key) => {
      events.push("client");
      assert.equal(url, config.url);
      assert.equal(key, config.key);
      return client;
    },
    readPassword: async (_input, _output, label) => {
      assert.match(text, /https:\/\/exampleproject\.supabase\.co/);
      assert.match(text, new RegExp(userId));
      events.push(label ? "code" : "password");
      return label ? "654321" : "fake-password_123";
    },
    loadPackage: () => assert.fail("enrollment must not load a package"),
    confirm: () => assert.fail("enrollment must not request publication approval"),
    credentialStore: { enroll: async (id, password, context) => {
      assert.equal(id, userId);
      assert.equal(password, "fake-password_123");
      assert.deepEqual(context, config);
      events.push("saved");
    } },
  };
  return { options, client, claims, events, text: () => text };
}

test("Production enrollment displays destination, verifies MFA identity, and only then saves", async () => {
  const fixture = productionEnrollment();
  const keychainCalls = [];
  const keychain = createKeychain({ platform: "darwin", run: async (args, stdin, capture) => {
    keychainCalls.push({ args, stdin, capture });
    return capture ? "fake-password_123\n" : "";
  } });
  const save = fixture.options.credentialStore.enroll;
  fixture.options.credentialStore.enroll = async (...args) => {
    await keychain.enroll(...args);
    await save(...args);
  };
  await publish(fixture.options);
  assert.deepEqual(fixture.events, ["client", "password", "login", "code", "mfa", "identity", "saved", "signout"]);
  assert.match(fixture.text(), /one-killer-party\.mystery-publisher\.production\.exampleproject/);
  assert.match(fixture.text(), /owner@example\.invalid/);
  assert.match(fixture.text(), /Production publisher credential enrolled/);
  assert.doesNotMatch(fixture.text(), /fake-password_123|654321|access_token/);
  assert.deepEqual(keychainCalls[0].args, ["-i"]);
  assert.match(keychainCalls[0].stdin, /one-killer-party\.mystery-publisher\.production\.exampleproject/);
  assert.match(keychainCalls[0].stdin, /fake-password_123/);
  assert.ok(keychainCalls.every(({ args }) => !args.join(" ").includes("fake-password_123")));
});

test("Production enrollment refuses authentication, MFA, identity and project failures without saving", async () => {
  const cases = [
    [({ client }) => { client.auth.signInWithPassword = async () => ({ error: { message: "secret-provider-error" } }); },
      "AUTHENTICATION_FAILED"],
    [({ client }) => { client.auth.mfa.challengeAndVerify = async () => ({ error: { message: "secret-provider-error" } }); },
      "MFA_FAILED"],
    [({ client }) => { client.auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: { currentLevel: "aal1" } }); },
      "MFA_FAILED"],
    [({ client }) => { client.auth.getUser = async () => ({ data: { user: { id: "wrong" } } }); },
      "PUBLISHER_IDENTITY_MISMATCH"],
    [({ client, claims }) => { client.auth.mfa.challengeAndVerify = async () =>
      ({ data: session({ ...claims, iss: "https://other.supabase.co/auth/v1" }) }); },
    "PUBLISHER_IDENTITY_MISMATCH"],
    [({ client, claims }) => { client.auth.mfa.challengeAndVerify = async () =>
      ({ data: session({ ...claims, role: "authenticated" }) }); }, "PUBLISHER_IDENTITY_MISMATCH"],
    [({ client, claims }) => { client.auth.mfa.challengeAndVerify = async () =>
      ({ data: session({ ...claims, aud: "anon" }) }); }, "PUBLISHER_IDENTITY_MISMATCH"],
    [({ client, claims }) => { client.auth.mfa.challengeAndVerify = async () =>
      ({ data: session({ ...claims, iat: 1 }) }); }, "PUBLISHER_IDENTITY_MISMATCH"],
  ];
  for (const [change, code] of cases) {
    const fixture = productionEnrollment();
    change(fixture);
    await assert.rejects(publish(fixture.options), { message: code });
    assert.ok(!fixture.events.includes("saved"));
    assert.doesNotMatch(fixture.text(), /secret-provider-error|fake-password_123|654321/);
  }
});

test("Production enrollment rejects cancellation, EOF, unsupported platform and non-TTY before storing", async () => {
  for (const change of [
    (options) => { options.readPassword = async () => null; },
    (options) => { options.readPassword = async (_input, _output, label) => label ? null : "fake-password_123"; },
    (options) => { options.readPassword = async () => ""; },
  ]) {
    const fixture = productionEnrollment();
    change(fixture.options);
    await assert.rejects(publish(fixture.options), /CANCELLED/);
    assert.ok(!fixture.events.includes("saved"));
  }
  for (const [change, code] of [
    [(options) => { options.platform = "linux"; }, "KEYCHAIN_MACOS_REQUIRED"],
    [(options) => { options.input.isTTY = false; }, "INTERACTIVE_TERMINAL_REQUIRED"],
    [(options) => { options.output.isTTY = false; }, "INTERACTIVE_TERMINAL_REQUIRED"],
    [(options) => { options.env.MYSTERY_PRODUCTION_SUPABASE_URL = "https://other.supabase.co"; }, "PRODUCTION_CONFIGURATION_REQUIRED"],
  ]) {
    const fixture = productionEnrollment();
    change(fixture.options);
    await assert.rejects(publish(fixture.options), { message: code });
    assert.deepEqual(fixture.events, []);
  }
});

test("Production Keychain errors are redacted and the Auth session is cleaned up", async () => {
  const fixture = productionEnrollment();
  fixture.options.credentialStore.enroll = async () => { throw new Error("fake-password_123 secret-keychain-error"); };
  await assert.rejects(publish(fixture.options), { message: "KEYCHAIN_FAILED" });
  assert.equal(fixture.events.at(-1), "signout");
  assert.doesNotMatch(fixture.text(), /fake-password_123|secret-keychain-error|credential enrolled/);
});

test("Keychain publication authenticates freshly before confirmation and writes nothing on cancellation", async () => {
  const definition = syntheticMysteryPackage();
  const events = [];
  let text = "";
  const client = { auth: {
    signInWithPassword: async ({ password }) => { events.push("login"); assert.equal(password, "fake-password");
      return { data: { session: session() } }; },
    getUser: async () => { events.push("identity"); return { data: { user: { id: userId } } }; },
    signOut: async () => { events.push("signout"); },
    mfa: {
      listFactors: async () => ({ data: { totp: [{ id: "factor", status: "verified" }] } }),
      challengeAndVerify: async () => { events.push("mfa"); return { data: session() }; },
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
    },
  }, storage: { from: () => assert.fail("unexpected write") } };
  await assert.rejects(publish({
    argv: ["--keychain", "/outside/package.json"], env, input: { isTTY: true },
    output: { isTTY: true, write: (value) => { text += value; } },
    loadPackage: async () => ({ input: definition, ref: sealMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES).ref }),
    makeClient: () => client,
    credentialStore: { read: async (id, context) => { events.push("read"); assert.equal(id, userId);
      assert.equal(context.target, "local"); return "fake-password"; } },
    readPassword: async () => "987654",
    confirm: async () => { events.push("confirm"); return false; },
  }), /CANCELLED/);
  assert.deepEqual(events, ["read", "login", "mfa", "identity", "confirm", "signout"]);
  assert.doesNotMatch(text, /fake-password|987654/);
});

test("approval is bound to the displayed digest, version and expiry", async () => {
  const definition = syntheticMysteryPackage();
  const ref = (await import("../../src/lib/mystery-content/integrity.ts")).sealMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES).ref;
  const approval = approvalFor(ref, userId);
  const neverWrite = { upload: async () => assert.fail("unexpected write") };
  const changed = { ...definition, version: "different-v1" };
  assert.deepEqual(await publishMysteryDefinition(changed, EIGHT_ROLE_PROTOTYPE_RULES, approval, neverWrite),
    { ok: false, code: "INVALID_APPROVAL" });
  assert.deepEqual(await publishMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES,
    approvalFor(ref, userId, Date.now() - 6 * 60 * 1000), neverWrite),
  { ok: false, code: "INVALID_APPROVAL" });
});

test("registration diagnostics expose only allowlisted codes", async () => {
  const diagnostics = {};
  const client = { rpc: async () => ({ error: { code: "23505", message: "SENTINEL" } }) };
  const store = publicationStore(client, diagnostics);
  await assert.rejects(store.register({}, "path", "rules", {}), /REGISTRATION_FAILED/);
  assert.deepEqual(diagnostics, { phase: "registration", rpcCode: "23505" });
  client.rpc = async () => ({ error: { code: "SENTINEL", message: "SENTINEL" } });
  await assert.rejects(store.register({}, "path", "rules", {}), /REGISTRATION_FAILED/);
  assert.deepEqual(diagnostics, { phase: "registration", rpcCode: "OTHER" });
});
