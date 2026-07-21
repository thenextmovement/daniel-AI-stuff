#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolveConfig, runScheduler, SchedulerError } from "./arrival_label_scheduler_lib.mjs";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
