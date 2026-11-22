import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// The local mail capture service (Mailpit in the current Supabase CLI) and
// GoTrue are disposable. Never include message bodies or links in test output.
async function signIn(page: Page) {
  const mailbox = `host-${randomUUID()}`;
  await page.goto("/host");
  await page.getByLabel("Email address").fill(`${mailbox}@example.test`);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
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
    const other = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    try {
      const otherPage = await other.newPage();
      await signIn(otherPage);
      await otherPage.goto(partyPath);
      await expect(otherPage.getByRole("heading", { name: "Host lobby" })).toBeVisible();
      await expect(otherPage.getByText("No players have joined yet.")).toHaveCount(0);
      await expect(otherPage.getByRole("button", { name: "Rotate invite" })).toHaveCount(0);
    } finally {
      await other.close();
    }

    const makeGuest = async (displayName: string, code: string) => {
      const context = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
      guestContexts.push(context);
      const guestPage = await context.newPage();
      await guestPage.goto("/join");
      await guestPage.getByLabel("Eight-character invitation code").fill(code);
      await guestPage.getByLabel("Your display name").fill(displayName);
      await guestPage.getByRole("button", { name: "Join party" }).click();
      return guestPage;
    };

    stage = "invite fragment and first guest admission";
    const guestContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    guestContexts.push(guestContext);
    const guestPage = await guestContext.newPage();
    const guestRequestUrls: string[] = [];
    guestPage.on("request", (request) => guestRequestUrls.push(request.url()));
    await guestPage.goto(joinLink.href);
    await expect(guestPage.getByLabel("Eight-character invitation code")).toHaveValue(code);
    await expect.poll(() => guestPage.evaluate(() => window.location.hash)).toBe("");
    await guestPage.getByLabel("Your display name").fill("Alex Guest");
    await guestPage.getByRole("button", { name: "Join party" }).click();
    await expect(guestPage.getByText("Your display name: Alex Guest")).toBeVisible();
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

    stage = "host-assisted session recovery";
    await alexRow.getByLabel("I have deliberately confirmed this guest’s identity out of band.").check();
    await alexRow.getByRole("button", { name: "Start guest recovery" }).click();
    const recoveryToken = await alexRow.getByTestId("recovery-credential").textContent();
    if (!recoveryToken) throw new Error("Recovery credential unavailable");
    const recoveredContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    guestContexts.push(recoveredContext);
    const recoveredPage = await recoveredContext.newPage();
    await recoveredPage.goto("/join");
    await recoveredPage.getByLabel("Recovery credential").fill(recoveryToken);
    await recoveredPage.getByRole("button", { name: "Recover membership" }).click();
    await expect(recoveredPage.getByText("Your display name: Alex Guest")).toBeVisible();
    await expect(recoveredPage.getByRole("button", { name: "Recover membership" })).toHaveCount(0);
    await guestPage.reload();
    await expect(guestPage.getByLabel("Eight-character invitation code")).toBeVisible();
    await guestPage.getByLabel("Eight-character invitation code").fill(code);
    await guestPage.getByLabel("Your display name").fill("Alex Guest");
    await guestPage.getByRole("button", { name: "Join party" }).click();
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
    await recoveredPage.getByRole("button", { name: "Join party" }).click();
    await expect(recoveredPage.getByText("That invitation could not be used. Check the code or ask the host for help.")).toBeVisible();
    const replacementPage = await makeGuest("Replacement", code);
    await expect(replacementPage.getByText("Your display name: Replacement")).toBeVisible();

    stage = "atomic last-slot concurrent admission";
    const fillers = [];
    for (let index = 1; index <= 6; index++) {
      fillers.push(await makeGuest(`Guest ${index}`, code));
    }
    const finalOneContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    const finalTwoContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    guestContexts.push(finalOneContext, finalTwoContext);
    const finalOne = await finalOneContext.newPage();
    const finalTwo = await finalTwoContext.newPage();
    for (const finalPage of [finalOne, finalTwo]) {
      await finalPage.goto("/join");
      await finalPage.getByLabel("Eight-character invitation code").fill(code);
      await finalPage.getByLabel("Your display name").fill("Last slot");
    }
    await Promise.all([
      finalOne.getByRole("button", { name: "Join party" }).click(),
      finalTwo.getByRole("button", { name: "Join party" }).click(),
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
