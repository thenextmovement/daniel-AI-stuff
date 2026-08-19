import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260819123716_harden_request_segmentation_phase1.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "supabase/security-backups/request-segmentation-phase1-prechange-20260819.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");

test("migration applies its function and ACL contract atomically", () => {
  assert.match(migration, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
});

test("shadow classification records a result but cannot project to master_requests", () => {
  assert.match(migration, /if v_policy_mode = 'shadow' then\s+v_projection_reason := 'policy_mode_shadow'/i);
  assert.match(migration, /'effective_status', v_effective_status/i);
  assert.match(migration, /'projection', jsonb_build_object\([\s\S]*?'applied', v_projection_applied/i);
  assert.match(migration, /p_policy_mode in \('followup_live', 'pricing_live'\)/i);
  assert.match(migration, /if v_verified_company_identity is not true then\s+return false/i);
  assert.match(migration, /'research_cache_written', v_research_cache_written/i);
});

test("manual authority and review proposals stay separate", () => {
  assert.match(migration, /coalesce\(v_request\.segment_source, ''\) ~ '\^manual_'/i);
  assert.match(migration, /v_projection_reason := 'manual_authoritative_preserved'/i);
  assert.match(migration, /elsif v_existing_authoritative then\s+v_projection_reason := 'existing_authoritative_preserved'/i);
  assert.match(migration, /elsif v_effective_status in \('needs_review', 'rejected', 'error'\)[\s\S]*?segment = null,[\s\S]*?segment_confidence = null/i);
  assert.match(migration, /'proposed_segment', p_segment,[\s\S]*?'effective_segment', v_effective_segment/i);
});

test("manual RPC is atomic, service-role-only, and does not fake model confidence", () => {
  assert.match(migration, /create or replace function public\.neontrip_set_manual_request_segment/i);
  assert.match(migration, /segment_confidence = null/i);
  assert.match(migration, /insert into public\.workflow_audit_log/i);
  assert.match(migration, /'customer_records_console',[\s\S]*?'customer_request_segment_override'/i);
  assert.match(migration, /segment_policy_version = 'manual_override_v1_20260819'/i);
  assert.match(migration, /revoke all on function public\.neontrip_set_manual_request_segment[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.neontrip_set_manual_request_segment[\s\S]*?to service_role/i);
});

test("manual import RPC cannot overwrite manual authority after taking its row lock", () => {
  const rpcStart = migration.indexOf("create or replace function public.neontrip_set_manual_request_segment");
  const rpcEnd = migration.indexOf("$function$;", rpcStart);
  const rpc = migration.slice(rpcStart, rpcEnd);
  const rowLock = rpc.indexOf("for update;");
  const importGuard = rpc.indexOf("if v_source = 'manual_ops_import'");
  const segmentUpdate = rpc.indexOf("update public.master_requests");

  assert.ok(rowLock >= 0);
  assert.ok(importGuard > rowLock);
  assert.ok(segmentUpdate > importGuard);
  assert.match(
    rpc,
    /if v_source = 'manual_ops_import'[\s\S]*?lower\(btrim\(coalesce\(v_request\.segment_source, ''\)\)\) ~ '\^manual_\[a-z0-9_\]\+\$'[\s\S]*?manual_ops_import_existing_manual_authority/i,
  );
  assert.doesNotMatch(rpc, /if v_source = 'manual_ops_portal'[\s\S]*?raise exception/i);
});

test("manual import idempotency is an atomic bounded partial unique index", () => {
  assert.match(migration, /do \$manual_import_idempotency_precondition\$[\s\S]*?duplicate_groups[\s\S]*?duplicate_extra_rows[\s\S]*?max_key_bytes/i);
  assert.match(
    migration,
    /add constraint master_requests_manual_ops_import_idempotency_key_len_check[\s\S]*?octet_length\(btrim\(attribution_raw->>'idempotency_key'\)\) <= 512/i,
  );
  assert.match(
    migration,
    /create unique index master_requests_manual_ops_import_idempotency_key_uidx\s+on public\.master_requests \(\(btrim\(attribution_raw->>'idempotency_key'\)\)\)\s+where form_id = 'manual_ops_import'\s+and nullif\(btrim\(attribution_raw->>'idempotency_key'\), ''\) is not null/i,
  );
  assert.equal("master_requests_manual_ops_import_idempotency_key_uidx".length <= 63, true);
  assert.match(rollback, /drop index if exists public\.master_requests_manual_ops_import_idempotency_key_uidx/i);
  assert.match(rollback, /drop constraint if exists master_requests_manual_ops_import_idempotency_key_len_check/i);
});

test("cache reuse excludes shared providers and requires stored-company identity", () => {
  assert.match(migration, /'is_freemail', is_freemail/i);
  assert.match(migration, /'is_shared_provider', is_shared_provider/i);
  assert.match(migration, /'is_valid_dns_host', is_valid_dns_host/i);
  assert.match(migration, /'email_domain_cache_allowed', is_valid_dns_host and not is_shared_provider/i);
  assert.match(migration, /split_part\(split_part\(split_part\(value, '\/', 1\), '\?', 1\), '#', 1\)/i);
  assert.match(migration, /src\.summary_json->>'effective_status' = 'accepted'/i);
  assert.match(migration, /src\.summary_json->>'verified_company_identity' = 'true'/i);
  assert.match(migration, /v_customer_company is not null/i);
  assert.match(migration, /regexp_replace\(lower\(v_company_name\)[\s\S]*?= regexp_replace\(lower\(v_customer_company\)/i);
  assert.match(migration, /v_has_matching_evidence_url/i);
  assert.match(migration, /evidence_domain\.facts->>'email_domain' = v_website_domain/i);
  assert.match(migration, /'evidence_website_domain_verified', true/i);
  assert.doesNotMatch(migration, /v_email_domain like|v_website_domain like|evidence_domain\.facts->>'email_domain' like/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.segment_research_cache/i);

  const providerBlocks = [...migration.matchAll(
    /from unnest\(array\[\s*([\s\S]*?)\s*\]::text\[\]\) as providers\(domain\)/gi,
  )];
  assert.ok(providerBlocks.length >= 2);
  const sharedProviders = [...providerBlocks[1][1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const isSharedProvider = (domain: string) => sharedProviders.some(
    (provider) => domain === provider || domain.endsWith(`.${provider}`),
  );
  for (const provider of [
    "mail.com",
    "gmx.at",
    "gmx.ch",
    "outlook.de",
    "hotmail.de",
    "live.de",
    "yahoo.co.uk",
    "email.de",
    "bluewin.ch",
    "kabelmail.de",
  ]) {
    assert.equal(isSharedProvider(provider), true, provider);
    assert.equal(isSharedProvider(`relay.${provider}`), true, `relay.${provider}`);
  }

  const dnsPattern = migration.match(/email_domain ~ '([^']+)'/i)?.[1];
  assert.ok(dnsPattern);
  const dnsHost = new RegExp(dnsPattern);
  for (const valid of ["example.com", "sub.example.co.uk", "xn--mnchen-3ya.de"]) {
    assert.equal(dnsHost.test(valid), true, valid);
  }
  for (const invalid of ["bad%.com", "bad_.com", "bad domain.com", "example", "-bad.com", "bad-.com", "example.c"]) {
    assert.equal(dnsHost.test(invalid), false, invalid);
  }
});

test("record RPC rejects stale inputs and blocking risk flags from projection", () => {
  assert.match(migration, /neontrip_compute_request_segment_input_hash\(p_request_id\)[\s\S]*?v_input_hash_current :=/i);
  assert.match(migration, /elsif not v_input_hash_current then\s+v_projection_reason := 'stale_input_hash'/i);
  assert.match(migration, /'conflicting_evidence',[\s\S]*?'missing_external_company_evidence',[\s\S]*?'prompt_injection_seen'/i);
  assert.match(migration, /'freemail_business_unclear',[\s\S]*?'missing_company_identity'/i);
  assert.match(migration, /v_has_external_url boolean[\s\S]*?jsonb_array_elements\([\s\S]*?p_evidence_json[\s\S]*?evidence_domain\.facts->>'is_valid_dns_host'/i);
  assert.doesNotMatch(migration, /v_has_external_url :=[\s\S]{0,500}\bor coalesce\(p_firmographic_json->>'website'/i);
  assert.match(migration, /array_agg\(distinct lower\(trim\(flag\)\) order by lower\(trim\(flag\)\)\)/i);
});

test("related history is same-customer-only and limits rows before aggregation", () => {
  assert.match(
    migration,
    /related_history_rows as \([\s\S]*?join customer c on mr\.customer_id = c\.id[\s\S]*?order by mr\.created_at desc, mr\.id\s+limit 10\s+\),\s+related_history as \([\s\S]*?from related_history_rows mr/i,
  );
  const payloadStart = migration.indexOf("create or replace function public.neontrip_get_request_segmentation_payload");
  const payloadEnd = migration.indexOf("$function$;", payloadStart);
  const payload = migration.slice(payloadStart, payloadEnd);
  assert.doesNotMatch(payload, /from public\.master_customers mc2/i);
});

test("automation decision uses manual authority or only the latest current AI classification", () => {
  assert.match(migration, /create or replace function public\.neontrip_get_request_segmentation_automation_decision/i);
  assert.match(migration, /order by c\.created_at desc, c\.id desc\s+limit 1/i);
  assert.match(migration, /current_classification as \([\s\S]*?c\.input_hash = ci\.input_hash[\s\S]*?order by c\.created_at desc, c\.id desc/i);
  assert.match(migration, /on conflict \(request_id, input_hash, classifier_version\) do update set[\s\S]*?created_at = now\(\)/i);
  assert.match(migration, /coalesce\(mr\.segment_source, ''\) ~ '\^manual_\[a-z0-9_\]\+\$'/i);
  assert.match(migration, /mr\.segment_source = 'request_segmenter'[\s\S]*?cc\.status = 'accepted'[\s\S]*?cc\.input_hash = ci\.input_hash[\s\S]*?cc\.policy_version = ap\.version[\s\S]*?mr\.segment_policy_version = ap\.version/i);
  assert.match(migration, /pr\.s_kategorie = mr\.s_kategorie/i);
  assert.match(migration, /and \(manual_authority or request_playbook_automation_enabled\)/i);
  assert.match(migration, /'authority',[\s\S]*?'kind',[\s\S]*?'manual_authority',[\s\S]*?'ai_authority'/i);
  assert.match(migration, /revoke all on function public\.neontrip_get_request_segmentation_automation_decision\(uuid\)[\s\S]*?grant execute[\s\S]*?to service_role/i);
});

test("enqueue removes only pending fallback NT-8 or NT-9 and preserves manual authority", () => {
  assert.match(migration, /segment = case when segment in \('NT-8', 'NT-9'\) then null else segment end/i);
  assert.match(migration, /coalesce\(segment_source, ''\) !~ '\^manual_'/i);
  assert.match(migration, /coalesce\(segment_status, 'pending'\) in \('pending', 'legacy', 'error'\)/i);
  assert.doesNotMatch(migration, /update public\.master_requests[\s\S]*?where segment_source like 'manual\\_%'/i);
});

test("follow-up claim preserves payment exclusion and gates before lease creation", () => {
  const paymentGate = migration.indexOf("queued.followup_type not like 'payment_reminder%'");
  const segmentationGate = migration.indexOf("public.neontrip_get_followup_queue_segmentation_decision(queued.id)");
  const attemptInsert = migration.indexOf("insert into public.followup_delivery_attempts", segmentationGate);
  assert.ok(paymentGate >= 0);
  assert.ok(segmentationGate > paymentGate);
  assert.ok(attemptInsert > segmentationGate);
  assert.match(migration, /->>'send_allowed'[\s\S]*?::boolean,[\s\S]*?false/i);
});

test("pre-change rollback snapshot contains affected definitions and safe aggregate state", () => {
  assert.match(rollback, /Captured at: 2026-08-19T12:25:06\.796359\+00:00/);
  assert.match(rollback, /create function public\.neontrip_record_request_segment_classification/i);
  assert.match(rollback, /create or replace function public\.neontrip_enqueue_request_segmentation/i);
  assert.match(rollback, /create or replace function public\.neontrip_get_request_segmentation_payload/i);
  assert.match(rollback, /create function public\.neontrip_upsert_segment_research_cache_from_classification/i);
  assert.match(rollback, /Exact live pre-change per-request automation-decision contract/);
  assert.match(rollback, /create or replace function public\.neontrip_get_request_segmentation_automation_decision/i);
  assert.match(rollback, /create or replace function public\.claim_followup_delivery_candidate/i);
  assert.match(rollback, /begin;[\s\S]*commit;/i);
  assert.match(rollback, /begin;\s+set local check_function_bodies = off;/i);
  assert.match(rollback, /comment on function public\.neontrip_enqueue_request_segmentation\(uuid, text, integer\) is null/i);
  assert.match(rollback, /Service-role-only deterministic consumer contract for using request segmentation/i);

  const payloadRestore = rollback.indexOf("create or replace function public.neontrip_get_request_segmentation_payload");
  const cacheRestore = rollback.indexOf("create function public.neontrip_upsert_segment_research_cache_from_classification");
  const domainHelperDrop = rollback.lastIndexOf("drop function if exists public.neontrip_request_segmentation_domain_facts");
  assert.ok(domainHelperDrop > payloadRestore);
  assert.ok(domainHelperDrop > cacheRestore);
});
