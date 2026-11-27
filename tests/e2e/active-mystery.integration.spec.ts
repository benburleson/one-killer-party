import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { publishMysteryDefinition, type PublicationBinding } from "../../src/lib/mystery-content/publication.ts";
import { PRIVATE_BUCKET, loadTrustedPublicMystery } from "../../src/lib/mystery-content/trusted-loader-core.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";
import { SYNTHETIC_SENTINELS, syntheticMysteryPackage } from "../unit/fixtures/synthetic-mystery-package.mjs";

const noAuthSession = { auth: { persistSession: false, autoRefreshToken: false } };

function localStatus() {
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }));
  if (status.API_URL !== "http://127.0.0.1:54321" ||
      !/^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(status.DB_URL) ||
      !status.ANON_KEY || !status.SERVICE_ROLE_KEY || !status.JWT_SECRET) {
    throw new Error("Disposable local Supabase is required");
  }
  return status;
}

function operatorToken(secret: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: now + 300,
    iat: now,
    iss: "supabase",
    role: "mystery_operator",
    sub: "00000000-0000-4000-8000-000000000001",
  })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

async function publishSyntheticPackage() {
  const status = localStatus();
  const operator = createClient(status.API_URL, status.ANON_KEY, {
    ...noAuthSession,
    global: { headers: { Authorization: "Bearer " + operatorToken(status.JWT_SECRET) } },
  });
  const runtime = createClient(status.API_URL, status.SERVICE_ROLE_KEY, noAuthSession);
  const packageDefinition = syntheticMysteryPackage();
  packageDefinition.mysteryId = `synthetic-e2e-${randomUUID().replaceAll("-", "")}`;
  packageDefinition.version = "v1";
  packageDefinition.title = "Synthetic Published Lobby";
  const metadata = {
    provenance: "synthetic:e2e",
    approvedBy: "local-test-operator",
    approvalReference: "issue-65-e2e",
  };
  const approvedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const store = {
    async upload(path: string, bytes: Uint8Array) {
      const { error } = await operator.storage.from(PRIVATE_BUCKET).upload(path, bytes, {
        contentType: "application/json",
        upsert: false,
      });
      if (error) throw new Error("upload unavailable");
    },
    async download(path: string) {
      const { data, error } = await runtime.storage.from(PRIVATE_BUCKET).download(path);
      if (error || !data) throw new Error("download unavailable");
      return new Uint8Array(await data.arrayBuffer());
    },
    async lookup(ref: { mysteryId: string; version: string; schemaVersion: number; digestSha256: string }) {
      const { data, error } = await runtime.rpc("get_published_mystery", {
        p_mystery_id: ref.mysteryId,
        p_version: ref.version,
        p_schema_version: ref.schemaVersion,
        p_digest_sha256: ref.digestSha256,
      });
      if (error) throw new Error("lookup unavailable");
      return data;
    },
    async register(
      ref: { mysteryId: string; version: string; schemaVersion: number; digestSha256: string },
      path: string,
      ruleSetId: string,
      values: typeof metadata,
    ) {
      const { data, error } = await operator.rpc("publish_mystery_version", {
        p_mystery_id: ref.mysteryId,
        p_version: ref.version,
        p_schema_version: ref.schemaVersion,
        p_digest_sha256: ref.digestSha256,
        p_object_path: path,
        p_rule_set_id: ruleSetId,
        p_provenance: values.provenance,
        p_approved_by: values.approvedBy,
        p_approval_reference: values.approvalReference,
      });
      if (error) throw new Error("registration unavailable");
      return data;
    },
  };
  const authorization = {
    target: "local" as const,
    projectRef: "local",
    artifact: {},
    async verify(_artifact: unknown, binding: PublicationBinding) {
      return {
        binding,
        ...metadata,
        approvedAt,
        expiresAt,
      };
    },
  };
  const { data: active, error: activeError } = await runtime.rpc("get_active_mystery");
  if (activeError || !Array.isArray(active) || active.length !== 1 ||
      active[0].mystery_id !== null) {
    throw new Error("Expected an absent active pointer before test setup");
  }
  const published = await publishMysteryDefinition(
    packageDefinition,
    EIGHT_ROLE_PROTOTYPE_RULES,
    authorization,
    store,
  );
  if (!published.ok) throw new Error("Synthetic publication failed");
  const publicPackage = await loadTrustedPublicMystery(published.ref, store);
  if (!publicPackage.ok) throw new Error("Synthetic public package verification failed");
  return { ref: published.ref, publicPackage: publicPackage.projection };
}

