import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";

// Only the browser widget is emulated; local Supabase authentication remains real.
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

export async function configureTurnstile(context: BrowserContext) {
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/javascript", body: localTurnstileScript });
  });
}

export async function verifiedSubmit(page: Page, label: string) {
  const submit = page.getByRole("button", { name: label });
  await expect(submit, `Local form "${label}" did not become ready`).toBeEnabled({ timeout: 30_000 });
  await submit.click();
}

// Mailpit and GoTrue are disposable. Do not expose message bodies, URLs or tokens.
export async function requestMagicLink(page: Page) {
  const mailbox = `host-${randomUUID()}@example.test`;
  await page.goto("/host");
  await page.getByLabel("Email address").fill(mailbox);
  await verifiedSubmit(page, "Send sign-in link");
  await expect(page.getByText("If sign-in is available, check your email for a link.")).toBeVisible();

  let link: string | undefined;
  for (let attempt = 0; attempt < 30 && !link; attempt++) {
    try {
      const query = encodeURIComponent(`to:${mailbox}`);
      const inbox = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${query}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (inbox.ok) {
        const { messages } = await inbox.json() as { messages?: { ID: string }[] };
        if (messages?.length) {
          const message = await fetch(`http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(messages[0].ID)}`, {
            signal: AbortSignal.timeout(2000),
          });
          if (message.ok) {
            const data = await message.json() as { HTML?: string; Text?: string };
            link = (data.HTML || data.Text || "").match(
              /http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^"'\s<>]+/,
            )?.[0]?.replaceAll("&amp;", "&");
          }
        }
      }
    } catch {
      // Retry the local mail service, without exposing request URLs or contents.
    }
    if (!link) await page.waitForTimeout(1000);
  }
  if (!link) throw new Error("Local email was not received");
  try {
    const url = new URL(link);
    const redirect = new URL(url.searchParams.get("redirect_to") || "");
    if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/verify" ||
        redirect.origin !== "http://127.0.0.1:3000" || redirect.pathname !== "/auth/callback") {
      throw new Error();
    }
  } catch {
    throw new Error("Unexpected local auth link");
  }
  return link;
}

export async function signIn(page: Page) {
  const link = await requestMagicLink(page);
  try {
    await page.goto(link);
  } catch {
    throw new Error("Local auth navigation failed");
  }
  await expect(page.getByRole("button", { name: "Create a Blackwood Affair party" })).toBeVisible();
}
