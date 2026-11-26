import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { isatty } from "node:tty";
import { fileURLToPath } from "node:url";
import { sealMysteryDefinition } from "../src/lib/mystery-content/integrity.ts";
import { publishMysteryDefinition } from "../src/lib/mystery-content/publication.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../src/lib/mystery-content/validate.ts";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const rules = EIGHT_ROLE_PROTOTYPE_RULES;
const bucket = "private-mystery-packages";
const localUrl = "http://127.0.0.1:54321";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keychainService = "one-killer-party.mystery-publisher";
const projectRefPattern = /^[a-z0-9]{1,63}$/;
const encodedPasswordPrefix = "okp1.";

function validKeychainPassword(password) {
  return typeof password === "string" && password.length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(password) &&
    Buffer.byteLength(password, "utf8") <= 1024 &&
    Buffer.from(password, "utf8").toString("utf8") === password;
}

export function parseArguments(argv) {
  let target = "local";
  let credential = "prompt";
  let mfa = false;
  let enrollMfa = false;
  let filename;
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") {
      if (seen.has(arg) || !["local", "production"].includes(argv[i + 1])) throw new Error("INVALID_ARGUMENTS");
      seen.add(arg);
      target = argv[++i];
    } else if (arg === "--keychain" || arg === "--enroll-keychain") {
      if (credential !== "prompt") throw new Error("INVALID_ARGUMENTS");
      credential = arg === "--keychain" ? "keychain" : "enroll";
    } else if (arg === "--mfa") {
      if (mfa) throw new Error("INVALID_ARGUMENTS");
      mfa = true;
    } else if (arg === "--enroll-mfa") {
      if (enrollMfa) throw new Error("INVALID_ARGUMENTS");
      enrollMfa = true;
    } else if (arg.startsWith("-") || filename) {
      throw new Error("INVALID_ARGUMENTS");
    } else {
      filename = arg;
    }
  }
  if (enrollMfa) {
    if (target !== "production" || credential !== "prompt" || mfa || filename) throw new Error("INVALID_ARGUMENTS");
    return { target, credential, mfa: false, filename, enrollMfa: true };
  }
  if ((credential === "enroll") === Boolean(filename)) throw new Error("ABSOLUTE_INPUT_REQUIRED");
  return { target, credential, mfa: mfa || credential !== "prompt", filename };
}

function runSecurity(args, stdin = "", capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", capture ? "pipe" : "ignore", "pipe"] });
    let result = "";
    let tooLarge = false;
    let failed = false;
    child.stderr.on("data", () => { failed = true; });
    child.stdout?.on("data", (chunk) => {
      if (result.length + chunk.length > 16384) {
        tooLarge = true;
      } else {
        result += chunk.toString("utf8");
      }
    });
    child.stdin.on("error", () => { failed = true; });
    child.on("error", () => reject(new Error("KEYCHAIN_FAILED")));
    child.on("close", (code) => {
      if (code !== 0 || tooLarge || failed) return reject(new Error("KEYCHAIN_FAILED"));
      resolve(result);
    });
    child.stdin.end(stdin);
  });
}

