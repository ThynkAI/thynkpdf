import { chromium } from "@playwright/test";
const br=await chromium.launch(); const pg=await br.newPage();
pg.on("console",m=>{ if(m.type()==="error") console.log("CONSOLE",m.text().slice(0,300)); }); pg.on("pageerror",e=>console.log("PAGEERROR",e.message.slice(0,300)));
await pg.goto("http://localhost:3123/"); await pg.waitForTimeout(4000);
console.log((await pg.locator("body").innerText()).slice(0,300));
await pg.screenshot({path:"/workspace/thynkpdf-audit/docs/audit/evidence/v017-web-home-crash.png"});
await br.close();
