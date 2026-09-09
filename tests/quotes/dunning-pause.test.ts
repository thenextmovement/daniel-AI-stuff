import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("managed dunning pauses are audited, stale-safe and legacy-safe", () => {
  const migration = read(
    "supabase/migrations/20260909143000_add_dunning_pause_controls.sql",
  );
  assert.match(migration, /add column if not exists pause_mode text/);
  assert.match(migration, /add column if not exists pause_until timestamptz/);
  assert.match(migration, /pause_version bigint not null default 0/);
  assert.match(migration, /create table public[.]dunning_pause_events/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /alter table public[.]dunning_pause_events enable row level security/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /pause_mode is null\s+and pause_until is null/);
  assert.doesNotMatch(migration, /update public[.]dunning_status\s+set pause_mode/);
  assert.doesNotMatch(migration, /sendMail|graph[.]microsoft[.]com/i);
});

test("pause and email claim share a case lock and fail closed during a send", () => {
  const migration = read(
    "supabase/migrations/20260909143000_add_dunning_pause_controls.sql",
  );
  const sharedLock =
    /pg_advisory_xact_lock\(hashtextextended\(v_order, 271\)\)/g;
  assert.equal(migration.match(sharedLock)?.length, 2);
  assert.match(migration, /DUNNING_PAUSE_SEND_IN_PROGRESS/);
  assert.match(migration, /active_lock[.]status = 'processing'/);
  assert.match(
    migration,
    /create function public[.]claim_dunning_email_if_unpaused/,
  );
  assert.match(migration, /if coalesce\(v_paused, false\) then/);
  assert.match(migration, /raise exception 'DUNNING_PAUSE_ACTIVE'/);
  assert.match(migration, /insert into public[.]email_locks/);
  assert.match(migration, /'processing'/);
});

test("automatic resume is due-only and idempotent", () => {
  const migration = read(
    "supabase/migrations/20260909143000_add_dunning_pause_controls.sql",
  );
  assert.match(migration, /v_action not in \('pause', 'resume', 'auto_resume'\)/);
  assert.match(migration, /v_status[.]pause_mode is distinct from 'until_date'/);
  assert.match(migration, /v_status[.]pause_until > now\(\)/);
  assert.match(migration, /DUNNING_PAUSE_NOT_DUE/);
  assert.match(migration, /perform pg_advisory_xact_lock\(hashtextextended\(p_idempotency_key, 271\)\)/);
  assert.match(migration, /where existing[.]idempotency_key = p_idempotency_key/);
  assert.match(migration, /return query select\s+false,/);
});

test("the n8n rollout plan resumes only managed pauses and preserves every live gate", () => {
  const artifact = JSON.parse(
    read("workflows/dunning/ticket-271-pause-resume-plan.json"),
  ) as {
    workflowId: string;
    precondition: { activeVersionId: string; nodeCount: number };
    validation: { valid: boolean; applied: boolean; operationCount: number };
    changes: Array<Record<string, unknown>>;
    requiredFixtures: Array<{ name: string; expected: string }>;
  };
  const serialized = JSON.stringify(artifact);
  assert.equal(artifact.workflowId, "HzMgctp78bcMq44A");
  assert.equal(
    artifact.precondition.activeVersionId,
    "6383e43f-f42a-471b-a5ed-594c7c67de69",
  );
  assert.equal(artifact.precondition.nodeCount, 43);
  assert.equal(artifact.validation.valid, true);
  assert.equal(artifact.validation.applied, false);
  assert.equal(artifact.validation.operationCount, 14);
  assert.match(serialized, /Legacy\/AI pauses with null pause_mode/);
  assert.match(serialized, /Read Current Dunning Hold/);
  assert.match(serialized, /MANUAL_HOLD_EVIDENCE_INCOMPLETE/);
  assert.match(serialized, /claim_dunning_email_if_unpaused/);
  assert.match(serialized, /reply_restart S1 cycle/);
  assert.match(serialized, /partial_payment S1 cycle/);
  assert.match(serialized, /full payment, stop tag, refund, dispute or credit/);
});
