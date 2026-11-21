import { chromium } from "@playwright/test";
const E="/workspace/thynkpdf-audit/docs/audit/evidence/", F="/workspace/thynkpdf-audit/packages/frontend-tests/audit/fixtures/";
const b=await chromium.connectOverCDP("http://127.0.0.1:9333");
const pg=b.contexts()[0].pages()[0];
const t0=Date.now(); await pg.reload(); await pg.getByText("What would you like to do?").waitFor(); console.log("home ms",Date.now()-t0);
// Documents
await pg.goto(pg.url().replace(/\/$/,"")+"/documents/"); await pg.waitForTimeout(2500);
await pg.screenshot({path:E+"desktop-02-documents-signin-wall.png"});
console.log("DOCS:",(await pg.locator("main, body").first().innerText()).slice(0,600));
// try register button presence
console.log("register-ui:", await pg.getByText(/create account|sign up|register/i).count());
// back home, open PDF locally
await pg.goto(pg.url().replace(/documents\/?$/,"")); await pg.getByText("What would you like to do?").waitFor();
await pg.locator('input[type=file]').first().setInputFiles(F+"mixed-rotated.pdf");
await pg.waitForTimeout(3000);
await pg.screenshot({path:E+"desktop-03-local-open-tools-disabled.png"});
const body=await pg.locator("body").innerText();
console.log("STATUS:", await pg.locator("footer[role=status]").innerText());
console.log(body.match(/Editing requires[^\n]*/g)?.length, "gate messages");
// try compress tool
for (const name of ["Compress","Forms","Merge & split"]) { const btn=pg.getByRole("button",{name:new RegExp("^"+name.replace("&","&"))}).first(); if (await btn.count()) { await btn.click().catch(()=>{}); await pg.waitForTimeout(800); console.log("--",name, (await pg.locator("aside, [role=complementary]").last().innerText().catch(()=>"")).slice(0,400)); } }
await pg.screenshot({path:E+"desktop-04-compress-local.png"});
process.exit(0);
