import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("arrival-label product config requires separate logical A4 and A6 printers", async () => {
  const sql = await readFile("supabase/migrations/20260720172500_enforce_separate_arrival_label_printers.sql", "utf8");
  assert.match(sql, /delivery_note_printer_key\s*<>\s*printer_key/i);
  assert.match(sql, /unsafe arrival-label config: A4 delivery-note and A6 label printers must be separate/i);
});

test("local worker examples pin the approved physical queues and media", async () => {
  const [label, deliveryNote] = await Promise.all([
    readFile("deploy/local-print-worker/arrival-label-print.env.example", "utf8"),
    readFile("deploy/local-print-worker/arrival-delivery-note-print.env.example", "utf8"),
  ]);
  assert.match(label, /ARRIVAL_LABEL_PRINTER_KEY=shipping-a6/);
  assert.match(label, /ARRIVAL_LABEL_CUPS_PRINTER=Brother_QL_1110NWB/);
  assert.match(label, /ARRIVAL_LABEL_PRINT_MEDIA=4x6/);
  assert.match(deliveryNote, /ARRIVAL_LABEL_PRINTER_KEY=shipping-a4-delivery-note/);
  assert.match(deliveryNote, /ARRIVAL_LABEL_CUPS_PRINTER=HP_Color_LaserJet_Pro_MFP_3302/);
  assert.match(deliveryNote, /ARRIVAL_LABEL_PRINT_MEDIA=A4/);
});

test("printer-separation rollback removes only the new constraint", async () => {
  const sql = await readFile("supabase/rollbacks/20260720172500_enforce_separate_arrival_label_printers_rollback.sql", "utf8");
  assert.match(sql, /drop constraint if exists arrival_label_product_config_separate_printers_check/i);
  assert.doesNotMatch(sql, /drop table/i);
});
