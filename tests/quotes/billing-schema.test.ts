import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260819170000_create_billing_cases.sql"), "utf8");
const rollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260819170000_create_billing_cases_rollback.sql"), "utf8");
const actions = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260819180000_create_billing_case_actions.sql"), "utf8");
const actionsRollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260819180000_create_billing_case_actions_rollback.sql"), "utf8");
const portalIngest = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260820133000_add_billing_portal_url_to_initial_job.sql"), "utf8");
const portalIngestRollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260820133000_add_billing_portal_url_to_initial_job_rollback.sql"), "utf8");

test("billing schema has source-of-truth ledgers and unique effect keys", () => {
  for (const table of ["billing_cases","billing_case_versions","billing_documents","billing_payments","billing_change_requests","billing_events","billing_jobs","billing_incidents"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /shopify_order_id text not null unique/);
  assert.match(migration, /document_number text not null unique/);
  assert.match(migration, /project_number text/);
  assert.match(migration, /billing_cases_project_number_check/);
  assert.match(migration, /idempotency_key text not null unique/g);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /grant execute on function public\.billing_case_ingest/);
});

test("billing actions are atomic, audited, and preserve the agreed invoice trigger rules", () => {
  assert.match(actions, /billing_case_apply_action/);
  assert.match(actions, /p_action='SET_PAYMENT_METHOD'/);
  assert.match(actions, /payment_terms_days=v_terms/);
  assert.match(actions, /p_action='MARK_PAID'/);
  assert.match(actions, /'trigger','PAYMENT_RECEIVED'/);
  assert.match(actions, /p_action='MARK_DELIVERED'/);
  assert.match(actions, /'trigger','DELIVERED'/);
  assert.match(actions, /tax_review_status='REVIEW_REQUIRED'/);
  assert.match(actions, /'invoiceEmail',lower\(trim\(v_changes->>'invoiceEmail'\)\)/);
  assert.match(actions, /'projectNumber',trim\(v_changes->>'projectNumber'\)/);
  assert.match(actions, /project_number=case when v_changes \? 'projectNumber'/);
  assert.match(actions, /insert into public\.billing_events/);
  assert.match(actionsRollback, /drop function if exists public\.billing_case_apply_action/);
});

test("billing migration has a complete rollback", () => {
  assert.match(rollback, /drop function if exists public\.billing_case_ingest/);
  assert.match(rollback, /drop table if exists public\.billing_cases/);
  assert.match(rollback, /drop function if exists public\.set_billing_updated_at/);
});

test("initial Pro-forma job receives the permanent Rechnungsportal URL atomically", () => {
  assert.match(portalIngest, /billing_case_ingest_with_portal/);
  assert.match(portalIngest, /rechnung\\\.neontrip\\\.de/);
  assert.match(portalIngest, /payload \|\| jsonb_build_object\('portalUrl',p_portal_url\)/);
  assert.match(portalIngestRollback, /drop function if exists public\.billing_case_ingest_with_portal/);
});
