import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const DEFAULT_BROWSER_TOKEN_SERVICE = "NEONTRIP EasyDPD Browser Worker API Token";
export const DEFAULT_CF_SECRET_SERVICE = "NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET";

export class BrowserWorkerError extends Error {
  constructor(message, exitCode = 1, { postDispatch = false } = {}) {
    super(message);
    this.name = "BrowserWorkerError";
    this.exitCode = exitCode;
    this.postDispatch = postDispatch;
  }
}

export function parseWorkerArgs(argv) {
  const options = {
    mode: "dry_run",
    once: false,
    daemon: false,
    intervalSeconds: 300,
    selfTest: false,
    setupSession: false,
    acknowledgeProductionWrite: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") options.once = true;
    else if (arg === "--daemon") options.daemon = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--setup-session") options.setupSession = true;
    else if (arg === "--acknowledge-production-write") options.acknowledgeProductionWrite = true;
    else if (["--mode", "--interval-seconds"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new BrowserWorkerError(`Wert fuer ${arg} fehlt.`, 64);
      if (arg === "--mode") options.mode = value;
      else options.intervalSeconds = Number(value);
      index += 1;
    } else throw new BrowserWorkerError(`Unbekanntes Argument: ${arg}`, 64);
  }
  if (!["dry_run", "live"].includes(options.mode)) throw new BrowserWorkerError("Modus muss dry_run oder live sein.", 64);
  if (!Number.isSafeInteger(options.intervalSeconds) || options.intervalSeconds < 60 || options.intervalSeconds > 86_400) {
    throw new BrowserWorkerError("Intervall muss zwischen 60 und 86400 Sekunden liegen.", 64);
  }
  if (options.once && options.daemon) throw new BrowserWorkerError("--once und --daemon duerfen nicht kombiniert werden.", 64);
  if (options.mode === "live" && (!options.acknowledgeProductionWrite || (!options.once && !options.daemon))) {
    throw new BrowserWorkerError("Live-Modus braucht --once oder --daemon sowie --acknowledge-production-write.", 64);
  }
  if ((options.setupSession || options.selfTest) && (options.once || options.daemon || options.mode === "live")) {
    throw new BrowserWorkerError("Session-Setup und Selbsttest sind eigene schreibfreie Modi.", 64);
  }
  return options;
}

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new BrowserWorkerError(`${name} ist nicht konfiguriert.`, 78);
  return value;
}

export function readKeychainSecret(service, account) {
  try {
    const value = execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (value.length < 32) throw new Error("secret too short");
    return value;
  } catch {
    throw new BrowserWorkerError(`Keychain-Geheimnis fehlt: ${service}`, 78);
  }
}

export function resolveWorkerConfig(options, env = process.env) {
  const apiUrl = new URL(required(env, "NEONTRIP_OPS_BASE_URL"));
  if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new BrowserWorkerError("NEONTRIP_OPS_BASE_URL muss eine saubere HTTPS-URL sein.", 78);
  }
  const workerId = required(env, "ARRIVAL_LABEL_BROWSER_WORKER_ID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(workerId)) throw new BrowserWorkerError("Browser-Worker-ID ist ungueltig.", 78);
  const account = required(env, "NEONTRIP_KEYCHAIN_ACCOUNT");
  const token = String(env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN || "").trim()
    || readKeychainSecret(String(env.NEONTRIP_EASYDPD_TOKEN_KEYCHAIN_SERVICE || DEFAULT_BROWSER_TOKEN_SERVICE), account);
  if (token.length < 32) throw new BrowserWorkerError("Browser-Worker-API-Token ist zu kurz.", 78);
  const cfClientId = String(env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID || "").trim();
  const cfClientSecret = cfClientId
    ? String(env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET || "").trim()
      || readKeychainSecret(String(env.NEONTRIP_ARRIVAL_LABEL_CF_SECRET_KEYCHAIN_SERVICE || DEFAULT_CF_SECRET_SERVICE), account)
    : "";
  if (Boolean(cfClientId) !== Boolean(cfClientSecret)) throw new BrowserWorkerError("Cloudflare-Access-Service-Token ist unvollstaendig.", 78);
  if (options.mode === "live" && String(env.ARRIVAL_LABEL_BROWSER_LIVE_ENABLED || "").toLowerCase() !== "true") {
    throw new BrowserWorkerError("Live-Kauf ist lokal nicht freigegeben.", 77);
  }
  const profileDirectory = resolve(String(env.ARRIVAL_LABEL_BROWSER_PROFILE_DIR || `${homedir()}/Library/Application Support/NEONTRIP/easydpd-browser-worker/profile`));
  const lockPath = resolve(String(env.ARRIVAL_LABEL_BROWSER_LOCK_PATH || `${homedir()}/Library/Application Support/NEONTRIP/easydpd-browser-worker/worker.lock`));
  const statusPath = resolve(String(env.ARRIVAL_LABEL_BROWSER_STATUS_PATH || `${homedir()}/Library/Logs/NEONTRIP/easydpd-browser-worker/status.json`));
  return {
    apiBaseUrl: apiUrl.toString().replace(/\/$/, ""),
    token,
    workerId,
    mode: options.mode,
    profileDirectory,
    lockPath,
    statusPath,
    cfClientId,
    cfClientSecret,
  };
}

