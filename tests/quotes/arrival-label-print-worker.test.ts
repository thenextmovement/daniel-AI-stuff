import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local worker durably marks dispatch before CUPS and never auto-reprints uncertainty", async () => {
  const source = await readFile("scripts/run_arrival_label_print_worker.ts", "utf8");
  const dispatch = source.indexOf('updateResult(configuration, job, "dispatching")');
  const submit = source.indexOf("printer.submit(pdfPath)");
  const uncertain = source.indexOf('updateResult(configuration, job, "uncertain"');
  assert.ok(dispatch >= 0 && submit > dispatch);
  assert.ok(uncertain > submit);
  assert.match(source, /assertPrintPdf\(bytes, job\.sha256\)/);
  assert.match(source, /mkdtemp/);
  assert.match(source, /--self-test/);
  assert.match(source, /ARRIVAL_LABEL_PRINT_LIVE_ENABLED/);
  assert.match(source, /--acknowledge-production-write/);
  assert.doesNotMatch(source, /shell:\s*true|exec\(/);
});

test("macOS print manager separates A6 and A4, uses Keychain, and requires an explicit live acknowledgement", async () => {
  const manager = await readFile("scripts/manage_arrival_label_print_workers.mjs", "utf8");
  const launcher = await readFile("scripts/run_arrival_label_print_worker_launcher.mjs", "utf8");
  const plist = await readFile("deploy/local-print-worker/de.neontrip.arrival-label-print.plist.template", "utf8");
  assert.match(manager, /install[\s\S]+--acknowledge-production-write/);
  assert.match(manager, /de\.neontrip\.arrival-label-print-a6/);
  assert.match(manager, /de\.neontrip\.arrival-label-print-a4/);
  assert.match(launcher, /Brother_QL_1110NWB[\s\S]+media:\s*"4x6"/);
  assert.match(launcher, /HP_Color_LaserJet_Pro_MFP_3302[\s\S]+media:\s*"A4"/);
  assert.match(launcher, /find-generic-password/);
  assert.doesNotMatch(plist, /ARRIVAL_LABEL_PRINT_API_TOKEN/);
  assert.match(plist, /ARRIVAL_LABEL_PRINT_LIVE_ENABLED/);
});

test("systemd worker runs unprivileged and keeps secrets outside the unit", async () => {
  const unit = await readFile("deploy/local-print-worker/neontrip-arrival-label-print.service", "utf8");
  assert.match(unit, /User=neontrip-print/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /EnvironmentFile=\/etc\/neontrip\/arrival-label-print\.env/);
  assert.doesNotMatch(unit, /ARRIVAL_LABEL_PRINT_API_TOKEN=/);

  const deliveryNoteUnit = await readFile("deploy/local-print-worker/neontrip-arrival-delivery-note-print.service", "utf8");
  assert.match(deliveryNoteUnit, /User=neontrip-print/);
  assert.match(deliveryNoteUnit, /NoNewPrivileges=true/);
  assert.match(deliveryNoteUnit, /ProtectSystem=strict/);
  assert.match(deliveryNoteUnit, /EnvironmentFile=\/etc\/neontrip\/arrival-delivery-note-print[.]env/);
  assert.doesNotMatch(deliveryNoteUnit, /ARRIVAL_LABEL_PRINT_API_TOKEN=/);
});
