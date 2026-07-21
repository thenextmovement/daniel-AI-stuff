import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireLock,
  resolveConfig,
  runScheduler,
  SchedulerError,
} from "../../scripts/arrival_label_scheduler_lib.mjs";
import {
  parseManagerArgs,
  renderPlist,
} from "../../scripts/manage_arrival_label_scheduler.mjs";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  USER: "scheduler-test",
  NEONTRIP_OPS_BASE_URL: "https://ops.neontrip.de",
};

test("local scheduler defaults to dry-run and the exact approved endpoint", () => {
  const config = resolveConfig([], baseEnvironment);
  assert.equal(config.mode, "dry_run");
  assert.equal(config.apiUrl, "https://ops.neontrip.de/api/internal/arrival-labels/run");
});

test("local scheduler rejects HTTP, unapproved hosts and alternate paths", () => {
  assert.throws(() => resolveConfig([], { ...baseEnvironment, NEONTRIP_OPS_BASE_URL: "http://ops.neontrip.de" }), /HTTPS/);
  assert.throws(() => resolveConfig(["--api-url", "https://attacker.invalid/api/internal/arrival-labels/run"], baseEnvironment), /nicht freigegeben/);
  assert.throws(() => resolveConfig(["--api-url", "https://ops.neontrip.de/api/internal/other"], baseEnvironment), /Pfad/);
});

test("execute requires both the environment gate and the explicit acknowledgement", () => {
  assert.throws(() => resolveConfig(["--mode", "execute"], baseEnvironment), /verriegelt/);
  assert.throws(() => resolveConfig(["--mode", "execute", "--acknowledge-production-write"], {
    ...baseEnvironment,
    ARRIVAL_LABEL_SCHEDULER_LIVE_ENABLED: "false",
  }), /verriegelt/);
  const config = resolveConfig(["--mode", "execute", "--acknowledge-production-write"], {
    ...baseEnvironment,
    ARRIVAL_LABEL_SCHEDULER_LIVE_ENABLED: "true",
  });
  assert.equal(config.mode, "execute");
});

test("scheduler submits once, uses local_schedule and never emits case PII", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let releases = 0;
  const config = { ...resolveConfig([], baseEnvironment), lockPath: "/unused/test-lock" };
  const result = await runScheduler(config, {
    acquireLockImpl: () => () => { releases += 1; },
    readSecret: () => "a-secret-with-at-least-24-characters",
    fetchImpl: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({
        ok: true,
        requestId: "request-1",
        result: {
          runId: "run-1",
          summary: { found: 2, labelPlanned: 1, existingLabel: 0, manualReview: 1, specialCase: 0, reviewNotifications: 1 },
          cases: [{ customerName: "Sensitive Customer", address: "Private Street 1" }],
        },
      });
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { mode: "dry_run", persist: true, triggerType: "local_schedule" });
  assert.match(String((calls[0].init.headers as Record<string, string>).Authorization), /^Bearer /);
  assert.equal(JSON.stringify(result).includes("Sensitive Customer"), false);
  assert.equal(JSON.stringify(result).includes("Private Street"), false);
  assert.equal(result.summary.found, 2);
  assert.equal(releases, 1);
});

test("scheduler never retries an ambiguous API failure and releases its lock", async () => {
  let calls = 0;
  let releases = 0;
  const config = { ...resolveConfig([], baseEnvironment), lockPath: "/unused/test-lock" };
  await assert.rejects(() => runScheduler(config, {
    acquireLockImpl: () => () => { releases += 1; },
    readSecret: () => "a-secret-with-at-least-24-characters",
    fetchImpl: async () => { calls += 1; throw new Error("ambiguous network state"); },
  }), (error: unknown) => error instanceof SchedulerError && error.exitCode === 69);
  assert.equal(calls, 1);
  assert.equal(releases, 1);
});