export function validateClaimedJob(job) {
  if (!job || typeof job !== "object") throw new BrowserWorkerError("Ops API lieferte keinen gueltigen Browser-Auftrag.", 65);
  if (!/^[0-9a-f-]{36}$/i.test(String(job.id || ""))) throw new BrowserWorkerError("Browser-Auftrags-ID ist ungueltig.", 65);
  const url = new URL(String(job.orderUrl || ""));
  if (url.origin !== "https://admin.shopify.com"
    || url.pathname !== "/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create"
    || !/^[0-9]{6,30}$/.test(String(url.searchParams.get("id") || ""))
    || url.searchParams.get("shop") !== "galaxybuzzdk.myshopify.com"
    || [...url.searchParams.keys()].some((key) => !["id", "shop"].includes(key))) {
    throw new BrowserWorkerError("Browser-Auftrags-URL liegt ausserhalb der freigegebenen EasyDPD-Route.", 65);
  }
  if (!["B2C", "B2C Predict", "DPD Express 8:30", "DPD Express 12:00", "DPD Express 18:00"].includes(job.productLabel)) {
    throw new BrowserWorkerError("EasyDPD-Produkt ist nicht freigegeben.", 65);
  }
  if (job.labelFormat !== "Einzeln auf A6" || job.packageWeightGrams !== 500) throw new BrowserWorkerError("EasyDPD-Format oder Gewicht ist nicht freigegeben.", 65);
  if (!Number.isInteger(job.maximumPurchaseCents) || job.maximumPurchaseCents < 1 || job.maximumPurchaseCents > 1500) {
    throw new BrowserWorkerError("Kaufpreisgrenze ist ungueltig.", 65);
  }
  if (!/^\d{10,40}$/.test(job.incomingDhlTrackingNumber) || job.incomingDhlLastSix !== job.incomingDhlTrackingNumber.slice(-6)) {
    throw new BrowserWorkerError("Eingehende DHL-Sendungsnummer ist ungueltig.", 65);
  }
  if (typeof job.orderName !== "string" || job.orderName.length < 2 || /[\r\n]/.test(job.orderName)) throw new BrowserWorkerError("Shopify-Bestellname ist ungueltig.", 65);
  return job;
}

export function acquireWorkerLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    const descriptor = openSync(lockPath, "wx", 0o600);
    writeFileSync(descriptor, `${process.pid}\n`, { encoding: "utf8" });
    closeSync(descriptor);
  } catch {
    let stale = false;
    try {
      const pid = Number(readFileSync(lockPath, "utf8").trim());
      if (Number.isInteger(pid) && pid > 1) process.kill(pid, 0);
      else stale = true;
    } catch (error) {
      stale = error?.code === "ESRCH" || error?.code === "EINVAL";
    }
    if (!stale) throw new BrowserWorkerError("Ein EasyDPD-Browser-Worker laeuft bereits.", 75);
    unlinkSync(lockPath);
    return acquireWorkerLock(lockPath);
  }
  return () => {
    try {
      if (existsSync(lockPath) && Number(readFileSync(lockPath, "utf8").trim()) === process.pid) unlinkSync(lockPath);
    } catch {}
  };
}

export async function apiRequest(configuration, endpoint, init = {}, { retryClaim = false } = {}) {
  if (!endpoint.startsWith("/api/internal/arrival-labels/browser-purchases/")) throw new BrowserWorkerError("Nicht freigegebener Ops-API-Pfad.", 65);
  const attempts = retryClaim ? 3 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${configuration.apiBaseUrl}${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${configuration.token}`,
          "X-Neontrip-Browser-Worker": configuration.workerId,
          ...(configuration.cfClientId ? {
            "CF-Access-Client-Id": configuration.cfClientId,
            "CF-Access-Client-Secret": configuration.cfClientSecret,
          } : {}),
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok || response.status === 204) return response;
      const payload = await response.json().catch(() => ({}));
      const message = String(payload.message || payload.error || `Ops API HTTP ${response.status}`).slice(0, 500);
      if (!retryClaim || ![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) throw new BrowserWorkerError(message, 69);
    } catch (error) {
      lastError = error;
      if (!retryClaim || attempt === attempts - 1) throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400 * (2 ** attempt)));
  }
  throw lastError || new BrowserWorkerError("Ops API nicht erreichbar.", 69);
}

export async function claimJob(configuration) {
  const response = await apiRequest(configuration, "/api/internal/arrival-labels/browser-purchases/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId: configuration.workerId, mode: configuration.mode }),
  }, { retryClaim: true });
  if (response.status === 204) return null;
  const payload = await response.json();
  return validateClaimedJob(payload.job);
}

export async function updateJob(configuration, job, result, error = null, detail = {}) {
  await apiRequest(configuration, job.resultPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workerId: configuration.workerId,
      result,
      error: error ? String(error).slice(0, 500) : null,
      existingDpdTracking: detail.existingDpdTracking || null,
      evidence: detail.evidence || null,
    }),
  });
}

export async function uploadArtifact(configuration, job, pdfBytes) {
  const hash = createHash("sha256").update(pdfBytes).digest("hex");
  const response = await apiRequest(configuration, job.artifactPath, {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-Neontrip-Pdf-Sha256": hash },
    body: pdfBytes,
  });
  return response.json();
}

export function ensurePrivateProfileDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}
