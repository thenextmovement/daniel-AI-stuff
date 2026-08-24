import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(resolve(root,
  "supabase/migrations/20260821063055_prepare_request_segmentation_treatment_shadow_always_on.sql"), "utf8");
const held = readFileSync(resolve(root,
  "supabase/rollouts/held/20260821070000_activate_request_segmentation_treatment_shadow_always_on.sql"), "utf8");
const fullRollback = readFileSync(resolve(root,
  "supabase/rollbacks/20260821063055_prepare_request_segmentation_treatment_shadow_always_on_rollback.sql"), "utf8");
const operationalRollback = readFileSync(resolve(root,
  "supabase/rollbacks/20260821070000_request_segmentation_treatment_shadow_operational_rollback.sql"), "utf8");
const trackingRedactionRepair = readFileSync(resolve(root,
  "supabase/migrations/20260824101129_repair_treatment_shadow_tracking_redaction.sql"), "utf8");
const trackingRedactionRollback = readFileSync(resolve(root,
  "supabase/rollbacks/20260824101129_repair_treatment_shadow_tracking_redaction_rollback.sql"), "utf8");
const reminderTreatmentDecision = readFileSync(resolve(root,
  "supabase/migrations/20260824110436_add_request_reminder_treatment_decision.sql"), "utf8");
const reminderTreatmentRollback = readFileSync(resolve(root,
  "supabase/rollbacks/20260824110436_add_request_reminder_treatment_decision_rollback.sql"), "utf8");

function functionBodyFrom(source: string, name: string) {
  const start = source.search(new RegExp(`create(?: or replace)? function public\\.${name}\\b`, "i"));
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `${name} terminator missing`);
  return source.slice(start, end + "$function$;".length);
}

