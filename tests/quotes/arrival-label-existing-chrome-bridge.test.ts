import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  EXPECTED_BRIDGE_PROTOCOL_VERSION,
  EXPECTED_EXTENSION_ID,
  EXTENSION_BUILD_MISMATCH_CODE,
  EXTENSION_PROTOCOL_MISMATCH_CODE,
  acquireClaimSlot,
  encodeNativeMessage,
  readActiveJobState,
  readNativeMessage,
  readNativeMessages,
  validateBridgeConfig,
  validateNativeRequest,
} from "../../scripts/easydpd_existing_chrome_bridge_lib.mjs";
import {
  bridgeDestinations,
  isFreshExtensionHeartbeat,
  parseExistingChromeManagerArgs,
  syncExtensionFilesInPlace,
} from "../../scripts/manage_easydpd_existing_chrome_bridge.mjs";
import { isExecutedEntryPoint, runNativeMessageLoop } from "../../scripts/run_easydpd_existing_chrome_host.mjs";
import { projectPersistedBrowserManualReview } from "../../src/lib/ops/arrival-labels/service";
import {
  BRIDGE_PROTOCOL_VERSION,
  existingLabelEvidence,
  matchingDownloadedPdf,
  validateBridgeJob,
  validateEasyDpdLabelDownloadUrl,
  validateOrderUrl,
} from "../../deploy/local-easydpd-existing-chrome/extension/policy.mjs";

const BUILD_COMMIT = "a".repeat(40);

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
  assert.equal(BRIDGE_PROTOCOL_VERSION, EXPECTED_BRIDGE_PROTOCOL_VERSION);
  assert.equal(manifest.version, "1.1.7");
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
  assert.equal(existingLabelEvidence([
    "https://easydpd.247apps.de/labels/3580043/download/label-neont4532.pdf?signature=redacted",
    "https://easydpd.247apps.de/labels/3580043/download/label-neont4532.pdf?signature=redacted",
  ]).labelCount, 1);
  assert.match(validateEasyDpdLabelDownloadUrl(
    "https://easydpd.247apps.de/labels/3580043/download/label-neont4532.pdf?signature=redacted",
  ), /^https:\/\/easydpd[.]247apps[.]de\/labels\//);
  assert.throws(() => validateEasyDpdLabelDownloadUrl("https://evil.example/labels/1/download/label.pdf"), /freigegebenen Route/);
  assert.throws(() => validateEasyDpdLabelDownloadUrl("https://easydpd.247apps.de/settings"), /freigegebenen Route/);
});

test("download capture requires the same Shopify tab or the exact EasyDPD order label after dispatch", () => {
  const item = {
    tabId: 23,
    filename: "/Users/test/Downloads/label.pdf",
    startTime: "2026-07-23T09:00:01.000Z",
    finalUrl: "https://easydpd.247apps.de/labels/1/download/label.pdf",
  };
  assert.equal(matchingDownloadedPdf(item, 23, Date.parse("2026-07-23T09:00:00.000Z")), true);
  assert.equal(matchingDownloadedPdf({ ...item, tabId: 24 }, 23, Date.parse("2026-07-23T09:00:00.000Z")), false);
  assert.equal(matchingDownloadedPdf({
    ...item,
    tabId: -1,
    filename: "/Users/test/Downloads/Label_#NEONT4535_2026-07-23_1100.pdf",
  }, 23, Date.parse("2026-07-23T09:00:00.000Z"), "#NEONT4535"), true);
  assert.equal(matchingDownloadedPdf({
    ...item,
    tabId: -1,
    filename: "/Users/test/Downloads/Label_#NEONT9999_2026-07-23_1100.pdf",
  }, 23, Date.parse("2026-07-23T09:00:00.000Z"), "#NEONT4535"), false);
  assert.equal(matchingDownloadedPdf({ ...item, filename: "/Users/test/Downloads/label.txt" }, 23, Date.parse("2026-07-23T09:00:00.000Z")), false);
  assert.equal(matchingDownloadedPdf({ ...item, finalUrl: "https://evil.example/label.pdf" }, 23, Date.parse("2026-07-23T09:00:00.000Z")), false);
});

