import { chromium } from "@playwright/test";
const E="/workspace/thynkpdf-audit/docs/audit/evidence/";
const b=await chromium.connectOverCDP("http://127.0.0.1:9333");
const pg=b.contexts()[0].pages()[0]; await pg.waitForTimeout(6000);
console.log(JSON.stringify({url:pg.url(), ls:await pg.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k).slice(0,80)]))), status:await pg.getByTestId("backend-status").innerText().catch(()=>null), page:await pg.getByTestId("status-page").innerText().catch(()=>null), ver: await pg.getByTestId("version-id").innerText().catch(()=>null)}));
await pg.screenshot({path:E+process.argv[2]});
process.exit(0);
