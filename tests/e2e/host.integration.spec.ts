import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

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
    await expect(page.getByText("No guests yet")).toBeVisible();
    await page.reload();
    await expect(page.getByText("No guests yet")).toBeVisible();
    await page.reload();
    await expect(page.getByText("No guests yet")).toBeVisible();
    await expect(page.getByRole("region", { name: "New invite" })).toHaveCount(0);

    stage = "host B isolation";
    const other = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    try {
      const otherPage = await other.newPage();
      await signIn(otherPage);
      await otherPage.goto(partyPath);
      await expect(otherPage.getByRole("heading", { name: "Host lobby" })).toBeVisible();
      await expect(otherPage.getByText("No guests yet")).toHaveCount(0);
      await expect(otherPage.getByRole("button", { name: "Rotate invite" })).toHaveCount(0);
    } finally {
      await other.close();
    }

    stage = "sign-out";
    await page.goto("/host");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await page.goto(partyPath);
    await expect(page.getByLabel("Email address")).toBeVisible();
  } catch {
    // Playwright errors may contain URLs or DOM text; retain only a safe stage.
    throw new Error(`Local integration failed at: ${stage}`);
  }
});
