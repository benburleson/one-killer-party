import { expect, test } from "@playwright/test";

test("landing page displays the existing headline", async ({ page }, testInfo) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("landing-page.png"),
    fullPage: true,
  });

  await expect(
    page.getByRole("heading", { name: "Everyone's a suspect." }),
  ).toBeVisible();
});

test("landing page exposes branded metadata and favicon", async ({ page }) => {
  await page.goto("/");

  const description =
    "Host an unforgettable murder mystery party. Bring your guests together for a night of secrets, suspects, and surprises.";
  await expect(page).toHaveTitle("One Killer Party");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", description);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://app.onekillerparty.com",
  );
  for (const [property, content] of [
    ["og:title", "One Killer Party"],
    ["og:description", description],
    ["og:url", "https://app.onekillerparty.com"],
    ["og:site_name", "One Killer Party"],
    ["og:type", "website"],
  ]) {
    await expect(page.locator(`meta[property="${property}"]`)).toHaveAttribute("content", content);
  }
  for (const [name, content] of [
    ["twitter:card", "summary"],
    ["twitter:title", "One Killer Party"],
    ["twitter:description", description],
  ]) {
    await expect(page.locator(`meta[name="${name}"]`)).toHaveAttribute("content", content);
  }
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(icon).toHaveAttribute("href", /^\/icon\.svg/);
  const href = await icon.getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  await expect(page.locator('link[rel="icon"][href*="favicon.ico"]')).toHaveCount(0);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /^\/apple-icon\.png/,
  );
});
