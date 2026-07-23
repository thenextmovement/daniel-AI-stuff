import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as claimBrowserPurchase } from "../../src/app/api/internal/arrival-labels/browser-purchases/claim/route";
import { extractUniqueDpdTrackingNumber } from "../../src/lib/ops/arrival-labels/browser-purchase";
import { parseManagerArgs } from "../../scripts/manage_easydpd_browser_worker.mjs";
import { parseWorkerArgs, validateClaimedJob } from "../../scripts/easydpd_browser_worker_lib.mjs";

const TOKEN = "browser-worker-test-token-more-than-32-characters";
const WORKER_ID = "test-easydpd-worker-01";

function claimedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orderName: "#NEONT4535",
    orderUrl: "https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create?id=1234567890&shop=galaxybuzzdk.myshopify.com",
    productLabel: "B2C",
    labelFormat: "Einzeln auf A6",
    packageWeightGrams: 500,
    maximumPurchaseCents: 1500,
    incomingDhlTrackingNumber: "1234567890",
    incomingDhlLastSix: "567890",
    artifactPath: "/api/internal/arrival-labels/browser-purchases/11111111-1111-4111-8111-111111111111/artifact",
    resultPath: "/api/internal/arrival-labels/browser-purchases/11111111-1111-4111-8111-111111111111/result",
    ...overrides,
  };
}

test("worker and manager require two independent live acknowledgements", () => {
  assert.throws(() => parseWorkerArgs(["--mode", "live", "--once"]), /acknowledge-production-write/);
  assert.throws(() => parseWorkerArgs(["--mode", "live", "--acknowledge-production-write"]), /--once oder --daemon/);
  assert.equal(parseWorkerArgs(["--mode", "live", "--once", "--acknowledge-production-write"]).mode, "live");
  assert.equal(parseWorkerArgs(["--mode", "live", "--daemon", "--interval-seconds", "300", "--acknowledge-production-write"]).daemon, true);
  assert.throws(() => parseWorkerArgs(["--mode", "live", "--once", "--daemon", "--acknowledge-production-write"]), /nicht kombiniert/);
  assert.throws(() => parseWorkerArgs(["--daemon", "--interval-seconds", "59"]), /zwischen 60 und 86400/);
  assert.throws(() => parseManagerArgs(["install", "--mode", "live"]), /acknowledge-production-write/);
});

test("claimed job validation pins shop, route, product, A6, weight, full inbound tracking and 15 EUR cap", () => {
  assert.equal(validateClaimedJob(claimedJob()).incomingDhlLastSix, "567890");
  assert.throws(() => validateClaimedJob(claimedJob({ orderUrl: "https://evil.example/fulfillments/create?id=1234567890" })), /freigegebenen EasyDPD-Route/);
  assert.throws(() => validateClaimedJob(claimedJob({ maximumPurchaseCents: 1501 })), /Kaufpreisgrenze/);
  assert.throws(() => validateClaimedJob(claimedJob({ incomingDhlLastSix: "7890" })), /DHL-Sendungsnummer/);
});

test("DPD tracking extraction requires exactly one distinct 14 digit number", () => {
  assert.equal(extractUniqueDpdTrackingNumber("DPD parcel 01476817678011", "1234567890"), "01476817678011");
  assert.throws(() => extractUniqueDpdTrackingNumber("01476817678011 and 01476817678012", "1234567890"), /nicht eindeutig/);
});

test("schema makes Postgres the purchase boundary and never retries after dispatch", async () => {
  const sql = await readFile("supabase/migrations/20260721170915_create_arrival_label_browser_purchase_queue.sql", "utf8");
  assert.match(sql, /case_id uuid not null unique/i);
  assert.match(sql, /maximum_purchase_cents between 1 and 1500/i);
  assert.match(sql, /live_purchase_enabled boolean not null default false/i);
  assert.match(sql, /approved_products jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /status in \('dispatching', 'purchased', 'artifact_uploaded'\)[\s\S]+status = 'manual_review'/i);
  assert.match(sql, /browser retry is safe only before purchase dispatch/i);
  assert.match(sql, /print job proof does not belong to browser purchase case/i);
  assert.match(sql, /delivery_note_required and v_case\.delivery_note_status <> 'printed'/i);
  assert.match(sql, /for update of j skip locked/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.arrival_label_browser_purchase_jobs from anon, authenticated/i);
  assert.match(sql, /bucket exists without the required private size and MIME controls/i);
});