export function createKeychain({ platform = process.platform, run = runSecurity } = {}) {
  const serviceFor = (context) => {
    if (!context || context.target === "local") return `${keychainService}.local`;
    if (context.target === "production" && projectRefPattern.test(context.projectRef)) {
      return `${keychainService}.production.${context.projectRef}`;
    }
    throw new Error("KEYCHAIN_FAILED");
  };
  return {
  async read(userId, context) {
    if (platform !== "darwin") throw new Error("KEYCHAIN_MACOS_REQUIRED");
    if (!uuid.test(userId)) throw new Error("KEYCHAIN_FAILED");
    const value = await run(["find-generic-password", "-s", serviceFor(context), "-a", userId, "-w"], "", true);
    if (!value.endsWith("\n")) throw new Error("KEYCHAIN_FAILED");
    const stored = value.slice(0, -1);
    let password;
    if (stored.startsWith(encodedPasswordPrefix)) {
      const encoded = stored.slice(encodedPasswordPrefix.length);
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("KEYCHAIN_FAILED");
      const bytes = Buffer.from(encoded, "base64url");
      password = bytes.toString("utf8");
      if (bytes.toString("base64url") !== encoded || !bytes.equals(Buffer.from(password, "utf8"))) {
        throw new Error("KEYCHAIN_FAILED");
      }
    } else {
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(stored)) throw new Error("KEYCHAIN_FAILED");
      password = stored;
    }
    if (!validKeychainPassword(password)) throw new Error("KEYCHAIN_FAILED");
    return password;
  },
  async enroll(userId, password, context) {
    if (platform !== "darwin") throw new Error("KEYCHAIN_MACOS_REQUIRED");
    if (!uuid.test(userId)) throw new Error("KEYCHAIN_FAILED");
    if (!validKeychainPassword(password)) throw new Error("KEYCHAIN_PASSWORD_FORMAT");
    const encoded = encodedPasswordPrefix + Buffer.from(password, "utf8").toString("base64url");
    await run(["-i"], `add-generic-password -s ${serviceFor(context)} -a ${userId} -w ${encoded}\n`);
    if (await this.read(userId, context) !== password) throw new Error("KEYCHAIN_FAILED");
  },
  };
}
const keychain = createKeychain();

export async function readPackage(filename, io = { realpath, readFile }) {
  if (typeof filename !== "string" || !isAbsolute(filename)) {
    throw new Error(filename?.startsWith("~") ? "EXPAND_TILDE_IN_SHELL" : "ABSOLUTE_INPUT_REQUIRED");
  }
  let actual;
  try {
    actual = await io.realpath(filename);
  } catch {
    throw new Error("INPUT_INVALID");
  }
  const fromRoot = relative(root, actual);
  if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))) {
    throw new Error("INPUT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  let input;
  try {
    input = JSON.parse(await io.readFile(actual, "utf8"));
  } catch {
    throw new Error("INPUT_INVALID");
  }
  const sealed = sealMysteryDefinition(input, rules);
  if (!sealed.ok) throw new Error("INVALID_PACKAGE");
  return { input, ref: sealed.ref };
}

export function localConfiguration(env) {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, MYSTERY_PUBLISHER_EMAIL: email,
    MYSTERY_PUBLISHER_USER_ID: userId } = env;
  if (url !== localUrl || !key || /[\r\n]/.test(key) || !email || /[\r\n]/.test(email) ||
      !userId || !uuid.test(userId)) throw new Error("LOCAL_CONFIGURATION_REQUIRED");
  return { target: "local", projectRef: "local", url, key, email, userId: userId.toLowerCase(),
    issuer: `${url}/auth/v1` };
}

function jwtClaims(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every(Boolean)) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function productionConfiguration(env) {
  const { MYSTERY_PRODUCTION_PROJECT_REF: projectRef, MYSTERY_PRODUCTION_SUPABASE_URL: url,
    MYSTERY_PRODUCTION_ANON_KEY: key, MYSTERY_PUBLISHER_EMAIL: email,
    MYSTERY_PUBLISHER_USER_ID: userId } = env;
  const claims = typeof key === "string" ? jwtClaims(key) : null;
  const publicKey = typeof key === "string" && (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) ||
    (claims?.role === "anon" && claims.ref === projectRef && claims.iss === "supabase"));
  if (!projectRef || !projectRefPattern.test(projectRef) ||
      url !== `https://${projectRef}.supabase.co` || !publicKey || !email ||
      /[\r\n]/.test(email) || !userId || !uuid.test(userId)) {
    throw new Error("PRODUCTION_CONFIGURATION_REQUIRED");
  }
  return { target: "production", projectRef, url, key, email, userId: userId.toLowerCase(),
    issuer: `${url}/auth/v1` };
}

