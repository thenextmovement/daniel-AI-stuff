import {
  BRIDGE_PROTOCOL_VERSION,
  EASYDPD_FRAME_ORIGIN,
  NATIVE_HOST,
  SHOPIFY_APP_PATH,
  SHOPIFY_ORIGIN,
  SHOPIFY_PATH,
  matchingDownloadedPdf,
  validateBridgeJob,
  validateOrderUrl,
} from "./policy.mjs";

const ALARM_NAME = "neontrip-easydpd-existing-chrome-cycle";
const EXTENSION_BUILD_COMMIT = "__NEONTRIP_EXTENSION_BUILD_COMMIT__";
const STATE_KEY = "neontripEasyDpdBridgeState";
const AUDIT_KEY = "neontripEasyDpdBridgeAudit";
const MAX_AUDIT_ENTRIES = 50;
const RELOAD_REQUIRED_CODES = new Set(["extension_build_mismatch", "extension_protocol_mismatch"]);
let cycleRunning = false;

function nativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      ...payload,
      bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
      extensionBuildCommit: EXTENSION_BUILD_COMMIT,
    }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) {
        if (RELOAD_REQUIRED_CODES.has(String(response?.code || ""))) {
          chrome.runtime.reload();
          return;
        }
        return reject(new Error(String(response?.error || "Native Bridge antwortete mit einem Fehler.")));
      }
      resolve(response);
    });
  });
}

function keepServiceWorkerAwake(intervalMs = 15_000) {
  const timer = setInterval(() => {
    chrome.storage.local.get([STATE_KEY]).catch(() => undefined);
  }, intervalMs);
  return () => clearInterval(timer);
}

async function record(state, detail = {}) {
  const entry = { at: new Date().toISOString(), state, ...detail };
  const stored = await chrome.storage.local.get([AUDIT_KEY]);
  const audit = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];
  audit.push(entry);
  await chrome.storage.local.set({ [STATE_KEY]: entry, [AUDIT_KEY]: audit.slice(-MAX_AUDIT_ENTRIES) });
}

async function findExistingEasyDpdTab() {
  const tabs = await chrome.tabs.query({
    url: [`${SHOPIFY_ORIGIN}${SHOPIFY_APP_PATH}`, `${SHOPIFY_ORIGIN}${SHOPIFY_APP_PATH}/*`],
  });
  const candidates = tabs.filter((tab) => {
    try {
      const url = new URL(tab.url || "");
      return url.origin === SHOPIFY_ORIGIN
        && (url.pathname === SHOPIFY_APP_PATH || url.pathname.startsWith(`${SHOPIFY_APP_PATH}/`));
    } catch {
      return false;
    }
  });
  candidates.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
  return candidates[0] || null;
}

async function getOrCreateEasyDpdTab(job) {
  const existing = await findExistingEasyDpdTab();
  if (existing) return existing;
  return chrome.tabs.create({ url: validateOrderUrl(job.orderUrl), active: false });
}

function waitForTabComplete(tabId, expectedUrl, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Shopify/easyDPD-Tab wurde nicht rechtzeitig geladen."));
    }, timeoutMs);
    const listener = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      try {
        if (validateOrderUrl(tab.url) !== validateOrderUrl(expectedUrl)) return;
      } catch {
        return;
      }
      clearTimeout(deadline);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        try {
          if (validateOrderUrl(tab.url) === validateOrderUrl(expectedUrl)) {
            clearTimeout(deadline);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(tab);
          }
        } catch {}
      }
    }).catch(() => undefined);
  });
}

