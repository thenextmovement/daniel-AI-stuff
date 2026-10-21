import { chromium } from "playwright";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import type { DunningCaseSummary } from "../src/lib/ops/dunning";
import { buildDunningCases } from "../src/lib/ops/dunning";
type BuildInput = Parameters<typeof buildDunningCases>[0];

function order(
  overrides: Partial<BuildInput["orders"][number]> = {},
): BuildInput["orders"][number] {
  return {
    shopify_order_id: "1234567890",
    name: "#NEONT5000",
    financial_status: "pending",
    fulfillment_status: "fulfilled",
    total_price: 119,
    total_outstanding: 119,
    currency: "EUR",
    email: "kunde@example.com",
    kunde: "Max Muster",
    kunde_email: "kunde@example.com",
    tags: "",
    created_at: "2026-08-01T10:00:00.000Z",
    cancelled_at: null,
    ingested_at: "2026-08-01T10:05:00.000Z",
    ship_address: {
      company: "Muster GmbH",
      first_name: "Max",
      last_name: "Muster",
      city: "Viersen",
    },
    bill_address: {
      company: "Muster GmbH",
      first_name: "Max",
      last_name: "Muster",
      city: "Viersen",
    },
    phone: "+49 211 123456",
    ...overrides,
  };
}

function candidate(
  overrides: Partial<BuildInput["candidates"][number]> = {},
): BuildInput["candidates"][number] {
  return {
    shopify_order_id: "1234567890",
    shopify_order_name: "#NEONT5000",
    shopify_order_created_at: "2026-08-01T10:00:00.000Z",
    shopify_email_hint: "kunde@example.com",
    shopify_company_hint: "Muster GmbH",
    easybill_document_id: "88001",
    easybill_invoice_number: "2026-0815",
    easybill_document_created_at: "2026-08-01T11:00:00.000Z",
    easybill_due_date: "2026-08-15",
    amount_due_cents: 11900,
    currency: "EUR",
    preliminary_only: true,
    ...overrides,
  };
}

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    orders: [order()],
    statuses: [],
    sendlogs: [],
    locks: [],
    audits: [],
    messages: [],
    candidates: [candidate()],
    intakeFresh: true,
    now: new Date("2026-08-25T12:00:00.000Z"),
    ...overrides,
  };
}