export function verifyIdentity(session, user, expectedId) {
  try {
    const claims = jwtClaims(session.access_token);
    return user?.id?.toLowerCase() === expectedId && claims.sub?.toLowerCase() === expectedId &&
      claims.role === "mystery_operator" && claims.aud === "authenticated" &&
      Number.isFinite(claims.exp) && claims.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function verifyProductionIdentity(session, user, config, now = Date.now(), requireOperator = true) {
  const claims = jwtClaims(session?.access_token);
  const seconds = now / 1000;
  const recent = (timestamp) => Number.isFinite(timestamp) && timestamp <= seconds &&
    timestamp >= seconds - 300;
  const projectClaim = claims?.project_id ?? claims?.ref;
  return config?.target === "production" && projectRefPattern.test(config.projectRef || "") &&
    config.url === `https://${config.projectRef}.supabase.co` &&
    config.issuer === `${config.url}/auth/v1` &&
    (requireOperator ? verifyIdentity(session, user, config.userId) :
      user?.id?.toLowerCase() === config.userId && claims?.sub?.toLowerCase() === config.userId &&
      claims?.role === "authenticated" && claims?.aud === "authenticated" &&
      Number.isFinite(claims?.exp) && claims.exp > seconds) &&
    claims?.iss === config.issuer && (!projectClaim || projectClaim === config.projectRef) &&
    claims.aal === "aal2" && recent(claims.iat) &&
    Array.isArray(claims.amr) && ["password", "totp"].every((method) =>
      claims.amr.some((entry) => entry?.method === method && recent(entry.timestamp)));
}

export function approvalFor(ref, userId, options = {}) {
  const now = typeof options === "number" ? options : (options.now ?? Date.now());
  const target = options.target ?? "local";
  const projectRef = options.projectRef ?? "local";
  const attemptId = options.attemptId ?? randomUUID();
  const binding = Object.freeze({ target, projectRef, ...ref, ruleSetId: rules.id });
  const approval = Object.freeze({
    binding,
    provenance: `owner:${target}`,
    approvedBy: userId,
    approvalReference: `local-attempt:${attemptId}`,
    approvedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
  });
  return {
    target,
    projectRef,
    artifact: approval,
    async verify(artifact, requested) {
      return artifact === approval && Object.keys(binding).every((key) => binding[key] === requested[key])
        ? approval : null;
    },
  };
}

export function passwordPrompt(input, output, label = "Publisher password",
  { timeoutMs = 0, maxLength = Infinity, rejectInvalid = false } = {}) {
  return new Promise((resolve, reject) => {
    let password = "";
    const decoder = new StringDecoder("utf8");
    let invalid = false;
    let expired = false;
    let timer;
    input.setRawMode(true);
    output.write(`${label} (not echoed): `);
    input.resume();
    const finish = (value, formatError = false) => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      clearTimeout(timer);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (formatError) reject(new Error("KEYCHAIN_PASSWORD_FORMAT"));
      else resolve(value);
    };
    const onEnd = () => finish(null);
    const onData = (chunk) => {
      for (const char of decoder.write(chunk)) {
        if (char === "\u0003" || char === "\u0004") return finish(null);
        if (char === "\r" || char === "\n") {
          return finish(invalid || expired ? null : password, rejectInvalid && invalid && !expired);
        }
        if (char === "\u007f" || char === "\b") password = Array.from(password).slice(0, -1).join("");
        else if (char >= " " && password.length + char.length <= maxLength) password += char;
        else if (maxLength !== Infinity || rejectInvalid) invalid = true;
      }
    };
    input.on("data", onData);
    input.once("end", onEnd);
    if (timeoutMs) timer = setTimeout(() => {
      expired = true;
      password = "";
      output.write("\nCAPTCHA prompt timed out. Input remains hidden; press Enter or Ctrl-C to cancel, then obtain a fresh token and retry: ");
    }, timeoutMs);
  });
}

async function passwordSignIn(client, config, password, input, output, readPassword) {
  let options;
  if (config.target === "production") {
    output.write("Obtain a fresh publisher CAPTCHA token from https://app.onekillerparty.com/publisher-verification; paste promptly. On failure, obtain a new token.\n");
    const captchaToken = await readPassword(input, output, "CAPTCHA token", { timeoutMs: 120000, maxLength: 8192 });
    if (!captchaToken) throw new Error("CANCELLED");
    if (typeof captchaToken !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(captchaToken)) {
      throw new Error("CAPTCHA_INVALID");
    }
    options = { captchaToken };
  }
  let response;
  try {
    response = await client.auth.signInWithPassword({ email: config.email, password, ...(options ? { options } : {}) });
  } catch {
    throw new Error("AUTHENTICATION_FAILED");
  }
  const { data, error } = response;
  if (error || !data?.session) throw new Error("AUTHENTICATION_FAILED");
  return data.session;
}

async function authCall(code, call) {
  try {
    return await call();
  } catch {
    throw new Error(code);
  }
}

export async function authenticate(client, config, password, requireMfa, input, output, readPassword) {
  const signedIn = await passwordSignIn(client, config, password, input, output, readPassword);
  let session = signedIn;
  if (requireMfa || config.target === "production") {
    const factors = await authCall("MFA_FACTOR_REQUIRED", () => client.auth.mfa.listFactors());
    if (factors.error || factors.data?.totp?.length !== 1 ||
        factors.data.totp[0].status !== "verified") throw new Error("MFA_FACTOR_REQUIRED");
    const code = await readPassword(input, output, "Authenticator code");
    if (!code) throw new Error("CANCELLED");
    if (!/^\d{6}$/.test(code)) throw new Error("MFA_FAILED");
    const verified = await authCall("MFA_FAILED", () => client.auth.mfa.challengeAndVerify({ factorId: factors.data.totp[0].id, code }));
    if (verified.error || !verified.data?.access_token) throw new Error("MFA_FAILED");
    session = verified.data;
    const assurance = await authCall("MFA_FAILED", () => client.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token));
    if (assurance.error || assurance.data?.currentLevel !== "aal2") throw new Error("MFA_FAILED");
  }
  const verified = await authCall("PUBLISHER_IDENTITY_MISMATCH", () => client.auth.getUser(session.access_token));
  const identityValid = config.target === "production" ?
    verifyProductionIdentity(session, verified.data?.user, config) :
    verifyIdentity(session, verified.data?.user, config.userId);
  if (verified.error || !identityValid) {
    throw new Error("PUBLISHER_IDENTITY_MISMATCH");
  }
  return session;
}

