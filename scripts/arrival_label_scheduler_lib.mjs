import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_BASE_URL = "https://ops.neontrip.de";
export const DEFAULT_ALLOWED_HOSTS = ["ops.neontrip.de"];
export const DEFAULT_TOKEN_SERVICE = "NEONTRIP_ARRIVAL_LABEL_AGENT_API_TOKEN";
export const DEFAULT_CF_SECRET_SERVICE = "NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET";
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export class SchedulerError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "SchedulerError";
    this.exitCode = exitCode;
  }
}

function parseBoolean(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new SchedulerError(`${label} muss eine positive Ganzzahl sein.`, 64);
  return parsed;
}

export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--acknowledge-production-write") {
      parsed.acknowledgeProductionWrite = true;
      continue;
    }
    if (!["--mode", "--api-url", "--local-date", "--lock-path"].includes(arg)) {
      throw new SchedulerError(`Unbekanntes Argument: ${arg}`, 64);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new SchedulerError(`Wert fuer ${arg} fehlt.`, 64);
    index += 1;
    if (arg === "--mode") parsed.mode = value;
    if (arg === "--api-url") parsed.apiUrl = value;
    if (arg === "--local-date") parsed.localDate = value;
    if (arg === "--lock-path") parsed.lockPath = value;
  }
  return parsed;
}

export function resolveConfig(argv = [], env = process.env) {
  const args = parseArgs(argv);
  const mode = args.mode || env.ARRIVAL_LABEL_SCHEDULER_MODE || "dry_run";
  if (!["dry_run", "execute"].includes(mode)) throw new SchedulerError("Modus muss dry_run oder execute sein.", 64);
  if (mode === "execute") {
    if (!parseBoolean(env.ARRIVAL_LABEL_SCHEDULER_LIVE_ENABLED) || args.acknowledgeProductionWrite !== true) {
      throw new SchedulerError("Execute ist verriegelt: Live-Gate und ausdrueckliche Bestaetigung sind erforderlich.", 64);
    }
  }

  const baseUrl = String(env.NEONTRIP_OPS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  let apiUrl;
  try {
    apiUrl = new URL(args.apiUrl || `${baseUrl}/api/internal/arrival-labels/run`);
  } catch {
    throw new SchedulerError("Ops-API-URL ist ungueltig.", 64);
  }
  const allowedHosts = String(env.NEONTRIP_OPS_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const testLoopbackAllowed = env.NODE_ENV === "test" && parseBoolean(env.ARRIVAL_LABEL_SCHEDULER_ALLOW_TEST_LOOPBACK);
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(apiUrl.hostname.toLowerCase());
  if (apiUrl.protocol !== "https:" && !(testLoopbackAllowed && isLoopback)) {
    throw new SchedulerError("Ops-API muss HTTPS verwenden.", 64);
  }
  if (!allowedHosts.includes(apiUrl.hostname.toLowerCase()) && !(testLoopbackAllowed && isLoopback)) {
    throw new SchedulerError("Ops-API-Host ist nicht freigegeben.", 64);
  }
  if (apiUrl.pathname !== "/api/internal/arrival-labels/run" || apiUrl.search || apiUrl.hash) {
    throw new SchedulerError("Ops-API-Pfad ist nicht freigegeben.", 64);
  }
  if (args.localDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.localDate)) {
    throw new SchedulerError("localDate muss YYYY-MM-DD sein.", 64);
  }

  const account = env.NEONTRIP_KEYCHAIN_ACCOUNT || env.USER;
  if (!account) throw new SchedulerError("Keychain-Account fehlt.", 64);
  return {
    mode,
    apiUrl: apiUrl.toString(),
    localDate: args.localDate,
    acknowledgeProductionWrite: args.acknowledgeProductionWrite === true,
    timeoutMs: parsePositiveInteger(env.ARRIVAL_LABEL_SCHEDULER_TIMEOUT_MS, 55_000, "Timeout"),
    lockPath: args.lockPath || env.ARRIVAL_LABEL_SCHEDULER_LOCK_PATH || join(homedir(), "Library", "Application Support", "NEONTRIP", "arrival-label-scheduler.lock"),
    keychainAccount: account,
    tokenService: env.NEONTRIP_ARRIVAL_LABEL_TOKEN_KEYCHAIN_SERVICE || DEFAULT_TOKEN_SERVICE,
    cfClientId: String(env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID || "").trim(),
    cfSecretService: env.NEONTRIP_ARRIVAL_LABEL_CF_SECRET_KEYCHAIN_SERVICE || DEFAULT_CF_SECRET_SERVICE,
  };
}

export function readKeychainSecret(service, account, exec = execFileSync) {
  try {
    const value = exec("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (value.length < 24) throw new Error("short secret");
    return value;
  } catch {
    throw new SchedulerError(`Keychain-Eintrag ${service} fehlt oder ist ungueltig.`, 78);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const nonce = randomUUID();
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw new SchedulerError("Scheduler-Sperre konnte nicht angelegt werden.", 73);
    let owner;
    try {
      owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
    } catch {
      throw new SchedulerError("Scheduler-Sperre ist unlesbar; manuelle Pruefung erforderlich.", 75);
    }
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || processIsAlive(owner.pid)) {
      throw new SchedulerError("Ein Arrival-Label-Lauf ist bereits aktiv.", 75);
    }
    const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
    try {
      renameSync(lockPath, stalePath);
      mkdirSync(lockPath, { mode: 0o700 });
    } catch {
      throw new SchedulerError("Scheduler-Sperre wurde gleichzeitig geaendert; Lauf abgebrochen.", 75);
    }
    try {
      rmSync(stalePath, { recursive: true, force: true });
    } catch {
      // A quarantined stale lock is harmless and may be cleaned up manually.
    }
  }
  const ownerPath = join(lockPath, "owner.json");
  const descriptor = openSync(ownerPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() }));
  } finally {
    closeSync(descriptor);
  }
  return () => {
    try {
      const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
      if (owner.pid === process.pid && owner.nonce === nonce) rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // A changed or missing lock is never removed blindly.
    }
  };
}

