import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260727110000_create_undeliverable_offer_agent.sql", "utf8");
const rollback = readFileSync("supabase/rollbacks/20260727110000_create_undeliverable_offer_agent_rollback.sql", "utf8");

test("migration is fail closed and service-role scoped", () => {
  for (const table of ["undeliverable_offer_settings", "undeliverable_offer_cases", "undeliverable_offer_events"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, "i"));
  }
  assert.doesNotMatch(sql, /grant\s+(?:all|execute|select|insert|update)[\s\S]{0,120}\b(?:anon|authenticated)\b/i);
});

test("side effects have durable one-attempt and unknown-outcome boundaries", () => {
  assert.match(sql, /attempt_count between 0 and 1/i);
  assert.match(sql, /max_send_attempts = 1/i);
  assert.match(sql, /p_result not in \('sent','failed','unknown'\)/i);
  assert.match(sql, /execution_idempotency_key text unique/i);
  assert.match(sql, /source_message_id text not null unique/i);
});

test("customer correction uses compare and set", () => {
  assert.match(sql, /update public\.master_requests set email=v_case\.proposed_email where request_id=v_case\.request_id and lower\(trim\(email\)\)=v_case\.failed_email/i);
  assert.match(sql, /customer_email_compare_and_set_failed/i);
});

test("A\/N 14706 cannot auto approve", () => {
  assert.match(sql, /coalesce\(v_case\.offer_number,''\)<>'14706'/i);
});

test("rollback covers all additive objects and warns about data loss", () => {
  assert.match(rollback, /Destructive: export/i);
  assert.match(rollback, /drop table if exists public\.undeliverable_offer_events/i);
  assert.match(rollback, /drop table if exists public\.undeliverable_offer_cases/i);
});

test("database only auto-approves internally verified evidence", () => {
  assert.match(sql, /in \('customer_supplied','existing_verified_contact'\)/i);
  assert.match(sql, /not exists \(select 1 from jsonb_array_elements\(p_evidence\)/i);
});