function totpTerminalWidth(input, output) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  }
  if (!Number.isInteger(output.columns) || output.columns < 40 ||
      !Number.isInteger(output.rows) || output.rows < 2 + Math.ceil(128 / (output.columns - 1))) {
    throw new Error("TERMINAL_TOO_SMALL");
  }
  return output.columns - 1;
}

export async function checkTotpTerminal(input, output, openTerminal = open, terminalIsTTY = isatty) {
  totpTerminalWidth(input, output);
  let terminal;
  try {
    terminal = await openTerminal("/dev/tty", "w");
    if (!terminalIsTTY(terminal.fd)) throw new Error("NOT_A_TTY");
  } catch {
    throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  } finally {
    if (terminal) {
      try { await terminal.close(); } catch { /* Never expose terminal errors. */ }
    }
  }
}

export async function showTotpSecret(input, output, secret, openTerminal = open, terminalIsTTY = isatty) {
  const width = totpTerminalWidth(input, output);
  const lines = [];
  for (let offset = 0; offset < secret.length; offset += width) lines.push(secret.slice(offset, offset + width));
  const display = `Setup key:\r\n${lines.join("\r\n")}`;
  output.write("Enter the setup key in your authenticator. Disable terminal recording and protect against observers; the key will be cleared on Enter.\n");
  let terminal;
  try {
    terminal = await openTerminal("/dev/tty", "w");
    if (!terminalIsTTY(terminal.fd)) throw new Error("NOT_A_TTY");
  } catch {
    if (terminal) {
      try { await terminal.close(); } catch { /* Never expose terminal errors. */ }
    }
    throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  }
  try {
    await terminal.write("\x1b[?1049h\x1b[2J\x1b[H");
    await terminal.write(display);
    let onData;
    let onEnd;
    try {
      return await new Promise((resolve) => {
        input.setRawMode(true);
        onEnd = () => resolve(false);
        onData = (chunk) => {
          for (const char of chunk.toString("utf8")) {
            if (char === "\u0003" || char === "\u0004") return resolve(false);
            if (char === "\r" || char === "\n") return resolve(true);
          }
        };
        input.on("data", onData);
        input.once("end", onEnd);
        input.resume();
      });
    } finally {
      if (onData) input.removeListener("data", onData);
      if (onEnd) input.removeListener("end", onEnd);
      try {
        input.setRawMode(false);
        input.pause();
      } catch {
        // The terminal may already have disconnected.
      }
    }
  } catch {
    throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  } finally {
    try { await terminal.write("\x1b[2J\x1b[H\x1b[?1049l"); } catch { /* Best effort on terminal failure. */ }
    try { await terminal.close(); } catch { /* Never expose terminal errors. */ }
  }
}

