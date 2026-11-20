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