function activateLocal(ref: {
  mysteryId: string;
  version: string;
  schemaVersion: number;
  digestSha256: string;
}) {
  execFileSync("node", [
    "--experimental-strip-types",
    "scripts/activate-mystery-local.mjs",
    "--local",
    ref.mysteryId,
    ref.version,
    String(ref.schemaVersion),
    ref.digestSha256,
    "--confirm-local-activation",
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

const turnstileScript = `
(() => {
  let nextId = 0;
  const active = new Map();
  window.turnstile = {
    render(element, options) {
      const id = String(++nextId);
      active.set(id, options);
      element.setAttribute("data-test-turnstile", options.action || "");
      queueMicrotask(() => { if (active.has(id)) options.callback("XXXX.DUMMY.TOKEN.XXXX"); });
      return id;
    },
    reset(id) {
      const options = active.get(id);
      if (options) queueMicrotask(() => { if (active.has(id)) options.callback("XXXX.DUMMY.TOKEN.XXXX"); });
    },
    remove(id) { active.delete(id); },
  };
})();
`;

async function testContext(browser: Browser) {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/javascript", body: turnstileScript });
  });
  return context;
}

async function requestMagicLink(page: Page) {
  const mailbox = `active-${randomUUID()}@example.test`;
  await page.goto("/host");
  await page.getByLabel("Email address").fill(mailbox);
  const submit = page.getByRole("button", { name: "Send sign-in link" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("If sign-in is available, check your email for a link.")).toBeVisible();
  let link: string | undefined;
  for (let attempt = 0; attempt < 30 && !link; attempt++) {
    const inbox = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${mailbox}`)}`);
    if (inbox.ok) {
      const { messages } = await inbox.json() as { messages?: { ID: string }[] };
      if (messages?.length) {
        const message = await fetch(`http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(messages[0].ID)}`);
        if (message.ok) {
          const data = await message.json() as { HTML?: string; Text?: string };
          link = (data.HTML || data.Text || "").match(
            /http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^"'\s<>]+/,
          )?.[0]?.replaceAll("&amp;", "&");
        }
      }
    }
    if (!link) await page.waitForTimeout(500);
  }
  if (!link) throw new Error("Local email was not received");
  const url = new URL(link);
  const redirect = new URL(url.searchParams.get("redirect_to") || "");
  if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/verify" ||
      redirect.origin !== "http://127.0.0.1:3000" || redirect.pathname !== "/auth/callback") {
    throw new Error("Unexpected local auth link");
  }
  await page.goto(url.href);
  await expect(page.getByRole("button", { name: "Create a Blackwood Affair party" })).toBeVisible();
}

function watchPublicResponses(page: Page) {
  const pending: Promise<string>[] = [];
  const observed = { html: false, rsc: false, javascript: false };
  page.on("response", (response) => {
    const url = new URL(response.url());
    const type = response.request().resourceType();
    const contentType = response.headers()["content-type"] ?? "";
    if (type === "script") observed.javascript = true;
    if (contentType.includes("text/x-component")) observed.rsc = true;
    if (contentType.includes("text/html")) observed.html = true;
    if (type === "script" || contentType.includes("text/x-component") ||
        contentType.includes("text/html") || url.pathname.endsWith("/sync")) {
      pending.push(response.body().then((body) => body.toString("utf8")).catch(() => ""));
    }
  });
  return async (pageContent: string) => {
    const responses = await Promise.all(pending);
    const serialized = [pageContent, ...responses].join("\n");
    expect(observed.html).toBe(true);
    expect(observed.rsc).toBe(true);
    expect(observed.javascript).toBe(true);
    for (const sentinel of Object.values(SYNTHETIC_SENTINELS)) {
      expect(serialized).not.toContain(sentinel);
    }
  };
}

async function createParty(page: Page, expectedTitle?: string) {
  await page.getByRole("button", { name: "Create a Blackwood Affair party" }).click();
  const invite = page.getByRole("region", { name: "New invite" });
  await expect(invite).toBeVisible();
  const code = await invite.locator("strong").textContent();
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  const partyPath = await invite.getByRole("link", { name: "Open party" }).getAttribute("href");
  expect(partyPath).toMatch(/^\/host\/[0-9a-f-]+$/i);
  await invite.getByRole("link", { name: "Open party" }).click();
  if (expectedTitle) await expect(page.getByRole("heading", { name: expectedTitle })).toBeVisible();
  return { code: code!, partyPath: partyPath! };
}

