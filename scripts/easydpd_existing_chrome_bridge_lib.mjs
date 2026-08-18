import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import {
  BrowserWorkerError,
  DEFAULT_BROWSER_TOKEN_SERVICE,
  DEFAULT_CF_SECRET_SERVICE,
  claimJob,
  resolveWorkerConfig,
  updateJob,
  uploadArtifact,
  validateClaimedJob,
} from "./easydpd_browser_worker_lib.mjs";

export const EXPECTED_EXTENSION_ID = "bgfphlbhdameagnafljlgpbpjdajmdhk";
export const EXPECTED_BRIDGE_PROTOCOL_VERSION = 2;
export const EXTENSION_BUILD_MISMATCH_CODE = "extension_build_mismatch";
export const EXTENSION_PROTOCOL_MISMATCH_CODE = "extension_protocol_mismatch";
export const NATIVE_HOST_NAME = "de.neontrip.easydpd_existing_chrome";
const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
const ALLOWED_UPDATE_RESULTS = new Set(["validated", "dispatching", "retryable_error", "uncertain", "existing_label"]);
const RESUMABLE_ACTIVE_JOB_PHASES = new Set(["claimed", "validated"]);

export class ExistingChromeBridgeError extends BrowserWorkerError {
  constructor(message, exitCode = 1, options = {}) {
    super(message, exitCode, options);
    this.name = "ExistingChromeBridgeError";
    this.nativeCode = options.nativeCode || null;
  }
}

function cleanString(value, name, maximumLength = 500) {
  const text = String(value || "").trim();
  if (!text || text.length > maximumLength || /[\0\r\n]/.test(text)) throw new ExistingChromeBridgeError(`${name} ist ungueltig.`, 65);
  return text;
}

export function validateBridgeConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ExistingChromeBridgeError("Bridge-Konfiguration fehlt.", 78);
  const mode = cleanString(raw.mode, "Bridge-Modus", 20);
  if (!["dry_run", "live"].includes(mode)) throw new ExistingChromeBridgeError("Bridge-Modus muss dry_run oder live sein.", 78);
  if (String(raw.extensionId || "") !== EXPECTED_EXTENSION_ID) throw new ExistingChromeBridgeError("Chrome-Erweiterungs-ID stimmt nicht.", 78);
  const extensionBuildCommit = String(raw.extensionBuildCommit || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(extensionBuildCommit)) throw new ExistingChromeBridgeError("Chrome-Erweiterungs-Build ist ungueltig.", 78);
  const apiBaseUrl = new URL(cleanString(raw.opsBaseUrl, "Ops-Basis-URL", 300));
  if (apiBaseUrl.protocol !== "https:" || apiBaseUrl.username || apiBaseUrl.password || apiBaseUrl.search || apiBaseUrl.hash) {
    throw new ExistingChromeBridgeError("Ops-Basis-URL muss eine saubere HTTPS-URL sein.", 78);
  }
  if (apiBaseUrl.origin !== "https://ops.neontrip.de" || apiBaseUrl.pathname !== "/") {
    throw new ExistingChromeBridgeError("Ops-Basis-URL ist nicht auf ops.neontrip.de gepinnt.", 78);
  }
  const downloadRoot = resolve(String(raw.downloadRoot || `${homedir()}/Downloads`));
  const statusPath = resolve(cleanString(raw.statusPath, "Bridge-Statuspfad", 1000));
  const activeJobPath = resolve(cleanString(raw.activeJobPath, "Bridge-Auftragspfad", 1000));
  if (downloadRoot !== resolve(homedir(), "Downloads")) throw new ExistingChromeBridgeError("Download-Verzeichnis ist nicht exakt auf den Benutzer-Downloads-Ordner gepinnt.", 78);
  if (statusPath !== resolve(homedir(), "Library/Logs/NEONTRIP/easydpd-existing-chrome-bridge/status.json")) {
    throw new ExistingChromeBridgeError("Bridge-Statuspfad ist nicht freigegeben.", 78);
  }
  if (activeJobPath !== resolve(homedir(), "Library/Application Support/NEONTRIP/easydpd-existing-chrome-bridge/active-job.json")) {
    throw new ExistingChromeBridgeError("Bridge-Auftragspfad ist nicht freigegeben.", 78);
  }
  const tokenService = cleanString(raw.tokenService, "Token-Keychain-Service", 200);
  const cfSecretService = cleanString(raw.cfSecretService, "Cloudflare-Keychain-Service", 200);
  if (tokenService !== DEFAULT_BROWSER_TOKEN_SERVICE || cfSecretService !== DEFAULT_CF_SECRET_SERVICE) {
    throw new ExistingChromeBridgeError("Bridge-Keychain-Services sind nicht freigegeben.", 78);
  }
  return {
    version: 1,
    mode,
    liveEnabled: mode === "live" && raw.liveEnabled === true,
    extensionId: EXPECTED_EXTENSION_ID,
    extensionBuildCommit,
    opsBaseUrl: apiBaseUrl.toString().replace(/\/$/, ""),
    keychainAccount: cleanString(raw.keychainAccount, "Keychain-Account", 200),
    workerId: cleanString(raw.workerId, "Browser-Worker-ID", 96),
    tokenService,
    cfClientId: String(raw.cfClientId || "").trim(),
    cfSecretService,
    downloadRoot,
    statusPath,
    activeJobPath,
  };
}

