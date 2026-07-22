#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_SERVICE = "NEONTRIP_ARRIVAL_LABEL_PRINT_API_TOKEN";
const CF_SECRET_SERVICE = "NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET";
const WORKERS = [
  { kind: "label", label: "de.neontrip.arrival-label-print-a6", logName: "a6" },
  { kind: "delivery_note", label: "de.neontrip.arrival-label-print-a4", logName: "a4" },
];

class ManagerError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

export function parseManagerArgs(argv) {
  const command = argv[0];
  if (!["install", "status", "self-test", "rollback", "uninstall"].includes(command)) {
    throw new ManagerError("Nutzung: manage_arrival_label_print_workers.mjs <install|status|self-test|rollback|uninstall> [--acknowledge-production-write]", 64);
  }
  const acknowledgeProductionWrite = argv.slice(1).includes("--acknowledge-production-write");
  if (argv.slice(1).some((arg) => arg !== "--acknowledge-production-write")) throw new ManagerError("Unbekanntes Argument.", 64);
  if (command === "install" && !acknowledgeProductionWrite) throw new ManagerError("Live-Installation braucht --acknowledge-production-write.", 64);
  return { command, acknowledgeProductionWrite };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: options.cwd || SOURCE_ROOT, encoding: "utf8", stdio: options.stdio || ["ignore", "pipe", "pipe"], env: options.env || process.env }).trim();
}

function gitState() {
  if (run("/usr/bin/git", ["status", "--porcelain"])) throw new ManagerError("Installation nur aus einem sauberen Worktree erlaubt.", 65);
  const head = run("/usr/bin/git", ["rev-parse", "HEAD"]);
  run("/usr/bin/git", ["fetch", "origin", "main", "--quiet"]);
  if (head !== run("/usr/bin/git", ["rev-parse", "origin/main"])) throw new ManagerError("Installation nur vom exakten origin/main-Commit erlaubt.", 65);
  return head;
}

function paths() {
  const home = homedir();
  const runtimeRoot = join(home, "NEONTRIP", "runtime", "arrival-label-print-workers");
  return { home, runtimeRoot, currentFile: join(runtimeRoot, "CURRENT"), logDir: join(home, "Library", "Logs", "NEONTRIP", "arrival-label-print-workers") };
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function launchDomain() { return `gui/${userInfo().uid}`; }

function launchctl(args, allowFailure = false) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 && !allowFailure) throw new ManagerError(`launchctl fehlgeschlagen: ${String(result.stderr || "").trim().slice(0, 300)}`, 70);
  return result;
}

function keychainSecretPresent(service, account) {
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0 || String(result.stdout || "").trim().length < 32) throw new ManagerError(`Keychain-Geheimnis fehlt: ${service}`, 78);
}

function runtimeEnvironment() {
  const account = String(process.env.NEONTRIP_KEYCHAIN_ACCOUNT || process.env.USER || "").trim();
  if (!account) throw new ManagerError("Keychain-Account fehlt.", 78);
  keychainSecretPresent(TOKEN_SERVICE, account);
  const cfClientId = String(process.env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID || "").trim();
  if (cfClientId) keychainSecretPresent(CF_SECRET_SERVICE, account);
  const opsUrl = new URL(process.env.NEONTRIP_OPS_BASE_URL || "https://ops.neontrip.de");
  if (opsUrl.protocol !== "https:" || opsUrl.hostname !== "ops.neontrip.de" || !["", "/"].includes(opsUrl.pathname)
    || opsUrl.username || opsUrl.password || opsUrl.search || opsUrl.hash) {
    throw new ManagerError("Ops-Basis-URL ist nicht freigegeben.", 78);
  }
  return { account, cfClientId, opsBaseUrl: "https://ops.neontrip.de" };
}

function backupPlist(target, backupDir) {
  if (!existsSync(target)) return null;
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = join(backupDir, `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${target.split("/").at(-1)}`);
  copyFileSync(target, backup); chmodSync(backup, 0o600); return backup;
}

