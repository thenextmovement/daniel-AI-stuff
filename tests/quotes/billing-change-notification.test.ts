import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260822163000_notify_billing_change_requests.sql"), "utf8");
const rollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260822163000_notify_billing_change_requests_rollback.sql"), "utf8");
const claimRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/internal/billing/jobs/claim/route.ts"), "utf8");
const workflow = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/billing-v2/generated/change-request-notification-worker-v1.inactive.json"), "utf8"));

test("portal submission queues exactly one internal change notification", () => {
  assert.match(migration, /'NOTIFY_CHANGE_REQUEST'/);
  assert.match(migration, /'notify-change-request:'\|\|v_request\.id::text/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /'requestedChanges',v_request\.requested_changes/);
  assert.match(migration, /'shopifyOrderName',v_case\.shopify_order_name/);
  assert.match(claimRoute, /"NOTIFY_CHANGE_REQUEST"/);
});

test("notification worker is inactive, internal-only and links to the exact Ops case", () => {
  assert.equal(workflow.active, false);
  assert.match(workflow.name, /Change Request Notification Worker \(INACTIVE\)/);
  const byName = Object.fromEntries(workflow.nodes.map((node: { name: string }) => [node.name, node]));
  assert.equal(byName["Claim Change Notification Job"].parameters.jsonBody.includes("'NOTIFY_CHANGE_REQUEST'"), true);
  assert.equal(byName["Send Internal Change Notification"].parameters.toRecipients, "={{ $json.recipient }}");
  assert.equal(byName["Send Internal Change Notification"].credentials.microsoftOutlookOAuth2Api.id, "CTEmJD5CjYu9hawu");
  const prepareCode = byName["Prepare Change Notification"].parameters.jsCode;
  assert.match(prepareCode, /recipient:'info@neontrip\.de'/);
  assert.match(prepareCode, /Rechnungsänderung angefordert/);
  assert.match(prepareCode, /ops\/rechnungen\//);
  assert.match(prepareCode, /Bisher/);
  assert.match(prepareCode, /Gewünscht/);
  assert.doesNotMatch(JSON.stringify(workflow), /api\.easybill\.de|myshopify\.com|SEND_CUSTOMER_DOCUMENT/);
});

test("notification failures retry without changing the financial case status", () => {
  assert.match(migration, /if v_job\.job_type='NOTIFY_CHANGE_REQUEST' then/);
  assert.match(migration, /Rechnungsänderung wartet ohne interne Benachrichtigung/);
  const notificationBranch = migration.slice(migration.indexOf("if v_job.job_type='NOTIFY_CHANGE_REQUEST' then"), migration.indexOf("else\n        update public.billing_cases set status='SYNC_BLOCKED'"));
  assert.doesNotMatch(notificationBranch, /update public\.billing_cases/);
  assert.match(rollback, /NOTIFY_CHANGE_REQUEST_JOB_PROCESSING/);
  assert.match(rollback, /delete from public\.billing_jobs where job_type='NOTIFY_CHANGE_REQUEST'/);
  assert.match(rollback, /create or replace function public\.billing_job_complete/);
  assert.doesNotMatch(rollback, /Rechnungsänderung wartet ohne interne Benachrichtigung/);
});

test("internal email content is bounded and escapes customer-controlled values", () => {
  const prepareNode = workflow.nodes.find((node: { name: string }) => node.name === "Prepare Change Notification");
  assert.ok(prepareNode);
  const code = prepareNode.parameters.jsCode;
  assert.match(code, /escapeHtml/);
  assert.match(code, /slice\(0, 500\)/);
  assert.match(code, /Diese Nachricht wurde nur intern versendet/);
  assert.match(code, /hat Shopify oder easybill nicht verändert/);
  assert.match(code, /DECISION_CUSTOMER/);
  assert.match(code, /Rechnungsänderung akzeptiert/);
  assert.match(code, /Rechnungsänderung abgelehnt/);
  assert.match(code, /Rechnungsportal öffnen/);
});
