#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BrowserWorkerError,
  DEFAULT_BROWSER_TOKEN_SERVICE,
  DEFAULT_CF_SECRET_SERVICE,
  readKeychainSecret,
} from "./easydpd_browser_worker_lib.mjs";
import {
  EXPECTED_EXTENSION_ID,
  NATIVE_HOST_NAME,
  loadBridgeConfig,
  selfTestBridge,
} from "./easydpd_existing_chrome_bridge_lib.mjs";

const OLD_WORKER_LABEL = "de.neontrip.easydpd-browser-worker";
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseExistingChromeManagerArgs(argv) {
  const command = argv[0];
  if (!["install", "status", "self-test", "rollback", "uninstall"].includes(command)) {
    throw new BrowserWorkerError("Nutzung: manage_easydpd_existing_chrome_bridge.mjs <install|status|self-test|rollback|uninstall> [--mode dry_run|live] [--acknowledge-production-write]", 64);
  }
  const options = { command, mode: "dry_run", acknowledgeProductionWrite: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--acknowledge-production-write") options.acknowledgeProductionWrite = true;
    else if (arg === "--mode") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new BrowserWorkerError("Wert fuer --mode fehlt.", 64);
      options.mode = value;
      index += 1;
    } else throw new BrowserWorkerError(`Unbekanntes Argument: ${arg}`, 64);
  }
  if (!["dry_run", "live"].includes(options.mode)) throw new BrowserWorkerError("Modus muss dry_run oder live sein.", 64);
  if (options.mode === "live" && !options.acknowledgeProductionWrite) throw new BrowserWorkerError("Live-Installation braucht --acknowledge-production-write.", 64);
  return options;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || SOURCE_ROOT,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    env: options.env || process.env,
  }).trim();
}

function gitState() {
  if (run("/usr/bin/git", ["status", "--porcelain"])) throw new BrowserWorkerError("Installation nur aus einem sauberen Worktree erlaubt.", 65);
  const head = run("/usr/bin/git", ["rev-parse", "HEAD"]);
  run("/usr/bin/git", ["fetch", "origin", "main", "--quiet"]);
  if (head !== run("/usr/bin/git", ["rev-parse", "origin/main"])) throw new BrowserWorkerError("Installation nur vom exakten origin/main-Commit erlaubt.", 65);
  return head;
}

function launchDomain() {
  return `gui/${userInfo().uid}`;
}

function launchctl(args, allowFailure = false) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 && !allowFailure) throw new BrowserWorkerError(`launchctl fehlgeschlagen: ${String(result.stderr || "").trim().slice(0, 300)}`, 70);
  return result;
}

export function bridgeDestinations(home = homedir()) {
  const applicationRoot = join(home, "Library", "Application Support", "NEONTRIP", "easydpd-existing-chrome-bridge");
  const runtimeRoot = join(applicationRoot, "runtime");
  return {
    home,
    runtimeRoot,
    versionsRoot: join(runtimeRoot, "versions"),
    currentFile: join(runtimeRoot, "CURRENT"),
    activeExtension: join(runtimeRoot, "extension"),
    backupsRoot: join(runtimeRoot, "backups"),
    nativeManifest: join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`),
    oldWorkerPlist: join(home, "Library", "LaunchAgents", `${OLD_WORKER_LABEL}.plist`),
    statusPath: join(home, "Library", "Logs", "NEONTRIP", "easydpd-existing-chrome-bridge", "status.json"),
    activeJobPath: join(applicationRoot, "active-job.json"),
    downloadRoot: join(home, "Downloads"),
  };
}

function backupPath(path, backupRoot, suffix) {
  if (!existsSync(path)) return null;
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const target = join(backupRoot, `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${suffix}`);
  if (statSync(path).isDirectory()) cpSync(path, target, { recursive: true });
  else copyFileSync(path, target);
  return target;
}

function extensionIdFromManifestKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest].flatMap((byte) => [byte >> 4, byte & 15]).map((nibble) => String.fromCharCode(97 + nibble)).join("");
}

function requiredRuntimeEnvironment() {
  const account = String(process.env.NEONTRIP_KEYCHAIN_ACCOUNT || process.env.USER || "").trim();
  if (!account) throw new BrowserWorkerError("Keychain-Account fehlt.", 64);
  const tokenService = String(process.env.NEONTRIP_EASYDPD_TOKEN_KEYCHAIN_SERVICE || DEFAULT_BROWSER_TOKEN_SERVICE);
  readKeychainSecret(tokenService, account);
  const cfClientId = String(process.env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID || "").trim();
  const cfSecretService = String(process.env.NEONTRIP_ARRIVAL_LABEL_CF_SECRET_KEYCHAIN_SERVICE || DEFAULT_CF_SECRET_SERVICE);
  if (cfClientId) readKeychainSecret(cfSecretService, account);
  return {
    account,
    tokenService,
    cfClientId,
    cfSecretService,
    opsBaseUrl: process.env.NEONTRIP_OPS_BASE_URL || "https://ops.neontrip.de",
    workerId: process.env.ARRIVAL_LABEL_BROWSER_WORKER_ID || "daniels-mac-easydpd-normal-chrome-01",
  };
}

function stageVersion(commit, installId, options, target, runtime) {
  const versionDir = join(target.versionsRoot, installId);
  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  for (const filename of [
    "easydpd_browser_worker_lib.mjs",
    "easydpd_existing_chrome_bridge_lib.mjs",
    "run_easydpd_existing_chrome_host.mjs",
  ]) {
    copyFileSync(join(SOURCE_ROOT, "scripts", filename), join(versionDir, filename));
    chmodSync(join(versionDir, filename), 0o500);
  }
  const extensionSource = join(SOURCE_ROOT, "deploy", "local-easydpd-existing-chrome", "extension");
  const manifest = JSON.parse(readFileSync(join(extensionSource, "manifest.json"), "utf8"));
  if (extensionIdFromManifestKey(manifest.key) !== EXPECTED_EXTENSION_ID) throw new BrowserWorkerError("Manifest-Key erzeugt nicht die fest gepinnte Erweiterungs-ID.", 70);
  const stagedExtension = join(versionDir, "extension");
  cpSync(extensionSource, stagedExtension, { recursive: true, force: true });
  const configPath = join(versionDir, "bridge-config.json");
  const config = {
    version: 1,
    mode: options.mode,
    liveEnabled: options.mode === "live",
    extensionId: EXPECTED_EXTENSION_ID,
    opsBaseUrl: runtime.opsBaseUrl,
    keychainAccount: runtime.account,
    workerId: runtime.workerId,
    tokenService: runtime.tokenService,
    cfClientId: runtime.cfClientId,
    cfSecretService: runtime.cfSecretService,
    downloadRoot: target.downloadRoot,
    statusPath: target.statusPath,
    activeJobPath: target.activeJobPath,
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const runnerPath = join(versionDir, "run_easydpd_existing_chrome_host.mjs");
  const executablePath = join(versionDir, "native-host");
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  writeFileSync(executablePath, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(runnerPath)} --config ${shellQuote(configPath)}\n`, { mode: 0o500 });
  return { versionDir, stagedExtension, configPath, executablePath };
}

