import { expect, test } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

const dummyToken = "DUMMY.PUBLISHER.TOKEN";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copied: string }).copied = value;
        },
      },
    });
  });
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.widgets = []; window.turnstile = {
        render: function (target, options) { window.widgets.push(options); return String(window.widgets.length - 1); },
        remove: function (id) { window.lastRemoved = id; },
        reset: function () {}
      };`,
    }),
  );
});

test("copies only after an explicit action and invalidates on expiry, reset, and cancellation", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url() + (request.postData() ?? "")));
  await page.goto("/publisher-verification");
  await expect(page.getByRole("heading", { name: "Publisher verification" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
  await page.getByRole("button", { name: "Start challenge", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { widgets?: unknown[] }).widgets?.length === 1);
  const options = await page.evaluate(() => {
    const widget = (window as unknown as { widgets: Record<string, unknown>[] }).widgets[0];
    return { action: widget.action, responseField: widget["response-field"], sitekey: widget.sitekey };
  });
  expect(options).toMatchObject({ action: "publisher_login", responseField: false });
  expect(options.sitekey).toBeTruthy();
  await page.evaluate((value) => {
    const widget = (window as unknown as { widgets: { callback: (v: string) => void }[] }).widgets[0];
    widget.callback(value);
  }, dummyToken);
  await expect(page.getByRole("button", { name: "Copy token" })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBeUndefined();
  expect(await page.locator("body").innerText()).not.toContain(dummyToken);
  expect(await page.locator("input").count()).toBe(0);
  expect(page.url()).not.toContain(dummyToken);
  await page.getByRole("button", { name: "Copy token" }).click();
  expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe(dummyToken);
  await expect(page.getByRole("status")).toContainText("Token copied");

  await page.evaluate(() => {
    const widget = (window as unknown as { widgets: { "expired-callback": () => void }[] }).widgets[0];
    widget["expired-callback"]();
  });
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("expired");
  await page.getByRole("button", { name: "Start new challenge" }).click();
  await page.waitForFunction(() => (window as unknown as { widgets: unknown[] }).widgets.length === 2);
  expect(await page.evaluate(() => (window as unknown as { lastRemoved: string }).lastRemoved)).toBe("0");
  await page.evaluate((value) => {
    const widgets = (window as unknown as { widgets: { callback: (v: string) => void }[] }).widgets;
    widgets[0].callback(value);
  }, dummyToken);
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
  await page.evaluate((value) => {
    const widgets = (window as unknown as { widgets: { callback: (v: string) => void }[] }).widgets;
    widgets[1].callback(value);
  }, dummyToken);
  await expect(page.getByRole("button", { name: "Copy token" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel challenge" }).click();
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("cancelled");
  expect(await page.evaluate(() => (window as unknown as { lastRemoved: string }).lastRemoved)).toBe("1");
  expect(requests.some((request) => request.includes(dummyToken))).toBe(false);
  expect(requests.some((request) => /\/_vercel\/(insights|speed-insights)/.test(request))).toBe(false);
});

test("clipboard failure and challenge errors do not reveal a token", async ({ page }) => {
  await page.goto("/publisher-verification");
  await page.getByRole("button", { name: "Start challenge", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { widgets?: unknown[] }).widgets?.length === 1);
  await page.evaluate((value) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    (window as unknown as { widgets: { callback: (v: string) => void }[] }).widgets[0].callback(value);
  }, dummyToken);
  await page.getByRole("button", { name: "Copy token" }).click();
  await expect(page.getByRole("status")).toContainText("Copy failed");
  expect(await page.locator("body").innerText()).not.toContain(dummyToken);
  await page.evaluate(() => {
    (window as unknown as { widgets: { "error-callback": () => boolean }[] }).widgets[0]["error-callback"]();
  });
  await expect(page.getByRole("status")).toContainText("Verification failed");
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
});

test("local expiry and unavailable clipboard fail closed", async ({ page }) => {
  await page.clock.install();
  await page.goto("/publisher-verification");
  await page.getByRole("button", { name: "Start challenge", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { widgets?: unknown[] }).widgets?.length === 1);
  await page.evaluate((value) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    (window as unknown as { widgets: { callback: (v: string) => void }[] }).widgets[0].callback(value);
  }, dummyToken);
  await page.getByRole("button", { name: "Copy token" }).click();
  await expect(page.getByRole("status")).toContainText("Secure clipboard access is unavailable");
  expect(await page.locator("body").innerText()).not.toContain(dummyToken);
  await page.clock.fastForward("04:01");
  await expect(page.getByRole("status")).toContainText("expired");
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
});

test("script load failure offers a safe recovery", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.abort());
  await page.goto("/publisher-verification");
  await page.getByRole("button", { name: "Start challenge", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("reload this page");
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
});

test("cancellation during a clipboard request invalidates the challenge", async ({ page }) => {
  await page.goto("/publisher-verification");
  await page.getByRole("button", { name: "Start challenge", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { widgets?: unknown[] }).widgets?.length === 1);
  await page.evaluate((value) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => new Promise<void>((resolve) => {
        (window as unknown as { finishCopy: () => void }).finishCopy = resolve;
      }) },
    });
    (window as unknown as { widgets: { callback: (v: string) => void }[] }).widgets[0].callback(value);
  }, dummyToken);
  await page.getByRole("button", { name: "Copy token" }).click();
  await page.getByRole("button", { name: "Cancel challenge" }).click();
  await expect(page.getByRole("status")).toContainText("pending clipboard request may still finish");
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  await expect(page.getByRole("status")).toContainText("Challenge cancelled");
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
});

test("expiry during a clipboard request warns that the write may still finish", async ({ page }) => {
  await page.goto("/publisher-verification");
  await page.getByRole("button", { name: "Start challenge", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { widgets?: unknown[] }).widgets?.length === 1);
  await page.evaluate((value) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => new Promise<void>((resolve) => {
        (window as unknown as { finishCopy: () => void }).finishCopy = resolve;
      }) },
    });
    (window as unknown as { widgets: { callback: (v: string) => void }[] }).widgets[0].callback(value);
  }, dummyToken);
  await page.getByRole("button", { name: "Copy token" }).click();
  await page.evaluate(() => (window as unknown as { widgets: { "expired-callback": () => void }[] }).widgets[0]["expired-callback"]());
  await expect(page.getByRole("status")).toContainText("expired");
  await expect(page.getByRole("status")).toContainText("pending clipboard request may still finish");
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  await expect(page.getByRole("status")).toContainText("expired");
  await expect(page.getByRole("button", { name: "Copy token" })).toBeDisabled();
});
