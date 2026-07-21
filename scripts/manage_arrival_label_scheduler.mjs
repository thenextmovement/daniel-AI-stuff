#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_CF_SECRET_SERVICE, DEFAULT_TOKEN_SERVICE, readKeychainSecret, resolveConfig, SchedulerError } from "./arrival_label_scheduler_lib.mjs";

const LABEL = "de.neontrip.arrival-label-scheduler";
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return "Nutzung: manage_arrival_label_scheduler.mjs <install|status|rollback|uninstall> [--mode dry_run|execute] [--interval-seconds 300] [--acknowledge-production-write]";
}

export function parseManagerArgs(argv) {
  const command = argv[0];
  if (!["install", "status", "rollback", "uninstall"].includes(command)) throw new SchedulerError(usage(), 64);
  const options = { command, mode: "dry_run", intervalSeconds: 300, acknowledgeProductionWrite: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--acknowledge-production-write") {
      options.acknowledgeProductionWrite = true;
      continue;
    }
    if (!["--mode", "--interval-seconds"].includes(arg)) throw new SchedulerError(`Unbekanntes Argument: ${arg}`, 64);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new SchedulerError(`Wert fuer ${arg} fehlt.`, 64);
    index += 1;
    if (arg === "--mode") options.mode = value;
    if (arg === "--interval-seconds") options.intervalSeconds = Number(value);
  }
  if (!["dry_run", "execute"].includes(options.mode)) throw new SchedulerError("Modus muss dry_run oder execute sein.", 64);
  if (!Number.isSafeInteger(options.intervalSeconds) || options.intervalSeconds < 60 || options.intervalSeconds > 86_400) {
    throw new SchedulerError("Intervall muss zwischen 60 und 86400 Sekunden liegen.", 64);
  }
  if (options.mode === "execute" && !options.acknowledgeProductionWrite) {
    throw new SchedulerError("Execute-Installation braucht --acknowledge-production-write.", 64);
  }
  return options;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: SOURCE_ROOT, encoding: "utf8", stdio: options.stdio || ["ignore", "pipe", "pipe"] }).trim();
}

function gitState() {
  const status = run("/usr/bin/git", ["status", "--porcelain"]);
  if (status) throw new SchedulerError("Installation nur aus einem sauberen Worktree erlaubt.", 65);
  const head = run("/usr/bin/git", ["rev-parse", "HEAD"]);
  run("/usr/bin/git", ["fetch", "origin", "main", "--quiet"]);
  const remote = run("/usr/bin/git", ["rev-parse", "origin/main"]);
  if (head !== remote) throw new SchedulerError("Installation nur vom exakten origin/main-Commit erlaubt.", 65);
  return head;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paths() {
  const home = homedir();
  return {
    home,
    runtimeRoot: join(home, "NEONTRIP", "runtime", "arrival-label-scheduler"),
    plist: join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    logDir: join(home, "Library", "Logs", "NEONTRIP", "arrival-label-scheduler"),
  };
}

function launchDomain() {
  return `gui/${userInfo().uid}`;
}

function launchctl(args, allowFailure = false) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 && !allowFailure) throw new SchedulerError(`launchctl fehlgeschlagen: ${String(result.stderr || "").trim().slice(0, 300)}`, 70);
  return result;
}

function backupPlist(target, backupDir) {
  if (!existsSync(target)) return null;
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backup = join(backupDir, `${stamp}.plist`);
  copyFileSync(target, backup);
  chmodSync(backup, 0o600);
  return backup;
}

export function renderPlist(template, values) {
  const replacements = {
    "{{NODE_PATH}}": xml(process.execPath),
    "{{RUNNER_PATH}}": xml(values.runnerPath),
    "{{MODE}}": xml(values.mode),
    "{{EXECUTE_ACK_ARGUMENT}}": values.mode === "execute" ? "    <string>--acknowledge-production-write</string>" : "",
    "{{HOME}}": xml(values.home),
    "{{OPS_BASE_URL}}": xml(values.opsBaseUrl),
    "{{KEYCHAIN_ACCOUNT}}": xml(values.keychainAccount),
    "{{LIVE_ENABLED}}": values.mode === "execute" ? "true" : "false",
    "{{CF_CLIENT_ID_ENV}}": values.cfClientId
      ? `    <key>ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID</key>\n    <string>${xml(values.cfClientId)}</string>`
      : "",
    "{{INTERVAL_SECONDS}}": String(values.intervalSeconds),
    "{{STDOUT_PATH}}": xml(join(values.logDir, "scheduler.log")),
    "{{STDERR_PATH}}": xml(join(values.logDir, "scheduler.error.log")),
  };
  let output = template;
  for (const [needle, replacement] of Object.entries(replacements)) output = output.replaceAll(needle, replacement);
  if (/\{\{[^}]+\}\}/.test(output)) throw new SchedulerError("Plist-Template enthaelt unbekannte Platzhalter.", 70);
  return output;
}

