import { defineConfig, devices } from "@playwright/test";
/** Audit suite (docs/audit). Needs a REAL backend + web build already running:
 *  THYNKPDF_API_URL=http://localhost:8123  AUDIT_WEB_URL=http://localhost:3123  npx playwright test -c audit/audit.config.ts
 *  Tests marked test.fail() are KNOWN-FAILING reproductions of confirmed defects (they pass while the defect exists). */
export default defineConfig({
  testDir: ".", testMatch: /.*\.audit\.spec\.ts/, timeout: 120_000, retries: 0, workers: 1,
  reporter: [["list"], ["json", { outputFile: `../../../docs/audit/evidence/audit-results-${process.env.AUDIT_COMMIT?.slice(0,7) ?? "x"}.json` }]],
  use: { baseURL: process.env.AUDIT_WEB_URL ?? "http://localhost:3123", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } }],
});
