import { chromium } from "@playwright/test";
const E="/workspace/thynkpdf-audit/docs/audit/evidence/";
const b=await chromium.connectOverCDP("http://127.0.0.1:9333");
const pg=b.contexts()[0].pages()[0];
console.log("URL",pg.url(), await pg.evaluate(()=>navigator.userAgent));
await pg.screenshot({path:E+"desktop-01-first-launch.png"});
console.log((await pg.locator("body").innerText()).slice(0,1500));