export async function loadBridgeConfig(path) {
  const payload = JSON.parse(await readFile(resolve(path), "utf8"));
  return validateBridgeConfig(payload);
}

export function workerConfiguration(config) {
  return resolveWorkerConfig(
    { mode: config.mode },
    {
      NEONTRIP_OPS_BASE_URL: config.opsBaseUrl,
      NEONTRIP_KEYCHAIN_ACCOUNT: config.keychainAccount,
      ARRIVAL_LABEL_BROWSER_WORKER_ID: config.workerId,
      NEONTRIP_EASYDPD_TOKEN_KEYCHAIN_SERVICE: config.tokenService,
      ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID: config.cfClientId,
      NEONTRIP_ARRIVAL_LABEL_CF_SECRET_KEYCHAIN_SERVICE: config.cfSecretService,
      ARRIVAL_LABEL_BROWSER_LIVE_ENABLED: config.liveEnabled ? "true" : "false",
      ARRIVAL_LABEL_BROWSER_STATUS_PATH: config.statusPath,
    },
  );
}

/**
 * @param {Record<string, unknown>} message
 * @param {string | null} [expectedBuildCommit]
 */
export function validateNativeRequest(message, expectedBuildCommit = null) {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new ExistingChromeBridgeError("Native-Bridge-Nachricht fehlt.", 65);
  const type = cleanString(message.type, "Native-Bridge-Nachrichtentyp", 40);
  if (!["status", "claim", "update", "upload_artifact"].includes(type)) throw new ExistingChromeBridgeError("Native-Bridge-Nachrichtentyp ist nicht freigegeben.", 65);
  if (message.bridgeProtocolVersion !== EXPECTED_BRIDGE_PROTOCOL_VERSION) {
    throw new ExistingChromeBridgeError("Chrome-Erweiterung ist veraltet; Erweiterung neu laden.", 65, {
      nativeCode: EXTENSION_PROTOCOL_MISMATCH_CODE,
    });
  }
  const extensionBuildCommit = String(message.extensionBuildCommit || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(extensionBuildCommit)) throw new ExistingChromeBridgeError("Chrome-Erweiterungs-Build fehlt oder ist ungueltig.", 65);
  if (expectedBuildCommit && extensionBuildCommit !== expectedBuildCommit) {
    throw new ExistingChromeBridgeError("Chrome-Erweiterungs-Build stimmt nicht mit dem installierten Native Host ueberein; Erweiterung neu laden.", 65, {
      nativeCode: EXTENSION_BUILD_MISMATCH_CODE,
    });
  }
  return { ...message, type, extensionBuildCommit };
}