async function enrollTotp(client, config, password, input, output, readPassword, showSecret, checkTerminal) {
  const session = await passwordSignIn(client, config, password, input, output, readPassword);
  const initial = await authCall("PUBLISHER_IDENTITY_MISMATCH", () => client.auth.getUser(session.access_token));
  const claims = jwtClaims(session.access_token);
  if (initial.error || initial.data?.user?.id?.toLowerCase() !== config.userId ||
      claims?.sub?.toLowerCase() !== config.userId || claims?.iss !== config.issuer ||
      claims?.role !== "authenticated" || claims?.aud !== "authenticated" ||
      ((claims?.project_id ?? claims?.ref) && (claims.project_id ?? claims.ref) !== config.projectRef) ||
      !Number.isFinite(claims?.exp) || claims.exp <= Date.now() / 1000) {
    throw new Error("PUBLISHER_IDENTITY_MISMATCH");
  }
  const factors = await authCall("MFA_FACTOR_CHECK_FAILED", () => client.auth.mfa.listFactors());
  if (factors.error || !Array.isArray(factors.data?.all)) throw new Error("MFA_FACTOR_CHECK_FAILED");
  if (factors.data.all.length !== 0) {
    output.write("Existing MFA factor detected; none was removed. For a verified factor, use its existing authenticator. " +
      "For an unverified factor, verify the project and UUID, then have the owner remove it through the separately approved Auth recovery procedure before retrying. Do not remove a verified factor without approved recovery.\n");
    throw new Error("MFA_FACTOR_EXISTS");
  }
  await checkTerminal(input, output);
  const enrolled = await authCall("MFA_ENROLLMENT_FAILED", () => client.auth.mfa.enroll({ factorType: "totp" }));
  const secret = enrolled.data?.totp?.secret;
  if (enrolled.error || !enrolled.data?.id || enrolled.data?.type !== "totp" ||
      typeof secret !== "string" || !/^[A-Z2-7]{16,128}$/i.test(secret)) throw new Error("MFA_ENROLLMENT_FAILED");
  output.write("If interrupted, an unverified factor may remain. Use the approved Auth recovery procedure before retrying.\n");
  if (!await showSecret(input, output, secret)) throw new Error("CANCELLED");
  const code = await readPassword(input, output, "Authenticator code");
  if (!code) throw new Error("CANCELLED");
  if (!/^\d{6}$/.test(code)) throw new Error("MFA_FAILED");
  const verified = await authCall("MFA_FAILED", () => client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code }));
  if (verified.error || !verified.data?.access_token) throw new Error("MFA_FAILED");
  const assurance = await authCall("MFA_FAILED", () => client.auth.mfa.getAuthenticatorAssuranceLevel(verified.data.access_token));
  if (assurance.error || assurance.data?.currentLevel !== "aal2") throw new Error("MFA_FAILED");
  const user = await authCall("PUBLISHER_IDENTITY_MISMATCH", () => client.auth.getUser(verified.data.access_token));
  if (user.error || !verifyProductionIdentity(verified.data, user.data?.user, config, Date.now(), false)) {
    throw new Error("PUBLISHER_IDENTITY_MISMATCH");
  }
  const after = await authCall("MFA_FACTOR_CHECK_FAILED", () => client.auth.mfa.listFactors());
  if (after.error || !Array.isArray(after.data?.all) || after.data.all.length !== 1 ||
      after.data.all[0]?.id !== enrolled.data.id || after.data.all[0]?.factor_type !== "totp" ||
      after.data.all[0]?.status !== "verified") throw new Error("MFA_FACTOR_CHECK_FAILED");
  output.write("Production TOTP enrollment verified at AAL2. Auth hook activation remains a separate approval.\n");
}

