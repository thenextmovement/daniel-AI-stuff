import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260720160951_email_agent_learning_loop_v3.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260720160951_email_agent_learning_loop_v3_rollback.sql",
  "utf8",
);
const reviewApi = readFileSync("src/app/api/ops/email-agent/reviews/route.ts", "utf8");
const reviewLibrary = readFileSync("src/lib/ops/email-agent-review.ts", "utf8");
const reviewUi = readFileSync("src/app/ops/email-agent/page-client.tsx", "utf8");
const qualityLibrary = readFileSync("src/lib/ops/email-agent-quality.ts", "utf8");
const mainWorkflow = readFileSync(
  "workflows/email-resolve-first/generated/main-resolve-first-v4.json",
  "utf8",
);
const matcherWorkflow = readFileSync(
  "workflows/email-feedback-delta/generated/review-feedback-matcher.json",
  "utf8",
);

test("v3 human review contract remains available as an audited exception path", () => {
  assert.match(migration, /create or replace function public\.get_email_agent_style_profile_v3/);
  assert.match(migration, /'email-style-profile-v3-human-gated'/);
  assert.match(migration, /'minimum_approved_samples', 5/);
  assert.match(migration, /recommended_max_paragraphs/);
  assert.match(migration, /preferred_closing/);
  assert.match(migration, /'facts_or_customer_content_included', false/);
  assert.match(migration, /'fact_learning_allowed', false/);
  assert.match(migration, /'automatic_prompt_rewrite_allowed', false/);
  assert.match(mainWorkflow, /get_email_agent_style_profile_v4/);
  assert.match(mainWorkflow, /email-style-profile-v4-passive-safe/);
  assert.match(mainWorkflow, /Apply Approved Style Profile/);
  assert.doesNotMatch(mainWorkflow, /rawProfile\.version === \\"email-style-profile-v1\\"/);
});

test("reason-coded review separates style from factual and process improvements", () => {
  assert.match(migration, /create or replace function public\.review_email_agent_feedback_v3/);
  assert.match(migration, /one to eight allowed review reason codes are required/);
  assert.match(migration, /cannot be approved for style learning/);
  assert.match(migration, /create table if not exists public\.email_agent_improvement_candidates/);
  assert.match(migration, /check \(contains_customer_content = false\)/);
  assert.match(migration, /candidate_type in \('knowledge', 'resolver', 'policy', 'manual_review'\)/);
  assert.match(migration, /on conflict \(feedback_id\) do update/);
  assert.match(reviewApi, /reasonCodes\.length < 1/);
  assert.match(reviewApi, /reviewEmailAgentFeedback/);
  assert.match(reviewLibrary, /email_agent_learning_review_overview_v3/);
  assert.match(reviewUi, /Nicht ausreichend recherchiert/);
  assert.match(reviewUi, /Unnötig intern abklären/);
  assert.match(reviewUi, /separate Wissens-, Resolver- oder Regelprüfung/);
});

test("post-generation quality gate is logged and cannot send automatically", () => {
  assert.match(mainWorkflow, /email-draft-quality-gate-v3/);
  assert.match(mainWorkflow, /no_vague_internal_deferral/);
  assert.match(mainWorkflow, /grounded_claims_only/);
  assert.match(mainWorkflow, /precise_customer_action_when_needed/);
  assert.match(mainWorkflow, /QUALITY_GATE_FAILED/);
  assert.match(mainWorkflow, /automatic_send_allowed/);
  assert.doesNotMatch(mainWorkflow, /sendMail|replyAll|\"operation\":\"send\"/i);
});

test("quality metrics remain aggregate while the current UI treats review as optional", () => {
  assert.match(migration, /create or replace function public\.get_email_agent_learning_quality_v3/);
  assert.match(migration, /reason_counts/);
  assert.match(migration, /quality_gate_7d/);
  assert.match(migration, /'customer_content_stored', false/);
  assert.match(qualityLibrary, /get_email_agent_learning_quality_v4/);
  assert.match(reviewUi, /Automatisches Stilprofil/);
  assert.match(matcherWorkflow, /email-feedback-delta-v2-structure/);
  assert.match(matcherWorkflow, /sent_paragraphs/);
});

test("v3 database surface is service-role-only and rollback preserves audit data", () => {
  assert.match(migration, /security invoker/g);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.match(rollback, /Non-destructive rollback/);
  assert.match(rollback, /grant execute on function public\.review_email_agent_feedback_v2/);
  assert.doesNotMatch(rollback, /drop table if exists public\.email_agent_improvement_candidates/);
  assert.doesNotMatch(rollback, /drop column.*review_reason_codes/i);
});
