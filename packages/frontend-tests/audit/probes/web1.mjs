import { chromium } from "@playwright/test";
const E="/workspace/thynkpdf-audit/docs/audit/evidence/", F="/workspace/thynkpdf-audit/packages/frontend-tests/audit/fixtures/", B="http://localhost:3123";
const br=await chromium.launch(); const ctx=await br.newContext({viewport:{width:1366,height:768}}); const pg=await ctx.newPage();
const out={};
await pg.goto(B+"/"); await pg.getByTestId("backend-status").waitFor();
await pg.waitForFunction(()=>/Online/.test(document.querySelector("[data-testid=backend-status]")?.textContent||""));
await pg.getByLabel("Username").fill("dev@thynkpdf.dev"); await pg.getByLabel("Password").fill("ThynkDev-2026!");
await pg.getByRole("button",{name:"Sign in",exact:true}).click();
await pg.waitForFunction(()=>/Connected/.test(document.querySelector("[data-testid=backend-status]")?.textContent||""));
async function up(f){ await pg.getByTestId("file-input").setInputFiles(F+f); await pg.waitForFunction(()=>/^v1 /.test(document.querySelector("[data-testid=version-id]")?.textContent||""),null,{timeout:30000}); await pg.waitForTimeout(800);}
// compress tiny
await up("tiny.pdf");
await pg.getByRole("button",{name:"Organize"}).click(); await pg.waitForTimeout(500);
await pg.getByTestId("compress-section").getByRole("button",{name:"Compress"}).click(); await pg.waitForTimeout(3000);
out.compressTiny=await pg.getByTestId("compress-result").innerText().catch(e=>"ERR "+e.message);
out.versionAfterCompress=await pg.getByTestId("version-id").innerText();
await pg.getByTestId("compress-section").screenshot({path:E+"web-compress-tiny.png"});
await pg.getByRole("button",{name:"Close organizer"}).click().catch(()=>{});
// text edit
await up("multifont.pdf");
const fe=pg.getByLabel("Find text"); const rp=pg.getByLabel("Replacement text");
async function edit(a,b){ await fe.fill(a); await rp.fill(b); await pg.getByRole("button",{name:"Replace",exact:true}).click(); await pg.waitForTimeout(2500);
 return {res:await pg.getByTestId("text-edit-result").innerText().catch(()=>null), err:await pg.locator("[role=alert]").allInnerTexts(), ver:await pg.getByTestId("version-id").innerText()}; }
out.editSimple=await edit("quick brown fox","slow red cat");
out.editLonger=await edit("Courier","Courier-with-a-much-much-longer-replacement-string-that-overflows");
out.editMultiRun=await edit("SplitRun","Joined");
out.editUnicode=await edit("Times-Roman","Ünïcödé 你好");
await pg.screenshot({path:E+"web-text-edit-results.png"});
console.log(JSON.stringify(out,null,1));
await br.close();