function confirmPrompt(input, output) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    let answered = false;
    rl.once("close", () => { if (!answered) resolve(false); });
    rl.question("Type PUBLISH to approve this exact publication (anything else cancels): ", (answer) => {
      answered = true;
      rl.close();
      resolve(answer === "PUBLISH");
    });
  });
}

export function publicationStore(client, diagnostics, beforeRegister) {
  return {
    async upload(path, bytes) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, {
        contentType: "application/json", upsert: false,
      });
      if (error) {
        diagnostics.phase = "upload";
        throw new Error("UPLOAD_FAILED");
      }
    },
    async download(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) {
        diagnostics.phase = "readback";
        throw new Error("READBACK_FAILED");
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async register(ref, path, rulesId, metadata) {
      if (beforeRegister) await beforeRegister(ref);
      const { data, error } = await client.rpc("publish_mystery_version", {
        p_mystery_id: ref.mysteryId, p_version: ref.version, p_schema_version: ref.schemaVersion,
        p_digest_sha256: ref.digestSha256, p_object_path: path, p_rule_set_id: rulesId,
        p_provenance: metadata.provenance, p_approved_by: metadata.approvedBy,
        p_approval_reference: metadata.approvalReference,
      });
      if (error || (data !== "published" && data !== "already_published")) {
        diagnostics.phase = "registration";
        const allowed = new Set(["22023", "23505", "23514", "42501", "PGRST301", "PGRST302"]);
        diagnostics.rpcCode = allowed.has(error?.code) ? error.code : "OTHER";
        throw new Error("REGISTRATION_FAILED");
      }
      return data;
    },
  };
}