export async function readNativeMessage(input) {
  const chunks = [];
  let byteLength = 0;
  let declared = null;
  for await (const chunk of input) {
    byteLength += chunk.length;
    if (byteLength > MAX_NATIVE_MESSAGE_BYTES + 4) throw new ExistingChromeBridgeError("Native-Bridge-Nachricht ist zu gross.", 65);
    chunks.push(chunk);
    if (declared === null && byteLength >= 4) {
      declared = Buffer.concat(chunks).readUInt32LE(0);
      if (declared < 2 || declared > MAX_NATIVE_MESSAGE_BYTES) {
        throw new ExistingChromeBridgeError("Native-Bridge-Nachrichtenlaenge ist ungueltig.", 65);
      }
    }
    if (declared !== null) {
      if (byteLength > declared + 4) throw new ExistingChromeBridgeError("Native-Bridge-Nachrichtenlaenge ist ungueltig.", 65);
      if (byteLength === declared + 4) break;
    }
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length < 4) throw new ExistingChromeBridgeError("Native-Bridge-Nachricht ist unvollstaendig.", 65);
  declared ??= buffer.readUInt32LE(0);
  if (declared < 2 || declared > MAX_NATIVE_MESSAGE_BYTES || buffer.length !== declared + 4) {
    throw new ExistingChromeBridgeError("Native-Bridge-Nachrichtenlaenge ist ungueltig.", 65);
  }
  return validateNativeRequest(JSON.parse(buffer.subarray(4).toString("utf8")));
}

export function encodeNativeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  if (body.length > MAX_NATIVE_MESSAGE_BYTES) throw new ExistingChromeBridgeError("Native-Bridge-Antwort ist zu gross.", 70);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

