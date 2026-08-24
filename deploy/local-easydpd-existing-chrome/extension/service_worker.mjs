import {
  BRIDGE_PROTOCOL_VERSION,
  EASYDPD_FRAME_ORIGIN,
  NATIVE_HOST,
  matchingDownloadedPdf,
  validateBridgeJob,
  validateEasyDpdLabelDownloadUrl,
  validateOrderUrl,
} from "./policy.mjs";

const ALARM_NAME = "neontrip-easydpd-existing-chrome-cycle";
const EXTENSION_BUILD_COMMIT = "__NEONTRIP_EXTENSION_BUILD_COMMIT__";
const STATE_KEY = "neontripEasyDpdBridgeState";
const AUDIT_KEY = "neontripEasyDpdBridgeAudit";
const MAX_AUDIT_ENTRIES = 50;
const POST_DISPATCH_HISTORY_TIMEOUT_MS = 45_000;
const RELOAD_REQUIRED_CODES = new Set(["extension_build_mismatch", "extension_protocol_mismatch"]);
let cycleRunning = false;

function createNativeSession() {
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  const pending = [];
  let closed = false;
  port.onMessage.addListener((response) => {
    const request = pending.shift();
    if (!request) return;
    if (!response?.ok) {
      if (RELOAD_REQUIRED_CODES.has(String(response?.code || ""))) {
        chrome.runtime.reload();
        return;
      }
      request.reject(new Error(String(response?.error || "Native Bridge antwortete mit einem Fehler.")));
      return;
    }
    request.resolve(response);
  });
  port.onDisconnect.addListener(() => {
    closed = true;
    const message = chrome.runtime.lastError?.message || "Native Bridge wurde getrennt.";
    while (pending.length > 0) pending.shift().reject(new Error(message));
  });
  return {
    send(payload) {
      if (closed) return Promise.reject(new Error("Native Bridge ist nicht verbunden."));
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        port.postMessage({
          ...payload,
          bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
          extensionBuildCommit: EXTENSION_BUILD_COMMIT,
        });
      });
    },
    close() {
      if (!closed) port.disconnect();
      closed = true;
    },
  };
}

async function record(state, detail = {}) {
  const entry = { at: new Date().toISOString(), state, ...detail };
  const stored = await chrome.storage.local.get([AUDIT_KEY]);
  const audit = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];
  audit.push(entry);
  await chrome.storage.local.set({ [STATE_KEY]: entry, [AUDIT_KEY]: audit.slice(-MAX_AUDIT_ENTRIES) });
}