export async function publish({ argv, env, input, output, makeClient = createClient,
  readPassword = passwordPrompt, confirm = confirmPrompt, credentialStore = keychain,
  loadPackage = readPackage, platform = process.platform, showSecret = showTotpSecret,
  checkTerminal = checkTotpTerminal }) {
  const options = parseArguments(argv);
  const packageData = options.filename ? await loadPackage(options.filename) : null;
  const config = options.target === "production" ? productionConfiguration(env) : localConfiguration(env);
  if (!input.isTTY || !output.isTTY) throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  if (options.enrollMfa) {
    output.write(`TOTP enrollment target: ${config.url}, project: ${config.projectRef}\nPublisher: ${config.userId} (${config.email})\n`);
  }
  if (options.credential === "enroll") {
    if (platform !== "darwin") throw new Error("KEYCHAIN_MACOS_REQUIRED");
    output.write(`Keychain enrollment target: ${config.target} (${config.url}), project: ${config.projectRef}\n` +
      `Publisher: ${config.userId} (${config.email})\n` +
      `Keychain service: ${keychainService}.${config.target}${config.target === "production" ? `.${config.projectRef}` : ""}\n`);
  }
  const client = makeClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const password = options.credential === "keychain" ? await credentialStore.read(config.userId, config) :
    await readPassword(input, output, undefined, options.credential === "enroll" ? { rejectInvalid: true } : undefined);
  if (!password) throw new Error("CANCELLED");
  if (options.credential === "enroll" && !validKeychainPassword(password)) throw new Error("KEYCHAIN_PASSWORD_FORMAT");
  try {
    if (options.enrollMfa) {
      await enrollTotp(client, config, password, input, output, readPassword, showSecret, checkTerminal);
      return;
    }
    const session = await authenticate(client, config, password, options.mfa, input, output, readPassword);
    if (options.credential === "enroll") {
      try {
        await credentialStore.enroll(config.userId, password, config);
      } catch {
        output.write("Keychain enrollment failed; an item may remain. Inspect the displayed service and account before retrying.\n");
        throw new Error("KEYCHAIN_FAILED");
      }
      output.write(`${config.target === "production" ? "Production" : "Local"} publisher credential enrolled in Keychain.\n`);
      return;
    }
    const { input: definition, ref } = packageData;
    output.write(`Target: ${config.target} (${config.url}), project: ${config.target === "production" ? config.projectRef : "local"}\nPublisher: ${config.userId}\n` +
      `Mystery: ${ref.mysteryId}\nVersion: ${ref.version}\nSchema: ${ref.schemaVersion}\n` +
      `Rule set: ${rules.id}\nSHA-256: ${ref.digestSha256}\n`);
    if (!await confirm(input, output)) throw new Error("CANCELLED");
    const diagnostics = {};
    const attemptId = randomUUID();
    const targetBinding = { target: config.target, projectRef: config.target === "production" ? config.projectRef : "local" };
    const authorization = approvalFor(ref, config.userId, { ...targetBinding, attemptId });
    const revalidate = config.target === "production" ? async (currentRef) => {
      const currentConfig = productionConfiguration(env);
      if (currentConfig.target !== config.target || currentConfig.projectRef !== config.projectRef ||
          currentConfig.url !== config.url || currentConfig.key !== config.key) throw new Error("TARGET_CHANGED");
      const currentPackage = await loadPackage(options.filename);
      if (currentPackage.ref.digestSha256 !== currentRef.digestSha256 ||
          currentPackage.ref.mysteryId !== currentRef.mysteryId ||
          currentPackage.ref.version !== currentRef.version ||
          currentPackage.ref.schemaVersion !== currentRef.schemaVersion) throw new Error("PACKAGE_CHANGED");
      const currentUser = await authCall("PUBLISHER_IDENTITY_MISMATCH", () => client.auth.getUser(session.access_token));
      if (currentUser.error || !verifyProductionIdentity(session, currentUser.data?.user, config)) {
        throw new Error("PUBLISHER_IDENTITY_MISMATCH");
      }
    } : undefined;
    const result = await publishMysteryDefinition(definition, rules, authorization,
      publicationStore(client, diagnostics, revalidate));
    if (!result.ok) {
      const phase = result.code === "REGISTRATION_FAILED" ? "registration" :
        result.code === "READBACK_FAILED" || result.code === "READBACK_MISMATCH" ? "readback" :
          result.code === "OBJECT_WRITE_FAILED" || result.code === "OBJECT_CONFLICT" ? "upload" : "approval";
      output.write(`Phase: ${phase}${phase === "registration" ? `; RPC code: ${diagnostics.rpcCode || "OTHER"}` : ""}\n` +
        "No overwrite was attempted. Retry only with the identical package and target; investigate conflicts before proceeding.\n");
      throw new Error(result.code);
    }
    output.write(`${result.status}: ${ref.mysteryId}/${ref.version} sha256=${ref.digestSha256}\n`);
  } finally {
    try { await client.auth.signOut({ scope: "local" }); } catch { /* Do not mask the publication result. */ }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  publish({ argv: process.argv.slice(2), env: process.env, input: process.stdin, output: process.stdout })
    .catch((error) => {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PUBLICATION_FAILED";
      console.error(code);
      if (code === "EXPAND_TILDE_IN_SHELL") {
        console.error("Use an absolute path, or leave ~ unquoted so your shell expands it.");
      }
      if (code === "KEYCHAIN_PASSWORD_FORMAT") {
        console.error("Keychain passwords must be valid UTF-8, at most 1024 bytes, and contain no control characters.");
      }
      process.exitCode = 1;
    });
}
