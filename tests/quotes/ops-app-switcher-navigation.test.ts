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
    "Design",
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
    "/ops/design",
    "/ops/offers",
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

test("secondary ops entry points expose Company Brain", () => {
  const managementSource = readFileSync("src/app/ops/management/page-client.tsx", "utf8");
  const loginSource = readFileSync("src/app/ops/ops-login-card.tsx", "utf8");
  const offersSource = readFileSync("src/app/ops/offers/page.tsx", "utf8");
  const designSource = readFileSync("src/app/ops/design/page-client.tsx", "utf8");

  assert.match(managementSource, /\/ops\/company-brain/);
  assert.match(managementSource, /Fälle & Belege prüfen/);
  assert.match(loginSource, /Company Brain/);
  assert.match(offersSource, /OpsPageHeader active="offers"/);
  assert.match(offersSource, /\/ops\/company-brain/);
  assert.match(designSource, /OpsPageHeader active="design"/);
  assert.match(designSource, /\/ops\/company-brain/);
});

test("company brain fix center groups risky actions and avoids browser prompts", () => {
  const source = readFileSync("src/app/ops/company-brain/page-client.tsx", "utf8");

  assert.match(source, /Intern sichern/);
  assert.match(source, /Daten korrigieren/);
  assert.match(source, /Kundenkontakt/);
  assert.match(source, /Freigabe prüfen/);
  assert.match(source, /Diese Aktion kann Kundenkontakt auslösen/);
  assert.match(source, /serverseitigem Duplicate-, Bounce- und Empfängercheck/);
  assert.doesNotMatch(source, /window\.prompt/);
});
