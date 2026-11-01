import { chromium } from "@playwright/test";
const E="/workspace/thynkpdf-audit/docs/audit/evidence/bc7ee6b/";
const b=await chromium.connectOverCDP("http://127.0.0.1:9334");
const pg=b.contexts()[0].pages()[0]; const base=new URL(pg.url()).origin;
await pg.goto(base+"/"); await pg.waitForTimeout(3000);
await pg.getByTestId("file-input").setInputFiles("/workspace/thynkpdf-audit/packages/frontend-tests/audit/fixtures/acroform-all.pdf"); await pg.waitForTimeout(4000);
const a=pg.locator("[role=alert]").filter({hasText:/HTTP_404/}).first(); await a.scrollIntoViewIfNeeded(); await pg.screenshot({path:E+"desktop017-05-forms-raw-404.png"});
process.exit(0);