test("scheduler lock blocks overlap and can be released", () => {
  const temporary = mkdtempSync(join(tmpdir(), "arrival-scheduler-lock-test-"));
  const lock = join(temporary, "run.lock");
  try {
    const release = acquireLock(lock);
    assert.throws(() => acquireLock(lock), (error: unknown) => error instanceof SchedulerError && error.exitCode === 75);
    release();
    const releaseAgain = acquireLock(lock);
    releaseAgain();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("LaunchAgent manager defaults to a five-minute dry-run and double-gates execute", () => {
  assert.deepEqual(parseManagerArgs(["install"]), {
    command: "install",
    mode: "dry_run",
    intervalSeconds: 300,
    acknowledgeProductionWrite: false,
  });
  assert.throws(() => parseManagerArgs(["install", "--mode", "execute"]), /acknowledge-production-write/);
  assert.equal(parseManagerArgs(["install", "--mode", "execute", "--acknowledge-production-write"]).mode, "execute");
});

test("LaunchAgent rendering leaves no placeholder or secret value", () => {
  const template = `{{NODE_PATH}}|{{RUNNER_PATH}}|{{MODE}}|{{EXECUTE_ACK_ARGUMENT}}|{{HOME}}|{{OPS_BASE_URL}}|{{KEYCHAIN_ACCOUNT}}|{{LIVE_ENABLED}}|{{CF_CLIENT_ID_ENV}}|{{INTERVAL_SECONDS}}|{{STDOUT_PATH}}|{{STDERR_PATH}}`;
  const rendered = renderPlist(template, {
    runnerPath: "/safe/runtime/run.mjs",
    mode: "dry_run",
    home: "/Users/test",
    opsBaseUrl: "https://ops.neontrip.de",
    keychainAccount: "test-account",
    cfClientId: "",
    intervalSeconds: 300,
    logDir: "/Users/test/Library/Logs/NEONTRIP",
  });
  assert.doesNotMatch(rendered, /\{\{/);
  assert.doesNotMatch(rendered, /API_TOKEN|CLIENT_SECRET|Bearer /);
  assert.match(rendered, /dry_run/);
});

test("local schedule trigger migration is constrained, audited and safely reversible", () => {
  const migration = readFileSync("supabase/migrations/20260721172000_allow_local_arrival_label_schedule.sql", "utf8");
  const rollback = readFileSync("supabase/rollbacks/20260721172000_allow_local_arrival_label_schedule_rollback.sql", "utf8");
  assert.match(migration, /arrival_label_runs_trigger_check/);
  assert.match(migration, /'local_schedule'/);
  assert.match(migration, /Audited origin/);
  assert.match(rollback, /where trigger_type = 'local_schedule'/);
  assert.match(rollback, /Rollback blocked/);
  assert.doesNotMatch(rollback, /delete\s+from\s+public\.arrival_label_runs/i);
});

test("Coolify sync uses a separate scheduler secret with an explicit delete rollback", () => {
  const workflow = readFileSync(".github/workflows/coolify-secret-sync.yml", "utf8");
  assert.match(workflow, /sync_ops_arrival_label_scheduler_token/);
  assert.match(workflow, /delete_ops_arrival_label_scheduler_token/);
  assert.match(workflow, /secrets\.ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN/);
  assert.match(workflow, /previous: previous \? envSummary\(previous\) : null/);
  assert.match(workflow, /valueSha256Prefix/);
  assert.doesNotMatch(workflow, /console\.log\([^\n]*ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN/);
});

test("Microsoft Graph secret rotation preserves the prior Coolify value as rollback", () => {
  const workflow = readFileSync(".github/workflows/coolify-secret-sync.yml", "utf8");
  const clients = readFileSync("src/lib/ops/arrival-labels/clients.ts", "utf8");
  assert.match(workflow, /sync_ops_microsoft_graph_secret/);
  assert.match(workflow, /delete_ops_microsoft_graph_secret_next/);
  assert.match(workflow, /MICROSOFT_GRAPH_CLIENT_SECRET_NEXT/);
  assert.match(workflow, /fallbackKeyPreserved: "MICROSOFT_GRAPH_CLIENT_SECRET"/);
  assert.match(workflow, /previous: previous \? envSummary\(previous\) : null/);
  assert.match(clients, /MICROSOFT_GRAPH_CLIENT_SECRET_NEXT/);
  assert.match(clients, /\|\| requiredEnv\("MICROSOFT_GRAPH_CLIENT_SECRET"\)/);
});
