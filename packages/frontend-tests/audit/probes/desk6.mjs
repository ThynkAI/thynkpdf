import { chromium } from "@playwright/test";
const F="/workspace/thynkpdf-audit/packages/frontend-tests/audit/fixtures/";
const b=await chromium.connectOverCDP("http://127.0.0.1:9333");
const pg=b.contexts()[0].pages()[0]; await pg.waitForTimeout(3000);
if (process.argv[2]==="save") {
  await pg.getByTestId("file-input").setInputFiles(F+"multifont.pdf"); await pg.waitForTimeout(3000);
  const o=pg.getByRole("button",{name:/Create signature|Change signature/}).first(); await o.scrollIntoViewIfNeeded(); await o.click();
  await pg.getByRole("tab",{name:"Type"}).click(); await pg.getByLabel("Type your name").fill("Persist Test"); await pg.getByRole("button",{name:"Use signature"}).click(); await pg.waitForTimeout(1000);
  await pg.evaluate(()=>{localStorage.setItem("tp-theme","dark")});
}
console.log(pg.url(), "saved-sigs:", await pg.getByTestId("saved-sigs").count(), await pg.evaluate(async()=>{const dbs=await indexedDB.databases();return JSON.stringify(dbs)+" theme="+localStorage.getItem("tp-theme")}));
process.exit(0);