async function writeStatus(config, state, detail = {}) {
  await mkdir(dirname(config.statusPath), { recursive: true, mode: 0o700 });
  const temporary = `${config.statusPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    version: 1,
    mode: config.mode,
    liveEnabled: config.liveEnabled,
    workerId: config.workerId,
    extensionId: config.extensionId,
    state,
    updatedAt: new Date().toISOString(),
    ...detail,
  };
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, config.statusPath);
}

async function writeStatusBestEffort(config, state, detail = {}) {
  try {
    await writeStatus(config, state, detail);
  } catch {}
}

const JOB_BINDING_FIELDS = [
  "id",
  "orderName",
  "orderUrl",
  "productLabel",
  "labelFormat",
  "packageWeightGrams",
  "maximumPurchaseCents",
  "incomingDhlTrackingNumber",
  "incomingDhlLastSix",
  "artifactPath",
  "resultPath",
];

async function storeActiveJob(config, job) {
  await mkdir(dirname(config.activeJobPath), { recursive: true, mode: 0o700 });
  const temporary = `${config.activeJobPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify({ version: 2, state: "active", phase: "claimed", job }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, config.activeJobPath);
}

export async function readActiveJobState(config) {
  let persisted;
  try {
    persisted = JSON.parse(await readFile(config.activeJobPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new ExistingChromeBridgeError("Lokale Browser-Auftragsbindung ist nicht lesbar; manuelle Pruefung erforderlich.", 65);
  }
  if (persisted?.version !== 2) throw new ExistingChromeBridgeError("Lokale Browser-Auftragsbindung hat eine unbekannte Version.", 65);
  if (persisted.state === "claiming" && !persisted.job) return { state: "claiming", phase: null, job: null };
  if (persisted.state !== "active" || !["claimed", "validated", "dispatching"].includes(persisted.phase)) {
    throw new ExistingChromeBridgeError("Lokale Browser-Auftragsphase ist ungueltig.", 65);
  }
  return { state: "active", phase: persisted.phase, job: validateClaimedJob(persisted.job) };
}

export async function acquireClaimSlot(config) {
  await mkdir(dirname(config.activeJobPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(config.activeJobPath, `${JSON.stringify({ version: 2, state: "claiming" }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

async function updateActiveJobPhase(config, jobId, phase) {
  if (!["validated", "dispatching"].includes(phase)) throw new ExistingChromeBridgeError("Lokale Browser-Auftragsphase ist ungueltig.", 65);
  const active = await readActiveJobState(config);
  if (!active?.job || active.job.id !== jobId) throw new ExistingChromeBridgeError("Lokal gebundener Browser-Auftrag fehlt.", 65);
  const temporary = `${config.activeJobPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify({ version: 2, state: "active", phase, job: active.job }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, config.activeJobPath);
}

async function clearClaimSlot(config) {
  const active = await readActiveJobState(config);
  if (active?.state === "claiming") await unlink(config.activeJobPath);
}

async function validatedJobFromMessage(config, message) {
  const supplied = validateClaimedJob(message.job);
  const active = await readActiveJobState(config);
  if (!active?.job) throw new ExistingChromeBridgeError("Lokal gebundener Browser-Auftrag fehlt; erneut sicher claimen.", 65);
  const job = active.job;
  if (JOB_BINDING_FIELDS.some((field) => supplied[field] !== job[field])) {
    throw new ExistingChromeBridgeError("Browser-Auftrag stimmt nicht mit dem lokal gebundenen Claim ueberein.", 65);
  }
  if (job.resultPath !== `/api/internal/arrival-labels/browser-purchases/${job.id}/result`
    || job.artifactPath !== `/api/internal/arrival-labels/browser-purchases/${job.id}/artifact`) {
    throw new ExistingChromeBridgeError("Browser-Auftrag enthaelt keinen exakten API-Pfad.", 65);
  }
  return job;
}

async function clearActiveJob(config, jobId) {
  try {
    const persisted = JSON.parse(await readFile(config.activeJobPath, "utf8"));
    if (persisted?.job?.id === jobId) await unlink(config.activeJobPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readAllowedPdf(filePath, config) {
  const requested = resolve(cleanString(filePath, "PDF-Dateipfad", 2000));
  const [root, actual] = await Promise.all([realpath(config.downloadRoot), realpath(requested)]);
  if (actual !== root && !actual.startsWith(`${root}${sep}`)) throw new ExistingChromeBridgeError("PDF liegt ausserhalb des freigegebenen Download-Verzeichnisses.", 65);
  if (!actual.toLowerCase().endsWith(".pdf")) throw new ExistingChromeBridgeError("EasyDPD-Download hat keine PDF-Endung.", 65);
  const metadata = await stat(actual);
  if (!metadata.isFile() || metadata.size < 100 || metadata.size > 10 * 1024 * 1024) throw new ExistingChromeBridgeError("EasyDPD-PDF hat eine ungueltige Groesse.", 65);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) throw new ExistingChromeBridgeError("EasyDPD-PDF gehoert nicht dem lokalen Benutzer.", 65);
  const bytes = await readFile(actual);
  if (bytes.subarray(0, 5).toString("utf8") !== "%PDF-") throw new ExistingChromeBridgeError("EasyDPD-Download ist keine PDF-Datei.", 65);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function handleNativeRequest(config, rawMessage) {
  const message = validateNativeRequest(rawMessage, config.extensionBuildCommit);
  const configuration = workerConfiguration(config);
  const verifiedExtension = {
    bridgeProtocolVersion: EXPECTED_BRIDGE_PROTOCOL_VERSION,
    extensionBuildCommit: config.extensionBuildCommit,
    extensionClientVerified: true,
  };
  if (message.type === "status") {
    const active = await readActiveJobState(config);
    const state = active ? "active_job_pending" : config.liveEnabled ? "live_ready" : "dry_run_ready";
    await writeStatus(config, state, {
      ...verifiedExtension,
      activeJobId: active?.job?.id || null,
      activeJobState: active?.state || null,
      purchaseClicked: false,
    });
    return {
      ok: true,
      mode: config.mode,
      liveEnabled: config.liveEnabled,
      extensionId: config.extensionId,
      ...verifiedExtension,
      activeJobPending: Boolean(active),
      purchaseClicked: false,
    };
  }
  if (message.type === "claim") {
    if (!config.liveEnabled) {
      await writeStatusBestEffort(config, "dry_run_no_claim", { ...verifiedExtension, purchaseClicked: false });
      return { ok: true, job: null, mode: config.mode };
    }
    const bound = await readActiveJobState(config);
    if (bound) {
      const resumable = bound.job && RESUMABLE_ACTIVE_JOB_PHASES.has(bound.phase);
      await writeStatusBestEffort(config, resumable ? "job_resumed_pre_dispatch" : "active_job_pending", {
        ...verifiedExtension,
        activeJobId: bound.job?.id || null,
        activeJobState: bound.state,
        activeJobPhase: bound.phase,
        purchaseClicked: false,
      });
      return { ok: true, job: resumable ? bound.job : null, resumed: resumable, activeJobPending: !resumable };
    }
    if (!await acquireClaimSlot(config)) {
      await writeStatusBestEffort(config, "active_job_pending", { ...verifiedExtension, purchaseClicked: false });
      return { ok: true, job: null, activeJobPending: true };
    }
    try {
      const job = await claimJob(configuration);
      if (job) await storeActiveJob(config, job);
      else await clearClaimSlot(config);
      await writeStatusBestEffort(config, job ? "job_claimed" : "idle", { ...verifiedExtension, jobId: job?.id || null, orderName: job?.orderName || null, purchaseClicked: false });
      return { ok: true, job };
    } catch (error) {
      await clearClaimSlot(config).catch(() => undefined);
      throw error;
    }
  }
  const job = await validatedJobFromMessage(config, message);
  if (message.type === "update") {
    const result = cleanString(message.result, "Browser-Ergebnis", 40);
    if (!ALLOWED_UPDATE_RESULTS.has(result)) throw new ExistingChromeBridgeError("Browser-Ergebnis ist nicht freigegeben.", 65);
    if (result === "dispatching") await updateActiveJobPhase(config, job.id, "dispatching");
    await updateJob(configuration, job, result, message.error || null, {
      existingDpdTracking: message.existingDpdTracking || null,
      evidence: message.evidence || null,
    });
    if (result === "validated") await updateActiveJobPhase(config, job.id, "validated");
    await writeStatusBestEffort(config, `job_${result}`, {
      ...verifiedExtension,
      jobId: job.id,
      orderName: job.orderName,
      purchaseDispatchStarted: result === "dispatching",
      purchaseClicked: false,
    });
    if (["retryable_error", "uncertain", "existing_label"].includes(result)) await clearActiveJob(config, job.id);
    return { ok: true, result };
  }
  const { bytes, sha256 } = await readAllowedPdf(message.filePath, config);
  const uploaded = await uploadArtifact(configuration, job, bytes);
  await writeStatusBestEffort(config, "artifact_uploaded", {
    ...verifiedExtension,
    jobId: job.id,
    orderName: job.orderName,
    originalPdfSha256: sha256,
    dpdTrackingNumber: uploaded.dpdTrackingNumber,
    printJobId: uploaded.printJobId,
    purchaseClicked: true,
  });
  await clearActiveJob(config, job.id);
  return { ok: true, ...uploaded, originalPdfSha256: sha256 };
}

export async function selfTestBridge(config) {
  workerConfiguration(config);
  const result = {
    ok: true,
    action: "self_test",
    mode: config.mode,
    liveEnabled: config.liveEnabled,
    extensionId: config.extensionId,
    bridgeProtocolVersion: EXPECTED_BRIDGE_PROTOCOL_VERSION,
    extensionBuildCommit: config.extensionBuildCommit,
    extensionClientVerified: false,
    nativeHost: NATIVE_HOST_NAME,
    purchaseClicked: false,
    claimAttempted: false,
  };
  await writeStatus(config, "self_test_ok", result);
  return result;
}
