import { defineConfig } from "@playwright/test";

const integration = process.env.PLAYWRIGHT_LOCAL_SUPABASE === "1";
if (integration) process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

if (
  integration &&
  (process.env.APP_URL !== "http://127.0.0.1:3000" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321" ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY)
) {
  throw new Error("Integration tests require the disposable local Supabase environment.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: integration
    ? [["list"]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  workers: integration ? 1 : undefined,
  timeout: integration ? 90_000 : 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    trace: integration ? "off" : "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
  projects: integration ? [
    {
      name: "integration-desktop",
      testMatch: "**/*.integration.spec.ts",
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: "integration-mobile",
      testMatch: "**/*.integration.spec.ts",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ] : [
    {
      name: "desktop-chromium",
      testIgnore: "**/*.integration.spec.ts",
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: "mobile-chromium",
      testIgnore: "**/*.integration.spec.ts",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    stderr: integration ? "ignore" : "pipe",
    reuseExistingServer: !process.env.CI && !integration,
    timeout: 120_000,
  },
});
