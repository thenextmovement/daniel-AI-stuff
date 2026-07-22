#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWorkerError, DEFAULT_BROWSER_TOKEN_SERVICE, DEFAULT_CF_SECRET_SERVICE, readKeychainSecret } from "./easydpd_browser_worker_lib.mjs";

const LABEL = "de.neontrip.easydpd-browser-worker";
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseManagerArgs(argv) {
  const command = argv[0];
  if (!["install", "status", "setup-session", "self-test", "rollback", "uninstall"].includes(command)) {
    throw new BrowserWorkerError("Nutzung: manage_easydpd_browser_worker.mjs <install|status|setup-session|self-test|rollback|uninstall> [--mode dry_run|live] [--interval-seconds 300] [--acknowledge-production-write]", 64);
  }
  const options = { command, mode: "dry_run", intervalSeconds: 300, acknowledgeProductionWrite: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--acknowledge-production-write") options.acknowledgeProductionWrite = true;
    else if (["--mode", "--interval-seconds"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new BrowserWorkerError(`Wert fuer ${arg} fehlt.`, 64);
      if (arg === "--mode") options.mode = value;
      else options.intervalSeconds = Number(value);
      index += 1;
    } else throw new BrowserWorkerError(`Unbekanntes Argument: ${arg}`, 64);
  }
  if (!["dry_run", "live"].includes(options.mode)) throw new BrowserWorkerError("Modus muss dry_run oder live sein.", 64);
  if (!Number.isSafeInteger(options.intervalSeconds) || options.intervalSeconds < 60 || options.intervalSeconds > 86_400) throw new BrowserWorkerError("Intervall muss zwischen 60 und 86400 Sekunden liegen.", 64);
  if (options.mode === "live" && !options.acknowledgeProductionWrite) throw new BrowserWorkerError("Live-Installation braucht --acknowledge-production-write.", 64);
  return options;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: options.cwd || SOURCE_ROOT, encoding: "utf8", stdio: options.stdio || ["ignore", "pipe", "pipe"], env: options.env || process.env }).trim();
}

function gitState() {
  if (run("/usr/bin/git", ["status", "--porcelain"])) throw new BrowserWorkerError("Installation nur aus einem sauberen Worktree erlaubt.", 65);
  const head = run("/usr/bin/git", ["rev-parse", "HEAD"]);
  run("/usr/bin/git", ["fetch", "origin", "main", "--quiet"]);
  if (head !== run("/usr/bin/git", ["rev-parse", "origin/main"])) throw new BrowserWorkerError("Installation nur vom exakten origin/main-Commit erlaubt.", 65);
  return head;
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function destinations() {
  const home = homedir();
  const runtimeRoot = join(home, "NEONTRIP", "runtime", "easydpd-browser-worker");
  return {
    home,
    runtimeRoot,
    currentFile: join(runtimeRoot, "CURRENT"),
    plist: join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    logDir: join(home, "Library", "Logs", "NEONTRIP", "easydpd-browser-worker"),
    profileDir: join(home, "Library", "Application Support", "NEONTRIP", "easydpd-browser-worker", "profile"),
    lockPath: join(home, "Library", "Application Support", "NEONTRIP", "easydpd-browser-worker", "worker.lock"),
  };
}

function launchDomain() { return `gui/${userInfo().uid}`; }

function launchctl(args, allowFailure = false) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 && !allowFailure) throw new BrowserWorkerError(`launchctl fehlgeschlagen: ${String(result.stderr || "").trim().slice(0, 300)}`, 70);
  return result;
}

function backupPlist(target, backupDir) {
  if (!existsSync(target)) return null;
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = join(backupDir, `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}.plist`);
  copyFileSync(target, backup);
  chmodSync(backup, 0o600);
  return backup;
}

export function renderPlist(template, values) {
  const replacements = {
    "{{NODE_PATH}}": xml(process.execPath),
    "{{RUNNER_PATH}}": xml(values.runnerPath),
    "{{MODE}}": xml(values.mode),
    "{{LIVE_ACK_ARGUMENT}}": values.mode === "live" ? "    <string>--acknowledge-production-write</string>" : "",
    "{{HOME}}": xml(values.home),
    "{{OPS_BASE_URL}}": xml(values.opsBaseUrl),
    "{{KEYCHAIN_ACCOUNT}}": xml(values.account),
    "{{WORKER_ID}}": xml(values.workerId),
    "{{PROFILE_DIR}}": xml(values.profileDir),
    "{{LOCK_PATH}}": xml(values.lockPath),
    "{{STATUS_PATH}}": xml(join(values.logDir, "status.json")),
    "{{LIVE_ENABLED}}": values.mode === "live" ? "true" : "false",
    "{{CF_CLIENT_ID_ENV}}": values.cfClientId ? `    <key>ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID</key>\n    <string>${xml(values.cfClientId)}</string>` : "",
    "{{INTERVAL_SECONDS}}": String(values.intervalSeconds),
    "{{STDOUT_PATH}}": xml(join(values.logDir, "worker.log")),
    "{{STDERR_PATH}}": xml(join(values.logDir, "worker.error.log")),
  };
  let output = template;
  for (const [needle, replacement] of Object.entries(replacements)) output = output.replaceAll(needle, replacement);
  if (/\{\{[^}]+\}\}/.test(output)) throw new BrowserWorkerError("Plist-Template enthaelt unbekannte Platzhalter.", 70);
  return output;
}

