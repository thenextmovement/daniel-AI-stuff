import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260720164453_email_agent_passive_safe_learning.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260720164453_email_agent_passive_safe_learning_rollback.sql",
  "utf8",
);
const qualityLibrary = readFileSync("src/lib/ops/email-agent-quality.ts", "utf8");
const reviewUi = readFileSync("src/app/ops/email-agent/page-client.tsx", "utf8");
const mainWorkflow = readFileSync(
  "workflows/email-resolve-first/generated/main-resolve-first-v4.json",
  "utf8",
);
const retryWorkflow = readFileSync(
  "workflows/email-retry-recovery/generated/retry-recovery-v1.json",
  "utf8",
);

test("passive learning accepts only deterministic style-safe comparisons", () => {
  assert.match(migration, /create or replace view public\.email_agent_auto_style_eligibility_v1/);
  assert.match(migration, /evaluated\.learning_status = 'pending'/);
  assert.match(migration, /evaluated\.edit_ratio <= 0\.65/);
  assert.match(migration, /question_added/);
  assert.match(migration, /amount_changed/);
  assert.match(migration, /attachment_reference_changed/);
  assert.match(migration, /commitment_changed/);
  assert.match(migration, /internal_detail_removed/);
  assert.match(migration, /draft_has_deferral/);
  assert.match(migration, /sent_has_unsafe_commitment/);
  assert.match(migration, /learning_status in \('rejected', 'ignored'\)/);
});

test("v4 profile is aggregate-only, bounded, and cannot rewrite prompts or send", () => {
  assert.match(migration, /get_email_agent_style_profile_v4/);
  assert.match(migration, /'minimum_safe_samples', 3/);
  assert.match(migration, /'facts_or_customer_content_included', false/);
  assert.match(migration, /'automatic_prompt_rewrite_allowed', false/);
  assert.match(migration, /'manual_review_required_for_safe_style', false/);
  assert.match(migration, /'customer_send_human_approval_required', true/);
  assert.match(migration, /'automatic_send_allowed', false/);
  assert.doesNotMatch(mainWorkflow, /sendMail|replyAll|"operation":"send"/i);
  assert.doesNotMatch(retryWorkflow, /sendMail|replyAll|"operation":"send"/i);
});

test("both drafting paths require the exact passive-safe profile contract", () => {
  for (const workflow of [mainWorkflow, retryWorkflow]) {
    assert.match(workflow, /get_email_agent_style_profile_v4/);
    assert.match(workflow, /email-style-profile-v4-passive-safe/);
    assert.match(workflow, /passive_deterministic/);
    assert.match(workflow, /safe_sample_count/);
    assert.match(workflow, /manual_review_required_for_safe_style/);
    assert.match(workflow, /customer_send_human_approval_required/);
    assert.match(workflow, /email-context-v6/);
  }
});

test("ops UI presents passive learning as normal and manual review as an exception", () => {
  assert.match(qualityLibrary, /get_email_agent_learning_quality_v4/);
  assert.match(reviewUi, /Lernt im Hintergrund/);
  assert.match(reviewUi, /Optionale Ausnahmeprüfung/);
  assert.match(reviewUi, /automatisch sicher/);
  assert.doesNotMatch(reviewUi, /übernimmt Verbesserungen erst nach menschlicher Freigabe/);
});

test("database surface is service-role-only and rollback is non-destructive", () => {
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.match(rollback, /drop function if exists public\.get_email_agent_learning_quality_v4/);
  assert.match(rollback, /drop view if exists public\.email_agent_auto_style_eligibility_v1/);
  assert.doesNotMatch(rollback, /drop table/i);
  assert.doesNotMatch(rollback, /delete from/i);
});