function renderNativeManifest(executablePath) {
  const template = JSON.parse(readFileSync(
    join(SOURCE_ROOT, "deploy", "local-easydpd-existing-chrome", "native-host-manifest.json.template"),
    "utf8",
  ));
  template.path = executablePath;
  if (template.name !== NATIVE_HOST_NAME
    || JSON.stringify(template.allowed_origins) !== JSON.stringify([`chrome-extension://${EXPECTED_EXTENSION_ID}/`])) {
    throw new BrowserWorkerError("Native-Host-Manifest ist nicht exakt auf die Erweiterung gepinnt.", 70);
  }
  return `${JSON.stringify(template, null, 2)}\n`;
}

function install(options) {
  const commit = gitState();
  const target = bridgeDestinations();
  const runtime = requiredRuntimeEnvironment();
  const installId = `${commit}-${Date.now()}`;
  const staged = stageVersion(commit, installId, options, target, runtime);
  const backupRoot = join(target.backupsRoot, installId);
  const previousManifest = backupPath(target.nativeManifest, backupRoot, "native-host.json");
  const previousExtension = backupPath(target.activeExtension, backupRoot, "extension");
  const previousCurrent = backupPath(target.currentFile, backupRoot, "CURRENT");
  const oldWorkerLoaded = launchctl(["print", `${launchDomain()}/${OLD_WORKER_LABEL}`], true).status === 0;
  mkdirSync(dirname(target.nativeManifest), { recursive: true, mode: 0o700 });
  mkdirSync(target.runtimeRoot, { recursive: true, mode: 0o700 });
  if (existsSync(target.activeExtension)) renameSync(target.activeExtension, `${target.activeExtension}.replaced-${Date.now()}`);
  cpSync(staged.stagedExtension, target.activeExtension, { recursive: true });
  const temporaryManifest = `${target.nativeManifest}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryManifest, renderNativeManifest(staged.executablePath), { mode: 0o600, flag: "wx" });
  renameSync(temporaryManifest, target.nativeManifest);
  chmodSync(target.nativeManifest, 0o600);
  if (options.mode === "live" && oldWorkerLoaded) launchctl(["bootout", launchDomain(), target.oldWorkerPlist], true);
  const record = {
    version: 1,
    installedAt: new Date().toISOString(),
    commit,
    mode: options.mode,
    extensionId: EXPECTED_EXTENSION_ID,
    nativeManifest: target.nativeManifest,
    activeExtension: target.activeExtension,
    previousManifest,
    previousExtension,
    previousCurrent,
    oldWorkerLoaded,
  };
  writeFileSync(join(staged.versionDir, "install-record.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(target.currentFile, `${JSON.stringify({ version: 1, commit, installId })}\n`, { mode: 0o600 });
  return {
    ok: true,
    action: "installed",
    commit,
    mode: options.mode,
    extensionId: EXPECTED_EXTENSION_ID,
    extensionPath: target.activeExtension,
    nativeManifest: target.nativeManifest,
    oldSeparateWorkerDisabled: options.mode === "live" && oldWorkerLoaded,
    serverGatesChanged: false,
  };
}

function currentVersion() {
  const target = bridgeDestinations();
  if (!existsSync(target.currentFile)) throw new BrowserWorkerError("Existing-Chrome-Bridge ist noch nicht installiert.", 66);
  const current = JSON.parse(readFileSync(target.currentFile, "utf8"));
  const commit = String(current.commit || "");
  const installId = String(current.installId || "");
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new BrowserWorkerError("Installierter Bridge-Commit ist ungueltig.", 65);
  if (!new RegExp(`^${commit}-[0-9]{10,16}$`).test(installId)) throw new BrowserWorkerError("Installierte Bridge-Version ist ungueltig.", 65);
  return { target, commit, installId, versionDir: join(target.versionsRoot, installId) };
}

async function selfTest() {
  const current = currentVersion();
  const config = await loadBridgeConfig(join(current.versionDir, "bridge-config.json"));
  return { ...(await selfTestBridge(config)), commit: current.commit, extensionPath: current.target.activeExtension };
}

function status() {
  const target = bridgeDestinations();
  let currentCommit = null;
  let config = null;
  let heartbeat = null;
  if (existsSync(target.currentFile)) {
    const current = JSON.parse(readFileSync(target.currentFile, "utf8"));
    currentCommit = String(current.commit || "");
    const configPath = join(target.versionsRoot, String(current.installId || ""), "bridge-config.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      config = { mode: raw.mode, liveEnabled: raw.liveEnabled, workerId: raw.workerId, extensionId: raw.extensionId };
    }
  }
  if (existsSync(target.statusPath)) {
    try { heartbeat = JSON.parse(readFileSync(target.statusPath, "utf8")); } catch {}
  }
  return {
    ok: existsSync(target.nativeManifest) && existsSync(target.activeExtension),
    action: "status",
    currentCommit,
    extensionId: EXPECTED_EXTENSION_ID,
    extensionPath: target.activeExtension,
    nativeManifestInstalled: existsSync(target.nativeManifest),
    config,
    heartbeat,
    oldSeparateWorkerLoaded: launchctl(["print", `${launchDomain()}/${OLD_WORKER_LABEL}`], true).status === 0,
  };
}

function latestBackupInstallRecord(target) {
  if (!existsSync(target.versionsRoot)) return null;
  const records = readdirSync(target.versionsRoot)
    .map((version) => join(target.versionsRoot, version, "install-record.json"))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, record: JSON.parse(readFileSync(path, "utf8")) }))
    .sort((a, b) => Date.parse(b.record.installedAt) - Date.parse(a.record.installedAt));
  return records[0] || null;
}

function rollback() {
  const target = bridgeDestinations();
  const candidate = latestBackupInstallRecord(target);
  if (!candidate) throw new BrowserWorkerError("Kein Bridge-Installationsdatensatz fuer Rollback vorhanden.", 66);
  const { record } = candidate;
  if (record.previousManifest && existsSync(record.previousManifest)) {
    copyFileSync(record.previousManifest, target.nativeManifest);
    chmodSync(target.nativeManifest, 0o600);
  } else if (existsSync(target.nativeManifest)) {
    renameSync(target.nativeManifest, `${target.nativeManifest}.rolled-back-${Date.now()}`);
  }
  if (record.previousExtension && existsSync(record.previousExtension)) {
    if (existsSync(target.activeExtension)) renameSync(target.activeExtension, `${target.activeExtension}.rolled-back-${Date.now()}`);
    cpSync(record.previousExtension, target.activeExtension, { recursive: true });
  }
  if (record.previousCurrent && existsSync(record.previousCurrent)) copyFileSync(record.previousCurrent, target.currentFile);
  if (record.oldWorkerLoaded && existsSync(target.oldWorkerPlist)) launchctl(["bootstrap", launchDomain(), target.oldWorkerPlist], true);
  return { ok: true, action: "rolled_back", installRecord: candidate.path, oldSeparateWorkerRestored: Boolean(record.oldWorkerLoaded) };
}

function uninstall() {
  const target = destinations();
  const backup = backupPath(target.nativeManifest, join(target.backupsRoot, `uninstall-${Date.now()}`), "native-host.json");
  if (existsSync(target.nativeManifest)) renameSync(target.nativeManifest, `${target.nativeManifest}.disabled-${Date.now()}`);
  return {
    ok: true,
    action: "uninstalled",
    recoverableNativeManifestBackup: backup,
    extensionRemovalRequiredInChrome: existsSync(target.activeExtension),
    serverGatesChanged: false,
  };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseExistingChromeManagerArgs(argv);
    const result = options.command === "install" ? install(options)
      : options.command === "status" ? status()
        : options.command === "self-test" ? await selfTest()
          : options.command === "rollback" ? rollback()
            : uninstall();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler." })}\n`);
    process.exitCode = error instanceof BrowserWorkerError ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
