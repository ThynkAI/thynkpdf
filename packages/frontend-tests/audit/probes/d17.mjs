import { chromium } from "@playwright/test";
const E="/workspace/thynkpdf-audit/docs/audit/evidence/bc7ee6b/", F="/workspace/thynkpdf-audit/packages/frontend-tests/audit/fixtures/";
const b=await chromium.connectOverCDP("http://127.0.0.1:9334");
const pg=b.contexts()[0].pages()[0]; const base=new URL(pg.url()).origin; const out={};
await pg.goto(base+"/"); await pg.waitForTimeout(3000);
out.status=await pg.getByTestId("backend-status").innerText().catch(()=>null);
await pg.screenshot({path:E+"desktop017-01-first-launch.png"});
await pg.getByTestId("file-input").setInputFiles(F+"acroform-all.pdf"); await pg.waitForTimeout(4000);
out.version=await pg.getByTestId("version-id").innerText().catch(()=>null);
out.footer=await pg.locator("footer[role=status]").innerText();
out.formsArea=(await pg.getByTestId("form-fields").innerText().catch(()=>"(no form-fields)")).slice(0,200);
out.alerts1=(await pg.locator("[role=alert]").allInnerTexts()).filter(Boolean);
await pg.screenshot({path:E+"desktop017-02-open-acroform.png"});
const rq=pg.getByRole("button",{name:"Request signatures"}); await rq.scrollIntoViewIfNeeded(); out.reqEnabled=await rq.isEnabled();
if(out.reqEnabled){ await rq.click(); await pg.getByLabel("Signer 1 name").fill("Alice"); await pg.getByLabel("Signer 1 email").fill("alice@example.com"); await pg.getByRole("button",{name:/Create request for/}).click(); await pg.waitForTimeout(3000); out.req=(await pg.getByTestId("request-panel").innerText()).slice(0,500); await pg.getByTestId("request-panel").screenshot({path:E+"desktop017-03-request-signatures.png"}); }
// AI
await pg.getByLabel("Question about the document").fill("Name").catch(()=>{}); await pg.getByRole("button",{name:"Ask",exact:true}).click().catch(()=>{}); await pg.waitForTimeout(3000);
out.ai=(await pg.locator("section[aria-labelledby=ai-h]").innerText().catch(()=>"")).slice(0,500);
// Documents page
await pg.goto(base+"/documents/"); await pg.waitForTimeout(3000); out.docs=(await pg.locator("body").innerText()).slice(0,700);
await pg.screenshot({path:E+"desktop017-04-documents.png"});
console.log(JSON.stringify(out,null,1)); process.exit(0);
