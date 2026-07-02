import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("ops app switcher exposes the complete internal software menu", () => {
  const source = readFileSync("src/app/ops/ops-app-switcher.tsx", "utf8");
  const expectedLabels = [
    "Kundenakte",
    "Schildgrößen & Preise",
    "Anrufe",
    "Aufgaben",
    "Company Brain",
    "Angebote",
    "Sales-Vergabe",
    "Versand",
    "Wareneingang",
    "Management"
  ];
  const expectedHrefs = [
    "/ops/customer-records",
    "/ops/customer-records/price-review",
    "/ops/customer-records/calls",
    "/ops/tasks",
    "/ops/company-brain",
    "https://angebote.neontrip.de/admin/offers",
    "/ops/sales-vergabe",
    "/ops/customer-records/shipping",
    "/ops/customer-records/inbound-shipping",
    "/ops/management"
  ];

  for (const label of expectedLabels) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const href of expectedHrefs) {
    assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(source, /minmax\(11\.75rem,1fr\)/);
  assert.match(source, /whitespace-normal break-words/);
});
