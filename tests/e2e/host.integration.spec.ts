import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Local Supabase has CAPTCHA disabled; emulate only Cloudflare's browser-side
// widget/token issuance. This isolates the guest recovery race test from external
// challenge script latency, without mocking Supabase, HTTP auth or database RPCs.
// The dummy token is public and never a production credential.
const localTurnstileScript = `
(() => {
  const active = new Map();
  let nextId = 0;
  const dummy = "XXXX.DUMMY.TOKEN.XXXX";
  window.turnstile = {
    render(element, options) {
      const id = String(++nextId);
      active.set(id, options);
      element.setAttribute("data-test-turnstile", options.action || "");
      queueMicrotask(() => { if (active.has(id)) options.callback(dummy); });
      return id;
    },
    reset(id) {
      const options = active.get(id);
      if (options) queueMicrotask(() => { if (active.has(id)) options.callback(dummy); });
    },
    remove(id) { active.delete(id); },
  };
})();
`;

async function configureTurnstile(context: BrowserContext) {
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: localTurnstileScript,
    });
  });
}
async function newTestContext(browser: Browser) {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  await configureTurnstile(context);
  return context;
}

// The local mail capture service (Mailpit in the current Supabase CLI) and
// GoTrue are disposable. Never include message bodies or links in test output.
async function verifiedSubmit(page: Page, label: string) {
  await expect(page.getByRole("button", { name: label })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: label }).click();
}