async function easyDpdFrameId(tabId, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const matches = (frames || []).filter((frame) => {
      try { return new URL(frame.url).origin === EASYDPD_FRAME_ORIGIN; } catch { return false; }
    });
    if (matches.length === 1) return matches[0].frameId;
    if (matches.length > 1) throw new Error("Mehr als ein EasyDPD-App-Frame wurde geladen; Auftrag wird gestoppt.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error("EasyDPD-App-Frame wurde nicht rechtzeitig geladen; Shopify-Anmeldung prüfen.");
}

async function frameMessage(tabId, frameId, payload) {
  const response = await chrome.tabs.sendMessage(tabId, { target: "neontrip-easydpd-frame", ...payload }, { frameId });
  if (!response?.ok) throw new Error(String(response?.error || "EasyDPD-App-Frame antwortete nicht."));
  return response.result;
}

function isMissingFrameReceiver(error) {
  return /Could not establish connection|Receiving end does not exist/i.test(String(error?.message || error));
}

async function validateAndPrepareFrame(tabId, job) {
  let frameId = await easyDpdFrameId(tabId);
  try {
    return { frameId, prepared: await frameMessage(tabId, frameId, { action: "validate_and_prepare", job }) };
  } catch (error) {
    if (!isMissingFrameReceiver(error)) throw error;
    await record("content_script_reload", { jobId: job.id, orderName: job.orderName });
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId, job.orderUrl);
    frameId = await easyDpdFrameId(tabId);
    return { frameId, prepared: await frameMessage(tabId, frameId, { action: "validate_and_prepare", job }) };
  }
}

function waitForDownloadedPdf(tabId, startedAt, orderName, signal, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let trackedId = null;
    let settled = false;
    let searchRunning = false;
    const cleanup = (error, item) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(reconcileInterval);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(item);
    };
    const onAbort = () => cleanup(new Error("EasyDPD-PDF-Beobachtung wurde beendet."));
    const consider = (item) => {
      if (!matchingDownloadedPdf(item, tabId, startedAt, orderName)) return;
      if (trackedId !== null) return cleanup(new Error("Mehr als ein passender PDF-Download wurde erkannt."));
      trackedId = item.id;
      if (item.state === "complete") cleanup(null, item);
      else if (item.state === "interrupted") cleanup(new Error("EasyDPD-PDF-Download wurde unterbrochen."));
    };
    const reconcile = async () => {
      if (settled || searchRunning) return;
      searchRunning = true;
      try {
        const items = await chrome.downloads.search({ startedAfter: new Date(startedAt - 2_000).toISOString() });
        const matches = items.filter((item) => matchingDownloadedPdf(item, tabId, startedAt, orderName));
        if (matches.length > 1) cleanup(new Error("Mehr als ein passender PDF-Download wurde erkannt."));
        else if (matches.length === 1 && trackedId === null) consider(matches[0]);
        else if (matches.length === 1 && trackedId !== matches[0].id) cleanup(new Error("Mehr als ein passender PDF-Download wurde erkannt."));
        else if (matches.length === 1 && matches[0].state === "complete") cleanup(null, matches[0]);
      } finally {
        searchRunning = false;
      }
    };
    const onCreated = (item) => consider(item);
    const onChanged = async (delta) => {
      if (trackedId === null || delta.id !== trackedId || !delta.state) return;
      if (delta.state.current === "interrupted") return cleanup(new Error("EasyDPD-PDF-Download wurde unterbrochen."));
      if (delta.state.current === "complete") {
        const items = await chrome.downloads.search({ id: trackedId });
        if (items.length !== 1 || !matchingDownloadedPdf(items[0], tabId, startedAt, orderName)) return cleanup(new Error("EasyDPD-PDF-Download konnte nicht eindeutig verifiziert werden."));
        cleanup(null, items[0]);
      }
    };
    const timeout = setTimeout(async () => {
      await reconcile().catch(() => undefined);
      cleanup(new Error("EasyDPD-PDF-Download wurde nicht bestätigt."));
    }, timeoutMs);
    const reconcileInterval = setInterval(() => reconcile().catch(() => undefined), 1_000);
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
    signal?.addEventListener("abort", onAbort, { once: true });
    reconcile().catch(() => undefined);
  });
}

async function updateJob(job, result, extra = {}) {
  return nativeMessage({ type: "update", job, result, ...extra });
}