test("worker marks dispatching before exactly one purchase click and routes later uncertainty to review", async () => {
  const source = await readFile("scripts/run_easydpd_browser_worker.mjs", "utf8");
  assert.match(source, /const EASYDPD_DASHBOARD = "https:\/\/admin[.]shopify[.]com\/store\/galaxybuzzdk\/apps\/dpd-versand-services";/);
  assert.doesNotMatch(source, /const EASYDPD_DASHBOARD = .*\/fulfillments";/);
  assert.match(source, /--restore-last-session/);
  assert.match(source, /ignoreDefaultArgs: \["--disable-sync", "--use-mock-keychain", "--password-store=basic"\]/);
  assert.doesNotMatch(source, /args: \[[^\]]*"--disable-sync"/);
  const dispatch = source.indexOf('updateJob(configuration, job, "dispatching")');
  const click = source.indexOf("createButton.click");
  assert.ok(dispatch >= 0 && click > dispatch);
  assert.equal(source.match(/createButton\.click/g)?.length, 1);
  assert.match(source, /postDispatch \? "uncertain" : "retryable_error"/);
  assert.match(source, /page\.waitForEvent\("download"/);
  assert.doesNotMatch(source, /reload\(|while\s*\([^)]*createButton/);
  assert.match(source, /weight of the shipment/i);
  assert.match(source, /async function runDaemon\(configuration, intervalSeconds\)/);
  assert.match(source, /state: "authentication_required"/);
  assert.match(source, /const context = await launchContext\(configuration\);[\s\S]+while \(!control\.isStopped\(\)\)/);
  assert.match(source, /processLiveJob\(configuration, page, job\)/);
});

test("LaunchAgent has no plaintext token and defaults to a harmless dry-run install", async () => {
  const plist = await readFile("deploy/local-easydpd-browser-worker/de.neontrip.easydpd-browser-worker.plist.template", "utf8");
  const readme = await readFile("deploy/local-easydpd-browser-worker/README.md", "utf8");
  assert.doesNotMatch(plist, /ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN/);
  assert.doesNotMatch(plist, /StartInterval/);
  assert.match(plist, /<string>--daemon<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>[\s\S]+<true\/>/);
  assert.match(plist, /ARRIVAL_LABEL_BROWSER_STATUS_PATH/);
  assert.match(readme, /install --mode dry_run/);
  assert.match(readme, /niemals automatisch/i);
  assert.match(readme, /dauerhaft laufenden Browserprozess/i);
  const library = await readFile("scripts/easydpd_browser_worker_lib.mjs", "utf8");
  assert.match(library, /NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET/);
});

test("Coolify sync supports a dedicated browser-worker secret and an exact delete rollback", async () => {
  const workflow = await readFile(".github/workflows/coolify-secret-sync.yml", "utf8");
  assert.match(workflow, /sync_ops_arrival_label_browser_worker_token/);
  assert.match(workflow, /delete_ops_arrival_label_browser_worker_token/);
  assert.match(workflow, /ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN: \$\{\{ secrets\.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN \}\}/);
  assert.match(workflow, /previous: previous \? envSummary\(previous\) : null/);
});

test("live rollout config keeps the purchase switch off until local workers pass", async () => {
  const sql = await readFile("supabase/migrations/20260722154500_prepare_arrival_label_live_configuration.sql", "utf8");
  const rollback = await readFile("supabase/rollbacks/20260722154500_prepare_arrival_label_live_configuration_rollback.sql", "utf8");
  assert.match(sql, /maximum_purchase_cents\s*=\s*1500/i);
  assert.match(sql, /worker_enabled\s*=\s*false/i);
  assert.match(sql, /live_purchase_enabled\s*=\s*false/i);
  assert.match(sql, /shipping-a6[\s\S]+shipping-a4-delivery-note/i);
  assert.match(sql, /arrival_labels_mark_delivery_note_qa_approved/i);
  assert.match(sql, /v_artifact[.]storage_bucket\s*<>\s*coalesce/i);
  assert.match(sql, /new[.]existing_dpd_tracking\s*:=\s*coalesce\(new[.]existing_dpd_tracking, old[.]existing_dpd_tracking\)/i);
  assert.match(sql, /old[.]status in \('label_created', 'pdf_processed', 'completed'\)/i);
  assert.match(rollback, /live_purchase_enabled\s*=\s*false/i);
});

test("Coolify rollout supports a separate print token, write gate and exact rollback modes", async () => {
  const workflow = await readFile(".github/workflows/coolify-secret-sync.yml", "utf8");
  assert.match(workflow, /sync_ops_arrival_label_print_worker_token/);
  assert.match(workflow, /delete_ops_arrival_label_print_worker_token/);
  assert.match(workflow, /enable_ops_arrival_label_writes/);
  assert.match(workflow, /disable_ops_arrival_label_writes/);
  assert.match(workflow, /ARRIVAL_LABEL_PRINT_API_TOKEN: \$\{\{ secrets\.ARRIVAL_LABEL_PRINT_API_TOKEN \}\}/);
});

test("browser claim API rejects auth before DB and dry-run never claims", async () => {
  const previous = {
    token: process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN,
    fetch: globalThis.fetch,
  };
  process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN = TOKEN;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
  try {
    const makeRequest = (token: string, mode: string) => new NextRequest("https://ops.example.invalid/api/internal/arrival-labels/browser-purchases/claim", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Neontrip-Browser-Worker": WORKER_ID },
      body: JSON.stringify({ workerId: WORKER_ID, mode }),
    });
    assert.equal((await claimBrowserPurchase(makeRequest("wrong", "dry_run"))).status, 401);
    assert.equal((await claimBrowserPurchase(makeRequest(TOKEN, "dry_run"))).status, 204);
    assert.equal(called, false);
  } finally {
    if (previous.token === undefined) delete process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN;
    else process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN = previous.token;
    globalThis.fetch = previous.fetch;
  }
});
