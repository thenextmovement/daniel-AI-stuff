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
cases[0].offerNumber="A/N 15903";
cases[0].offerAdminUrl="/api/ops/customer-records/offers/test12345/admin";
cases[0].offerUrl="https://angebote.neontrip.de/offer/test12345";
const stats={total:3,open:3,actionRequired:0,replies:0,paused:0,finalReminderWaiting:0,courtReview:0,dataIssues:3,totalOutstandingCents:35700};
const dashboard={generatedAt:new Date().toISOString(),cases,stats,sendConfigured:false,sourceHealth:{intakeComplete:true,intakeFresh:true,historicalFresh:true,shopifyLive:true,bankFresh:true,bankComplete:true,shopifyMirrorFresh:true,candidateCount:3,bankCount:0,shopifyMirrorCount:3}};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1000},permissions:["clipboard-read","clipboard-write"]});
await context.addCookies([{name:"neontrip_ops_session",value:createHash("sha256").update("neontrip:ops:isolated-preview-only").digest("hex"),url:"http://127.0.0.1:3198"}]);
let failDetail=false; let holdDetail=false; let releaseDetail: (()=>void)|null=null;
const page=await context.newPage(); page.setDefaultTimeout(10000); const errors:string[]=[]; const actions:any[]=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/ops/**",async route=>{
 const request=route.request(), path=new URL(request.url()).pathname;
 let payload:any={ok:true};
 if(path==="/api/ops/dunning") payload={ok:true,dashboard};
 else if(path.endsWith("/actions")){const body=request.postDataJSON();actions.push(body);if(body.action==="nominate_court") cases[0].courtNomination={id:body.idempotencyKey,actor:"Fabienne",at:new Date().toISOString()};payload={ok:true};}
 else if(path.startsWith("/api/ops/dunning/")){if(failDetail){await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"Fallakte vorübergehend nicht verfügbar"})});return;}if(holdDetail) await new Promise<void>(resolve=>{releaseDetail=resolve;});const entry=cases.find(x=>x.key===decodeURIComponent(path.split("/").pop()!))||cases[0];payload={ok:true,detail:{case:entry,timeline:[],courtProfile:null,courtDraftJob:null,generatedAt:new Date().toISOString()}};}
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(payload)});
});
await page.goto("http://127.0.0.1:3198/ops/mahnwesen",{waitUntil:"networkidle"});
assert.equal(await page.getByLabel("Bestelljahr",{exact:true}).isVisible(),false,"Year is inside collapsed advanced filters");
holdDetail=true;
await page.getByRole("button",{name:/^(Nächste Stufe|Details|Prüfung öffnen)$/}).first().click();
await page.getByRole("dialog").waitFor({timeout:800});
assert.ok(await page.getByText("Aktuelle Fallakte wird geladen …",{exact:true}).isVisible());
assert.equal(await page.getByRole("button",{name:"Angerufen speichern",exact:true}).count(),0);
await page.getByRole("button",{name:"Fall schließen",exact:true}).click();
holdDetail=false; if(releaseDetail) (releaseDetail as ()=>void)();
await page.waitForTimeout(200);
assert.equal(await page.getByRole("dialog").count(),0,"Late response must not reopen a closed drawer");
failDetail=true;
await page.getByRole("button",{name:/^(Nächste Stufe|Details|Prüfung öffnen)$/}).first().click();
await page.getByRole("button",{name:"Erneut laden",exact:true}).waitFor();
assert.equal(await page.getByRole("button",{name:"Angerufen speichern",exact:true}).count(),0);
failDetail=false;
await page.getByRole("button",{name:"Erneut laden",exact:true}).click();
await page.getByLabel("Gesprächsnotiz").waitFor();
await page.getByRole("button",{name:"Fall schließen",exact:true}).click();
await page.locator("summary").filter({hasText:"Weitere Filter"}).click();
assert.equal(await page.getByLabel("Erstellte/eingereichte Mahnanträge ausblenden").isChecked(),true);
assert.equal(await page.getByLabel("Gesperrte Fälle ausblenden",{exact:true}).isChecked(),true);
assert.equal(await page.getByLabel("Vorgemerkte gelbe Briefe ausblenden",{exact:true}).isChecked(),true);
const year=page.locator("label").filter({has:page.locator("span",{hasText:/^Bestelljahr$/})}).locator("select"); await year.waitFor();
for(const value of ["2024","2025","2026"]){await year.selectOption(value);assert.equal(await page.locator("tbody tr").count(),1);}
await year.selectOption("all"); assert.equal(await page.locator("tbody tr").count(),3);
await page.getByRole("button",{name:"Telefonnummer +49 211 123456 kopieren"}).first().click();
assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),"+49 211 123456");
await page.evaluate(`Object.defineProperty(navigator.clipboard,"writeText",{configurable:true,value:async()=>{throw new Error("denied");}})`);
await page.getByRole("button",{name:"Telefonnummer +49 211 123456 kopieren"}).first().click();
assert.ok(await page.getByText("Kopieren nicht möglich – Nummer bitte markieren",{exact:true}).first().isVisible());
await page.getByRole("button",{name:"+1 Woche",exact:true}).first().click();
await page.waitForTimeout(300);assert.equal(actions.at(-1)?.action,"pause_dunning");assert.equal(actions.at(-1)?.pauseMode,"until_date");
const one=Date.parse(actions.at(-1).pauseUntil);assert.ok(one>Date.now()+6*86400000 && one<Date.now()+8*86400000);
await page.getByRole("button",{name:"Fall schließen",exact:true}).click();
await page.getByRole("button",{name:"+2 Wochen",exact:true}).first().click();await page.waitForTimeout(300);
const two=Date.parse(actions.at(-1).pauseUntil);assert.ok(two>Date.now()+13*86400000 && two<Date.now()+15*86400000);
await page.getByRole("button",{name:"Fall schließen",exact:true}).click();
assert.equal(await page.getByRole("link",{name:"#NEONT5000",exact:true}).first().getAttribute("href"),"https://admin.shopify.com/store/galaxybuzzdk/orders/1234567890");
assert.equal(await page.getByRole("link",{name:"Angebot A/N 15903",exact:true}).first().getAttribute("href"),"/api/ops/customer-records/offers/test12345/admin");
assert.ok(await page.getByText("Kein Angebot zugeordnet",{exact:true}).count() > 0);
const countBefore=actions.length;
page.once("dialog",dialog=>dialog.dismiss());
await page.getByRole("button",{name:"Gelber Brief",exact:true}).first().click();
assert.equal(actions.length,countBefore,"Cancel has no write");
page.once("dialog",dialog=>{assert.match(dialog.message(),/kein Antrag erstellt oder versandt/);void dialog.accept();});
await page.getByRole("button",{name:"Gelber Brief",exact:true}).first().click();
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length===2);
assert.equal(actions.at(-1)?.action,"nominate_court");
assert.ok(!actions.some(a=>["prepare_court_application","send_next_stage"].includes(a.action)));
await page.reload({waitUntil:"networkidle"});
assert.equal(await page.locator("tbody tr").count(),2);
await page.locator("summary").filter({hasText:"Weitere Filter"}).click();
await page.getByLabel("Vorgemerkte gelbe Briefe ausblenden",{exact:true}).uncheck();
assert.equal(await page.locator("tbody tr").count(),3);
await page.getByRole("button",{name:"Vorgemerkt",exact:true}).first().waitFor();
assert.equal(await page.getByLabel("Erstellte/eingereichte Mahnanträge ausblenden").isChecked(),true);
mkdirSync("artifacts/dunning-actions",{recursive:true});
await page.locator("table").scrollIntoViewIfNeeded();
await page.screenshot({path:"artifacts/dunning-actions/nomination-list.png",fullPage:false});
await page.getByRole("button",{name:/^(Nächste Stufe|Details|Prüfung öffnen)$/}).first().click();
await page.getByLabel("Gesprächsnotiz").fill("Kunde erreicht, Rückruf vereinbart");
await page.getByRole("button",{name:"Angerufen speichern",exact:true}).click();
await page.waitForTimeout(300); assert.equal(actions.at(-1).action,"record_phone_call");
assert.equal(actions.at(-1).note,"Kunde erreicht, Rückruf vereinbart");
assert.match(actions.at(-1).idempotencyKey,/^[a-f0-9-]{36}$/);
mkdirSync("artifacts/dunning-actions",{recursive:true});
await page.screenshot({path:"artifacts/dunning-actions/desktop.png",fullPage:false});
await page.setViewportSize({width:390,height:844}); await page.screenshot({path:"artifacts/dunning-actions/mobile.png",fullPage:false});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
await page.getByRole("button",{name:"Fall schließen",exact:true}).click();
cases[0].paused=true; cases[1].stopTag=true;
await page.getByRole("button",{name:"Aktualisieren",exact:true}).click();await page.waitForTimeout(300);
assert.equal(await page.locator("article").count(),1,"Held cases hidden by default");
await page.getByLabel("Gesperrte Fälle ausblenden",{exact:true}).uncheck();
const cards=page.locator("button").filter({hasText:/^\+1 Woche$/});
const disabled=await cards.evaluateAll(buttons=>buttons.filter(b=>(b as HTMLButtonElement).disabled).length);
assert.ok(disabled>=2,"existing pauses and stop tags disable quick pauses");
await page.locator("article").first().scrollIntoViewIfNeeded();
await page.screenshot({path:"artifacts/dunning-actions/mobile-list.png",fullPage:false});
cases[0].paused=false; cases[1].stopTag=false;
cases[1].courtEvents=[{id:"court-test",orderNumber:cases[1].orderNumber,eventKey:"draft",eventType:"application_draft_created",eventLabel:"Entwurf",occurredOn:"2026-08-20",sourceReference:null,actor:"Test",note:null,createdAt:"2026-08-20T10:00:00Z"}];
await page.getByRole("button",{name:"Aktualisieren",exact:true}).click();
await page.getByRole("button",{name:"Zurücksetzen",exact:true}).click();
await page.waitForTimeout(300);
assert.equal(await page.locator("article").count(),1,"Reset hides nominations and draft applications");
for(const label of ["Vorgemerkte gelbe Briefe ausblenden","Erstellte/eingereichte Mahnanträge ausblenden","Gesperrte Fälle ausblenden"])
  assert.equal(await page.getByLabel(label,{exact:true}).isChecked(),true);
await page.getByLabel("Vorgemerkte gelbe Briefe ausblenden",{exact:true}).uncheck();
assert.equal(await page.locator("article").count(),2,"Unhiding nominations keeps court drafts hidden");
await page.getByLabel("Erstellte/eingereichte Mahnanträge ausblenden",{exact:true}).uncheck();
assert.equal(await page.locator("article").count(),3,"Both independently restored");
await page.getByRole("button",{name:"Zurücksetzen",exact:true}).click();
await page.locator("summary").filter({hasText:"Weitere Filter"}).scrollIntoViewIfNeeded();
await page.screenshot({path:"artifacts/dunning-actions/filter-defaults.png",fullPage:false});
assert.deepEqual(errors,[]);console.log("PASS: immediate drawer during held response, close ignores late result, failure/retry without actions, default hidden nominations/held cases, 2024/2025/2026, clipboard, one/two-week payloads, nomination confirmation/cancellation/persistence/filter and Shopify/offer links, mobile overflow, no runtime errors");
await browser.close();

}
main().catch(error=>{console.error(error);process.exit(1);});