async function readBoundedJson(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) throw new SchedulerError("Ops-Antwort hat einen ungueltigen Inhaltstyp.", 69);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new SchedulerError("Ops-Antwort ist zu gross.", 69);
  if (!response.body) throw new SchedulerError("Ops-Antwort ist leer.", 69);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new SchedulerError("Ops-Antwort ist zu gross.", 69);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SchedulerError("Ops-Antwort ist kein gueltiges JSON.", 69);
  }
}

function safeSummary(payload, mode) {
  const summary = payload?.result?.summary || {};
  const count = (key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0 ? summary[key] : null;
  return {
    ok: true,
    mode,
    requestId: typeof payload?.requestId === "string" ? payload.requestId.slice(0, 80) : null,
    runId: typeof payload?.result?.runId === "string" ? payload.result.runId.slice(0, 80) : null,
    summary: {
      found: count("found"),
      labelPlanned: count("labelPlanned"),
      existingLabel: count("existingLabel"),
      manualReview: count("manualReview"),
      specialCase: count("specialCase"),
      reviewNotifications: count("reviewNotifications"),
    },
    completedAt: new Date().toISOString(),
  };
}

export async function runScheduler(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const readSecret = dependencies.readSecret || readKeychainSecret;
  const release = (dependencies.acquireLockImpl || acquireLock)(config.lockPath);
  try {
    const token = readSecret(config.tokenService, config.keychainAccount);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "NEONTRIP-Arrival-Label-Scheduler/1.0",
    };
    if (config.cfClientId) {
      headers["CF-Access-Client-Id"] = config.cfClientId;
      headers["CF-Access-Client-Secret"] = readSecret(config.cfSecretService, config.keychainAccount);
    }
    const body = { mode: config.mode, persist: true, triggerType: "local_schedule" };
    if (config.localDate) body.localDate = config.localDate;
    let response;
    try {
      response = await fetchImpl(config.apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new SchedulerError("Ops-API nicht sicher erreichbar; kein automatischer Wiederholungsversuch.", 69);
    }
    const payload = await readBoundedJson(response);
    if (!response.ok || payload?.ok !== true) {
      throw new SchedulerError(`Ops-Lauf fehlgeschlagen (HTTP ${response.status}); Audit-Log pruefen.`, 69);
    }
    return safeSummary(payload, config.mode);
  } finally {
    release();
  }
}
