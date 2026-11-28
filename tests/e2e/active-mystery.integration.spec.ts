import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { publishMysteryDefinition, type PublicationBinding } from "../../src/lib/mystery-content/publication.ts";
import { PRIVATE_BUCKET, loadTrustedPublicMystery } from "../../src/lib/mystery-content/trusted-loader-core.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";
import { SYNTHETIC_SENTINELS, syntheticMysteryPackage } from "../unit/fixtures/synthetic-mystery-package.mjs";
import { configureTurnstile, signIn, verifiedSubmit } from "./local-auth";
import { isolateLocalRateLimits } from "./local-isolation";

test.beforeEach(isolateLocalRateLimits);

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

async function testContext(browser: Browser, mobile: boolean) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  await configureTurnstile(context);
  return context;
}

function watchPublicResponses(page: Page) {
  const pending: Promise<string>[] = [];
  const observed = { html: false, rsc: false, javascript: false };
  page.on("response", (response) => {
    const url = new URL(response.url());
    // Dossiers are deliberately fetched on demand and are not public surfaces.
    if (/^\/api\/lobby\/[^/]+\/dossier$/.test(url.pathname)) return;
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

async function joinAsGuest(browser: Browser, code: string, name: string, mobile: boolean) {
  const context = await testContext(browser, mobile);
  const requests = watchDossierRequests(context);
  const page = await context.newPage();
  const assertNoPrivate = watchPublicResponses(page);
  await page.goto(`/join#code=${code}`);
  await expect(page.getByLabel("Eight-character invitation code")).toHaveValue(code);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await page.getByLabel("Your display name").fill(name);
  await verifiedSubmit(page, "Join party");
  await expect(page.getByText(`Your display name: ${name}`)).toBeVisible();
  return { context, page, assertNoPrivate, requests };
}

function watchDossierRequests(context: BrowserContext) {
  const requests: string[] = [];
  context.on("request", (request) => {
    if (/^\/api\/lobby\/[^/]+\/dossier$/.test(new URL(request.url()).pathname)) {
      requests.push(request.method());
    }
  });
  return requests;
}

function watchPollLatency(page: Page, path: string) {
  const started = new WeakMap<object, number>();
  const latencies: number[] = [];
  const statuses: number[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === path) started.set(request, Date.now());
  });
  page.on("response", (response) => {
    const start = started.get(response.request());
    if (start === undefined) return;
    latencies.push(Date.now() - start);
    statuses.push(response.status());
  });
  return { latencies, statuses };
}

// Sanitized lifecycle diagnostics: categories, statuses, network error codes
// and UI states only; never response bodies, URLs, identifiers or credentials.
function watchDossierLifecycle(page: Page) {
  const started = Date.now();
  const events: string[] = [];
  const category = (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/join/sync" || /^\/host\/[^/]+\/sync$/.test(path)) return "sync";
    if (/^\/api\/lobby\/[^/]+\/dossier$/.test(path)) return "dossier";
    return null;
  };
  const record = (event: string) => events.push(`+${Date.now() - started}ms ${event}`);
  page.on("response", (response) => {
    const kind = category(response.url());
    if (!kind) return;
    const status = response.status();
    record(`${kind} ${status === 401 || status === 403 ? "denied" : status === 200 ? "ok" : "failed"} ${status}`);
  });
  page.on("requestfailed", (request) => {
    const kind = category(request.url());
    if (!kind) return;
    const code = /^net::[A-Z_]+$/.exec(request.failure()?.errorText ?? "")?.[0] ?? "unknown";
    record(`${kind} ${code === "net::ERR_ABORTED" ? "canceled" : "network-failed"} ${code}`);
  });
  return {
    mark: record,
    async report() {
      const ui = await page.evaluate(() => {
        const text = document.body.innerText;
        const labels = ["Reconnecting to the lobby…", "Waiting to reconnect…", "Loading your character…",
          "Your character is unavailable."].filter((label) => text.includes(label));
        const section = document.querySelector('section[aria-label="My Character"]');
        const buttons = [...(section?.querySelectorAll("button") ?? [])].map((button) =>
          `${button.textContent === "My Character" ? "open-button" : button.textContent === "Close" ? "close-button" : "other-button"}${button.disabled ? ":disabled" : ""}`);
        const articles = [...(section?.querySelectorAll("article") ?? [])].map((article) => article.hidden ? "article:hidden" : "article:shown");
        return [...labels, ...buttons, ...articles];
      }).catch(() => ["page unavailable"]);
      return [...events, `ui: ${ui.join(", ") || "no lifecycle status"}`].join("\n");
    },
  };
}

async function withDiagnostics<T>(diagnostics: { report(): Promise<string> }, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nDossier lifecycle diagnostics:\n${await diagnostics.report()}`);
  }
}

async function settledGuestSnapshot(page: Page) {
  const sync = (request: { url(): string; method(): string }) =>
    request.method() === "GET" && new URL(request.url()).pathname === "/join/sync";
  const response = await (await page.waitForRequest(sync)).response();
  expect(response?.status()).toBe(200);
  // The next poll is scheduled only after the previous snapshot has been applied.
  await page.waitForRequest(sync);
}

async function openCharacter(page: Page, index: number) {
  const responsePromise = page.waitForResponse((response) =>
    /^\/api\/lobby\/[^/]+\/dossier$/.test(new URL(response.url()).pathname) &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "My Character", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual(expectedDossier(index));

  const fixture = syntheticMysteryPackage();
  const own = fixture.startingDossiers[index];
  for (const text of [own.biography, ...own.interpersonalPrompts, ...own.relationships.map((r) => r.perspective)]) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  const content = await page.content();
  for (let other = 0; other < fixture.startingDossiers.length; other++) {
    if (other !== index) expect(content).not.toContain(`${SYNTHETIC_SENTINELS.dossier}-${other + 1} `);
  }
  for (const sentinel of [SYNTHETIC_SENTINELS.briefing, SYNTHETIC_SENTINELS.item,
    SYNTHETIC_SENTINELS.objective, SYNTHETIC_SENTINELS.solution]) {
    expect(content).not.toContain(sentinel);
  }
}

async function expectNoPersistentDossier(page: Page) {
  const result = await page.evaluate(async (sentinels) => {
    const stored = [
      ...Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index)!;
        return `${key}:${localStorage.getItem(key)}`;
      }),
      ...Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index)!;
        return `${key}:${sessionStorage.getItem(key)}`;
      }),
    ].join("\n");
    return {
      containsPrivateSentinel: sentinels.some((sentinel) => stored.includes(sentinel)),
      indexedDatabaseCount: (await indexedDB.databases()).length,
      cacheCount: (await caches.keys()).length,
      serviceWorkerCount: (await navigator.serviceWorker.getRegistrations()).length,
    };
  }, Object.values(SYNTHETIC_SENTINELS));
  expect(result.containsPrivateSentinel).toBe(false);
  expect(result.indexedDatabaseCount).toBe(0);
  expect(result.cacheCount).toBe(0);
  expect(result.serviceWorkerCount).toBe(0);
}

async function dossier(page: Page, partyPath: string, origin = "http://127.0.0.1:3000") {
  const partyId = partyPath.split("/").pop();
  const response = await page.request.post(`/api/lobby/${partyId}/dossier`, {
    headers: { origin },
  });
  expect(response.headers()["cache-control"]).toContain("no-store");
  return { status: response.status(), body: await response.json() };
}

function expectUnavailable(result: { status: number; body: unknown }, status = 404) {
  expect(result).toEqual({ status, body: { error: "Dossier unavailable" } });
}

function expectedDossier(index: number) {
  const fixture = syntheticMysteryPackage();
  const character = fixture.characters[index];
  const privateData = fixture.startingDossiers[index];
  return {
    dossier: {
      character,
      biography: privateData.biography,
      interpersonalPrompts: privateData.interpersonalPrompts,
      relationships: privateData.relationships.map((relationship) => ({
        ...relationship,
        publicName: fixture.characters.find((candidate) => candidate.id === relationship.characterId)!.publicName,
      })),
    },
  };
}

test("My Character is on demand, principal-scoped, and invalidated by lobby changes", async ({ browser }, testInfo) => {
  const { ref, publicPackage } = await publishSyntheticPackage();
  const mobile = testInfo.project.name === "integration-mobile";
  const contexts: BrowserContext[] = [];
  const hostContext = await testContext(browser, mobile);
  contexts.push(hostContext);
  const hostRequests = watchDossierRequests(hostContext);
  const hostPage = await hostContext.newPage();
  const assertHostNoPrivate = watchPublicResponses(hostPage);
  let releaseDelayed: (() => void) | undefined;
  try {
    await signIn(hostPage);
    activateLocal(ref);
    const party = await createParty(hostPage, "Synthetic Published Lobby");
    const guest = await joinAsGuest(browser, party.code, "Character Guest", mobile);
    contexts.push(guest.context);
    const other = await joinAsGuest(browser, party.code, "Other Guest", mobile);
    contexts.push(other.context);
    await expect(hostPage.getByRole("heading", { name: "Players (2/8)" })).toBeVisible({ timeout: 15_000 });
    await expect(guest.page.getByRole("button", { name: "My Character", exact: true })).toHaveCount(0);
    await expect(other.page.getByRole("button", { name: "My Character", exact: true })).toHaveCount(0);

    const row = (name: string) => hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    }).getByRole("listitem").filter({ has: hostPage.getByText(name, { exact: true }) });
    const guestRow = row("Character Guest");
    const otherRow = row("Other Guest");
    await guestRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[0].id);
    await guestRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(guestRow.getByRole("status")).toContainText("Character assignment updated.");
    await otherRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[1].id);
    await otherRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(otherRow.getByRole("status")).toContainText("Character assignment updated.");
    await hostPage.getByLabel("Player display name").fill("Playing Host");
    await hostPage.getByRole("button", { name: "Join as a player" }).click();
    await expect(hostPage.getByText("You are enrolled as a player.")).toBeVisible();
    const hostRow = row("Playing Host (host)");
    await hostRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[2].id);
    await hostRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(hostRow.getByRole("status")).toContainText("Character assignment updated.");
    await expect(guest.page.getByRole("heading", { name: publicPackage.characters[0].publicName }))
      .toBeVisible({ timeout: 15_000 });
    await expect(other.page.getByRole("heading", { name: publicPackage.characters[1].publicName }))
      .toBeVisible({ timeout: 15_000 });

    expect(guest.requests).toEqual([]);
    expect(other.requests).toEqual([]);
    expect(hostRequests).toEqual([]);
    // Every host change bumps the party version in each guest's membership context, and a context change
    // deliberately closes an open dossier. Let the guest apply a snapshot taken after the final host change.
    await settledGuestSnapshot(guest.page);
    await openCharacter(guest.page, 0);
    expect(guest.requests).toEqual(["POST"]);
    await guest.page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(guest.page.getByText("SENTINEL-DOSSIER-1 placeholder biography.", { exact: true })).toHaveCount(0);
    await openCharacter(guest.page, 0);
    expect(guest.requests).toEqual(["POST", "POST"]);
    await expectNoPersistentDossier(guest.page);
    const lifecycle = watchDossierLifecycle(guest.page);
    await guest.page.evaluate(() => {
      const counts = { online: 0, offline: 0, reset: 0, suspend: 0 };
      (window as unknown as { __lifecycleEvents: typeof counts }).__lifecycleEvents = counts;
      window.addEventListener("online", () => counts.online++);
      window.addEventListener("offline", () => counts.offline++);
      window.addEventListener("lobby-private-invalidate", (event) => {
        if ((event as CustomEvent).detail?.reset) counts.reset++; else counts.suspend++;
      });
    });
    const lifecycleEvents = () => guest.page.evaluate(() =>
      (window as unknown as { __lifecycleEvents: Record<string, number> }).__lifecycleEvents);
    lifecycle.mark("set offline");
    await guest.context.setOffline(true);
    await expect(guest.page.getByText("SENTINEL-DOSSIER-1 placeholder biography.", { exact: true })).toHaveCount(0);
    const freshSync = guest.page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/join/sync" && response.status() === 200);
    const freshDossier = guest.page.waitForResponse((response) =>
      /^\/api\/lobby\/[^/]+\/dossier$/.test(new URL(response.url()).pathname) && response.status() === 200);
    lifecycle.mark("set online");
    // Chromium dispatches the native online event for network emulation; no synthetic event is needed.
    await guest.context.setOffline(false);
    await withDiagnostics(lifecycle, async () => {
      await freshSync;
      await freshDossier;
      await expect(guest.page.getByText("SENTINEL-DOSSIER-1 placeholder biography.", { exact: true })).toBeVisible();
    });
    const events = await lifecycleEvents();
    expect(events.online).toBe(1);
    expect(events.offline).toBe(1);
    expect(events.reset).toBe(0);
    expect(guest.requests).toEqual(["POST", "POST", "POST"]);
    await openCharacter(other.page, 1);
    await openCharacter(hostPage, 2);
    expect(other.requests).toEqual(["POST"]);
    expect(hostRequests).toEqual(["POST"]);
    await guest.page.getByRole("button", { name: "Close", exact: true }).click();
    await other.page.getByRole("button", { name: "Close", exact: true }).click();
    await hostPage.getByRole("button", { name: "Close", exact: true }).click();

    // Hold a real, authorized response until the server has reassigned the guest.
    let responseReady!: () => void;
    let responseFailed!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      responseReady = resolve;
      responseFailed = reject;
    });
    const gate = new Promise<void>((resolve) => { releaseDelayed = resolve; });
    let responseFinished!: () => void;
    const finished = new Promise<void>((resolve) => { responseFinished = resolve; });
    const dossierRoute = `**/api/lobby/${party.partyPath.split("/").pop()}/dossier`;
    await guest.page.route(dossierRoute, async (route) => {
      try {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual(expectedDossier(0));
        responseReady();
        await gate;
        await route.fulfill({ response }).catch(() => {});
      } catch (error) {
        responseFailed(error);
      } finally {
        responseFinished();
      }
    });
    await guest.page.getByRole("button", { name: "My Character", exact: true }).click();
    await ready;
    await guestRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[3].id);
    await guestRow.getByLabel("I confirm changing or clearing this assigned character.").check();
    await guestRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(guestRow.getByRole("status")).toContainText("Character assignment updated.");
    await guest.page.getByRole("button", { name: "Refresh assignment" }).click();
    await expect(guest.page.getByRole("heading", { name: publicPackage.characters[3].publicName }))
      .toBeVisible({ timeout: 15_000 });
    releaseDelayed!();
    await finished;
    await guest.page.unroute(dossierRoute);
    await expect(guest.page.getByText("SENTINEL-DOSSIER-1 placeholder biography.", { exact: true })).toHaveCount(0);
    await openCharacter(guest.page, 3);

    await guestRow.getByLabel("I have deliberately confirmed this guest’s identity out of band.").check();
    await guestRow.getByRole("button", { name: "Start guest recovery" }).click();
    const token = await guestRow.getByTestId("recovery-credential").textContent();
    if (!token) throw new Error("Recovery credential unavailable");
    const recoveredContext = await testContext(browser, mobile);
    contexts.push(recoveredContext);
    const recoveredRequests = watchDossierRequests(recoveredContext);
    const recoveredPage = await recoveredContext.newPage();
    await recoveredPage.goto("/join");
    await recoveredPage.getByRole("button", { name: "Lost access to your guest session? Recover it" }).click();
    await recoveredPage.getByLabel("Recovery credential").fill(token);
    await expect(recoveredPage.getByRole("button", { name: "Recover membership" })).toBeEnabled();
    await recoveredPage.getByRole("button", { name: "Recover membership" }).click();
    await expect(recoveredPage.getByText("Your display name: Character Guest")).toBeVisible();
    expect(recoveredRequests).toEqual([]);
    await expect(guest.page.getByText("This browser no longer has access to that lobby. Ask the host for help."))
      .toBeVisible({ timeout: 15_000 });
    await expect(guest.page.getByText("SENTINEL-DOSSIER-4 placeholder biography.", { exact: true })).toHaveCount(0);
    await openCharacter(recoveredPage, 3);
    await guestRow.getByLabel("I confirm removing this participant before the game starts.").check();
    await guestRow.getByRole("button", { name: "Remove participant" }).click();
    await expect(hostPage.getByRole("heading", { name: "Players (2/8)" })).toBeVisible();
    await expect(recoveredPage.getByText("This browser no longer has access to that lobby. Ask the host for help."))
      .toBeVisible({ timeout: 15_000 });
    await expect(recoveredPage.getByText("SENTINEL-DOSSIER-4 placeholder biography.", { exact: true })).toHaveCount(0);
    await assertHostNoPrivate(await hostPage.content());
    await guest.assertNoPrivate(await guest.page.content());
    await other.assertNoPrivate(await other.page.content());
  } finally {
    releaseDelayed?.();
    execFileSync("docker", [
      "exec", "supabase_db_one-killer-party", "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres", "-c",
      "UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton",
    ], { stdio: ["ignore", "ignore", "ignore"] });
    for (const context of contexts) await context.close().catch(() => {});
  }
});

test("activated published and legacy lobbies render and synchronize without private content", async ({ browser }, testInfo) => {
  const { ref, publicPackage } = await publishSyntheticPackage();
  const mobile = testInfo.project.name === "integration-mobile";
  const hostContexts: BrowserContext[] = [];
  const guestContexts: BrowserContext[] = [];
  const hostContext = await testContext(browser, mobile);
  hostContexts.push(hostContext);
  const hostPage = await hostContext.newPage();
  const assertHostNoPrivate = watchPublicResponses(hostPage);
  try {
    await signIn(hostPage);

    const legacy = await createParty(hostPage);
    await expect(hostPage.getByRole("heading", { name: "Blackwood Affair" })).toBeVisible();
    await expect(hostPage.getByRole("list", { name: "Public character roster" }).getByRole("listitem"))
      .toHaveCount(8);
    await expect(hostPage.getByText("Vivienne Blackwood", { exact: true })).toBeVisible();

    activateLocal(ref);
    await hostPage.goto(legacy.partyPath);
    await expect(hostPage.getByRole("heading", { name: "Blackwood Affair" })).toBeVisible();
    const legacyGuest = await joinAsGuest(browser, legacy.code, "Legacy Guest", mobile);
    guestContexts.push(legacyGuest.context);
    await expect(hostPage.getByRole("heading", { name: "Players (1/8)" })).toBeVisible({ timeout: 15_000 });
    const legacyRow = hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    }).getByRole("listitem").filter({ has: hostPage.getByText("Legacy Guest", { exact: true }) });
    await legacyRow.getByLabel("Assigned public character").selectOption("vivienne");
    await legacyRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(legacyGuest.page.getByRole("heading", { name: "Vivienne Blackwood" })).toBeVisible({ timeout: 15_000 });
    expectUnavailable(await dossier(legacyGuest.page, legacy.partyPath));

    await hostPage.goto("/host");
    await expect(hostPage.getByRole("button", { name: "Create a Blackwood Affair party" })).toBeVisible();
    const published = await createParty(hostPage, "Synthetic Published Lobby");
    await expect(hostPage.getByRole("list", { name: "Public character roster" }).getByRole("listitem"))
      .toHaveCount(8);
    await expect(hostPage.getByText(publicPackage.characters[0].publicName, { exact: true })).toBeVisible();

    const guest = await joinAsGuest(browser, published.code, "Published Guest", mobile);
    guestContexts.push(guest.context);
    const otherGuest = await joinAsGuest(browser, published.code, "Second Guest", mobile);
    guestContexts.push(otherGuest.context);
    const anonymous = await testContext(browser, mobile);
    guestContexts.push(anonymous);
    const anonymousPage = await anonymous.newPage();
    expectUnavailable(await dossier(anonymousPage, published.partyPath));
    expectUnavailable(await dossier(hostPage, published.partyPath));
    expectUnavailable(await dossier(guest.page, published.partyPath));
    expectUnavailable(await dossier(guest.page, legacy.partyPath));
    expectUnavailable(await dossier(guest.page, published.partyPath, "https://foreign.example"), 403);
    await expect(hostPage.getByRole("heading", { name: "Players (2/8)" })).toBeVisible({ timeout: 15_000 });
    const publishedRow = hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    }).getByRole("listitem").filter({ has: hostPage.getByText("Published Guest", { exact: true }) });
    await publishedRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[0].id);
    await publishedRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(publishedRow.getByRole("status")).toContainText("Character assignment updated.");
    await expect(guest.page.getByRole("heading", { name: publicPackage.characters[0].publicName }))
      .toBeVisible({ timeout: 15_000 });
    await expect(guest.page.getByText(publicPackage.characters[0].archetype)).toBeVisible();
    expect(await dossier(guest.page, published.partyPath)).toEqual({ status: 200, body: expectedDossier(0) });
    expectUnavailable(await dossier(otherGuest.page, published.partyPath));
    const secondRow = hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    }).getByRole("listitem").filter({ has: hostPage.getByText("Second Guest", { exact: true }) });
    await secondRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[1].id);
    await secondRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(secondRow.getByRole("status")).toContainText("Character assignment updated.");
    expect(await dossier(otherGuest.page, published.partyPath)).toEqual({ status: 200, body: expectedDossier(1) });
    expect(await dossier(guest.page, published.partyPath)).toEqual({ status: 200, body: expectedDossier(0) });

    await hostPage.getByLabel("Player display name").fill("Playing Host");
    await hostPage.getByRole("button", { name: "Join as a player" }).click();
    await expect(hostPage.getByText("You are enrolled as a player.")).toBeVisible();
    expectUnavailable(await dossier(hostPage, published.partyPath));
    const hostRow = hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    }).getByRole("listitem").filter({ has: hostPage.getByText("Playing Host (host)", { exact: true }) });
    await hostRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[2].id);
    await hostRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(hostRow.getByRole("status")).toContainText("Character assignment updated.");
    expect(await dossier(hostPage, published.partyPath)).toEqual({ status: 200, body: expectedDossier(2) });

    await publishedRow.getByLabel("Assigned public character").selectOption(publicPackage.characters[3].id);
    await publishedRow.getByLabel("I confirm changing or clearing this assigned character.").check();
    await expect(publishedRow.getByRole("status")).toHaveCount(0);
    await publishedRow.getByRole("button", { name: "Save assignment" }).click();
    await expect(publishedRow.getByRole("status")).toContainText("Character assignment updated.");
    // Synchronize on the canonical roster, not retained form feedback, before one dossier read.
    const publicRoster = hostPage.getByRole("list", { name: "Public character roster" });
    const rosterCard = (index: number) => publicRoster.getByRole("listitem").filter({
      has: hostPage.getByRole("heading", { name: publicPackage.characters[index].publicName, exact: true }),
    });
    await expect(rosterCard(3)).toContainText("Assigned to Published Guest");
    await expect(rosterCard(0)).toContainText("Available");
    const reassigned = await dossier(guest.page, published.partyPath);
    expect(reassigned).toEqual({ status: 200, body: expectedDossier(3) });
    expect(JSON.stringify(reassigned)).not.toContain("SENTINEL-DOSSIER-1 ");

    await publishedRow.getByLabel("I have deliberately confirmed this guest’s identity out of band.").check();
    await publishedRow.getByRole("button", { name: "Start guest recovery" }).click();
    const recoveryToken = await publishedRow.getByTestId("recovery-credential").textContent();
    if (!recoveryToken) throw new Error("Recovery credential unavailable");
    const recoveredContext = await testContext(browser, mobile);
    guestContexts.push(recoveredContext);
    const recoveredPage = await recoveredContext.newPage();
    await recoveredPage.goto("/join");
    await recoveredPage.getByRole("button", { name: "Lost access to your guest session? Recover it" }).click();
    await recoveredPage.getByLabel("Recovery credential").fill(recoveryToken);
    await expect(recoveredPage.getByRole("button", { name: "Recover membership" })).toBeEnabled();
    await recoveredPage.getByRole("button", { name: "Recover membership" }).click();
    await expect(recoveredPage.getByText("Your display name: Published Guest")).toBeVisible();
    expectUnavailable(await dossier(guest.page, published.partyPath));
    expect(await dossier(recoveredPage, published.partyPath)).toEqual({ status: 200, body: expectedDossier(3) });
    await publishedRow.getByLabel("I confirm removing this participant before the game starts.").check();
    await publishedRow.getByRole("button", { name: "Remove participant" }).click();
    await expect(hostPage.getByRole("heading", { name: "Players (2/8)" })).toBeVisible();
    expectUnavailable(await dossier(recoveredPage, published.partyPath));

    await hostPage.reload();
    await expect(hostPage.getByRole("heading", { name: "Synthetic Published Lobby" })).toBeVisible();
    await expect(hostPage.getByRole("list", { name: "Public character roster" })
      .getByRole("listitem").filter({ hasText: publicPackage.characters[1].publicName }))
      .toContainText("Assigned to Second Guest");
    await hostPage.goto(legacy.partyPath);
    await expect(hostPage.getByRole("heading", { name: "Blackwood Affair" })).toBeVisible();
    await expect(hostPage.getByRole("list", { name: "Public character roster" }).getByRole("listitem"))
      .toHaveCount(8);
    await expect(legacyGuest.page.getByRole("heading", { name: "Vivienne Blackwood" })).toBeVisible();

    await assertHostNoPrivate(await hostPage.content());
    for (const lobbyGuest of [legacyGuest, guest, otherGuest]) {
      await lobbyGuest.page.reload();
      await lobbyGuest.assertNoPrivate(await lobbyGuest.page.content());
    }
  } finally {
    execFileSync("docker", [
      "exec", "supabase_db_one-killer-party", "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres", "-c",
      "UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton",
    ], { stdio: ["ignore", "ignore", "ignore"] });
    for (const context of guestContexts) await context.close().catch(() => {});
    for (const context of hostContexts) await context.close().catch(() => {});
  }
});

test("eight-player published lobby polls concurrently during host operations", async ({ browser }, testInfo) => {
  const { ref, publicPackage } = await publishSyntheticPackage();
  const mobile = testInfo.project.name === "integration-mobile";
  const contexts: BrowserContext[] = [];
  const hostContext = await testContext(browser, mobile);
  contexts.push(hostContext);
  const hostPage = await hostContext.newPage();
  const assertHostNoPrivate = watchPublicResponses(hostPage);
  const metrics: ReturnType<typeof watchPollLatency>[] = [];
  try {
    await signIn(hostPage);
    activateLocal(ref);
    const party = await createParty(hostPage, "Synthetic Published Lobby");
    const guests = [];
    for (let index = 0; index < 7; index++) {
      const guest = await joinAsGuest(browser, party.code, `Load Guest ${index + 1}`, mobile);
      contexts.push(guest.context);
      guests.push(guest);
    }
    await expect(hostPage.getByRole("heading", { name: "Players (7/8)" })).toBeVisible({ timeout: 15_000 });
    await hostPage.getByLabel("Player display name").fill("Load Host");
    await hostPage.getByRole("button", { name: "Join as a player" }).click();
    await expect(hostPage.getByText("You are enrolled as a player.")).toBeVisible();
    await expect(hostPage.getByRole("heading", { name: "Players (8/8)" })).toBeVisible({ timeout: 15_000 });

    metrics.push(watchPollLatency(hostPage, `/host/${party.partyPath.split("/").pop()}/sync`));
    for (const guest of guests) metrics.push(watchPollLatency(guest.page, "/join/sync"));
    const participantList = hostPage.getByRole("list").filter({
      has: hostPage.getByRole("button", { name: "Save assignment" }),
    });
    for (let index = 0; index < guests.length; index++) {
      const row = participantList.getByRole("listitem").filter({
        has: hostPage.getByText(`Load Guest ${index + 1}`, { exact: true }),
      });
      await row.getByLabel("Assigned public character").selectOption(publicPackage.characters[index].id);
      await row.getByRole("button", { name: "Save assignment" }).click();
      await expect(row.getByRole("status")).toContainText("Character assignment updated.");
    }
    await expect.poll(() => metrics.every(({ latencies }) => latencies.length >= 2), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => metrics.every(({ statuses }) => statuses.includes(200)), { timeout: 30_000 }).toBe(true);
    for (const { statuses } of metrics) {
      expect(statuses.every((status) => status === 200 || status === 503)).toBe(true);
    }
    for (const guest of guests) expect(guest.requests).toEqual([]);
    for (const guest of guests) await guest.assertNoPrivate(await guest.page.content());
    await assertHostNoPrivate(await hostPage.content());

    const samples = metrics.flatMap(({ latencies }) => latencies).sort((a, b) => a - b);
    const percentile = (ratio: number) => samples[Math.min(Math.ceil(samples.length * ratio) - 1, samples.length - 1)];
    console.log(JSON.stringify({
      scenario: "disposable-local-eight-player-lobby",
      clients: metrics.length,
      pollResponses: samples.length,
      http200Responses: metrics.flatMap(({ statuses }) => statuses).filter((status) => status === 200).length,
      retryable503Responses: metrics.flatMap(({ statuses }) => statuses).filter((status) => status === 503).length,
      pollsPerClientMinimum: Math.min(...metrics.map(({ latencies }) => latencies.length)),
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: samples.at(-1) },
      hostAssignmentsDuringPolling: guests.length,
    }));
  } finally {
    execFileSync("docker", [
      "exec", "supabase_db_one-killer-party", "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres", "-c",
      "UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton",
    ], { stdio: ["ignore", "ignore", "ignore"] });
    for (const context of contexts) await context.close().catch(() => {});
  }
});