async function createFreshEasyDpdTab(job) {
  const tab = await chrome.tabs.create({ url: validateOrderUrl(job.orderUrl), active: false });
  if (!Number.isInteger(tab.id)) throw new Error("Frischer Shopify/easyDPD-Tab konnte nicht angelegt werden.");
  return tab;
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

function reloadAndWaitForTabComplete(tabId, expectedUrl, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    let settled = false;
    const cleanup = (error, tab) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve(tab);
    };
    const deadline = setTimeout(() => cleanup(new Error("Shopify/easyDPD-Tab wurde nicht rechtzeitig frisch geladen.")), timeoutMs);
    const listener = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId) return;
      if (changeInfo.status === "loading") sawLoading = true;
      if (!sawLoading || changeInfo.status !== "complete") return;
      try {
        if (validateOrderUrl(tab.url) !== validateOrderUrl(expectedUrl)) return;
      } catch {
        return;
      }
      cleanup(null, tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.reload(tabId, { bypassCache: true }).catch((error) => cleanup(error));
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

async function frameMessageWhenReady(tabId, frameId, payload, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    try {
      return await frameMessage(tabId, frameId, payload);
    } catch (error) {
      if (!isMissingFrameReceiver(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } while (Date.now() < deadline);
  throw lastError || new Error("EasyDPD-App-Frame antwortete nicht rechtzeitig.");
}

async function validateAndPrepareFrame(tabId, job) {
  let frameId = await easyDpdFrameId(tabId);
  try {
    return { frameId, prepared: await frameMessageWhenReady(tabId, frameId, { action: "validate_and_prepare", job }) };
  } catch (error) {
    if (!isMissingFrameReceiver(error)) throw error;
    await record("content_script_reload", { jobId: job.id, orderName: job.orderName });
    await reloadAndWaitForTabComplete(tabId, job.orderUrl);
    frameId = await easyDpdFrameId(tabId);
    return { frameId, prepared: await frameMessageWhenReady(tabId, frameId, { action: "validate_and_prepare", job }) };
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

function waitForDownloadId(downloadId, startedAt, expectedUrl, timeoutMs = 45_000) {
  const validatedExpectedUrl = validateEasyDpdLabelDownloadUrl(expectedUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (error, item) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(reconcileInterval);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve(item);
    };
    const consider = (item) => {
      if (!item || item.id !== downloadId) return;
      const start = Date.parse(String(item.startTime || ""));
      if (!Number.isFinite(start) || start < startedAt - 2_000) {
        cleanup(new Error("EasyDPD-History-Download liegt ausserhalb des Recovery-Zeitfensters."));
        return;
      }
      let source;
      try { source = validateEasyDpdLabelDownloadUrl(item.url); } catch {
        cleanup(new Error("EasyDPD-History-Download stammt nicht von der freigegebenen Route."));
        return;
      }
      if (source !== validatedExpectedUrl) {
        cleanup(new Error("EasyDPD-History-Download stimmt nicht mit dem belegten Label ueberein."));
        return;
      }
      if (item.state === "interrupted") cleanup(new Error("EasyDPD-History-Download wurde unterbrochen."));
      else if (item.state === "complete") {
        if (String(item.filename || "").toLowerCase().endsWith(".pdf") !== true) {
          cleanup(new Error("EasyDPD-History-Download ist keine PDF-Datei."));
        } else cleanup(null, item);
      }
    };
    const reconcile = async () => {
      const items = await chrome.downloads.search({ id: downloadId });
      if (items.length === 1) consider(items[0]);
    };
    const onChanged = (delta) => {
      if (delta.id === downloadId && delta.state) reconcile().catch((error) => cleanup(error));
    };
    const deadline = setTimeout(() => cleanup(new Error("EasyDPD-History-PDF-Download wurde nicht bestaetigt.")), timeoutMs);
    const reconcileInterval = setInterval(() => reconcile().catch((error) => cleanup(error)), 500);
    chrome.downloads.onChanged.addListener(onChanged);
    reconcile().catch((error) => cleanup(error));
  });
}

function safeHistoryEvidence(evidence) {
  return {
    found: evidence?.found === true,
    labelCount: Number(evidence?.labelCount || 0),
    trackingNumbers: Array.isArray(evidence?.trackingNumbers) ? evidence.trackingNumbers : [],
  };
}

function waitForPostDispatchPageError(tabId, frameId, job, baselineAlertTexts, signal) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const cleanup = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(null);
    };
    const onAbort = () => cleanup(null);
    const poll = async () => {
      if (settled) return;
      try {
        const observed = await frameMessageWhenReady(tabId, frameId, {
          action: "inspect_post_dispatch",
          job,
          baselineAlertTexts,
        });
        if (settled) return;
        const newAlertTexts = Array.isArray(observed?.newAlertTexts)
          ? observed.newAlertTexts.map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3)
          : [];
        if (newAlertTexts.length > 0) {
          const message = `EasyDPD meldet nach dem Kaufversuch: ${newAlertTexts.join(" | ")}`.slice(0, 500);
          await record("post_dispatch_page_error", { jobId: job.id, orderName: job.orderName, error: message }).catch(() => undefined);
          cleanup(new Error(message));
          return;
        }
      } catch (error) {
        if (settled) return;
        if (!isMissingFrameReceiver(error)) {
          cleanup(error);
          return;
        }
      }
      if (settled) return;
      timer = setTimeout(poll, 500);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    poll();
  });
}

