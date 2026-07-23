#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  BrowserWorkerError,
  acquireWorkerLock,
  claimJob,
  ensurePrivateProfileDirectory,
  parseWorkerArgs,
  resolveWorkerConfig,
  updateJob,
  uploadArtifact,
} from "./easydpd_browser_worker_lib.mjs";

const EASYDPD_DASHBOARD = "https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services";
const SESSION_RECHECK_MILLISECONDS = 15_000;

async function writeWorkerStatus(configuration, status) {
  await mkdir(dirname(configuration.statusPath), { recursive: true, mode: 0o700 });
  const temporary = `${configuration.statusPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    version: 1,
    workerId: configuration.workerId,
    mode: configuration.mode,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...status,
  };
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, configuration.statusPath);
}

function stopController() {
  let stopped = false;
  let resolveStop;
  const stoppedPromise = new Promise((resolvePromise) => { resolveStop = resolvePromise; });
  const stop = () => {
    stopped = true;
    resolveStop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return {
    isStopped: () => stopped,
    wait: (milliseconds) => new Promise((resolvePromise) => {
      if (stopped) return resolvePromise();
      const timer = setTimeout(resolvePromise, milliseconds);
      stoppedPromise.then(() => {
        clearTimeout(timer);
        resolvePromise();
      });
    }),
  };
}

async function launchContext(configuration) {
  ensurePrivateProfileDirectory(configuration.profileDirectory);
  const { chromium } = await import("playwright-core");
  return chromium.launchPersistentContext(configuration.profileDirectory, {
    channel: "chrome",
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: ["--disable-sync", "--use-mock-keychain", "--password-store=basic"],
    args: ["--disable-background-networking", "--restore-last-session"],
  });
}

async function easyDpdFrame(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((entry) => {
      try { return new URL(entry.url()).hostname === "easydpd.247apps.de"; } catch { return false; }
    });
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new BrowserWorkerError("EasyDPD-App-Frame wurde nicht geladen; Shopify-Anmeldung pruefen.", 65);
}

async function assertShopifyOrderPage(page, job) {
  const current = new URL(page.url());
  if (current.origin !== "https://admin.shopify.com" || current.pathname !== new URL(job.orderUrl).pathname) {
    throw new BrowserWorkerError("Shopify hat auf eine nicht freigegebene Seite umgeleitet; Anmeldung pruefen.", 65);
  }
  const frame = await easyDpdFrame(page);
  if (await frame.getByText(job.orderName, { exact: true }).count() < 1) throw new BrowserWorkerError("EasyDPD-Bestellname stimmt nicht mit dem reservierten Auftrag ueberein.", 65);
  const product = frame.getByRole("combobox", { name: "Product", exact: true });
  const format = frame.getByRole("combobox", { name: "Format", exact: true });
  const weight = frame.getByRole("spinbutton", { name: /^Total (?:package weight|weight of the shipment)(?:\s+(?:g|gr))?$/i });
  const createButton = frame.getByRole("button", { name: "Create label", exact: true });
  for (const [name, locator] of [["Produkt", product], ["Format", format], ["Gesamtgewicht", weight], ["Kaufbutton", createButton]]) {
    if (await locator.count() !== 1) throw new BrowserWorkerError(`EasyDPD-${name} ist nicht eindeutig auffindbar.`, 65);
  }
  await product.selectOption({ label: job.productLabel });
  await format.selectOption({ label: job.labelFormat });
  await weight.fill(String(job.packageWeightGrams));
  if ((await product.locator("option:checked").textContent())?.trim() !== job.productLabel) throw new BrowserWorkerError("EasyDPD-Produkt konnte nicht deterministisch gesetzt werden.", 65);
  if ((await format.locator("option:checked").textContent())?.trim() !== job.labelFormat) throw new BrowserWorkerError("EasyDPD-Format konnte nicht auf A6 gesetzt werden.", 65);
  if (Number(await weight.inputValue()) !== job.packageWeightGrams) throw new BrowserWorkerError("EasyDPD-Gesamtgewicht stimmt nicht.", 65);
  if (!await createButton.isEnabled()) throw new BrowserWorkerError("EasyDPD-Kaufbutton ist nicht freigegeben.", 65);
  return { frame, createButton };
}

async function setupSession(configuration) {
  const context = await launchContext(configuration);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(EASYDPD_DASHBOARD, { waitUntil: "domcontentloaded", timeout: 45_000 });
    process.stdout.write(`${JSON.stringify({ ok: true, action: "session_setup_open", instruction: "In Chrome bei Shopify anmelden, EasyDPD oeffnen und danach hier Enter druecken." })}\n`);
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    await terminal.question("");
    terminal.close();
    await easyDpdFrame(page);
    process.stdout.write(`${JSON.stringify({ ok: true, action: "session_ready" })}\n`);
  } finally {
    await context.close();
  }
}

async function selfTest(configuration) {
  const context = await launchContext(configuration);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(EASYDPD_DASHBOARD, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await easyDpdFrame(page);
    process.stdout.write(`${JSON.stringify({ ok: true, action: "self_test", sessionReady: true, purchaseClicked: false })}\n`);
  } finally {
    await context.close();
  }
}

async function processLiveJob(configuration, page, job) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "neontrip-easydpd-"));
  let dispatchStarted = false;
  try {
    await page.goto(job.orderUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const { createButton } = await assertShopifyOrderPage(page, job);
    await updateJob(configuration, job, "validated");
    await updateJob(configuration, job, "dispatching");
    dispatchStarted = true;

    const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
    await createButton.click({ timeout: 10_000, noWaitAfter: true });
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    if (!suggested.toLowerCase().endsWith(".pdf")) throw new BrowserWorkerError("EasyDPD-Download ist keine PDF-Datei.", 65, { postDispatch: true });
    const localPath = join(temporaryDirectory, "easydpd-label.pdf");
    await download.saveAs(localPath);
    const pdfBytes = await readFile(localPath);
    const result = await uploadArtifact(configuration, job, pdfBytes);
    process.stdout.write(`${JSON.stringify({ ok: true, action: "label_purchased_and_queued_for_print", jobId: job.id, orderName: job.orderName, dpdTrackingNumber: result.dpdTrackingNumber, incomingDhlLastSix: result.incomingDhlLastSix, printJobId: result.printJobId })}\n`);
  } catch (error) {
    const postDispatch = dispatchStarted || (error instanceof BrowserWorkerError && error.postDispatch);
    await updateJob(configuration, job, postDispatch ? "uncertain" : "retryable_error", error).catch(() => undefined);
    throw new BrowserWorkerError(
      postDispatch
        ? "EasyDPD-Buchung wurde begonnen, aber nicht sicher abgeschlossen; manuelle Pruefung erforderlich und kein automatischer Wiederholungskauf."
        : error instanceof Error ? error.message : "EasyDPD-Vorabpruefung fehlgeschlagen.",
      postDispatch ? 74 : 69,
      { postDispatch },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runOnce(configuration) {
  const job = await claimJob(configuration);
  if (!job) {
    process.stdout.write(`${JSON.stringify({ ok: true, action: "no_job", mode: configuration.mode })}\n`);
    return;
  }
  if (configuration.mode !== "live") throw new BrowserWorkerError("Dry-Run darf keinen Browser-Auftrag reservieren.", 70);
  const context = await launchContext(configuration);
  try {
    const page = context.pages()[0] || await context.newPage();
    await processLiveJob(configuration, page, job);
  } finally {
    await context.close();
  }
}

async function runDaemon(configuration, intervalSeconds) {
  const control = stopController();
  const context = await launchContext(configuration);
  let page = context.pages()[0] || await context.newPage();
  const updateStatus = (status) => writeWorkerStatus(configuration, { intervalSeconds, ...status });
  await updateStatus({ state: "starting", sessionReady: false, purchaseClicked: false });
  try {
    while (!control.isStopped()) {
      try {
        if (page.isClosed()) page = await context.newPage();
        await page.goto(EASYDPD_DASHBOARD, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await easyDpdFrame(page);
      } catch (error) {
        if (context.browser()?.isConnected() === false) throw error;
        await updateStatus({
          state: "authentication_required",
          sessionReady: false,
          purchaseClicked: false,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Shopify-Anmeldung erforderlich.",
        });
        await control.wait(SESSION_RECHECK_MILLISECONDS);
        continue;
      }

      await updateStatus({ state: "ready", sessionReady: true, purchaseClicked: false, lastError: null });
      let job;
      try {
        job = await claimJob(configuration);
      } catch (error) {
        await updateStatus({
          state: "api_retry",
          sessionReady: true,
          purchaseClicked: false,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Ops API ist voruebergehend nicht erreichbar.",
        });
        await control.wait(intervalSeconds * 1000);
        continue;
      }

      if (!job) {
        await updateStatus({ state: "idle", sessionReady: true, purchaseClicked: false, lastError: null });
        await control.wait(intervalSeconds * 1000);
        continue;
      }
      if (configuration.mode !== "live") throw new BrowserWorkerError("Dry-Run darf keinen Browser-Auftrag reservieren.", 70);

      await updateStatus({ state: "processing", sessionReady: true, purchaseClicked: false, jobId: job.id, lastError: null });
      try {
        await processLiveJob(configuration, page, job);
      } catch (error) {
        const postDispatch = Boolean(error?.postDispatch);
        await updateStatus({
          state: postDispatch ? "manual_review" : "job_retry",
          sessionReady: false,
          purchaseClicked: postDispatch,
          jobId: job.id,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Browser-Auftrag fehlgeschlagen.",
        });
        process.stderr.write(`${JSON.stringify({ ok: false, action: "job_failed", jobId: job.id, postDispatch, error: error instanceof Error ? error.message : "Unbekannter Fehler." })}\n`);
        await control.wait(intervalSeconds * 1000);
        continue;
      }
      await updateStatus({ state: "idle", sessionReady: true, purchaseClicked: true, jobId: job.id, lastError: null });
      await control.wait(intervalSeconds * 1000);
    }
  } finally {
    await updateStatus({ state: "stopping", sessionReady: false, purchaseClicked: false }).catch(() => undefined);
    await context.close();
  }
}

async function main() {
  const options = parseWorkerArgs(process.argv.slice(2));
  const configuration = resolveWorkerConfig(options);
  const releaseLock = acquireWorkerLock(configuration.lockPath);
  try {
    if (options.setupSession) return await setupSession(configuration);
    if (options.selfTest) return await selfTest(configuration);
    if (options.daemon) return await runDaemon(configuration, options.intervalSeconds);
    await runOnce(configuration);
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler.", postDispatch: Boolean(error?.postDispatch) })}\n`);
  process.exitCode = error instanceof BrowserWorkerError ? error.exitCode : 1;
});