async function processJob(tab, job) {
  validateBridgeJob(job);
  const stopKeepAlive = keepServiceWorkerAwake();
  let dispatchStarted = false;
  let serverCompleted = false;
  let downloadController = null;
  try {
    if (validateOrderUrl(tab.url) !== validateOrderUrl(job.orderUrl)) {
      await chrome.tabs.update(tab.id, { url: job.orderUrl, active: false });
    }
    await waitForTabComplete(tab.id, job.orderUrl);
    const { frameId, prepared } = await validateAndPrepareFrame(tab.id, job);
    if (prepared.existingLabel?.found) {
      const trackingNumbers = prepared.existingLabel.trackingNumbers || [];
      await updateJob(job, "existing_label", {
        existingDpdTracking: trackingNumbers.length === 1 ? trackingNumbers[0] : null,
        evidence: prepared.existingLabel,
        error: "EasyDPD-History enthält bereits ein Label; kein zweiter Kauf.",
      });
      await record("existing_label_blocked", { jobId: job.id, orderName: job.orderName, evidence: prepared.existingLabel });
      return;
    }
    if (!prepared.ready) throw new Error("EasyDPD-Auftrag ist nicht kaufbereit.");
    await updateJob(job, "validated");
    const rechecked = await frameMessage(tab.id, frameId, { action: "validate_and_prepare", job });
    if (!rechecked.ready || rechecked.existingLabel?.found) throw new Error("EasyDPD-Zustand änderte sich vor der Kaufgrenze.");
    await updateJob(job, "dispatching");
    dispatchStarted = true;
    const dispatchNonce = crypto.randomUUID();
    await record("dispatching", { jobId: job.id, orderName: job.orderName, dispatchNonce });
    const startedAt = Date.now();
    downloadController = new AbortController();
    const downloadPromise = waitForDownloadedPdf(tab.id, startedAt, job.orderName, downloadController.signal);
    const clickResult = await frameMessage(tab.id, frameId, { action: "purchase_once", job, dispatchNonce });
    if (clickResult.clicked !== true) throw new Error("EasyDPD-Kaufklick wurde nicht eindeutig bestätigt.");
    const download = await downloadPromise;
    const uploaded = await nativeMessage({ type: "upload_artifact", job, filePath: download.filename });
    serverCompleted = true;
    await record("artifact_uploaded", {
      jobId: job.id,
      orderName: job.orderName,
      dpdTrackingNumber: uploaded.dpdTrackingNumber,
      printJobId: uploaded.printJobId,
    }).catch(() => undefined);
  } catch (error) {
    downloadController?.abort();
    const message = String(error?.message || error).slice(0, 500);
    if (!serverCompleted) {
      await updateJob(job, dispatchStarted ? "uncertain" : "retryable_error", { error: message }).catch(() => undefined);
    }
    await record(dispatchStarted ? "manual_review_after_dispatch" : "retryable_error", { jobId: job.id, orderName: job.orderName, error: message });
    throw error;
  } finally {
    stopKeepAlive();
  }
}

async function runCycle(source) {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const status = await nativeMessage({ type: "status" });
    if (status.mode !== "live" || status.liveEnabled !== true) {
      await record("dry_run_ready", { source, extensionId: chrome.runtime.id });
      return;
    }
    const claimed = await nativeMessage({ type: "claim" });
    if (!claimed.job) {
      await record(claimed.activeJobPending ? "active_job_pending" : "idle", { source });
      return;
    }
    const tab = await getOrCreateEasyDpdTab(claimed.job);
    await processJob(tab, claimed.job);
  } catch (error) {
    await record("bridge_error", { source, error: String(error?.message || error).slice(0, 500) });
  } finally {
    cycleRunning = false;
  }
}

async function ensureAlarm() {
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.1, periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm().then(() => runCycle("installed"));
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm().then(() => runCycle("startup"));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runCycle("alarm");
});
ensureAlarm().then(() => runCycle("service_worker"));