test("native protocol is length-prefixed, bounded and allowlisted", async () => {
  const request = { type: "status", bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION, extensionBuildCommit: BUILD_COMMIT };
  const encoded = encodeNativeMessage(request);
  assert.deepEqual(await readNativeMessage(Readable.from([encoded])), request);
  const stillOpen = new PassThrough();
  const withoutEof = readNativeMessage(stillOpen);
  stillOpen.write(encoded.subarray(0, 3));
  stillOpen.write(encoded.subarray(3));
  assert.deepEqual(await withoutEof, request);
  const bad = Buffer.from(encoded);
  bad.writeUInt32LE(encoded.length + 10, 0);
  await assert.rejects(() => readNativeMessage(Readable.from([bad])), /Nachrichtenlaenge/);
  const denied = encodeNativeMessage({ ...request, type: "shell" });
  await assert.rejects(() => readNativeMessage(Readable.from([denied])), /nicht freigegeben/);
  const stale = encodeNativeMessage({ ...request, bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION - 1 });
  await assert.rejects(
    () => readNativeMessage(Readable.from([stale])),
    (error: unknown) => error instanceof Error
      && error.message.includes("veraltet")
      && (error as Error & { nativeCode?: string }).nativeCode === EXTENSION_PROTOCOL_MISMATCH_CODE,
  );
});

test("native protocol keeps ordered request frames on a long-lived connection", async () => {
  const status = { type: "status", bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION, extensionBuildCommit: BUILD_COMMIT };
  const claim = { type: "claim", bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION, extensionBuildCommit: BUILD_COMMIT };
  const messages = [];
  for await (const message of readNativeMessages(Readable.from([Buffer.concat([
    encodeNativeMessage(status),
    encodeNativeMessage(claim),
  ])]))) messages.push(message);
  assert.deepEqual(messages, [status, claim]);
});

test("native host answers multiple ordered requests before the Chrome port closes", async () => {
  const status = { type: "status", bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION, extensionBuildCommit: BUILD_COMMIT };
  const claim = { type: "claim", bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION, extensionBuildCommit: BUILD_COMMIT };
  const responses: Record<string, unknown>[] = [];
  await runNativeMessageLoop(
    {},
    Readable.from([encodeNativeMessage(status), encodeNativeMessage(claim)]),
    (response: Record<string, unknown>) => responses.push(response),
    async (_config, request) => ({ ok: true, handled: request.type }),
  );
  assert.deepEqual(responses, [{ ok: true, handled: "status" }, { ok: true, handled: "claim" }]);
});

