import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260717104000_harden_email_learning_knowledge_review_gate.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260717104000_harden_email_learning_knowledge_review_gate_rollback.sql",
  "utf8",
);
const reviewApi = readFileSync("src/app/api/ops/email-agent/reviews/route.ts", "utf8");
const emailReviewUi = readFileSync("src/app/ops/email-agent/page-client.tsx", "utf8");
const knowledgeUi = readFileSync("src/app/ops/voice-copilot/knowledge-panel.tsx", "utf8");
const knowledgeReviewApi = readFileSync("src/app/api/ops/voice-copilot/knowledge/review/route.ts", "utf8");
const emailKnowledgeReviewApi = readFileSync("src/app/api/ops/voice-copilot/knowledge/email-review/route.ts", "utf8");

test("style learning requires an eligible human-reviewed signal", () => {
  assert.match(migration, /create table if not exists public\.email_agent_learning_review_audit/);
  assert.match(migration, /create or replace function public\.review_email_agent_feedback_v2/);
  assert.match(migration, /fact_or_intent_change_detected/);
  assert.match(migration, /high_risk_case/);
  assert.match(migration, /review note must contain at least 8 characters/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('email-learning-review:'/);
  assert.match(migration, /'email-style-profile-v2-human-gated'/);
  assert.match(migration, /'minimum_approved_samples', 5/);
  assert.match(migration, /'facts_or_customer_content_included', false/);
  assert.match(migration, /revoke all on function public\.review_email_agent_feedback\(bigint, text, text, text\)[\s\S]*from service_role/);
});

test("email knowledge has an independent content-bound approval gate", () => {
  assert.match(migration, /create table if not exists public\.email_support_knowledge_approvals/);
  assert.match(migration, /create table if not exists public\.knowledge_review_audit/);
  assert.match(migration, /create or replace function public\.review_email_support_knowledge_v1/);
  assert.match(migration, /email_approval\.approved_content_hash = version\.content_hash/);
  assert.match(migration, /version\.status = 'approved'/);
  assert.match(migration, /email_approval\.status = 'approved'/);
  assert.match(migration, /'human_draft_review_required', true/);
  assert.match(migration, /version\.reviewed_by = 'daniel_klesse_user_authorized_2026-07-14'/);
  assert.match(migration, /revoke all on function public\.review_voice_knowledge_version\(uuid, text, text\)[\s\S]*from service_role/);
});

test("review UIs and APIs require identity, reason and idempotency", () => {
  assert.match(reviewApi, /note\.length < 8/);
  assert.match(reviewApi, /operatorName\.length < 2/);
  assert.match(reviewApi, /idempotencyKey/);
  assert.match(emailReviewUi, /crypto\.randomUUID\(\)/);
  assert.match(emailReviewUi, /Pflicht: Warum ist diese Entscheidung richtig/);
  assert.match(knowledgeUi, /reviewNote: reviewNotes\[versionId\]/);
  assert.match(knowledgeUi, /Für E-Mail-Entwürfe freigeben/);
  assert.match(knowledgeUi, /E-Mail-Freigabe entziehen/);
  assert.match(knowledgeReviewApi, /resolveVoiceCopilotActor/);
  assert.match(emailKnowledgeReviewApi, /resolveVoiceCopilotActor/);
  assert.match(emailKnowledgeReviewApi, /authenticatedActor/);
});

test("rollback restores prior callers and removes new gate objects", () => {
  assert.match(rollback, /drop function if exists public\.review_email_support_knowledge_v1/);
  assert.match(rollback, /grant execute on function public\.review_email_agent_feedback/);
  assert.match(rollback, /grant execute on function public\.review_voice_knowledge_version/);
  assert.match(rollback, /drop table if exists public\.knowledge_review_audit/);
  assert.match(rollback, /drop table if exists public\.email_support_knowledge_approvals/);
});