function stageVersion(commit) {
  const target = paths();
  const versionDir = join(target.runtimeRoot, "versions", commit);
  mkdirSync(join(versionDir, "scripts"), { recursive: true, mode: 0o700 });
  mkdirSync(join(versionDir, "src", "lib", "ops", "arrival-labels"), { recursive: true, mode: 0o700 });
  for (const filename of ["run_arrival_label_print_worker_launcher.mjs", "run_arrival_label_print_worker.ts"]) {
    const target = join(versionDir, "scripts", filename);
    if (existsSync(target)) chmodSync(target, 0o700);
    copyFileSync(join(SOURCE_ROOT, "scripts", filename), target);
    chmodSync(target, 0o500);
  }
  copyFileSync(join(SOURCE_ROOT, "src", "lib", "ops", "arrival-labels", "printing.ts"), join(versionDir, "src", "lib", "ops", "arrival-labels", "printing.ts"));
  for (const filename of ["package.json", "package-lock.json"]) copyFileSync(join(SOURCE_ROOT, "deploy", "local-print-worker", filename), join(versionDir, filename));
  run("/usr/bin/env", ["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: versionDir });
  return { versionDir, runnerPath: join(versionDir, "scripts", "run_arrival_label_print_worker_launcher.mjs") };
}

function renderPlist(template, values) {
  const replacements = {
    "{{LABEL}}": xml(values.worker.label), "{{NODE_PATH}}": xml(process.execPath), "{{RUNNER_PATH}}": xml(values.runnerPath),
    "{{WORKING_DIRECTORY}}": xml(dirname(dirname(values.runnerPath))),
    "{{KIND}}": xml(values.worker.kind), "{{HOME}}": xml(values.home), "{{OPS_BASE_URL}}": xml(values.opsBaseUrl),
    "{{KEYCHAIN_ACCOUNT}}": xml(values.account), "{{CF_CLIENT_ID_ENV}}": values.cfClientId ? `    <key>ARRIVAL_LABEL_PRINT_CF_ACCESS_CLIENT_ID</key>\n    <string>${xml(values.cfClientId)}</string>` : "",
    "{{STDOUT_PATH}}": xml(join(values.logDir, `${values.worker.logName}.log`)), "{{STDERR_PATH}}": xml(join(values.logDir, `${values.worker.logName}.error.log`)),
  };
  let output = template;
  for (const [needle, value] of Object.entries(replacements)) output = output.replaceAll(needle, value);
  if (/\{\{[^}]+\}\}/.test(output)) throw new ManagerError("Plist-Template enthaelt unbekannte Platzhalter.", 70);
  return output;
}

function install() {
  const commit = gitState(); const target = paths(); const runtime = runtimeEnvironment(); const staged = stageVersion(commit);
  mkdirSync(join(target.home, "Library", "LaunchAgents"), { recursive: true, mode: 0o700 });
  mkdirSync(target.logDir, { recursive: true, mode: 0o700 });
  const template = readFileSync(join(SOURCE_ROOT, "deploy", "local-print-worker", "de.neontrip.arrival-label-print.plist.template"), "utf8");
  const backups = [];
  try {
    for (const worker of WORKERS) {
      const plist = join(target.home, "Library", "LaunchAgents", `${worker.label}.plist`);
      backups.push({ worker, plist, backup: backupPlist(plist, join(target.runtimeRoot, "plist-backups")) });
      launchctl(["bootout", launchDomain(), plist], true);
      const temporary = `${plist}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(temporary, renderPlist(template, { worker, runnerPath: staged.runnerPath, home: target.home, logDir: target.logDir, ...runtime }), { mode: 0o600, flag: "wx" });
      renameSync(temporary, plist); chmodSync(plist, 0o600); launchctl(["bootstrap", launchDomain(), plist]);
    }
    for (const worker of WORKERS) launchctl(["kickstart", "-k", `${launchDomain()}/${worker.label}`]);
    writeFileSync(target.currentFile, `${commit}\n`, { mode: 0o600 });
  } catch (error) {
    for (const item of backups) {
      launchctl(["bootout", launchDomain(), item.plist], true);
      if (item.backup) { copyFileSync(item.backup, item.plist); launchctl(["bootstrap", launchDomain(), item.plist], true); }
      else if (existsSync(item.plist)) renameSync(item.plist, `${item.plist}.failed-${Date.now()}`);
    }
    throw error;
  }
  return { ok: true, action: "installed", commit, workers: WORKERS.map((worker) => worker.label), backups: backups.map((item) => item.backup) };
}

function selfTest() {
  const commit = gitState(); const target = paths(); const runtime = runtimeEnvironment(); const staged = stageVersion(commit);
  for (const worker of WORKERS) {
    const result = spawnSync(process.execPath, ["--import", "tsx", staged.runnerPath, "--kind", worker.kind, "--self-test"], {
      cwd: staged.versionDir, encoding: "utf8", env: { ...process.env, NEONTRIP_KEYCHAIN_ACCOUNT: runtime.account, NEONTRIP_OPS_BASE_URL: runtime.opsBaseUrl, ARRIVAL_LABEL_PRINT_LIVE_ENABLED: "false", ...(runtime.cfClientId ? { ARRIVAL_LABEL_PRINT_CF_ACCESS_CLIENT_ID: runtime.cfClientId } : {}) },
    });
    if (result.status !== 0) throw new ManagerError(`${worker.kind}-Selbsttest fehlgeschlagen: ${String(result.stderr || result.stdout || "").trim().slice(0, 500)}`, result.status || 1);
  }
  return { ok: true, action: "self-test", commit, pagePrinted: false, queues: WORKERS.map((worker) => worker.kind) };
}

function status() {
  const target = paths();
  return { ok: true, action: "status", currentCommit: existsSync(target.currentFile) ? readFileSync(target.currentFile, "utf8").trim() : null, workers: WORKERS.map((worker) => {
    const plist = join(target.home, "Library", "LaunchAgents", `${worker.label}.plist`); const result = launchctl(["print", `${launchDomain()}/${worker.label}`], true);
    return { label: worker.label, plistInstalled: existsSync(plist), loaded: result.status === 0 };
  }) };
}

function uninstall() {
  const target = paths(); const backups = [];
  for (const worker of WORKERS) {
    const plist = join(target.home, "Library", "LaunchAgents", `${worker.label}.plist`); launchctl(["bootout", launchDomain(), plist], true);
    const backup = backupPlist(plist, join(target.runtimeRoot, "disabled-plists")); backups.push(backup);
    if (existsSync(plist)) renameSync(plist, `${plist}.disabled-${Date.now()}`);
  }
  return { ok: true, action: "uninstalled", recoverableBackups: backups };
}

function rollback() {
  const target = paths(); const restored = []; const dir = join(target.runtimeRoot, "plist-backups");
  const resolved = WORKERS.map((worker) => {
    const plist = join(target.home, "Library", "LaunchAgents", `${worker.label}.plist`);
    let candidates = []; try { candidates = run("/bin/ls", ["-1t", dir]).split("\n").filter((name) => name.endsWith(`${worker.label}.plist`)); } catch {}
    if (!candidates[0]) throw new ManagerError(`Kein Plist-Backup fuer ${worker.label}.`, 66);
    return { worker, plist, backup: candidates[0] };
  });
  for (const item of resolved) {
    launchctl(["bootout", launchDomain(), item.plist], true);
    backupPlist(item.plist, join(target.runtimeRoot, "rollback-replaced-plists"));
    copyFileSync(join(dir, item.backup), item.plist); chmodSync(item.plist, 0o600); launchctl(["bootstrap", launchDomain(), item.plist]); restored.push(item.backup);
  }
  for (const worker of WORKERS) launchctl(["kickstart", "-k", `${launchDomain()}/${worker.label}`]);
  const restoredCommit = readFileSync(resolved[0].plist, "utf8").match(/versions\/([0-9a-f]{40})\/scripts\/run_arrival_label_print_worker_launcher[.]mjs/)?.[1] || null;
  if (restoredCommit) writeFileSync(target.currentFile, `${restoredCommit}\n`, { mode: 0o600 });
  return { ok: true, action: "rolled_back", restored };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseManagerArgs(argv);
    const result = options.command === "install" ? install() : options.command === "self-test" ? selfTest() : options.command === "status" ? status() : options.command === "rollback" ? rollback() : uninstall();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler." })}\n`);
    process.exitCode = error instanceof ManagerError ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
