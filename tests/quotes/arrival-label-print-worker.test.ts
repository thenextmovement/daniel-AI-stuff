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
  assert.doesNotMatch(source, /shell:\s*true|exec\(/);
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