async function requestMagicLink(page: Page) {
  const mailbox = `host-${randomUUID()}`;
  await page.goto("/host");
  await page.getByLabel("Email address").fill(`${mailbox}@example.test`);
  await verifiedSubmit(page, "Send sign-in link");
  await expect(page.getByText("If sign-in is available, check your email for a link.")).toBeVisible();

  let link: string | undefined;
  for (let attempt = 0; attempt < 30 && !link; attempt++) {
    const query = encodeURIComponent(`to:${mailbox}@example.test`);
    const inbox = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${query}`);
    if (inbox.ok) {
      const { messages } = await inbox.json() as { messages?: { ID: string }[] };
      if (messages?.length) {
        const message = await fetch(`http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(messages[0].ID)}`);
        if (message.ok) {
          const data = await message.json() as { HTML?: string; Text?: string };
          const body = data.HTML || data.Text || "";
          link = body.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^"'\s<>]+/)?.[0]
            ?.replaceAll("&amp;", "&");
        }
      }
    }
    if (!link) await page.waitForTimeout(1000);
  }
  if (!link) throw new Error("Local email was not received");
  return link;
}

async function signIn(page: Page) {
  const link = await requestMagicLink(page);
  const url = new URL(link);
  const redirect = new URL(url.searchParams.get("redirect_to") || "");
  if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/verify" ||
      redirect.origin !== "http://127.0.0.1:3000" || redirect.pathname !== "/auth/callback") {
    throw new Error("Unexpected local auth link");
  }
  await page.goto(url.href);
  await expect(page.getByRole("button", { name: "Create a Blackwood Affair party" })).toBeVisible();
}

test("local host sign-in, party access, isolation and sign-out", async ({ page, browser }, testInfo) => {
  await configureTurnstile(page.context());
  let stage = "sign-in screen";
  const guestContexts: BrowserContext[] = [];
  try {
    await page.goto("/host");
    await expect(page.getByRole("heading", { name: "Host sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeEmpty();
    await page.screenshot({ path: testInfo.outputPath("host-sign-in.png"), fullPage: true });

    stage = "unauthenticated access";
    await page.goto("/host/00000000-0000-4000-8000-000000000001");
    await expect(page.getByLabel("Email address")).toBeVisible();

    stage = "invalid callback";
    await page.goto("/auth/callback?code=invalid");
    await expect(page.getByLabel("Email address")).toBeVisible();

    stage = "host A authentication";
    await signIn(page);
    stage = "party creation";
    await page.getByRole("button", { name: "Create a Blackwood Affair party" }).click();
    // The creation response may contain the one-time invite; never screenshot it.
    const invite = page.getByRole("region", { name: "New invite" });
    await expect(invite).toBeVisible();
    const code = await invite.locator("strong").textContent();
    if (!code || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) throw new Error("Invalid invite");
    const joinLink = new URL(await invite.getByLabel("Reusable invite link").inputValue());
    if (joinLink.origin !== "http://127.0.0.1:3000" || joinLink.pathname !== "/join" ||
        new URLSearchParams(joinLink.hash.slice(1)).get("code") !== code) {
      throw new Error("Invalid join link");
    }
    const partyLink = invite.getByRole("link", { name: "Open party" });
    const partyPath = await partyLink.getAttribute("href");
    if (!partyPath || !/^\/host\/[0-9a-f-]+$/i.test(partyPath)) throw new Error("Party link unavailable");

    stage = "reload and return to lobby";
    await page.goto(partyPath);
    await expect(page.getByText("No players have joined yet.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("No players have joined yet.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("No players have joined yet.")).toBeVisible();
    await expect(page.getByRole("region", { name: "New invite" })).toHaveCount(0);

    stage = "host B isolation";
    const other = await newTestContext(browser);
    try {
      const otherPage = await other.newPage();
      await signIn(otherPage);
      await otherPage.goto(partyPath);
      await expect(otherPage.getByRole("heading", { name: "Host lobby" })).toBeVisible();
      await expect(otherPage.getByText("No players have joined yet.")).toHaveCount(0);
      await expect(otherPage.getByRole("button", { name: "Rotate invite" })).toHaveCount(0);
      await otherPage.goto("/join");
      await expect(otherPage.getByRole("heading", { name: "Open this invitation in a private window" })).toBeVisible();
      await expect(otherPage.getByRole("button", { name: "Join party" })).toHaveCount(0);
      await expect(otherPage.getByLabel("Recovery credential")).toHaveCount(0);
    } finally {
      await other.close();
    }

    const makeGuest = async (displayName: string, code: string) => {
      const context = await newTestContext(browser);
      guestContexts.push(context);
      const guestPage = await context.newPage();
      await guestPage.goto("/join");
      await guestPage.getByLabel("Eight-character invitation code").fill(code);
      await guestPage.getByLabel("Your display name").fill(displayName);
      await verifiedSubmit(guestPage, "Join party");
      return guestPage;
    };

    stage = "guest authentication errors are not confused with host sessions";
    // Simulate GoTrue rejecting an anonymous signup without leaking provider
    // error details; the app must not claim a different account is signed in.
    const rejectedContext = await newTestContext(browser);
    guestContexts.push(rejectedContext);
    await rejectedContext.route("**/auth/v1/signup", async (route) => {
      await route.fulfill({
        status: 403, contentType: "application/json",
        body: JSON.stringify({ code: "captcha_failed", message: "Human verification failed" }),
      });
    });
    const rejectedGuest = await rejectedContext.newPage();
    await rejectedGuest.goto("/join");
    await rejectedGuest.getByLabel("Eight-character invitation code").fill(code);
    await rejectedGuest.getByLabel("Your display name").fill("Rejected Guest");
    await verifiedSubmit(rejectedGuest, "Join party");
    await expect(rejectedGuest.getByRole("status")).toContainText("Guest sign-in was unavailable.");
    await expect(rejectedGuest.getByText(/another signed-in account/)).toHaveCount(0);

    stage = "invite fragment and first guest admission";
    const guestContext = await newTestContext(browser);
    guestContexts.push(guestContext);
    const guestPage = await guestContext.newPage();
    const guestRequestUrls: string[] = [];
    guestPage.on("request", (request) => guestRequestUrls.push(request.url()));
    await guestPage.goto(joinLink.href);
    await expect(guestPage.getByLabel("Eight-character invitation code")).toHaveValue(code);
    await expect.poll(() => guestPage.evaluate(() => window.location.hash)).toBe("");
    await guestPage.getByLabel("Your display name").fill("Alex Guest");
    await verifiedSubmit(guestPage, "Join party");
    await expect(guestPage.getByText("Your display name: Alex Guest")).toBeVisible();
    await guestPage.screenshot({
      path: testInfo.outputPath("guest-waiting-lobby.png"),
      fullPage: true,
    });
    for (const requestUrl of guestRequestUrls) {
      const request = new URL(requestUrl);
      if (request.searchParams.has("code") || request.searchParams.has("token") || requestUrl.includes(code)) {
        throw new Error("Invitation credential appeared in a request URL");
      }
    }

    stage = "same-session guest reconnect and safe host roster";
    await guestPage.reload();
    await expect(guestPage.getByText("Your display name: Alex Guest")).toBeVisible();
    await expect(guestPage.getByRole("button", { name: "Join party" })).toHaveCount(0);
    await page.goto(partyPath);
    await expect(page.getByRole("heading", { name: "Players (1/8)" })).toBeVisible();
    const alexRow = page.getByRole("listitem").filter({ hasText: "Alex Guest" });
    await expect(alexRow.getByText(/Participant ID:/)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("host-safe-roster.png"),
      fullPage: true,
    });

    stage = "guest session protected from host sign-in";
    await guestPage.goto("/host");
    await expect(guestPage.getByRole("status")).toContainText("open host sign-in in a separate browser");
    await expect(guestPage.getByLabel("Email address")).toHaveCount(0);
    await guestPage.screenshot({
      path: testInfo.outputPath("guest-session-preserved.png"),
      fullPage: true,
    });
    const hostLoginContext = await newTestContext(browser);
    guestContexts.push(hostLoginContext);
    const hostLoginPage = await hostLoginContext.newPage();
    const hostMagicLink = await requestMagicLink(hostLoginPage);
    const hostMagicUrl = new URL(hostMagicLink);
    await guestPage.goto(hostMagicUrl.href);
    await expect(guestPage).toHaveURL(/\/host\?auth=error$/);
    await expect(guestPage.getByRole("status")).toContainText("This browser already has an authenticated session");
    await guestPage.goto("/join");
    await expect(guestPage.getByText("Your display name: Alex Guest")).toBeVisible();

    await page.goto(partyPath);
    stage = "host-assisted recovery initiation";
    await alexRow.getByLabel("I have deliberately confirmed this guest’s identity out of band.").check();
    await alexRow.getByRole("button", { name: "Start guest recovery" }).click();
    const recoveryToken = await alexRow.getByTestId("recovery-credential").textContent();
    if (!recoveryToken) throw new Error("Recovery credential unavailable");
    stage = "host-assisted recovery browser setup";
    const recoveryContexts = await Promise.all([
      newTestContext(browser),
      newTestContext(browser),
    ]);
    guestContexts.push(...recoveryContexts);
    const recoveryPages = await Promise.all(recoveryContexts.map((context) => context.newPage()));
    for (const recoveryPage of recoveryPages) {
      await recoveryPage.goto("/join");
      await expect(recoveryPage.getByLabel("Recovery credential")).toHaveCount(0);
      await expect(recoveryPage.locator('[data-test-turnstile="guest_join"]')).toHaveCount(1);
      await recoveryPage.getByRole("button", { name: "Lost access to your guest session? Recover it" }).click();
      await recoveryPage.getByLabel("Recovery credential").fill(recoveryToken);
    }
    stage = "host-assisted recovery widget ready";
    for (const recoveryPage of recoveryPages) {
      await expect(recoveryPage.locator('[data-test-turnstile="guest_join"]')).toHaveCount(0);
      await expect(recoveryPage.locator('[data-test-turnstile="guest_recovery"]')).toHaveCount(1);
      await expect(recoveryPage.getByRole("button", { name: "Recover membership" })).toBeEnabled();
    }
    stage = "host-assisted recovery challenge and submission";
    await Promise.all(recoveryPages.map((recoveryPage) =>
      verifiedSubmit(recoveryPage, "Recover membership")));
    stage = "host-assisted recovery single-use outcome";
    await expect.poll(async () => {
      const outcomes = await Promise.all(recoveryPages.map(async (recoveryPage) => ({
        recovered: await recoveryPage.getByText("Your display name: Alex Guest").count(),
        rejected: await recoveryPage.getByText("Recovery could not be completed. Ask the host to verify your identity and issue a new credential.").count(),
      })));
      return outcomes.reduce((sum, outcome) => sum + outcome.recovered, 0) === 1 &&
        outcomes.reduce((sum, outcome) => sum + outcome.rejected, 0) === 1;
    }).toBe(true);
    const recoveredPage = await recoveryPages[0].getByText("Your display name: Alex Guest").count() === 1
      ? recoveryPages[0] : recoveryPages[1];
    stage = "host-assisted recovery old principal isolation";
    await guestPage.reload();
    await expect(guestPage.getByLabel("Eight-character invitation code")).toBeVisible();
    await guestPage.getByLabel("Eight-character invitation code").fill(code);
    await guestPage.getByLabel("Your display name").fill("Alex Guest");
    await verifiedSubmit(guestPage, "Join party");
    await expect(guestPage.getByText("That invitation could not be used. Check the code or ask the host for help.")).toBeVisible();

    stage = "confirmed host removal and fresh replacement identity";
    await page.goto(partyPath);
    const recoveredRow = page.getByRole("listitem").filter({ hasText: "Alex Guest" });
    await recoveredRow.getByLabel("I confirm removing this participant before the game starts.").check();
    await recoveredRow.getByRole("button", { name: "Remove participant" }).click();
    await expect(page.getByRole("heading", { name: "Players (0/8)" })).toBeVisible();
    await recoveredPage.reload();
    await recoveredPage.getByLabel("Eight-character invitation code").fill(code);
    await recoveredPage.getByLabel("Your display name").fill("Alex Guest");
    await verifiedSubmit(recoveredPage, "Join party");
    await expect(recoveredPage.getByText("That invitation could not be used. Check the code or ask the host for help.")).toBeVisible();
    const replacementPage = await makeGuest("Replacement", code);
    await expect(replacementPage.getByText("Your display name: Replacement")).toBeVisible();

    stage = "atomic last-slot concurrent admission";
    const fillers = [];
    for (let index = 1; index <= 6; index++) {
      fillers.push(await makeGuest(`Guest ${index}`, code));
    }
    const finalOneContext = await newTestContext(browser);
    const finalTwoContext = await newTestContext(browser);
    guestContexts.push(finalOneContext, finalTwoContext);
    const finalOne = await finalOneContext.newPage();
    const finalTwo = await finalTwoContext.newPage();
    for (const finalPage of [finalOne, finalTwo]) {
      await finalPage.goto("/join");
      await finalPage.getByLabel("Eight-character invitation code").fill(code);
      await finalPage.getByLabel("Your display name").fill("Last slot");
    }
    await Promise.all([
      verifiedSubmit(finalOne, "Join party"),
      verifiedSubmit(finalTwo, "Join party"),
    ]);
    await expect.poll(async () => {
      const joinedCount = await Promise.all([finalOne, finalTwo].map((finalPage) =>
        finalPage.getByRole("heading", { name: "You’re in the lobby" }).count()));
      const fullCount = await Promise.all([finalOne, finalTwo].map((finalPage) =>
        finalPage.getByText("This party is full. Ask the host for help.").count()));
      return joinedCount.reduce((sum, value) => sum + value, 0) === 1 &&
        fullCount.reduce((sum, value) => sum + value, 0) === 1;
    }).toBe(true);
    await page.goto(partyPath);
    await expect(page.getByRole("heading", { name: "Players (8/8)" })).toBeVisible();

    stage = "sign-out";
    await page.goto("/host");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await page.goto(partyPath);
    await expect(page.getByLabel("Email address")).toBeVisible();
  } catch {
    // Playwright errors may contain URLs or DOM text; retain only a safe stage.
    throw new Error(`Local integration failed at: ${stage}`);
  } finally {
    await Promise.all(guestContexts.map((context) => context.close()));
  }
});
