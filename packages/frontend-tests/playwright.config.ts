import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e", timeout: 60_000, retries: 0, reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 } }],
  webServer: { command: "pnpm --filter @thynkpdf/web build && pnpm --filter @thynkpdf/web start", url: "http://localhost:3000", reuseExistingServer: true, timeout: 240_000, cwd: "../.." },
});
