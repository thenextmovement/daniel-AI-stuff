import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260821123000_sequence_cancel_invoice_and_storno.sql"), "utf8");
const rollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260821123000_sequence_cancel_invoice_and_storno_rollback.sql"), "utf8");
const numberPairMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260821143500_allow_invoice_cancellation_number_pair.sql"), "utf8");
const numberPairRollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260821143500_allow_invoice_cancellation_number_pair_rollback.sql"), "utf8");

test("unbilled Shopify cancellation sequences invoice before linked cancellation", () => {
  assert.match(migration, /elsif v_case\.final_invoice_at is null then[\s\S]*'CREATE_INVOICE'/);
  assert.match(migration, /after update of final_invoice_at on public\.billing_cases/);
  assert.match(migration, /'CREATE_CANCELLATION'/);
  assert.match(migration, /'billing:'\|\|new\.id::text\|\|':cancellation'/);
  assert.match(migration, /status='CANCELLATION_PENDING'/);
  assert.match(migration, /document_type='CANCELLATION'[\s\S]*status in \('FINALIZED','SENT'\)/);
  assert.match(migration, /set status='CANCELLED'/);
});

test("cancel sequence is idempotent, suppresses customer email, and preserves refund behavior", () => {
  assert.match(migration, /if exists\(select 1 from public\.billing_events where idempotency_key=p_event_id\)/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/g);
  assert.match(migration, /'customerEmailSuppressed',true/g);
  assert.doesNotMatch(migration, /SEND_CUSTOMER_DOCUMENT|send\/email/);
  assert.match(migration, /p_event_type='REFUND_CREATED'/);
  assert.match(migration, /'CREATE_CREDIT'/);
  assert.match(migration, /BILLING_REFUND_POST_LINES_REQUIRED/);
});

test("unresolved VAT blocks the accounting chain with an urgent incident", () => {
  assert.match(migration, /tax_review_status='REVIEW_REQUIRED'/);
  assert.match(migration, /status='SYNC_BLOCKED'/);
  assert.match(migration, /'cancel-tax-review:'\|\|p_event_id/);
  assert.match(migration, /'URGENT','Fehler Rechnung Shopify\/Easybill'/);
});

test("migration is reversible without deleting finalized documents", () => {
  assert.match(rollback, /drop trigger if exists billing_cancel_queue_after_invoice_trigger/);
  assert.match(rollback, /drop trigger if exists billing_cancel_finish_after_storno_trigger/);
  assert.match(rollback, /create or replace function public\.billing_shopify_event_ingest/);
  assert.match(rollback, /status='SYNC_BLOCKED'[\s\S]*CANCELLATION_PENDING/);
  assert.doesNotMatch(rollback, /delete from public\.billing_documents|drop table public\.billing_documents/);
});

test("Easybill invoice and cancellation may share a number without allowing same-type duplicates", () => {
  assert.match(numberPairMigration, /drop constraint if exists billing_documents_document_number_key/);
  assert.match(numberPairMigration, /unique index if not exists billing_documents_type_document_number_key/);
  assert.match(numberPairMigration, /\(document_type, document_number\)/);
  assert.match(numberPairRollback, /add constraint billing_documents_document_number_key unique \(document_number\)/);
});