async function joinAsGuest(browser: Browser, code: string, name: string) {
  const context = await testContext(browser);
  const page = await context.newPage();
  const assertNoPrivate = watchPublicResponses(page);
  await page.goto(`/join#code=${code}`);
  await expect(page.getByLabel("Eight-character invitation code")).toHaveValue(code);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await page.getByLabel("Your display name").fill(name);
  const submit = page.getByRole("button", { name: "Join party" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(`Your display name: ${name}`)).toBeVisible();
  return { context, page, assertNoPrivate };
}

test("activated published and legacy lobbies render and synchronize without private content", async ({ browser }) => {
  const { ref, publicPackage } = await publishSyntheticPackage();
  const hostContexts: BrowserContext[] = [];
  const guestContexts: BrowserContext[] = [];
  const hostContext = await testContext(browser);
  hostContexts.push(hostContext);
  const hostPage = await hostContext.newPage();
  const assertHostNoPrivate = watchPublicResponses(hostPage);
  try {
    await requestMagicLink(hostPage);

    const legacy = await createParty(hostPage);
    await expect(hostPage.getByRole("heading", { name: "Blackwood Affair" })).toBeVisible();
    await expect(hostPage.getByRole("list", { name: "Public character roster" }).getByRole("listitem"))
      .toHaveCount(8);
    await expect(hostPage.getByText("Vivienne Blackwood", { exact: true })).toBeVisible();

    activateLocal(ref);
    await hostPage.goto(legacy.partyPath);
    await expect(hostPage.getByRole("heading", { name: "Blackwood Affair" })).toBeVisible();
    const legacyGuest = await joinAsGuest(browser, legacy.code, "Legacy Guest");
    guestContexts.push(legacyGuest.context);
    await expect(hostPage.getByRole("heading", { name: "Players (1/8)" })).toBeVisible();
    const legacyRow = hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    }).getByRole("listitem").filter({ has: hostPage.getByText("Legacy Guest", { exact: true }) });
    await legacyRow.getByLabel("Assigned public character").selectOption("vivienne");
    await legacyRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(legacyGuest.page.getByRole("heading", { name: "Vivienne Blackwood" })).toBeVisible();

    await hostPage.goto("/host");
    await expect(hostPage.getByRole("button", { name: "Create a Blackwood Affair party" })).toBeVisible();
    const published = await createParty(hostPage, "Synthetic Published Lobby");
    await expect(hostPage.getByRole("list", { name: "Public character roster" }).getByRole("listitem"))
      .toHaveCount(8);
    await expect(hostPage.getByText(publicPackage.characters[0].publicName, { exact: true })).toBeVisible();

    const guest = await joinAsGuest(browser, published.code, "Published Guest");
    guestContexts.push(guest.context);
    await expect(hostPage.getByRole("heading", { name: "Players (1/8)" })).toBeVisible();
    const publishedRow = hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    }).getByRole("listitem").filter({ has: hostPage.getByText("Published Guest", { exact: true }) });
    await publishedRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[0].id);
    await publishedRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(publishedRow.getByRole("status")).toContainText("Character assignment updated.");
    await expect(guest.page.getByRole("heading", { name: publicPackage.characters[0].publicName }))
      .toBeVisible({ timeout: 15_000 });
    await expect(guest.page.getByText(publicPackage.characters[0].archetype)).toBeVisible();

    await hostPage.reload();
    await expect(hostPage.getByRole("heading", { name: "Synthetic Published Lobby" })).toBeVisible();
    await expect(hostPage.getByRole("list", { name: "Public character roster" })
      .getByRole("listitem").filter({ hasText: publicPackage.characters[0].publicName }))
      .toContainText("Assigned to Published Guest");
    await hostPage.goto(legacy.partyPath);
    await expect(hostPage.getByRole("heading", { name: "Blackwood Affair" })).toBeVisible();
    await expect(hostPage.getByRole("list", { name: "Public character roster" }).getByRole("listitem"))
      .toHaveCount(8);
    await expect(legacyGuest.page.getByRole("heading", { name: "Vivienne Blackwood" })).toBeVisible();

    await assertHostNoPrivate(await hostPage.content());
    for (const lobbyGuest of [legacyGuest, guest]) {
      await lobbyGuest.page.reload();
      await lobbyGuest.assertNoPrivate(await lobbyGuest.page.content());
    }
  } finally {
    for (const context of guestContexts) await context.close();
    for (const context of hostContexts) await context.close();
    execFileSync("docker", [
      "exec", "supabase_db_one-killer-party", "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres", "-c",
      "UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton",
    ], { stdio: ["ignore", "ignore", "ignore"] });
  }
});
