import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  EXPECTED_EXTENSION_ID,
  encodeNativeMessage,
  readNativeMessage,
  validateBridgeConfig,
} from "../../scripts/easydpd_existing_chrome_bridge_lib.mjs";
import {
  bridgeDestinations,
  parseExistingChromeManagerArgs,
} from "../../scripts/manage_easydpd_existing_chrome_bridge.mjs";
import { isExecutedEntryPoint } from "../../scripts/run_easydpd_existing_chrome_host.mjs";
import {
  existingLabelEvidence,
  matchingDownloadedPdf,
  validateBridgeJob,
  validateOrderUrl,
} from "../../deploy/local-easydpd-existing-chrome/extension/policy.mjs";

function job(overrides: Record<string, unknown> = {}) {
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

test("existing-Chrome extension is pinned to the normal NEONTRIP Shopify/easyDPD origins", async () => {
  const manifest = JSON.parse(await readFile("deploy/local-easydpd-existing-chrome/extension/manifest.json", "utf8"));
  const nativeManifest = JSON.parse(await readFile("deploy/local-easydpd-existing-chrome/native-host-manifest.json.template", "utf8"));
  assert.equal(EXPECTED_EXTENSION_ID, "bgfphlbhdameagnafljlgpbpjdajmdhk");
  assert.deepEqual(manifest.host_permissions, [
    "https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services/*",
    "https://easydpd.247apps.de/*",
  ]);
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.deepEqual(nativeManifest.allowed_origins, [`chrome-extension://${EXPECTED_EXTENSION_ID}/`]);
  assert.equal(nativeManifest.type, "stdio");
});

test("existing-Chrome policy rejects other shops, routes, products, weights and price caps", () => {
  assert.match(validateOrderUrl(job().orderUrl), /^https:\/\/admin[.]shopify[.]com/);
  assert.equal(validateBridgeJob(job()).incomingDhlLastSix, "567890");
  assert.throws(() => validateOrderUrl("https://admin.shopify.com/store/other/apps/dpd-versand-services/fulfillments/create?id=1234567890&shop=other.myshopify.com"), /freigegebenen EasyDPD-Route/);
  assert.throws(() => validateBridgeJob(job({ productLabel: "Classic" })), /nicht freigegeben/);
  assert.throws(() => validateBridgeJob(job({ packageWeightGrams: 501 })), /Format oder Gewicht/);
  assert.throws(() => validateBridgeJob(job({ maximumPurchaseCents: 1501 })), /Kaufpreisgrenze/);
});

test("EasyDPD history evidence blocks on label downloads or exact DPD tracking", () => {
  assert.deepEqual(existingLabelEvidence([]), { found: false, labelCount: 0, trackingNumbers: [] });
  const evidence = existingLabelEvidence([
    "https://easydpd.247apps.de/labels/3580043/download/label-neont4532.pdf?signature=redacted",
    "https://tracking.dpd.de/status/de_DE/parcel/01476817855492",
  ]);
  assert.equal(evidence.found, true);
  assert.equal(evidence.labelCount, 1);
  assert.deepEqual(evidence.trackingNumbers, ["01476817855492"]);
});

test("download capture requires a PDF from the same Shopify tab after dispatch", () => {
  const item = {
    tabId: 23,
    filename: "/Users/test/Downloads/label.pdf",
    startTime: "2026-07-23T09:00:01.000Z",
    finalUrl: "https://easydpd.247apps.de/labels/1/download/label.pdf",
  };
  assert.equal(matchingDownloadedPdf(item, 23, Date.parse("2026-07-23T09:00:00.000Z")), true);
  assert.equal(matchingDownloadedPdf({ ...item, tabId: 24 }, 23, Date.parse("2026-07-23T09:00:00.000Z")), false);
  assert.equal(matchingDownloadedPdf({ ...item, filename: "/Users/test/Downloads/label.txt" }, 23, Date.parse("2026-07-23T09:00:00.000Z")), false);
  assert.equal(matchingDownloadedPdf({ ...item, finalUrl: "https://evil.example/label.pdf" }, 23, Date.parse("2026-07-23T09:00:00.000Z")), false);
});

test("native protocol is length-prefixed, bounded and allowlisted", async () => {
  const encoded = encodeNativeMessage({ type: "status" });
  assert.deepEqual(await readNativeMessage(Readable.from([encoded])), { type: "status" });
  const stillOpen = new PassThrough();
  const withoutEof = readNativeMessage(stillOpen);
  stillOpen.write(encoded.subarray(0, 3));
  stillOpen.write(encoded.subarray(3));
  assert.deepEqual(await withoutEof, { type: "status" });
  const bad = Buffer.from(encoded);
  bad.writeUInt32LE(encoded.length + 10, 0);
  await assert.rejects(() => readNativeMessage(Readable.from([bad])), /Nachrichtenlaenge/);
  const denied = encodeNativeMessage({ type: "shell" });
  await assert.rejects(() => readNativeMessage(Readable.from([denied])), /nicht freigegeben/);
});

test("native host recognizes a symlinked installed entry point", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neontrip-native-entry-"));
  const source = join(process.cwd(), "scripts/run_easydpd_existing_chrome_host.mjs");
  const linked = join(directory, "native-host.mjs");
  try {
    await symlink(source, linked);
    assert.equal(isExecutedEntryPoint(linked, pathToFileURL(source).href), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bridge config requires HTTPS, fixed extension id and narrow download root", () => {
  const valid = {
    mode: "dry_run",
    liveEnabled: false,
    extensionId: EXPECTED_EXTENSION_ID,
    opsBaseUrl: "https://ops.neontrip.de",
    keychainAccount: "daniel",
    workerId: "daniels-mac-easydpd-normal-chrome-01",
    tokenService: "NEONTRIP EasyDPD Browser Worker API Token",
    cfClientId: "",
    cfSecretService: "NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET",
    downloadRoot: `${homedir()}/Downloads`,
    statusPath: `${homedir()}/Library/Logs/NEONTRIP/easydpd-existing-chrome-bridge/status.json`,
    activeJobPath: `${homedir()}/Library/Application Support/NEONTRIP/easydpd-existing-chrome-bridge/active-job.json`,
  };
  assert.equal(validateBridgeConfig(valid).liveEnabled, false);
  assert.throws(() => validateBridgeConfig({ ...valid, opsBaseUrl: "http://127.0.0.1:3000" }), /HTTPS/);
  assert.throws(() => validateBridgeConfig({ ...valid, extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), /Erweiterungs-ID/);
  assert.throws(() => validateBridgeConfig({ ...valid, downloadRoot: homedir() }), /nicht exakt/);
  assert.throws(() => validateBridgeConfig({ ...valid, opsBaseUrl: "https://evil.example" }), /ops[.]neontrip[.]de/);
  assert.throws(() => validateBridgeConfig({ ...valid, activeJobPath: `${homedir()}/Documents/active-job.json` }), /Auftragspfad/);
});

test("manager requires an independent live acknowledgement", () => {
  assert.equal(parseExistingChromeManagerArgs(["install", "--mode", "dry_run"]).mode, "dry_run");
  assert.throws(() => parseExistingChromeManagerArgs(["install", "--mode", "live"]), /acknowledge-production-write/);
  assert.equal(parseExistingChromeManagerArgs(["install", "--mode", "live", "--acknowledge-production-write"]).mode, "live");
  assert.equal(
    bridgeDestinations("/Users/test").runtimeRoot,
    "/Users/test/Library/Application Support/NEONTRIP/easydpd-existing-chrome-bridge/runtime",
  );
  assert.doesNotMatch(bridgeDestinations("/Users/test").runtimeRoot, /Desktop|\/NEONTRIP\/runtime/);
});

test("service worker reuses an open tab, blocks existing labels and dispatches before one click", async () => {
  const service = await readFile("deploy/local-easydpd-existing-chrome/extension/service_worker.mjs", "utf8");
  const content = await readFile("deploy/local-easydpd-existing-chrome/extension/content_script.js", "utf8");
  assert.match(service, /findExistingEasyDpdTab/);
  assert.doesNotMatch(service, /chrome[.]windows[.]create|chrome[.]tabs[.]create/);
  assert.match(service, /prepared[.]existingLabel[?][.]found/);
  assert.match(service, /updateJob\(job, "existing_label"/);
  const dispatch = service.indexOf('updateJob(job, "dispatching")');
  const purchase = service.indexOf('action: "purchase_once"');
  assert.ok(dispatch >= 0 && purchase > dispatch);
  assert.equal(content.match(/createButton\(\)[.]click\(\)/g)?.length, 1);
  assert.match(content, /sessionStorage[.]setItem\(purchaseKey/);
  assert.match(content, /collectExistingLabelEvidence/);
  const nativeHost = await readFile("scripts/easydpd_existing_chrome_bridge_lib.mjs", "utf8");
  assert.match(nativeHost, /JOB_BINDING_FIELDS/);
  assert.match(nativeHost, /stimmt nicht mit dem lokal gebundenen Claim ueberein/);
  assert.match(nativeHost, /storeActiveJob\(config, job\)/);
});

test("database existing-label stopper is pre-dispatch, audited and service-role only", async () => {
  const sql = await readFile("supabase/migrations/20260723091205_add_arrival_label_existing_label_stop.sql", "utf8");
  const rollback = await readFile("supabase/rollbacks/20260723091205_add_arrival_label_existing_label_stop_rollback.sql", "utf8");
  const sqlTest = await readFile("supabase/tests/arrival_label_existing_label_stop.sql", "utf8");
  assert.match(sql, /status not in \('claimed', 'validated', 'manual_review'\)/i);
  assert.match(sql, /status = 'manual_review'/i);
  assert.match(sql, /browser_purchase_existing_label_blocked/i);
  assert.match(sql, /revoke execute[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute[\s\S]+to service_role/i);
  assert.match(rollback, /drop function if exists public[.]arrival_labels_block_browser_purchase_existing_label/i);
  assert.match(sqlTest, /status <> 'manual_review'[\s\S]+lease_owner is not null[\s\S]+dpd_tracking_number <> '01476817855492'/i);
  assert.match(sqlTest, /has_function_privilege\('anon'[\s\S]+has_function_privilege\('service_role'/i);
  assert.match(sqlTest, /rollback;/i);
});
