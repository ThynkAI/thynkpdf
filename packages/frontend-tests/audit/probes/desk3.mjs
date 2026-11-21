import { chromium } from "@playwright/test";
const E="/workspace/thynkpdf-audit/docs/audit/evidence/", F="/workspace/thynkpdf-audit/packages/frontend-tests/audit/fixtures/";
const b=await chromium.connectOverCDP("http://127.0.0.1:9333");
const pg=b.contexts()[0].pages()[0]; const base=new URL(pg.url()).origin;
await pg.goto(base+"/"); await pg.getByText("What would you like to do?").waitFor();
const st=pg.getByTestId("backend-status"); console.log("backend-status:", await st.innerText().catch(()=>"n/a"));
if(!/Connected/.test(await st.innerText())){await pg.getByLabel("Username").first().fill("tester@example.com"); await pg.getByLabel("Password").first().fill("Audit-Pass-2026!");
await pg.getByRole("button",{name:"Sign in",exact:true}).first().click(); await pg.waitForTimeout(1500);}
console.log("after sign-in:", await st.innerText().catch(()=>"n/a"));
await pg.getByTestId("file-input").setInputFiles(F+"multifont.pdf"); await pg.waitForFunction(()=>/^v1/.test(document.querySelector("[data-testid=version-id]")?.textContent||""),null,{timeout:20000});
console.log("version", await pg.getByTestId("version-id").innerText());
// Share
const share=pg.getByRole("button",{name:"Create public view-only link"}); 
if(!(await share.isVisible().catch(()=>false))) { await pg.getByText("Share",{exact:false}).first().click().catch(()=>{}); }
await share.scrollIntoViewIfNeeded().catch(()=>{}); await share.click(); await pg.waitForTimeout(1500);
const panel=await pg.locator("body").innerText(); console.log("SHARE:", (panel.match(/https?:\/\/[^\s]*shared[^\s]*/)||["none"])[0]);
await share.screenshot({path:E+"tmp.png"}).catch(()=>{});
await pg.locator("text=/shared\\/\\?token/").first().scrollIntoViewIfNeeded().catch(()=>{});
await pg.screenshot({path:E+"desktop-05-share-link-localhost.png"});
// Request signatures
const rq=pg.getByText("Request signatures").first(); await rq.scrollIntoViewIfNeeded(); 
const area=rq.locator("xpath=ancestor::section[1]"); console.log("REQ panel:", (await area.innerText().catch(()=>"")).slice(0,500));
process.exit(0);
