import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260717113500_email_agent_retry_recovery.sql",
  import.meta.url,
);
const rollbackPath = new URL(
  "../../supabase/rollbacks/20260717113500_email_agent_retry_recovery_rollback.sql",
  import.meta.url,
);
const identityFixPath = new URL(
  "../../supabase/migrations/20260717114500_fix_email_agent_retry_legacy_identity.sql",
  import.meta.url,
);
const movedSourceFixPath = new URL(
  "../../supabase/migrations/20260717121500_requeue_moved_outlook_retry_sources.sql",
  import.meta.url,
);
const knownDraftFixPath = new URL(
  "../../supabase/migrations/20260717122000_reconcile_known_outlook_retry_drafts.sql",
  import.meta.url,
);
const workflowPath = new URL(
  "../../workflows/email-retry-recovery/generated/retry-recovery-v1.json",
  import.meta.url,
);
const qualityPath = new URL("../../src/lib/ops/email-agent-quality.ts", import.meta.url);
const pagePath = new URL("../../src/app/ops/email-agent/page-client.tsx", import.meta.url);

test("email retry recovery is private, bounded, observable, and reversible", async () => {
  const [migration, rollback, identityFix, movedSourceFix, knownDraftFix] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(rollbackPath, "utf8"),
    readFile(identityFixPath, "utf8"),
    readFile(movedSourceFixPath, "utf8"),
    readFile(knownDraftFixPath, "utf8"),
  ]);

  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /attempt_count < 5/i);
  assert.match(migration, /retry_worker_busy/i);
  assert.match(migration, /suppressed_existing_draft/i);
  assert.match(migration, /automatic_send_allowed', false/i);
  assert.match(migration, /human_approval_required', true/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /to service_role/i);
  assert.doesNotMatch(migration, /security definer/i);

  assert.match(rollback, /drop function if exists public\.claim_due_email_agent_retry/i);
  assert.match(rollback, /drop table if exists public\.email_agent_retry_events/i);
  assert.match(rollback, /create or replace function public\.fail_email_agent_message/i);
  assert.match(identityFix, /claim_due_email_agent_retry_v2/i);
  assert.match(identityFix, /request_id like 'ai-email-v2:AAM%'/i);
  assert.match(identityFix, /Retry requeued after legacy message identity repair/i);
  assert.match(movedSourceFix, /source_message_unavailable_http_404/i);
  assert.match(movedSourceFix, /immutable internet-message-id lookup/i);
  assert.match(knownDraftFix, /known_outlook_draft_reconciled/i);
  assert.match(knownDraftFix, /suppressed_existing_draft/i);
});

test("retry worker creates human-review drafts only and reconciles duplicates", async () => {
  const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as {
    nodes: Array<{ name: string; type: string; parameters: Record<string, unknown> }>;
  };
  const serialized = JSON.stringify(workflow);

  assert.equal(workflow.nodes.filter((node) => node.type.endsWith("Trigger")).length, 1);
  assert.equal(workflow.nodes.length, 30);
  assert.match(serialized, /createReply/);
  assert.match(serialized, /conversation-drafts/);
  assert.match(serialized, /source-by-internet-id/);
  assert.match(serialized, /internetMessageId eq/);
  assert.match(serialized, /mailFolders\/drafts\/messages/);
  assert.match(serialized, /existing_reply_draft/);
  assert.match(serialized, /complete_email_agent_retry_message/);
  assert.doesNotMatch(serialized, /"operation":"send"/);
  assert.doesNotMatch(serialized, /sendMail|replyAll/);
});

test("email-agent dashboard exposes content-free retry health", async () => {
  const [quality, page] = await Promise.all([
    readFile(qualityPath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert.match(quality, /get_email_agent_retry_health/);
  assert.match(quality, /automatic_send_allowed: false/);
  assert.match(quality, /human_approval_required: true/);
  assert.match(page, /Fehler-Wiederholung/);
  assert.match(page, /Letzte 24 h gerettet/);
});
