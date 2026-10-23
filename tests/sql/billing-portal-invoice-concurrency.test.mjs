// Disposable development PostgreSQL only; never point this test at a live database.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const container = process.env.BILLING_TEST_CONTAINER || "portal-invoice-test-20261023";
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.HostConfig.NetworkMode}}", container], { encoding: "utf8" }).trim(), "none");
const args = ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1"];
function sql(input) {
  return execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function session(input) {
  const child = spawn("docker", args);
  let output = "", errors = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { errors += chunk; });
  const closed = once(child, "close").then(([code]) => ({ code, output, errors }));
  child.stdin.write(input + "\n");
  return { child, closed, output: () => output };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(30);
  }
  throw new Error("Expected concurrent database lock was not observed");
}
const fixture = readFileSync("tests/sql/billing-portal-invoice.test.sql", "utf8").split("do $$\ndeclare c uuid; result")[0];
sql(fixture + "\nselect pg_temp.fixture(n) from generate_series(98101,98103) n;\ncommit;");
const request = n => "select billing_portal_request_invoice('test-token-" + n + "',true,0," +
  "(select updated_at from billing_cases where portal_token_hash='test-token-" + n + "'),'2026-10-23');";
const change = n => "select billing_portal_submit_change('test-token-" + n + "','race-edit-" + n +
  "','{\"billingAddress\":{\"city\":\"Hamburg\"}}','accounts@example.com');";

async function race(n, first, second, expectedError) {
  const holder = session("begin;\n" + first + "\nselect 'LOCK_READY';");
  await until(() => holder.output().includes("LOCK_READY"));
  const waiter = session("set application_name='portal_invoice_waiter_" + n + "';\n" + second);
  waiter.child.stdin.end();
  await until(() => sql("select count(*) from pg_stat_activity where application_name='portal_invoice_waiter_" + n + "' and wait_event_type='Lock';") === "1");
  holder.child.stdin.end("commit;\n");
  assert.equal((await holder.closed).code, 0);
  const result = await waiter.closed;
  if (expectedError) {
    assert.notEqual(result.code, 0);
    assert.ok(result.errors.includes(expectedError), result.errors);
  } else {
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.output).duplicate, true);
  }
}
try {
  await race(98101, request(98101), request(98101));
  await race(98102, request(98102), change(98102), "BILLING_PORTAL_READ_ONLY");
  await race(98103, change(98103), request(98103), "BILLING_INVOICE_CHANGES_PENDING");
  assert.equal(sql("select count(*) from billing_jobs j join billing_cases c on c.id=j.billing_case_id where c.shopify_order_id in ('98101','98102') and j.job_type='CREATE_INVOICE';"), "2");
  assert.equal(sql("select count(*) from billing_change_requests r join billing_cases c on c.id=r.billing_case_id where c.shopify_order_id='98102';"), "0");
  assert.equal(sql("select count(*) from billing_jobs j join billing_cases c on c.id=j.billing_case_id where c.shopify_order_id='98103' and j.job_type='CREATE_INVOICE';"), "0");
  console.log("PASS: concurrent request/request and both request/edit orderings; no duplicate or conflicting side effects.");
} finally {
  sql("begin; " + ["billing_jobs","billing_documents","billing_events","billing_change_requests"].map(table =>
    "delete from " + table + " where billing_case_id in (select id from billing_cases where shopify_order_id in ('98101','98102','98103'));").join(" ") +
    "delete from billing_cases where shopify_order_id in ('98101','98102','98103'); commit;");
}
