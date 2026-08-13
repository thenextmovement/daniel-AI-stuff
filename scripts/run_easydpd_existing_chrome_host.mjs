#!/usr/bin/env node
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ExistingChromeBridgeError,
  encodeNativeMessage,
  handleNativeRequest,
  loadBridgeConfig,
  readNativeMessage,
  selfTestBridge,
} from "./easydpd_existing_chrome_bridge_lib.mjs";

function configPathFromArgs(argv) {
  const index = argv.indexOf("--config");
  const value = index >= 0 ? argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new ExistingChromeBridgeError("--config fehlt.", 64);
  const unknown = argv.filter((entry, position) => !["--config", "--self-test"].includes(entry) && position !== index + 1);
  if (unknown.length) throw new ExistingChromeBridgeError(`Unbekanntes Argument: ${unknown[0]}`, 64);
  return value;
}

async function main(argv = process.argv.slice(2)) {
  const config = await loadBridgeConfig(configPathFromArgs(argv));
  if (argv.includes("--self-test")) {
    process.stdout.write(`${JSON.stringify(await selfTestBridge(config), null, 2)}\n`);
    return;
  }
  try {
    const request = await readNativeMessage(process.stdin);
    const response = await handleNativeRequest(config, request);
    writeFileSync(1, encodeNativeMessage(response));
  } catch (error) {
    const payload = {
      ok: false,
      code: error instanceof ExistingChromeBridgeError ? error.nativeCode : null,
      error: String(error instanceof Error ? error.message : "Unbekannter Native-Bridge-Fehler.").slice(0, 500),
      postDispatch: Boolean(error?.postDispatch),
    };
    writeFileSync(1, encodeNativeMessage(payload));
  }
}

export function isExecutedEntryPoint(argvPath = process.argv[1], moduleUrl = import.meta.url) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return moduleUrl === pathToFileURL(argvPath).href;
  }
}

if (isExecutedEntryPoint()) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler." })}\n`);
    process.exitCode = error instanceof ExistingChromeBridgeError ? error.exitCode : 1;
  });
}

export { main };