test("native mismatch codes are stable and bridge heartbeats expire", () => {
  assert.equal(EXTENSION_BUILD_MISMATCH_CODE, "extension_build_mismatch");
  assert.throws(
    () => validateNativeRequest({
      type: "status",
      bridgeProtocolVersion: EXPECTED_BRIDGE_PROTOCOL_VERSION,
      extensionBuildCommit: BUILD_COMMIT,
    }, "b".repeat(40)),
    (error: unknown) => error instanceof Error
      && (error as Error & { nativeCode?: string }).nativeCode === EXTENSION_BUILD_MISMATCH_CODE,
  );
  const heartbeat = {
    extensionClientVerified: true,
    bridgeProtocolVersion: EXPECTED_BRIDGE_PROTOCOL_VERSION,
    extensionBuildCommit: BUILD_COMMIT,
    updatedAt: "2026-08-13T10:00:00.000Z",
  };
  assert.equal(isFreshExtensionHeartbeat(heartbeat, BUILD_COMMIT, Date.parse("2026-08-13T10:02:59.999Z")), true);
  assert.equal(isFreshExtensionHeartbeat(heartbeat, BUILD_COMMIT, Date.parse("2026-08-13T10:03:00.001Z")), false);
  assert.equal(isFreshExtensionHeartbeat({ ...heartbeat, extensionBuildCommit: "b".repeat(40) }, BUILD_COMMIT, Date.parse("2026-08-13T10:01:00.000Z")), false);
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
    extensionBuildCommit: BUILD_COMMIT,
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

test("manager updates the unpacked extension without replacing its stable root directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neontrip-extension-sync-"));
  const source = join(directory, "source");
  const destination = join(directory, "extension");
  try {
    await Promise.all([mkdir(source), mkdir(destination)]);
    for (const filename of ["content_script.js", "policy.mjs", "service_worker.mjs", "manifest.json"]) {
      await writeFile(join(source, filename), `new:${filename}\n`);
      await writeFile(join(destination, filename), `old:${filename}\n`);
    }
    const before = await stat(destination);
    syncExtensionFilesInPlace(source, destination);
    const after = await stat(destination);
    assert.equal(after.ino, before.ino);
    assert.deepEqual((await readdir(destination)).sort(), ["content_script.js", "manifest.json", "policy.mjs", "service_worker.mjs"]);
    assert.equal(await readFile(join(destination, "manifest.json"), "utf8"), "new:manifest.json\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("service worker creates a fresh background tab, recovers from live history and dispatches before one click", async () => {
  const service = await readFile("deploy/local-easydpd-existing-chrome/extension/service_worker.mjs", "utf8");
  const content = await readFile("deploy/local-easydpd-existing-chrome/extension/content_script.js", "utf8");
  assert.doesNotMatch(service, /findExistingEasyDpdTab|getOrCreateEasyDpdTab/);
  assert.match(service, /bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION/);
  assert.match(service, /extensionBuildCommit: EXTENSION_BUILD_COMMIT/);
  assert.match(service, /RELOAD_REQUIRED_CODES/);
  assert.match(service, /chrome[.]runtime[.]reload\(\)/);
  assert.match(service, /__NEONTRIP_EXTENSION_BUILD_COMMIT__/);
  assert.doesNotMatch(service, /chrome[.]windows[.]create/);
  assert.match(service, /chrome[.]tabs[.]create\(\{ url: validateOrderUrl\(job[.]orderUrl\), active: false \}\)/);
  assert.match(service, /createFreshEasyDpdTab\(claimed[.]job\)/);
  assert.match(service, /easyDpdFrameId\(tabId, timeoutMs = 45_000\)/);
  assert.match(service, /matches[.]length === 1[\s\S]+matches[.]length > 1[\s\S]+setTimeout\(resolve, 500\)/);
  assert.match(service, /chrome[.]runtime[.]connectNative\(NATIVE_HOST\)/);
  assert.match(service, /nativeSession[.]send\(\{ type: "status" \}\)/);
  assert.match(service, /nativeSession[.]send\(\{ type: "claim" \}\)/);
  assert.doesNotMatch(service, /chrome[.]runtime[.]sendNativeMessage/);
  assert.doesNotMatch(service, /keepServiceWorkerAwake/);
  assert.match(service, /chrome[.]downloads[.]search\(\{ startedAfter:/);
  assert.match(service, /waitForDownloadedPdf\(tab[.]id, startedAt, job[.]orderName/);
  assert.match(service, /isMissingFrameReceiver/);
  assert.match(service, /chrome[.]tabs[.]reload\(tabId, \{ bypassCache: true \}\)/);
  assert.match(service, /reloadAndWaitForTabComplete\(tabId, job[.]orderUrl\)/);
  assert.match(service, /action: "inspect_history"/);
  assert.match(service, /chrome[.]downloads[.]download\(\{ url: downloadUrl, saveAs: false, conflictAction: "uniquify" \}\)/);
  assert.match(service, /post_dispatch_download_recovered/);
  assert.match(service, /EasyDPD-History blieb nach frischem Reload ohne Label; kein automatischer Wiederholungskauf/);
  assert.ok(service.indexOf("isMissingFrameReceiver") < service.indexOf('updateJob(nativeSession, job, "validated")'));
  assert.match(service, /prepared[.]existingLabel[?][.]found/);
  assert.match(service, /updateJob\(nativeSession, job, "existing_label"/);
  assert.ok(service.indexOf('nativeSession.send({ type: "claim" })') < service.indexOf("createFreshEasyDpdTab(claimed.job)"));
  const dispatch = service.indexOf('updateJob(nativeSession, job, "dispatching")');
  const purchase = service.indexOf('action: "purchase_once"');
  assert.ok(dispatch >= 0 && purchase > dispatch);
  assert.equal(content.match(/createButton\(\)[.]click\(\)/g)?.length, 1);
  assert.match(content, /sessionStorage[.]setItem\(purchaseKey/);
  assert.match(content, /collectExistingLabelEvidence/);
  assert.match(content, /inspectHistoryWhenReady/);
  assert.match(content, /message[.]action === "inspect_history"/);
  assert.match(content, /const PREPARE_READY_TIMEOUT_MS = 20_000/);
  assert.match(content, /async function validateAndPrepareWhenReady\(job\)/);
  assert.match(content, /isTransientPreparationError\(error\)/);
  assert.match(content, /setTimeout\(resolve, PREPARE_READY_INTERVAL_MS\)/);
  assert.match(content, /validateAndPrepareWhenReady\(message[.]job\)/);
  const nativeHost = await readFile("scripts/easydpd_existing_chrome_bridge_lib.mjs", "utf8");
  assert.match(nativeHost, /JOB_BINDING_FIELDS/);
  assert.match(nativeHost, /stimmt nicht mit dem lokal gebundenen Claim ueberein/);
  assert.match(nativeHost, /active_job_pending/);
  assert.match(nativeHost, /RESUMABLE_ACTIVE_JOB_PHASES = new Set\(\["claimed", "validated"\]\)/);
  assert.match(nativeHost, /job_resumed_pre_dispatch/);
  assert.match(nativeHost, /resumable \? bound[.]job : null/);
  assert.doesNotMatch(nativeHost, /RESUMABLE_ACTIVE_JOB_PHASES = new Set\([^)]*dispatching/);
  assert.ok(nativeHost.indexOf('updateActiveJobPhase(config, job.id, "dispatching")')
    < nativeHost.indexOf("await updateJob(configuration, job, result"));
  assert.match(nativeHost, /flag: "wx"/);
  assert.match(nativeHost, /storeActiveJob\(config, job\)/);
  assert.match(nativeHost, /Chrome-Erweiterung ist veraltet/);
  const nativeRunner = await readFile("scripts/run_easydpd_existing_chrome_host.mjs", "utf8");
  assert.match(nativeRunner, /error instanceof ExistingChromeBridgeError \? error[.]nativeCode : null/);
  assert.match(nativeRunner, /runNativeMessageLoop/);
  const manager = await readFile("scripts/manage_easydpd_existing_chrome_bridge.mjs", "utf8");
  assert.match(manager, /extension_reload_required/);
  assert.match(manager, /extensionClientVerified/);
  assert.match(manager, /extensionHeartbeatFresh/);
  assert.match(manager, /syncExtensionFilesInPlace\(staged[.]stagedExtension, target[.]activeExtension\)/);
  assert.doesNotMatch(manager, /renameSync\(target[.]activeExtension/);
});

test("native host claim slot is atomic and preserves the bound job across worker restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neontrip-native-claim-"));
  const config = { activeJobPath: join(directory, "active-job.json") };
  try {
    assert.equal(await acquireClaimSlot(config), true);
    assert.equal(await acquireClaimSlot(config), false);
    assert.deepEqual(await readActiveJobState(config), { state: "claiming", phase: null, job: null });
    await writeFile(config.activeJobPath, `${JSON.stringify({ version: 2, state: "active", phase: "claimed", job: job() })}\n`, { mode: 0o600 });
    assert.equal((await readActiveJobState(config))?.job?.id, job().id);
    assert.equal((await readActiveJobState(config))?.phase, "claimed");
    assert.equal(await acquireClaimSlot(config), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser artifact route exposes only a safe failure stage and keeps PDF.js external at runtime", async () => {
  const route = await readFile("src/app/api/internal/arrival-labels/browser-purchases/[jobId]/artifact/route.ts", "utf8");
  const nextConfig = await readFile("next.config.ts", "utf8");
  assert.match(route, /stage = "extract_tracking"/);
  assert.match(route, /stage = "upload_storage"/);
  assert.match(route, /code: safeErrorCode\(error\)/);
  assert.doesNotMatch(route, /console[.]error\([^)]*error[.]message/);
  assert.match(nextConfig, /serverExternalPackages: \["@napi-rs\/canvas", "pdfjs-dist"\]/);
});

test("a persisted browser manual review cannot be projected back to label planned", async () => {
  const decision = {
    idempotencyKey: "arrival:test",
    trackingNumber: "5098556175",
    lastSix: "556175",
    expectedArrival: "2026-08-03",
    trelloCard: null,
    shopifyOrder: null,
    shippingClass: "standard" as const,
    destinationCountryCode: "DE",
    destinationClass: "domestic_de" as const,
    deliveryNoteRequired: false,
    deliveryNoteStatus: "not_required" as const,
    selectedDpdProduct: "DPD_DE_B2C",
    existingDpdTracking: null,
    status: "label_planned" as const,
    manualReviewReason: null,
    relevantOrderNote: null,
    reasons: ["trello_sign_shipped_trigger"],
  };
  const projected = projectPersistedBrowserManualReview(decision, {
    status: "manual_review",
    manual_review_reason: "EasyDPD-Browserauftrag ist manuell zu pruefen; kein automatischer Zweitkauf.",
  });
  assert.equal(projected.status, "manual_review");
  assert.match(projected.manualReviewReason || "", /kein automatischer Zweitkauf/);
  assert.equal(projected.reasons.includes("browser_purchase_manual_review"), true);

  const migration = await readFile("supabase/migrations/20260803105500_preserve_arrival_browser_manual_review.sql", "utf8");
  const rollback = await readFile("supabase/rollbacks/20260803105500_preserve_arrival_browser_manual_review_rollback.sql", "utf8");
  assert.match(migration, /before update of status, manual_review_reason/i);
  assert.match(migration, /j[.]status = 'manual_review'/i);
  assert.match(migration, /new[.]status := 'manual_review'/i);
  assert.match(migration, /nullif\(old[.]manual_review_reason, ''\)/i);
  assert.match(migration, /left\(j[.]last_error, 500\)/i);
  assert.match(rollback, /drop trigger if exists arrival_label_cases_preserve_browser_manual_review/i);
  assert.match(rollback, /drop function if exists public[.]arrival_labels_preserve_browser_manual_review/i);

  const notificationMigration = await readFile(
    "supabase/migrations/20260803090717_preserve_arrival_browser_manual_review_notifications.sql",
    "utf8",
  );
  const notificationRollback = await readFile(
    "supabase/rollbacks/20260803090717_preserve_arrival_browser_manual_review_notifications_rollback.sql",
    "utf8",
  );
  assert.match(notificationMigration, /arrival_labels_enqueue_review_notification/i);
  assert.match(notificationMigration, /j[.]status = 'manual_review'/i);
  assert.match(notificationMigration, /selected_dpd_product is not null and not v_browser_manual_review/i);
  assert.match(notificationMigration, /fail-closed browser review can enqueue a review notification/i);
  assert.match(notificationRollback, /selected_dpd_product is not null then/i);
  assert.match(notificationRollback, /only a blocked case without DPD product can enqueue a review notification/i);
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

test("confirmed-empty EasyDPD recovery is one-time, audited and rejects downstream evidence", async () => {
  const sql = await readFile(
    "supabase/migrations/20260824174459_reconcile_arrival_browser_no_label_retry.sql",
    "utf8",
  );
  const rollback = await readFile(
    "supabase/rollbacks/20260824174459_reconcile_arrival_browser_no_label_retry_rollback.sql",
    "utf8",
  );
  const sqlTest = await readFile("supabase/tests/arrival_label_browser_no_label_requeue.sql", "utf8");
  assert.match(sql, /status <> 'manual_review'/i);
  assert.match(sql, /easydpd_live_history_after_forced_reload/i);
  assert.match(sql, /no_label_no_tracking/i);
  assert.match(sql, /labelCount'[)]::numeric <> 0/i);
  assert.match(sql, /jsonb_array_length\(p_evidence -> 'trackingNumbers'\) <> 0/i);
  assert.match(sql, /existing_dpd_tracking is not null[\s\S]+dpd_tracking_number is not null[\s\S]+original_pdf_sha256 is not null[\s\S]+print_job_id is not null/i);
  assert.match(sql, /artifact_kind in \('original_pdf', 'annotated_pdf', 'rendered_preview'\)/i);
  assert.match(sql, /document_kind = 'label'/i);
  assert.match(sql, /confirmed-no-label-requeue/i);
  assert.match(sql, /browser_purchase_requeued_after_confirmed_no_label/i);
  assert.match(sql, /status = 'queued'[\s\S]+attempts = 0[\s\S]+status = 'label_planned'/i);
  assert.match(sql, /revoke execute[\s\S]+from public, anon, authenticated[\s\S]+grant execute[\s\S]+to service_role/i);
  assert.match(rollback, /drop function if exists public[.]arrival_labels_requeue_browser_purchase_after_confirmed_no_label/i);
  assert.match(sqlTest, /v_job[.]status <> 'queued'[\s\S]+v_job[.]attempts <> 0[\s\S]+v_event_count <> 1/i);
});
