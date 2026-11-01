import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../e2e", timeout: 60_000, retries: 0, reporter: "list",
  use: { baseURL: "http://localhost:3123", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 }, testIgnore: /responsive\.spec\.ts/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /(viewer|a11y|shell)\.spec\.ts/ },
    // WebKit needs host libraries (`npx playwright install-deps webkit`); this box's apt mirror failed, so it is opt-in.
    ...(process.env.PW_WEBKIT ? [{ name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: /(viewer|a11y|shell)\.spec\.ts/ }] : []),
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(responsive|a11y)\.spec\.ts/ },
  ],
  webServer: { command: "pnpm --filter @thynkpdf/web build && pnpm --filter @thynkpdf/web start", url: "http://localhost:3123", reuseExistingServer: true, timeout: 240_000, cwd: "../../.." },
});
