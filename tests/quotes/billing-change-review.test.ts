import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const migration = read("supabase/migrations/20260822170000_billing_change_review_detail.sql");

test("billing overview opens a dedicated order detail page", () => {
  const client = read("src/app/ops/rechnungen/page-client.tsx");
  const detailPage = read("src/app/ops/rechnungen/[caseId]/page.tsx");
  assert.match(client, /href=\{`\/ops\/rechnungen\/\$\{entry\.id\}`\}/);
  assert.match(client, /window\.location\.replace\(`\/ops\/rechnungen\/\$\{caseId\}`\)/);
  assert.match(detailPage, /detailCaseId=\{caseId\}/);
  assert.doesNotMatch(client, /JSON\.stringify\(change\.requested_changes/);
});

test("Ops can save a reviewed draft without emailing the customer", () => {
  const client = read("src/app/ops/rechnungen/page-client.tsx");
  assert.match(client, /SAVE_CHANGE_REQUEST_DRAFT/);
  assert.match(client, /Änderungen speichern/);
  assert.match(client, /Abbrechen/);
  assert.match(client, /cancelEditing/);
  assert.match(client, /setForm\(changeForm\(change, billingCase\)\)/);
  assert.match(client, /Beim internen Speichern wird keine E-Mail versendet/);
  assert.match(client, /Daten ändern/);
  assert.match(client, /Annehmen/);
  assert.match(client, /disabled=\{Boolean\(busy\) \|\| editing\}/);
  assert.doesNotMatch(client, /Anfrage anpassen/);
  const draftFunction = migration.slice(migration.indexOf("billing_change_request_save_draft"), migration.indexOf("billing_change_request_decide"));
  assert.doesNotMatch(draftFunction, /billing_jobs|NOTIFY_CHANGE_REQUEST/);
  assert.match(draftFunction, /CHANGE_REQUEST_DRAFT_SAVED/);
});

test("only a final decision queues one idempotent customer notification", () => {
  assert.match(migration, /'notify-change-decision:'\|\|p_change_request_id::text\|\|':'\|\|upper\(p_decision\)/);
  assert.match(migration, /'notificationKind','DECISION_CUSTOMER'/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /BILLING_CHANGE_EMAIL_INVALID/);
  assert.match(migration, /BILLING_CHANGE_PORTAL_URL_MISSING/);
});

test("original customer request and reviewed values remain separately auditable", () => {
  assert.match(migration, /v_original := v_change\.requested_changes/);
  assert.match(migration, /requested_changes=v_original/);
  assert.match(migration, /applied_changes=case when v_action='APPLY_CHANGE_REQUEST' then v_reviewed/);
  assert.match(migration, /ops_draft_changes/);
});
