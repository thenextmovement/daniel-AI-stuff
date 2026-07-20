import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCupsPrinter, assertPrintPdf, readBoundedResponseBytes, validateApprovedArrivalPrinterMapping, validatePrintWorkerId } from "../src/lib/ops/arrival-labels/printing";

type ClaimedJob = {
  id: string;
  documentKind: "label" | "delivery_note";
  printerKey: string;
  sha256: string;
  attempts: number;
  maxAttempts: number;
  documentPath: string;
};

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} ist nicht konfiguriert.`);
  return value;
}

function config() {
  const apiUrl = required("ARRIVAL_LABEL_PRINT_API_URL").replace(/\/$/, "");
  if (!/^https:\/\//.test(apiUrl)) throw new Error("ARRIVAL_LABEL_PRINT_API_URL muss HTTPS verwenden.");
  const token = required("ARRIVAL_LABEL_PRINT_API_TOKEN");
  if (token.length < 32) throw new Error("ARRIVAL_LABEL_PRINT_API_TOKEN ist zu kurz.");
  const pollSeconds = Number(process.env.ARRIVAL_LABEL_PRINT_POLL_SECONDS || 15);
  const confirmationSeconds = Number(process.env.ARRIVAL_LABEL_PRINT_CONFIRM_SECONDS || 120);
  const cloudflareClientId = String(process.env.ARRIVAL_LABEL_PRINT_CF_ACCESS_CLIENT_ID || "").trim();
  const cloudflareClientSecret = String(process.env.ARRIVAL_LABEL_PRINT_CF_ACCESS_CLIENT_SECRET || "").trim();
  if (Boolean(cloudflareClientId) !== Boolean(cloudflareClientSecret)) throw new Error("Cloudflare Access Service Token ist unvollstaendig.");
  if (!Number.isInteger(pollSeconds) || pollSeconds < 5 || pollSeconds > 300) throw new Error("Ungueltiges Druck-Pollintervall.");
  if (!Number.isInteger(confirmationSeconds) || confirmationSeconds < 30 || confirmationSeconds > 600) throw new Error("Ungueltiges Druck-Bestaetigungszeitfenster.");
  const printer = validateApprovedArrivalPrinterMapping({
    printerKey: required("ARRIVAL_LABEL_PRINTER_KEY"),
    cupsPrinter: required("ARRIVAL_LABEL_CUPS_PRINTER"),
    media: required("ARRIVAL_LABEL_PRINT_MEDIA"),
  });
  return {
    apiUrl,
    token,
    workerId: validatePrintWorkerId(required("ARRIVAL_LABEL_PRINT_WORKER_ID")),
    ...printer,
    pollSeconds,
    confirmationSeconds,
    cloudflareClientId,
    cloudflareClientSecret,
  };
}

async function apiRequest(configuration: ReturnType<typeof config>, endpoint: string, init: RequestInit = {}) {
  let response: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`${configuration.apiUrl}${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${configuration.token}`,
          "Content-Type": "application/json",
          "X-Neontrip-Print-Worker": configuration.workerId,
          ...(configuration.cloudflareClientId ? {
            "CF-Access-Client-Id": configuration.cloudflareClientId,
            "CF-Access-Client-Secret": configuration.cloudflareClientSecret,
          } : {}),
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok || response.status === 204 || ![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error("Ops Print API nicht erreichbar.");
  if (!response.ok && response.status !== 204) {
    const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(payload.message || payload.error || `Ops Print API HTTP ${response.status}`);
  }
  return response;
}

async function updateResult(configuration: ReturnType<typeof config>, job: ClaimedJob, result: string, cupsJobId?: string, error?: unknown) {
  await apiRequest(configuration, `/api/internal/arrival-labels/print-jobs/${job.id}/result`, {
    method: "POST",
    body: JSON.stringify({
      workerId: configuration.workerId,
      result,
      cupsJobId: cupsJobId || null,
      error: error instanceof Error ? error.message.slice(0, 500) : error ? String(error).slice(0, 500) : null,
    }),
  });
}

async function claim(configuration: ReturnType<typeof config>) {
  const response = await apiRequest(configuration, "/api/internal/arrival-labels/print-jobs/claim", {
    method: "POST",
    body: JSON.stringify({ workerId: configuration.workerId, printerKey: configuration.printerKey }),
  });
  if (response.status === 204) return null;
  const payload = await response.json() as { job?: ClaimedJob };
  if (!payload.job
    || payload.job.printerKey !== configuration.printerKey
    || !["label", "delivery_note"].includes(payload.job.documentKind)) {
    throw new Error("Ops Print API lieferte einen ungueltigen Druckauftrag.");
  }
  return payload.job;
}

async function waitForCompletion(printer: ReturnType<typeof createCupsPrinter>, cupsJobId: string, seconds: number) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await printer.isCompleted(cupsJobId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

async function processOne(configuration: ReturnType<typeof config>, printer: ReturnType<typeof createCupsPrinter>) {
  const job = await claim(configuration);
  if (!job) return false;
  let dispatchStarted = false;
  let cupsJobId: string | undefined;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "neontrip-label-print-"));
  try {
    const response = await apiRequest(configuration, job.documentPath, { method: "GET", headers: { Accept: "application/pdf" } });
    const bytes = await readBoundedResponseBytes(response, 10 * 1024 * 1024);
    assertPrintPdf(bytes, job.sha256);
    const pdfPath = path.join(temporaryDirectory, `${job.id}.pdf`);
    await writeFile(pdfPath, bytes, { mode: 0o600 });

    await updateResult(configuration, job, "dispatching");
    dispatchStarted = true;
    cupsJobId = await printer.submit(pdfPath);
    await updateResult(configuration, job, "submitted", cupsJobId);

    if (await waitForCompletion(printer, cupsJobId, configuration.confirmationSeconds)) {
      await updateResult(configuration, job, "printed", cupsJobId);
      process.stdout.write(`printed kind=${job.documentKind} job=${job.id} cups=${cupsJobId}\n`);
    } else {
      await updateResult(configuration, job, "uncertain", cupsJobId, "CUPS completion could not be proven; manual check required and no automatic reprint is allowed.");
      process.stderr.write(`manual_review job=${job.id} cups=${cupsJobId}\n`);
    }
  } catch (error) {
    await updateResult(configuration, job, dispatchStarted ? "uncertain" : "retryable_error", cupsJobId, error).catch(() => undefined);
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return true;
}

async function main() {
  const configuration = config();
  const printer = createCupsPrinter({ cupsPrinter: configuration.cupsPrinter, media: configuration.media });
  await printer.selfTest();
  if (process.argv.includes("--self-test")) {
    process.stdout.write("CUPS printer self-test passed (no page printed).\n");
    return;
  }
  const once = process.argv.includes("--once");
  do {
    await processOne(configuration, printer).catch((error) => {
      process.stderr.write(`print worker error: ${error instanceof Error ? error.message : "unknown"}\n`);
    });
    if (!once) await new Promise((resolve) => setTimeout(resolve, configuration.pollSeconds * 1000));
  } while (!once);
}

main().catch((error) => {
  process.stderr.write(`print worker failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