function install(options) {
  const commit = gitState();
  const destination = paths();
  const account = process.env.NEONTRIP_KEYCHAIN_ACCOUNT || process.env.USER;
  if (!account) throw new SchedulerError("Keychain-Account fehlt.", 64);
  readKeychainSecret(process.env.NEONTRIP_ARRIVAL_LABEL_TOKEN_KEYCHAIN_SERVICE || DEFAULT_TOKEN_SERVICE, account);
  const cfClientId = String(process.env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID || "").trim();
  if (cfClientId) readKeychainSecret(process.env.NEONTRIP_ARRIVAL_LABEL_CF_SECRET_KEYCHAIN_SERVICE || DEFAULT_CF_SECRET_SERVICE, account);
  resolveConfig(options.mode === "execute"
    ? ["--mode", "execute", "--acknowledge-production-write"]
    : ["--mode", "dry_run"], {
      ...process.env,
      ARRIVAL_LABEL_SCHEDULER_LIVE_ENABLED: options.mode === "execute" ? "true" : "false",
    });

  const versionDir = join(destination.runtimeRoot, "versions", commit);
  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  for (const filename of ["arrival_label_scheduler_lib.mjs", "run_arrival_label_scheduler.mjs"]) {
    copyFileSync(join(SOURCE_ROOT, "scripts", filename), join(versionDir, filename));
    chmodSync(join(versionDir, filename), 0o500);
  }
  mkdirSync(dirname(destination.plist), { recursive: true, mode: 0o700 });
  mkdirSync(destination.logDir, { recursive: true, mode: 0o700 });
  const backupDir = join(destination.runtimeRoot, "plist-backups");
  const backup = backupPlist(destination.plist, backupDir);
  const template = readFileSync(join(SOURCE_ROOT, "deploy", "local-arrival-label-scheduler", `${LABEL}.plist.template`), "utf8");
  const rendered = renderPlist(template, {
    runnerPath: join(versionDir, "run_arrival_label_scheduler.mjs"),
    mode: options.mode,
    home: destination.home,
    opsBaseUrl: process.env.NEONTRIP_OPS_BASE_URL || "https://ops.neontrip.de",
    keychainAccount: account,
    cfClientId,
    intervalSeconds: options.intervalSeconds,
    logDir: destination.logDir,
  });
  const temporaryPlist = `${destination.plist}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPlist, rendered, { mode: 0o600, flag: "wx" });
  launchctl(["bootout", launchDomain(), destination.plist], true);
  renameSync(temporaryPlist, destination.plist);
  chmodSync(destination.plist, 0o600);
  try {
    launchctl(["bootstrap", launchDomain(), destination.plist]);
    launchctl(["kickstart", "-k", `${launchDomain()}/${LABEL}`]);
  } catch (error) {
    launchctl(["bootout", launchDomain(), destination.plist], true);
    if (backup) {
      copyFileSync(backup, destination.plist);
      launchctl(["bootstrap", launchDomain(), destination.plist], true);
    } else if (existsSync(destination.plist)) {
      renameSync(destination.plist, `${destination.plist}.failed-${Date.now()}`);
    }
    throw error;
  }
  return { ok: true, action: "installed", label: LABEL, commit, mode: options.mode, intervalSeconds: options.intervalSeconds, backup };
}

function status() {
  const destination = paths();
  const result = launchctl(["print", `${launchDomain()}/${LABEL}`], true);
  return {
    ok: result.status === 0,
    action: "status",
    label: LABEL,
    plistInstalled: existsSync(destination.plist),
    loaded: result.status === 0,
    detail: result.status === 0 ? String(result.stdout).split("\n").slice(0, 20).join("\n") : "not_loaded",
  };
}

function rollback() {
  const destination = paths();
  const backupDir = join(destination.runtimeRoot, "plist-backups");
  let candidates = [];
  try {
    candidates = run("/bin/ls", ["-1t", backupDir]).split("\n").filter((name) => name.endsWith(".plist"));
  } catch {
    throw new SchedulerError("Kein Plist-Backup fuer Rollback vorhanden.", 66);
  }
  if (!candidates[0]) throw new SchedulerError("Kein Plist-Backup fuer Rollback vorhanden.", 66);
  launchctl(["bootout", launchDomain(), destination.plist], true);
  const replaced = backupPlist(destination.plist, join(destination.runtimeRoot, "rollback-replaced-plists"));
  copyFileSync(join(backupDir, candidates[0]), destination.plist);
  chmodSync(destination.plist, 0o600);
  launchctl(["bootstrap", launchDomain(), destination.plist]);
  launchctl(["kickstart", "-k", `${launchDomain()}/${LABEL}`]);
  return { ok: true, action: "rolled_back", label: LABEL, backup: candidates[0], replaced };
}

function uninstall() {
  const destination = paths();
  launchctl(["bootout", launchDomain(), destination.plist], true);
  const backup = backupPlist(destination.plist, join(destination.runtimeRoot, "disabled-plists"));
  if (existsSync(destination.plist)) renameSync(destination.plist, `${destination.plist}.disabled-${Date.now()}`);
  return { ok: true, action: "uninstalled", label: LABEL, recoverableBackup: backup };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseManagerArgs(argv);
    const result = options.command === "install"
      ? install(options)
      : options.command === "status"
        ? status()
        : options.command === "rollback"
          ? rollback()
          : uninstall();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const exitCode = error instanceof SchedulerError ? error.exitCode : 1;
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler.", exitCode })}\n`);
    process.exitCode = exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
