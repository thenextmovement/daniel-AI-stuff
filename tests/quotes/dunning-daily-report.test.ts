
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {createRequire} from "node:module";
const {DateTime}=createRequire(import.meta.url)("luxon");

const code = readFileSync(new URL("../../workflows/dunning/daily-35-day-reconciliation.js", import.meta.url), "utf8");
const alertCode = readFileSync(new URL("../../workflows/dunning/daily-35-day-alert.js", import.meta.url), "utf8");
function fixture(stage = 4, modern = true) {
  const sentAt = "2026-10-14T14:20:27Z";
  const page = (body: any[]) => [{ statusCode: 200, headers: { "content-range": "0-0/" + body.length }, body }];
  const o = { name: "#NEONT4581", legacyResourceId: "8439288856843", createdAt: "2026-07-01T08:00:00Z", cancelledAt: null, displayFinancialStatus: "PENDING", currentTotalPriceSet: { shopMoney: { amount: "1342.32", currencyCode: "EUR" } }, totalOutstandingSet: { shopMoney: { amount: "1342.32", currencyCode: "EUR" } }, email: "kunde@example.com", tags: [], billingAddress: { company: "Testkunde" } };
  const f: Record<string, any[]> = {
    "Read Daily Intake Snapshot": [{statusCode:200,body:[{status:"success",metadata:{source_complete:true,observed_at:"2026-10-16T09:30:00Z",fresh_until:"2026-10-16T11:00:00Z",candidates:[{shopify_order_id:"8439288856843"}]}}]}],
    "Read Summary": [{ bank: [], shopify: { open: [o], orders: [o], total: 1, pages: 1, cutoff: "2026-09-10" }, invoices: [{ order_number: "#NEONT4581", type: "INVOICE" }], proformas: [] }],
    "Read Daily Dunning States": page([{ shopify_order_number: "#NEONT4581", mahnstufe: stage, last_sent_at: sentAt, next_due_at: "2026-10-21", paused: false, note: "Manuelle Notiz" }]),
    "Read Daily Reminder Logs": page(modern ? [] : [{ shopify_order_number: "#NEONT4581", mahnstufe: stage, sent_at: sentAt, status: "sent", subject: "Letzte Mahnung vor Inkasso" }]),
    "Read Daily Verified Stages": page(modern ? [{ document_id: "8439288856843", metadata: { stage, provider_message_id: "sent-1", sent_at: sentAt, evidence_schema: "t099.sender.evidence.v1" } }] : []),
    "Read Daily Mail Evidence": page([]),
    "Read Daily Sender Issues": page([]),
  };
  return f;
}
function run(f: Record<string, any[]>) {
  class Clock extends Date {
    constructor(value?: any) { super(value === undefined ? "2026-10-16T10:00:00Z" : value); }
  }
  const $ = (name: string) => ({ first: () => ({ json: f[name]![0] }), all: () => f[name]!.map(json => ({ json })) });
  return new Function("$", "Date", "DateTime", code)($, Clock, DateTime)[0].json;
}
function report(r: any) {
  return new Function("$", alertCode)((name: string) => ({ first: () => ({ json: name === "Build Daily OPS Reconciliation" ? r : { audit_id: "test-audit" } }) }));
}

