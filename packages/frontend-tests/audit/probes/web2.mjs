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
await up("acroform-all.pdf");
out.formsBtns=await pg.getByRole("button",{name:/^Forms/}).allInnerTexts(); await pg.getByRole("button",{name:/^Forms/}).first().click().catch(()=>{}); await pg.waitForTimeout(1500);
const ff=pg.getByTestId("form-fields"); await ff.waitFor({timeout:10000}).catch(()=>{});
out.fieldsUI=(await ff.innerText().catch(()=>"none")).replace(/\n/g," / ");
await pg.getByLabel("name",{exact:true}).fill("Jane Q Tester").catch(e=>out.e1=e.message);
await pg.getByLabel("agree",{exact:true}).check().catch(e=>out.e2=e.message);
await pg.getByLabel("color",{exact:true}).selectOption("blue").catch(e=>out.e3=e.message);
await pg.getByLabel("country",{exact:true}).selectOption("Mexico").catch(e=>out.e4=e.message);
await pg.getByLabel("notes",{exact:true}).fill("line1 line2").catch(e=>out.e5=e.message);
out.notesTag=await pg.getByLabel("notes",{exact:true}).evaluate(e=>e.tagName).catch(()=>null);
await ff.screenshot({path:E+"web-forms-panel.png"}).catch(()=>{});
out.organizerOpenAfterFormsClick=await pg.getByRole("button",{name:"Close organizer"}).isVisible(); await pg.keyboard.press("Escape"); out.organizerAfterEsc=await pg.getByRole("button",{name:"Close organizer"}).isVisible(); if(out.organizerAfterEsc) await pg.getByRole("button",{name:"Close organizer"}).click(); await ff.getByRole("button",{name:/Save values/}).click(); await pg.waitForTimeout(2500);
out.formVer=await pg.getByTestId("version-id").innerText();
// AI on scanned
await up("scanned.pdf");
await pg.getByRole("button",{name:/^Ask AI/}).first().click().catch(()=>{}); await pg.waitForTimeout(800);
out.aiMode=await pg.getByTestId("ai-mode").innerText().catch(()=>null);
out.consent=await pg.getByTestId("consent-text").innerText().catch(()=>null);
await pg.getByLabel("Question about the document").fill("What is the invoice total?"); await pg.getByRole("button",{name:"Ask",exact:true}).click(); await pg.waitForTimeout(2500);
out.aiScanned=(await pg.getByTestId("ai-answer").innerText().catch(()=>"(no answer block)")) + " ALERTS:" + (await pg.locator("[role=alert]").allInnerTexts()).join("|");
await pg.screenshot({path:E+"web-ai-scanned.png"});
// AI on large
await up("large-320.pdf");
await pg.getByLabel("Question about the document").fill("needle-unique-word").catch(()=>{}); await pg.getByRole("button",{name:"Ask",exact:true}).click().catch(()=>{}); await pg.waitForTimeout(3000);
out.aiLarge=(await pg.getByTestId("ai-answer").innerText().catch(()=>"none")).slice(0,400);
out.homeTile=await pg.evaluate(()=>[...document.querySelectorAll("button,a")].map(b=>b.textContent.trim()).filter(t=>/AI/.test(t)));
console.log(JSON.stringify(out,null,1)); await br.close();