async function main() {
const cases: DunningCaseSummary[]=[2024,2025,2026].map((year,index)=>({...buildDunningCases(input({orders:[order({created_at:`${year}-08-01T10:00:00Z`})]}))[0],key:`NEONT${5000+index}`,orderNumber:`#NEONT${5000+index}`}));
cases[0].orderCreatedAt = new Date(Date.now()-12*86400000).toISOString();
cases[0].offerNumber="A/N 15903";
cases[0].offerAdminUrl="/api/ops/customer-records/offers/test12345/admin";
cases[0].offerUrl="https://angebote.neontrip.de/offer/test12345";
const stats={total:3,open:3,actionRequired:0,replies:0,paused:0,finalReminderWaiting:0,courtReview:0,dataIssues:3,totalOutstandingCents:35700};
const dashboard={generatedAt:new Date().toISOString(),cases,stats,sendConfigured:false,sourceHealth:{intakeComplete:true,intakeFresh:true,historicalFresh:true,shopifyLive:true,bankFresh:true,bankComplete:true,shopifyMirrorFresh:true,candidateCount:3,bankCount:0,shopifyMirrorCount:3}};

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
page.setDefaultTimeout(10000);
const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
let holdAction=false, releaseAction: (()=>void)|undefined;
let holdDashboard=false, releaseDashboard: (()=>void)|undefined; let rejectAction=false;
const actions:any[]=[];
await page.route("**/api/ops/**",async route=>{
 const request=route.request(),path=new URL(request.url()).pathname;
 let payload:any={ok:true};
 if(path==="/api/ops/dunning") { if(holdDashboard) await new Promise<void>(resolve=>{releaseDashboard=resolve;});payload={ok:true,dashboard}; }
 else if(path.endsWith("/actions")) {
  const body=request.postDataJSON();actions.push(body);
  if(holdAction) await new Promise<void>(resolve=>{releaseAction=resolve;});
  if(rejectAction){await route.fulfill({status:503,json:{ok:false,error:"Speichern fehlgeschlagen"}});return;}
  const entry=cases.find(x=>path.includes(x.key))!;
  if(body.action==="nominate_court") {entry.courtNomination={id:body.idempotencyKey,actor:"Fabienne",at:new Date().toISOString()};payload={ok:true,nomination:entry.courtNomination};}
  if(body.action==="record_phone_call") {const call={id:body.idempotencyKey,actor:"Fabienne",at:new Date().toISOString(),note:body.note};entry.phoneCalls=[call];payload={ok:true,call};}
 }
 else if(path.startsWith("/api/ops/dunning/")){const entry=cases.find(x=>x.key===decodeURIComponent(path.split("/").pop()!))!;payload={ok:true,detail:{case:entry,timeline:[],courtProfile:null,courtDraftJob:null,generatedAt:new Date().toISOString()}};}
 await route.fulfill({status:200,json:payload});
});
console.log('await page.goto(');
await page.goto("http://127.0.0.1:3199/ops/mahnwesen",{waitUntil:"networkidle"});
await page.locator("summary").filter({hasText:"Weitere Filter"}).click();
assert.equal(await page.locator("tbody tr").count(),3);
cases[1].paused=true;cases[1].blockers=["Gesperrt: Rückruf vereinbart"];
cases[2].stopTag=true;cases[2].blockers=["Gesperrt: Shopify-Tag „Mahnstop“"];
await page.getByRole("button",{name:"Aktualisieren",exact:true}).click();
await page.waitForFunction(()=>document.querySelectorAll("tbody tr").length===1);
await page.getByLabel("Sperren anzeigen",{exact:true}).selectOption("blocked");
assert.equal(await page.locator("tbody tr").count(),2);
assert.ok(await page.getByText("Gesperrt: Rückruf vereinbart",{exact:true}).first().isVisible());
await page.getByLabel("Sperren anzeigen",{exact:true}).selectOption("shopify");
assert.equal(await page.locator("tbody tr").count(),1);
assert.ok(await page.getByText("Gesperrt: Shopify-Tag „Mahnstop“",{exact:true}).first().isVisible());
assert.ok(await page.getByRole("button",{name:"Gelber Brief",exact:true}).first().isDisabled());
await page.getByLabel("Sperren anzeigen",{exact:true}).selectOption("all");
console.log('const before=actions.length;');
const before=actions.length;
page.once("dialog",async dialog=>{assert.match(dialog.message(),/erst 12 Tage/);await dialog.dismiss();});
await page.getByRole("button",{name:"Gelber Brief",exact:true}).first().click();
assert.equal(actions.length,before);
console.log('// Confirmed writes');
// Confirmed writes must show immediately, even while a dashboard response is held.
holdDashboard=true;
page.once("dialog",dialog=>dialog.accept());
await page.getByRole("button",{name:"Gelber Brief",exact:true}).first().click();
await page.getByRole("status").filter({hasText:/vorgemerkt am/}).waitFor({timeout:1500});
assert.match(await page.getByRole("status").filter({hasText:/vorgemerkt am/}).innerText(),/Fabienne/);
assert.equal(await page.getByRole("status").filter({hasText:/vorgemerkt am/}).evaluate(el=>getComputedStyle(el.parentElement!).position),"fixed");
assert.equal(await page.locator("tbody tr").count(),0);
await page.getByLabel("Vorgemerkte gelbe Briefe ausblenden",{exact:true}).uncheck();
await page.getByRole("button",{name:"Vorgemerkt",exact:true}).first().waitFor({timeout:1500});
holdDashboard=false;releaseDashboard?.();
console.log('await page.getByRole("button",{name:"Anruf erfassen"');
await page.getByRole("button",{name:"Anruf erfassen",exact:true}).first().click();
await page.getByLabel("Gesprächsnotiz").fill("Kunde erreicht, Rückruf vereinbart");
holdDashboard=true;
holdAction=true;
await page.getByRole("button",{name:"Angerufen speichern",exact:true}).click();
await page.getByText("Aktion wird geprüft und gespeichert …",{exact:true}).waitFor();
await page.getByRole("button",{name:"Fall schließen",exact:true}).click();
await page.getByRole("button",{name:"Anruf erfassen",exact:true}).first().click();
assert.equal(await page.getByRole("button",{name:"Fall schließen",exact:true}).count(),0);
holdAction=false;releaseAction?.();
await page.getByRole("status").filter({hasText:/Anruf gespeichert am/}).waitFor({timeout:1500});
assert.equal(await page.getByText("Aktion wird geprüft und gespeichert …",{exact:true}).count(),0);
holdDashboard=false;releaseDashboard?.();
await page.getByRole("button",{name:"Anruf erfassen",exact:true}).first().click();
await page.getByText("Kunde erreicht, Rückruf vereinbart",{exact:true}).last().waitFor();
await page.getByRole("button",{name:"Fall schließen",exact:true}).click();
console.log('// Failure must');
// Failure must not invent a nomination.
cases[0].courtNomination=null;
await page.getByRole("button",{name:"Aktualisieren",exact:true}).click();
await page.getByRole("button",{name:"Gelber Brief",exact:true}).first().waitFor();
rejectAction=true;page.once("dialog",dialog=>dialog.accept());
await page.getByRole("button",{name:"Gelber Brief",exact:true}).first().click();
await page.getByText("Speichern fehlgeschlagen",{exact:true}).waitFor();
assert.equal(await page.getByRole("button",{name:"Vorgemerkt",exact:true}).count(),0);
rejectAction=false;
await page.getByLabel("Gesperrte Fälle ausblenden",{exact:true}).uncheck();
mkdirSync("artifacts/dunning-usability",{recursive:true});
console.log('for (const width');
for (const width of [1920,1600,1366,1280,1024,390]) {
 await page.setViewportSize({width,height:1000});
 await page.locator(width>=1280?"table":"article").first().scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,`page overflow ${width}`);
 if(width>=1280) assert.equal(await page.locator("table").evaluate(e=>e.scrollWidth>e.clientWidth),false,`table overflow ${width}`);
 await page.screenshot({path:`artifacts/dunning-usability/list-${width}.png`});
}
assert.deepEqual(errors,[]);
console.log("PASS: blocked/Shopify filters and reasons, 12-day warning/cancel, immediate confirmed nomination/call during slow refresh, failed save, six responsive widths");
await browser.close();
}
main().catch(error=>{console.error(error);process.exit(1);});
