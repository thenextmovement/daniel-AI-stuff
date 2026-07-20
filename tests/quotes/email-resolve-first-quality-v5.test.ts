import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260720185658_email_agent_resolve_first_quality_v5.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260720185658_email_agent_resolve_first_quality_v5_rollback.sql",
  "utf8",
);
const qualityLibrary = readFileSync("src/lib/ops/email-agent-quality.ts", "utf8");
const qualityUi = readFileSync("src/app/ops/email-agent/page-client.tsx", "utf8");
const mainWorkflow = readFileSync(
  "workflows/email-resolve-first/generated/main-resolve-first-v4.json",
  "utf8",
);
const retryWorkflow = readFileSync(
  "workflows/email-retry-recovery/generated/retry-recovery-v1.json",
  "utf8",
);

test("feedback changes are classified automatically without storing customer content", () => {
  assert.match(migration, /create table if not exists public\.email_agent_feedback_analysis_v1/);
  assert.match(migration, /create trigger email_agent_feedback_analyze_v5/);
  assert.match(migration, /analyze_email_agent_feedback_v5/);
  assert.match(migration, /unnecessary_internal_deferral/);
  assert.match(migration, /attachment_missed/);
  assert.match(migration, /price_or_offer_error/);
  assert.match(migration, /contains_customer_content boolean not null default false/);
  assert.match(migration, /signal_summary jsonb/);
  assert.doesNotMatch(migration, /customer_body|message_body|draft_body_text text|sent_body_text text/);
  assert.match(migration, /automatic_prompt_rewrite_allowed', false/);
});

test("style learning requires ten semantically equivalent samples", () => {
  assert.match(migration, /create or replace view public\.email_agent_auto_style_eligibility_v2/);
  assert.match(migration, /analysis\.reusable_style_candidate/);
  assert.match(migration, /stats\.sample_count >= 10/);
  assert.match(migration, /'minimum_safe_samples', 10/);
  assert.match(migration, /email-style-profile-v5-passive-safe/);
  assert.match(migration, /email-feedback-analyzer-v5/);
});

test("rollout quality is measured per category and remains draft-only", () => {
  assert.match(migration, /get_email_agent_rollout_gate_v2/);
  assert.match(migration, /email-facts-package-v2/);
  assert.match(migration, /category_coverage_passed/);
  assert.match(migration, /minimum_category_samples', 3/);
  assert.match(migration, /'automatic_send_allowed', false/);
  assert.match(migration, /'human_send_approval_required', true/);
  assert.match(qualityLibrary, /get_email_agent_rollout_gate_v2/);
  assert.match(qualityLibrary, /get_email_agent_learning_quality_v5/);
  assert.match(qualityUi, /Automatische Fehleranalyse/);
});

test("main and retry workflows share v5 safety contracts and never send", () => {
  for (const workflow of [mainWorkflow, retryWorkflow]) {
    assert.match(workflow, /email-facts-package-v2/);
    assert.match(workflow, /email-resolve-first-v2/);
    assert.match(workflow, /email-draft-quality-gate-v4/);
    assert.match(workflow, /email-style-profile-v5-passive-safe/);
    assert.match(workflow, /email-feedback-analyzer-v5/);
    assert.match(workflow, /deterministic_fallback_used/);
    assert.match(workflow, /fabienne123\.jpg/);
    assert.match(workflow, /weiss_logo_NEONTRIP\.png/);
    assert.doesNotMatch(workflow, /sendMail|replyAll|\"operation\":\"send\"/i);
  }
  assert.doesNotMatch(mainWorkflow, /current status will be checked/);
  assert.doesNotMatch(mainWorkflow, /If facts are missing, say that the matter will be checked internally/);
});

test("database changes are service-role-only and have an explicit rollback", () => {
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /security invoker/g);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.match(rollback, /drop trigger if exists email_agent_feedback_analyze_v5/);
  assert.match(rollback, /drop function if exists public\.get_email_agent_rollout_gate_v2/);
  assert.match(rollback, /drop table if exists public\.email_agent_feedback_analysis_v1/);
});
