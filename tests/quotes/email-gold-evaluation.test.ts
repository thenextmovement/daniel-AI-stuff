import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260717111500_email_agent_gold_evaluation_and_rollout_gate.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260717111500_email_agent_gold_evaluation_and_rollout_gate_rollback.sql",
  "utf8",
);
const qualityApi = readFileSync("src/app/api/ops/email-agent/quality/route.ts", "utf8");
const qualityLibrary = readFileSync("src/lib/ops/email-agent-quality.ts", "utf8");
const reviewUi = readFileSync("src/app/ops/email-agent/page-client.tsx", "utf8");

test("gold set is immutable, metadata-only and requires 50 cases", () => {
  assert.match(migration, /create table if not exists public\.email_agent_gold_cases/);
  assert.match(migration, /target_count integer := greatest\(50/);
  assert.match(migration, /an active gold set already exists and is immutable/);
  assert.match(migration, /'customer_content_stored', false/);
  assert.doesNotMatch(migration, /source_body_text/);
  assert.match(migration, /observed_human_sent_reply/);
  assert.match(migration, /deterministic_safety_policy/);
  assert.match(migration, /deterministic_safe_no_reply_policy/);
  assert.match(migration, /decision\.final_decision = 'no_reply'/);
  assert.doesNotMatch(
    migration.match(/decision\.reason_codes <@ array\[[\s\S]*?\]::text\[\] then 'no_reply'/)?.[0] ?? "",
    /internal_or_duplicate/,
  );
});

test("evaluation blocks unsafe no-reply and measures routing separately from exact labels", () => {
  assert.match(migration, /unsafe_no_reply_count_value/);
  assert.match(migration, /routing_accuracy_value/);
  assert.match(migration, /actionable_recall_value/);
  assert.match(migration, /no_reply_precision_value/);
  assert.match(migration, /max_unsafe_no_reply integer not null default 0/);
  assert.match(migration, /min_routing_accuracy numeric\(7,6\) not null default 0\.980000/);
  assert.match(migration, /evaluation version is immutable and already has a different prediction/);
});

test("rollout fails closed and permanently prohibits automatic sending", () => {
  assert.match(migration, /requested_stage in \('shadow', 'review_only', 'routing_gate'\)/);
  assert.match(migration, /check \(automatic_send_allowed = false\)/);
  assert.match(migration, /check \(human_send_approval_required = true\)/);
  assert.match(migration, /routing_gate is blocked until both decision and current-version draft quality gates pass/);
  assert.match(migration, /min_current_draft_samples integer not null default 30/);
  assert.match(migration, /log\.context_snapshot#>>'\{evidence_card,version\}' = 'email-evidence-card-v2'/);
  assert.match(migration, /'automatic_send_allowed', false/);
});

test("quality endpoint is authenticated and dashboard exposes both gates", () => {
  assert.match(qualityApi, /hasOpsSession/);
  assert.match(qualityApi, /getEmailAgentRolloutGate/);
  assert.match(qualityLibrary, /get_email_agent_rollout_gate_v1/);
  assert.match(reviewUi, /50-Fälle-Entscheidungstest/);
  assert.match(reviewUi, /Aktuelle Facts-Package-Version/);
  assert.match(reviewUi, /Kein automatischer Versand/);
  assert.match(reviewUi, /gefährliche No-Reply-Fehler/);
});

test("rollback removes all evaluation and rollout objects", () => {
  assert.match(rollback, /drop function if exists public\.set_email_agent_rollout_stage_v1/);
  assert.match(rollback, /drop table if exists public\.email_agent_rollout_audit/);
  assert.match(rollback, /drop table if exists public\.email_agent_gold_cases/);
});