for (const [stage, label] of [[4, "1. Mahnung"], [5, "2. Mahnung"]] as const) {
  test(`daily report does not label modern S${stage} as final and exposes its deadline to OPS`, () => {
    const r = run(fixture(stage));
    const c = r.audit_record.metadata.cases[0];
    assert.equal(c.status, "reminder_evidenced");
    assert.equal(c.stage_source, "t099");
    assert.equal(c.stage_label, label);
    assert.equal(c.next_due_at, "2026-10-21");
    assert.match(r.note_rows[0].note, new RegExp(label));
    assert.match(r.note_rows[0].note, /2026-10-21/);
    assert.deepEqual(report(r), []);
    assert.match(r.note_rows[0].note, /Manuelle Notiz/);
    assert.deepEqual(Object.keys(r.note_rows[0]).sort(), ["note", "shopify_order_number", "updated_at", "updated_by"]);
  });
}
test("daily report keeps modern S6 and legacy S4 as distinct final stages", () => {
  const modern = run(fixture(6)).audit_record.metadata.cases[0];
  const legacyResult = run(fixture(4, false));
  const legacy = legacyResult.audit_record.metadata.cases[0];
  assert.equal(modern.status, "final_stage_review");
  assert.equal(modern.stage_label, "3. und letzte Mahnung");
  assert.equal(legacy.status, "final_stage_review");
  assert.equal(legacy.stage_source, "legacy");
  assert.match(legacy.stage_label, /Altbestand/);
  assert.match(report(legacyResult)[0].json.emailBody, /Altbestand/);
});
test("daily report does not use another order's modern evidence", () => {
  const f = fixture();
  f["Read Daily Verified Stages"]![0].body[0].document_id = "other-order";
  const c = run(f).audit_record.metadata.cases[0];
  assert.equal(c.stage_source, "legacy");
  assert.equal(c.status, "final_stage_review");
});
test("daily report keeps matching imported modern sent evidence out of legacy stages", () => {
  const f = fixture();
  f["Read Daily Reminder Logs"]![0].body.push({ shopify_order_number: "#NEONT4581", mahnstufe: 4, sent_at: "2026-10-14T14:20:27Z", status: "import-outlook", subject: "1. Mahnung" });
  f["Read Daily Reminder Logs"]![0].headers["content-range"] = "0-0/1";
  assert.equal(run(f).audit_record.metadata.cases[0].status, "reminder_evidenced");
});
test("daily report surfaces distinct conflicting stages without calling them final", () => {
  const f = fixture(4, false);
  f["Read Daily Verified Stages"] = fixture(3)["Read Daily Verified Stages"]!;
  const c = run(f).audit_record.metadata.cases[0];
  assert.equal(c.status, "stage_source_review");
  assert.match(report(run(f))[0].json.emailBody, /Zuordnung/);
});
test("daily report keeps holds, payment conflicts and blocked sends ahead of normal follow-up", () => {
  const held = fixture();
  held["Read Daily Dunning States"]![0].body[0].paused = true;
  assert.equal(run(held).audit_record.metadata.cases[0].status, "held");
  const paid = fixture();
  paid["Read Summary"]![0].shopify.open[0].displayFinancialStatus = "PAID";
  assert.equal(run(paid).audit_record.metadata.cases[0].status, "payment_data_conflict");
  const blocked = fixture();
  blocked["Read Daily Sender Issues"] = [{statusCode: 200, headers: {"content-range": "0-0/1"}, body:[{document_id:"8439288856843", created_at:"2026-10-15T10:00:00Z", metadata:{stage:5,reasons:["PROTECTED_CUSTOMER"]}}]}];
  assert.equal(run(blocked).audit_record.metadata.cases[0].status, "sender_blocked");
});
test("daily report fails if any required source pagination is incomplete", () => {
  const f = fixture();
  f["Read Daily Mail Evidence"]![0].headers["content-range"] = "0-0/1";
  assert.throws(() => run(f), /INCOMPLETE/);
});
test("manual legacy audit evidence is retained when the projection is behind", () => {
  const f = fixture(2);
  f['Read Daily Dunning States']![0].body[0].mahnstufe=1;
  f['Read Daily Verified Stages']![0].body[0].metadata.evidence_schema='t296.manual-dunning.v1';
  const c=run(f).audit_record.metadata.cases[0];
  assert.equal(c.stage,2);
  assert.equal(c.stage_source,'legacy');
});

test("retryable enrolled cases remain in the blocked-work email until a successful send", () => {
  for (const status of ["enrolled", "regular_intake"]) {
    const r = run(fixture());
    r.audit_record.metadata.cases[0] = {
      ...r.audit_record.metadata.cases[0],
      status:"sender_blocked", sender_blocked:true,
      automation:{status}, note:"Versand blockiert: QONTO_AMBIGUOUS_POSSIBLE_PAYMENT.",
    };
    const result = report(r);
    assert.equal(result.length, 1);
    assert.match(result[0].json.emailSubject, /1 Fälle zur Prüfung/);
    assert.match(result[0].json.emailBody, /QONTO_AMBIGUOUS_POSSIBLE_PAYMENT/);
    assert.doesNotMatch(result[0].json.emailBody, /Fälle im automatischen Ablauf/);
  }
});

test("the control distinguishes not-yet-due from missing first reminders",()=>{
 const f:any=fixture(0);f["Read Daily Dunning States"][0].body=[];f["Read Daily Dunning States"][0].headers["content-range"]="*/0";f["Read Daily Verified Stages"][0].body=[];f["Read Daily Verified Stages"][0].headers["content-range"]="*/0";
 const o=f["Read Summary"][0].shopify.open[0];o.createdAt="2026-10-15T09:00:00Z";
 f["Read Summary"][0].invoices=[{order_number:"#NEONT4581",type:"INVOICE",created_at:"2026-10-15 11:00:00",due_date:"2026-10-15",is_draft:false}];
 const c=run(f).audit_record.metadata.cases[0];assert.equal(c.status,"not_due");assert.equal(c.next_due_at,"2026-10-20T09:00:00.000Z");
});
test("the report never claims regular enrollment when its intake candidate is absent",()=>{
 const f:any=fixture();f["Read Daily Intake Snapshot"][0].body[0].metadata.candidates=[];
 const r=run(f),c=r.audit_record.metadata.cases[0];assert.equal(c.automation.status,"excluded");assert.equal(c.automation.reason,"REGULAR_INTAKE_MISSING");assert.equal(report(r).length,1);
});