function requiredRuntimeEnvironment() {
  const account = String(process.env.NEONTRIP_KEYCHAIN_ACCOUNT || process.env.USER || "").trim();
  if (!account) throw new BrowserWorkerError("Keychain-Account fehlt.", 64);
  readKeychainSecret(String(process.env.NEONTRIP_EASYDPD_TOKEN_KEYCHAIN_SERVICE || DEFAULT_BROWSER_TOKEN_SERVICE), account);
  const cfClientId = String(process.env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID || "").trim();
  if (cfClientId) readKeychainSecret(String(process.env.NEONTRIP_ARRIVAL_LABEL_CF_SECRET_KEYCHAIN_SERVICE || DEFAULT_CF_SECRET_SERVICE), account);
  return {
    account,
    cfClientId,
    opsBaseUrl: process.env.NEONTRIP_OPS_BASE_URL || "https://ops.neontrip.de",
    workerId: process.env.ARRIVAL_LABEL_BROWSER_WORKER_ID || "daniels-mac-easydpd-01",
  };
}

function stageVersion(commit) {
  const target = destinations();
  const versionDir = join(target.runtimeRoot, "versions", commit);
  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  for (const filename of ["easydpd_browser_worker_lib.mjs", "run_easydpd_browser_worker.mjs"]) {
    copyFileSync(join(SOURCE_ROOT, "scripts", filename), join(versionDir, filename));
    chmodSync(join(versionDir, filename), 0o500);
  }
  for (const filename of ["package.json", "package-lock.json"]) copyFileSync(join(SOURCE_ROOT, "deploy", "local-easydpd-browser-worker", filename), join(versionDir, filename));
  run("/usr/bin/env", ["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: versionDir,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
  return { versionDir, runnerPath: join(versionDir, "run_easydpd_browser_worker.mjs") };
}

function install(options) {
  const commit = gitState();
  const target = destinations();
  const runtime = requiredRuntimeEnvironment();
  const staged = stageVersion(commit);
  mkdirSync(dirname(target.plist), { recursive: true, mode: 0o700 });
  mkdirSync(target.logDir, { recursive: true, mode: 0o700 });
  mkdirSync(target.profileDir, { recursive: true, mode: 0o700 });
  const statusFile = join(target.logDir, "status.json");
  const previousStatus = existsSync(statusFile) ? `${statusFile}.previous-${Date.now()}` : null;
  if (previousStatus) renameSync(statusFile, previousStatus);
  const backup = backupPlist(target.plist, join(target.runtimeRoot, "plist-backups"));
  const template = readFileSync(join(SOURCE_ROOT, "deploy", "local-easydpd-browser-worker", `${LABEL}.plist.template`), "utf8");
  const rendered = renderPlist(template, {
    runnerPath: staged.runnerPath,
    mode: options.mode,
    home: target.home,
    profileDir: target.profileDir,
    lockPath: target.lockPath,
    logDir: target.logDir,
    intervalSeconds: options.intervalSeconds,
    ...runtime,
  });
  const temporary = `${target.plist}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, rendered, { mode: 0o600, flag: "wx" });
  launchctl(["bootout", launchDomain(), target.plist], true);
  renameSync(temporary, target.plist);
  chmodSync(target.plist, 0o600);
  try {
    launchctl(["bootstrap", launchDomain(), target.plist]);
    launchctl(["kickstart", "-k", `${launchDomain()}/${LABEL}`]);
    writeFileSync(target.currentFile, `${commit}\n`, { mode: 0o600 });
  } catch (error) {
    launchctl(["bootout", launchDomain(), target.plist], true);
    if (previousStatus && !existsSync(statusFile)) renameSync(previousStatus, statusFile);
    if (backup) {
      copyFileSync(backup, target.plist);
      launchctl(["bootstrap", launchDomain(), target.plist], true);
    }
    throw error;
  }
  return { ok: true, action: "installed", label: LABEL, commit, mode: options.mode, intervalSeconds: options.intervalSeconds, backup, previousStatus };
}

function currentRunner() {
  const target = destinations();
  if (!existsSync(target.currentFile)) throw new BrowserWorkerError("Browser-Worker ist noch nicht installiert.", 66);
  const commit = readFileSync(target.currentFile, "utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new BrowserWorkerError("Installierter Browser-Worker-Commit ist ungueltig.", 65);
  return join(target.runtimeRoot, "versions", commit, "run_easydpd_browser_worker.mjs");
}

function runInteractive(command) {
  const target = destinations();
  const launchState = launchctl(["print", `${launchDomain()}/${LABEL}`], true);
  if (launchState.status !== 0) throw new BrowserWorkerError("Browser-Worker ist nicht geladen.", 66);
  const statusPath = join(target.logDir, "status.json");
  let heartbeat = null;
  if (existsSync(statusPath)) {
    try { heartbeat = JSON.parse(readFileSync(statusPath, "utf8")); } catch {}
  }
  if (command === "setup-session") {
    return {
      ok: true,
      action: "setup-session",
      instruction: "Im offenen NEONTRIP-Chrome bei Shopify anmelden. Der laufende Worker prueft EasyDPD automatisch erneut.",
      heartbeat,
    };
  }
  if (!heartbeat || heartbeat.sessionReady !== true || !["ready", "idle"].includes(heartbeat.state)) {
    throw new BrowserWorkerError("EasyDPD-Sitzung ist im laufenden Browser-Worker noch nicht bereit.", 65);
  }
  const updatedAt = Date.parse(String(heartbeat.updatedAt || ""));
  const maximumAge = Math.max(120_000, (Number(heartbeat.intervalSeconds) || 300) * 2_000 + 60_000);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > maximumAge) throw new BrowserWorkerError("Browser-Worker-Heartbeat ist veraltet.", 65);
  return { ok: true, action: "self-test", sessionReady: true, purchaseClicked: false, heartbeat };
}

function status() {
  const target = destinations();
  const result = launchctl(["print", `${launchDomain()}/${LABEL}`], true);
  let heartbeat = null;
  const statusPath = join(target.logDir, "status.json");
  if (existsSync(statusPath)) {
    try { heartbeat = JSON.parse(readFileSync(statusPath, "utf8")); } catch {}
  }
  return { ok: result.status === 0, action: "status", label: LABEL, plistInstalled: existsSync(target.plist), loaded: result.status === 0, currentCommit: existsSync(target.currentFile) ? readFileSync(target.currentFile, "utf8").trim() : null, heartbeat };
}

function rollback() {
  const target = destinations();
  const backupDir = join(target.runtimeRoot, "plist-backups");
  let candidates = [];
  try { candidates = run("/bin/ls", ["-1t", backupDir]).split("\n").filter((name) => name.endsWith(".plist")); } catch {}
  if (!candidates[0]) throw new BrowserWorkerError("Kein Plist-Backup fuer Rollback vorhanden.", 66);
  launchctl(["bootout", launchDomain(), target.plist], true);
  const replaced = backupPlist(target.plist, join(target.runtimeRoot, "rollback-replaced-plists"));
  copyFileSync(join(backupDir, candidates[0]), target.plist);
  chmodSync(target.plist, 0o600);
  launchctl(["bootstrap", launchDomain(), target.plist]);
  launchctl(["kickstart", "-k", `${launchDomain()}/${LABEL}`]);
  const restoredCommit = readFileSync(target.plist, "utf8").match(/versions\/([0-9a-f]{40})\/run_easydpd_browser_worker[.]mjs/)?.[1] || null;
  if (restoredCommit) writeFileSync(target.currentFile, `${restoredCommit}\n`, { mode: 0o600 });
  return { ok: true, action: "rolled_back", backup: candidates[0], replaced };
}

function uninstall() {
  const target = destinations();
  launchctl(["bootout", launchDomain(), target.plist], true);
  const backup = backupPlist(target.plist, join(target.runtimeRoot, "disabled-plists"));
  if (existsSync(target.plist)) renameSync(target.plist, `${target.plist}.disabled-${Date.now()}`);
  return { ok: true, action: "uninstalled", recoverableBackup: backup };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseManagerArgs(argv);
    const result = options.command === "install" ? install(options)
      : options.command === "status" ? status()
        : options.command === "setup-session" || options.command === "self-test" ? runInteractive(options.command)
          : options.command === "rollback" ? rollback() : uninstall();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler." })}\n`);
    process.exitCode = error instanceof BrowserWorkerError ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