function assertBalancedSqlQuotes(source: string, label: string) {
  let singleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) { if (current === "\n") lineComment = false; continue; }
    if (blockComment) {
      if (current === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (singleQuoted) {
      if (current === "'" && next === "'") index += 1;
      else if (current === "'") singleQuoted = false;
      continue;
    }
    if (current === "-" && next === "-") { lineComment = true; index += 1; continue; }
    if (current === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (current === "'") { singleQuoted = true; continue; }
    if (current === "$") {
      const match = source.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
      if (match) { dollarTag = match[0]; index += dollarTag.length - 1; }
    }
  }
  assert.equal(singleQuoted, false, `${label} unclosed quote`);
  assert.equal(blockComment, false, `${label} unclosed comment`);
  assert.equal(dollarTag, null, `${label} unclosed dollar quote`);
}

test("all always-on treatment SQL artifacts are atomic and quote-balanced", () => {
  for (const [label, source] of [
    ["migration", migration], ["held", held], ["full rollback", fullRollback],
    ["operational rollback", operationalRollback],
  ] as const) {
    assertBalancedSqlQuotes(source, label);
    assert.match(source, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  }
});

test("base migration is additive and keeps the candidate inactive", () => {
  assert.doesNotMatch(migration, /create\s+table|create\s+(?:unique\s+)?index|alter\s+table[\s\S]*?add\s+column/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.request_segmentation_jobs/i);
  assert.doesNotMatch(migration, /update\s+public\.master_requests/i);
  assert.match(migration, /'nt_quality_gate_v6_20260821_treatment_shadow'[\s\S]*?'segment_classifier_v7_20260821_treatment_shadow'[\s\S]*?false/i);
  assert.match(migration, /'nt_policy_v6_20260821_treatment_shadow',[\s\S]*?false,[\s\S]*?'shadow'/i);
});

test("all eight candidate rules remain commercially inert", () => {
  assert.match(migration, /insert into public\.segment_policy_rules[\s\S]*?'nt_policy_v6_20260821_treatment_shadow'[\s\S]*?null,[\s\S]*?0,[\s\S]*?null,[\s\S]*?'\[\]'::jsonb,[\s\S]*?'\[\]'::jsonb/i);
  for (const source of [migration, held]) {
    assert.match(source, /automation_enabled[\s\S]*?needs_human_review[\s\S]*?price_factor is not null[\s\S]*?max_followups <> 0/i);
  }
});

test("payload is minimized, dynamic-source-bound and service-role-only", () => {
  const payload = functionBodyFrom(migration, "neontrip_get_request_segmentation_treatment_shadow_payload");
  assert.match(payload, /j\.status = 'processing'[\s\S]*?j\.lock_owner = 'n8n-request-segmenter-v7-treatment-shadow'/i);
  assert.match(payload, /lower\(coalesce\(j\.metadata->>'evaluation_only', 'true'\)\) = 'false'/i);
  assert.match(payload, /lower\(coalesce\(j\.metadata->>'master_projection_authorized', 'false'\)\) = 'true'/i);
  assert.match(payload, /'source', \(select source from exact_job\)/i);
  assert.match(payload, /'company', null[\s\S]*?'company_lookup_allowed', false/i);
  assert.match(payload, /'domain_lookup_allowed',[\s\S]*?is_freemail[\s\S]*?is_shared_provider/i);
  assert.match(migration, /revoke all on function public\.neontrip_get_request_segmentation_treatment_shadow_payload\(uuid\)[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.doesNotMatch(payload.slice(payload.indexOf("else jsonb_build_object")), /'job_id'|'request_id'|'input_hash'|'email'|'phone'|'gold'|'cache'|'related_history'/i);
});

test("canonical record patch adds exactly the v7 worker and pins both prompt pairs", () => {
  assert.match(migration, /actual_md5=%s[\s\S]*?0ab12d2ba650117b1151eb4729949547/i);
  assert.match(migration, /segment_classifier_v3_20260819_cx8'[\s\S]*?segment_prompt_v4_20260819_cx8'[\s\S]*?n8n-request-segmenter-v3/i);
  assert.match(migration, /segment_classifier_v4_20260820_cx8'[\s\S]*?segment_prompt_v4_20260819_cx8'[\s\S]*?n8n-request-segmenter-v4/i);
  assert.match(migration, /segment_classifier_v7_20260821_treatment_shadow'[\s\S]*?segment_prompt_v7_20260821_treatment_shadow'[\s\S]*?n8n-request-segmenter-v7-treatment-shadow/i);
  assert.match(migration, /4dfc1d420a265ee7c13aa4658dec4e6a/i);
  assert.doesNotMatch(migration, /drop function public\.neontrip_record_request_segment_classification/i);
});

test("held activation flips policy and gate only after both lanes are safe", () => {
  assert.match(held, /old_contract_not_drained/i);
  assert.match(held, /candidate_runtime_not_pristine/i);
  assert.match(held, /status in \('pending', 'processing'\)[\s\S]*?attempts < max_attempts/i);
  assert.match(held, /set active = false[\s\S]*?nt_policy_v2_20260819_cx8_shadow/i);
  assert.match(held, /set active = true[\s\S]*?nt_policy_v6_20260821_treatment_shadow/i);
  assert.doesNotMatch(held, /insert\s+into\s+public\.request_segmentation_jobs|update\s+public\.master_requests/i);
});

test("operational rollback preserves history and requires zero processing", () => {
  assert.match(operationalRollback, /status = 'processing'[\s\S]*?lock_owner is not null[\s\S]*?locked_at is not null/i);
  assert.match(operationalRollback, /set active = false[\s\S]*?nt_policy_v6_20260821_treatment_shadow/i);
  assert.match(operationalRollback, /set active = true[\s\S]*?nt_policy_v2_20260819_cx8_shadow/i);
  assert.doesNotMatch(operationalRollback, /delete\s+from\s+public\.(?:request_segmentation_jobs|request_segment_classifications|request_segmentation_gold_adjudications)/i);
});

test("full rollback is allowed only before runtime history and restores exact record md5", () => {
  assert.match(fullRollback, /request_segmentation_jobs[\s\S]*?segment_classifier_v7_20260821_treatment_shadow/i);
  assert.match(fullRollback, /request_segment_classifications[\s\S]*?segment_classifier_v7_20260821_treatment_shadow/i);
  assert.match(fullRollback, /drop function public\.neontrip_get_request_segmentation_treatment_shadow_payload\(uuid\)/i);
  assert.match(fullRollback, /0ab12d2ba650117b1151eb4729949547/i);
  assert.doesNotMatch(fullRollback, /delete\s+from\s+public\.(?:request_segmentation_jobs|request_segment_classifications|request_segmentation_gold_adjudications)/i);
});

test("tracking redaction repair is bounded, drift-gated and keeps the helper private", () => {
  assertBalancedSqlQuotes(trackingRedactionRepair, "tracking redaction repair");
  assert.match(trackingRedactionRepair, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(trackingRedactionRepair, /fd9cfccc390984564a5091ab39d67612/i);
  assert.ok(trackingRedactionRepair.includes(
    "\\m(utm_[[:alnum:]_]+|gclid|gbraid|wbraid|fbclid)\\M"));
  assert.match(trackingRedactionRepair, /\[TRACKING\]/);
  assert.match(trackingRedactionRepair,
    /revoke all on function public\.neontrip_treatment_redact_segmentation_text\(text, integer, text\[\]\)[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(trackingRedactionRepair,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:request_segmentation_jobs|request_segment_classifications|master_requests|segment_research_cache)/i);
});

test("tracking redaction rollback is exact, idle-gated and non-destructive", () => {
  assertBalancedSqlQuotes(trackingRedactionRollback, "tracking redaction rollback");
  assert.match(trackingRedactionRollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(trackingRedactionRollback, /d450996670c9e9c6e1d585468c7a547a/i);
  assert.match(trackingRedactionRollback, /fd9cfccc390984564a5091ab39d67612/i);
  assert.match(trackingRedactionRollback,
    /status = 'processing' or lock_owner is not null or locked_at is not null/i);
  assert.doesNotMatch(trackingRedactionRollback,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:request_segmentation_jobs|request_segment_classifications|master_requests|segment_research_cache)/i);
});

test("reminder treatment is a quote-balanced suppression-only decision", () => {
  assertBalancedSqlQuotes(reminderTreatmentDecision, "reminder treatment decision");
  assert.match(reminderTreatmentDecision, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(reminderTreatmentDecision, /4dfc1d420a265ee7c13aa4658dec4e6a/i);
  assert.match(reminderTreatmentDecision,
    /segment_classifier_v7_20260821_treatment_shadow[\s\S]*?then 'n8n_cx8_validator_v4'[\s\S]*?else 'n8n_cx8_validator_v1'/i);
  assert.match(reminderTreatmentDecision,
    /create function public\.neontrip_get_request_reminder_treatment_decision\([\s\S]*?security invoker/i);
  assert.match(reminderTreatmentDecision,
    /c\.evidence_provenance_valid[\s\S]*?c\.mapping_integrity[\s\S]*?cardinality\(coalesce\(c\.risk_flags/i);
  assert.match(reminderTreatmentDecision,
    /special_handling_required'\s*=\s*'true'::jsonb[\s\S]*?positive_evidence_valid'\s*=\s*'true'::jsonb/i);
  assert.match(reminderTreatmentDecision,
    /'automatic_email_allowed', not personal_followup[\s\S]*?'max_automatic_reminders', case when personal_followup then 0 else 1 end[\s\S]*?'suppression_only', true/i);
  assert.match(reminderTreatmentDecision,
    /revoke all on function public\.neontrip_get_request_reminder_treatment_decision\(uuid\)[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.doesNotMatch(reminderTreatmentDecision,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:master_requests|request_segment_classifications|offer_followup_queue|ops_internal_tasks)/i);
});

test("reminder treatment rollback is idle-gated, exact and non-destructive", () => {
  assertBalancedSqlQuotes(reminderTreatmentRollback, "reminder treatment rollback");
  assert.match(reminderTreatmentRollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(reminderTreatmentRollback,
    /status = 'processing'[\s\S]*?lock_owner is not null[\s\S]*?locked_at is not null/i);
  assert.match(reminderTreatmentRollback,
    /drop function public\.neontrip_get_request_reminder_treatment_decision\(uuid\)/i);
  assert.match(reminderTreatmentRollback, /4dfc1d420a265ee7c13aa4658dec4e6a/i);
  assert.doesNotMatch(reminderTreatmentRollback,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:request_segmentation_jobs|request_segment_classifications|master_requests|segment_research_cache)/i);
});