async function recoverPostDispatchDownload(tabId, job, settleDelayMs = 0) {
  if (settleDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
  await reloadAndWaitForTabComplete(tabId, job.orderUrl);
  const frameId = await easyDpdFrameId(tabId);
  const deadline = Date.now() + POST_DISPATCH_HISTORY_TIMEOUT_MS;
  let observed = null;
  do {
    observed = await frameMessageWhenReady(tabId, frameId, { action: "inspect_history", job });
    if (observed?.found) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);

  const evidence = safeHistoryEvidence(observed);
  await record("post_dispatch_history_checked", { jobId: job.id, orderName: job.orderName, evidence });
  if (!evidence.found) throw new Error("EasyDPD-History blieb nach frischem Reload ohne Label; kein automatischer Wiederholungskauf.");
  if (evidence.labelCount !== 1 || evidence.trackingNumbers.length > 1 || typeof observed.downloadUrl !== "string") {
    throw new Error("EasyDPD-History ist nach dem Dispatch nicht eindeutig einem Label-Download zuzuordnen.");
  }
  const downloadUrl = validateEasyDpdLabelDownloadUrl(observed.downloadUrl);
  const startedAt = Date.now();
  const downloadId = await chrome.downloads.download({ url: downloadUrl, saveAs: false, conflictAction: "uniquify" });
  if (!Number.isInteger(downloadId)) throw new Error("EasyDPD-History-Download konnte nicht gestartet werden.");
  const download = await waitForDownloadId(downloadId, startedAt, downloadUrl);
  await record("post_dispatch_download_recovered", { jobId: job.id, orderName: job.orderName, evidence });
  return download;
}

async function updateJob(nativeSession, job, result, extra = {}) {
  return nativeSession.send({ type: "update", job, result, ...extra });
}

async function processJob(nativeSession, tab, job) {
  validateBridgeJob(job);
  let dispatchStarted = false;
  let serverCompleted = false;
  let downloadController = null;
  let downloadPromise = null;
  let pageErrorController = null;
  let pageErrorPromise = null;
  let postDispatchReconciliationAttempted = false;
  let artifactUploadStarted = false;
  try {
    await waitForTabComplete(tab.id, job.orderUrl);
    const { frameId, prepared } = await validateAndPrepareFrame(tab.id, job);
    if (prepared.existingLabel?.found) {
      const trackingNumbers = prepared.existingLabel.trackingNumbers || [];
      await updateJob(nativeSession, job, "existing_label", {
        existingDpdTracking: trackingNumbers.length === 1 ? trackingNumbers[0] : null,
        evidence: prepared.existingLabel,
        error: "EasyDPD-History enthält bereits ein Label; kein zweiter Kauf.",
      });
      await record("existing_label_blocked", { jobId: job.id, orderName: job.orderName, evidence: prepared.existingLabel });
      return;
    }
    if (!prepared.ready) throw new Error("EasyDPD-Auftrag ist nicht kaufbereit.");
    await updateJob(nativeSession, job, "validated");
    const rechecked = await frameMessage(tab.id, frameId, { action: "validate_and_prepare", job });
    if (!rechecked.ready || rechecked.existingLabel?.found) throw new Error("EasyDPD-Zustand änderte sich vor der Kaufgrenze.");
    await updateJob(nativeSession, job, "dispatching");
    dispatchStarted = true;
    const dispatchNonce = crypto.randomUUID();
    await record("dispatching", { jobId: job.id, orderName: job.orderName, dispatchNonce });
    const startedAt = Date.now();
    downloadController = new AbortController();
    downloadPromise = waitForDownloadedPdf(tab.id, startedAt, job.orderName, downloadController.signal);
    const clickResult = await frameMessage(tab.id, frameId, { action: "purchase_once", job, dispatchNonce });
    if (clickResult.clicked !== true) throw new Error("EasyDPD-Kaufklick wurde nicht eindeutig bestätigt.");
    pageErrorController = new AbortController();
    pageErrorPromise = waitForPostDispatchPageError(
      tab.id,
      frameId,
      job,
      clickResult.baselineAlertTexts,
      pageErrorController.signal,
    );
    let download;
    try {
      download = await Promise.race([downloadPromise, pageErrorPromise]);
    } catch (error) {
      downloadController.abort();
      pageErrorController.abort();
      postDispatchReconciliationAttempted = true;
      await record("post_dispatch_download_missing", {
        jobId: job.id,
        orderName: job.orderName,
        error: String(error?.message || error).slice(0, 500),
      });
      try {
        download = await recoverPostDispatchDownload(tab.id, job);
      } catch (recoveryError) {
        throw new Error(`${String(error?.message || error)} Post-Dispatch-Abgleich: ${String(recoveryError?.message || recoveryError)}`);
      }
    } finally {
      pageErrorController.abort();
      await pageErrorPromise.catch(() => undefined);
    }
    artifactUploadStarted = true;
    const uploaded = await nativeSession.send({ type: "upload_artifact", job, filePath: download.filename });
    serverCompleted = true;
    await record("artifact_uploaded", {
      jobId: job.id,
      orderName: job.orderName,
      dpdTrackingNumber: uploaded.dpdTrackingNumber,
      printJobId: uploaded.printJobId,
    }).catch(() => undefined);
  } catch (error) {
    downloadController?.abort();
    pageErrorController?.abort();
    await downloadPromise?.catch(() => undefined);
    await pageErrorPromise?.catch(() => undefined);
    let finalError = error;
    if (dispatchStarted && !serverCompleted && !postDispatchReconciliationAttempted && !artifactUploadStarted) {
      postDispatchReconciliationAttempted = true;
      try {
        const download = await recoverPostDispatchDownload(tab.id, job, 5_000);
        artifactUploadStarted = true;
        const uploaded = await nativeSession.send({ type: "upload_artifact", job, filePath: download.filename });
        serverCompleted = true;
        await record("artifact_uploaded", {
          jobId: job.id,
          orderName: job.orderName,
          dpdTrackingNumber: uploaded.dpdTrackingNumber,
          printJobId: uploaded.printJobId,
          recoveredAfterDispatchError: true,
        }).catch(() => undefined);
        return;
      } catch (recoveryError) {
        finalError = new Error(`${String(error?.message || error)} Post-Dispatch-Abgleich: ${String(recoveryError?.message || recoveryError)}`);
      }
    }
    const message = String(finalError?.message || finalError).slice(0, 500);
    if (!serverCompleted) {
      await updateJob(nativeSession, job, dispatchStarted ? "uncertain" : "retryable_error", { error: message }).catch(() => undefined);
    }
    await record(dispatchStarted ? "manual_review_after_dispatch" : "retryable_error", { jobId: job.id, orderName: job.orderName, error: message });
    throw finalError;
  }
}

async function runCycle(source) {
  if (cycleRunning) return;
  cycleRunning = true;
  const nativeSession = createNativeSession();
  try {
    const status = await nativeSession.send({ type: "status" });
    if (status.mode !== "live" || status.liveEnabled !== true) {
      await record("dry_run_ready", { source, extensionId: chrome.runtime.id });
      return;
    }
    const claimed = await nativeSession.send({ type: "claim" });
    if (!claimed.job) {
      await record(claimed.activeJobPending ? "active_job_pending" : "idle", { source });
      return;
    }
    const tab = await createFreshEasyDpdTab(claimed.job);
    await processJob(nativeSession, tab, claimed.job);
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  } catch (error) {
    await record("bridge_error", { source, error: String(error?.message || error).slice(0, 500) });
  } finally {
    nativeSession.close();
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
