#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveConfig, runScheduler, SchedulerError } from "./arrival_label_scheduler_lib.mjs";

export function isDirectInvocation(moduleUrl, argvPath, resolveRealpath = (value) => realpathSync(value)) {
  if (!argvPath) return false;
  try {
    return resolveRealpath(fileURLToPath(moduleUrl)) === resolveRealpath(argvPath);
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const result = await runScheduler(resolveConfig(argv, env));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const exitCode = error instanceof SchedulerError ? error.exitCode : 1;
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unbekannter Scheduler-Fehler.", exitCode })}\n`);
    return exitCode;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
