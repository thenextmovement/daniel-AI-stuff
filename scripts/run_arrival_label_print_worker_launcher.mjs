#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

const TOKEN_SERVICE = "NEONTRIP_ARRIVAL_LABEL_PRINT_API_TOKEN";
const CF_SECRET_SERVICE = "NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET";
const CONFIG = {
  label: {
    workerId: "daniels-mac-arrival-label-a6-01",
    printerKey: "shipping-a6",
    cupsPrinter: "Brother_QL_1110NWB",
    media: "4x6",
  },
  delivery_note: {
    workerId: "daniels-mac-arrival-delivery-note-a4-01",
    printerKey: "shipping-a4-delivery-note",
    cupsPrinter: "HP_Color_LaserJet_Pro_MFP_3302",
    media: "A4",
  },
};

function fail(message, code = 64) {
  process.stderr.write(`print worker launcher failed: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { kind: "", selfTest: false, once: false, acknowledgeProductionWrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--once") options.once = true;
    else if (arg === "--acknowledge-production-write") options.acknowledgeProductionWrite = true;
    else if (arg === "--kind") {
      options.kind = argv[index + 1] || "";
      index += 1;
    } else fail(`Unbekanntes Argument: ${arg}`);
  }
  if (!Object.hasOwn(CONFIG, options.kind)) fail("--kind muss label oder delivery_note sein.");
  if (!options.selfTest && !options.acknowledgeProductionWrite) fail("Live-Druck braucht --acknowledge-production-write.");
  return options;
}

function keychainSecret(service, account) {
  try {
    const value = execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (value.length < 32) throw new Error("secret too short");
    return value;
  } catch {
    fail(`Keychain-Geheimnis fehlt: ${service}`, 78);
  }
}

const options = parseArgs(process.argv.slice(2));
const account = String(process.env.NEONTRIP_KEYCHAIN_ACCOUNT || process.env.USER || "").trim();
if (!account) fail("Keychain-Account fehlt.", 78);
const apiUrl = new URL(String(process.env.NEONTRIP_OPS_BASE_URL || "https://ops.neontrip.de"));
if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) fail("Ops-Basis-URL ist ungueltig.", 78);
const selected = CONFIG[options.kind];
process.env.ARRIVAL_LABEL_PRINT_API_URL = apiUrl.toString().replace(/\/$/, "");
process.env.ARRIVAL_LABEL_PRINT_API_TOKEN = keychainSecret(TOKEN_SERVICE, account);
process.env.ARRIVAL_LABEL_PRINT_WORKER_ID = selected.workerId;
process.env.ARRIVAL_LABEL_PRINTER_KEY = selected.printerKey;
process.env.ARRIVAL_LABEL_CUPS_PRINTER = selected.cupsPrinter;
process.env.ARRIVAL_LABEL_PRINT_MEDIA = selected.media;
process.env.ARRIVAL_LABEL_PRINT_POLL_SECONDS = "15";
process.env.ARRIVAL_LABEL_PRINT_CONFIRM_SECONDS = "120";
const cfClientId = String(process.env.ARRIVAL_LABEL_PRINT_CF_ACCESS_CLIENT_ID || "").trim();
if (cfClientId) process.env.ARRIVAL_LABEL_PRINT_CF_ACCESS_CLIENT_SECRET = keychainSecret(CF_SECRET_SERVICE, account);
if (!options.selfTest && String(process.env.ARRIVAL_LABEL_PRINT_LIVE_ENABLED || "").toLowerCase() !== "true") {
  fail("Live-Druck ist lokal nicht freigegeben.", 77);
}
const forwarded = [];
if (options.selfTest) forwarded.push("--self-test");
if (options.once) forwarded.push("--once");
if (options.acknowledgeProductionWrite) forwarded.push("--acknowledge-production-write");
process.argv = [process.argv[0], resolve(new URL("./run_arrival_label_print_worker.ts", import.meta.url).pathname), ...forwarded];
await import("./run_arrival_label_print_worker.ts");
