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
  const companyBrainSource = readFileSync("src/app/ops/company-brain/page-client.tsx", "utf8");

  assert.match(managementSource, /\/ops\/company-brain/);
  assert.match(managementSource, /Fälle & Belege prüfen/);
  assert.match(loginSource, /Company Brain/);
  assert.match(offersSource, /OpsPageHeader active="offers"/);
  assert.match(offersSource, /\/ops\/company-brain/);
  assert.match(offersSource, /name="query"/);
  assert.match(offersSource, /name="auto" value="1"/);
  assert.match(offersSource, /problemType" value="offer_not_sent"/);
  assert.match(designSource, /OpsPageHeader active="design"/);
  assert.match(designSource, /\/ops\/company-brain/);
  assert.match(companyBrainSource, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(companyBrainSource, /params\.get\("query"\)/);
  assert.match(companyBrainSource, /params\.get\("auto"\) === "1"/);
});

test("company brain fix center groups risky actions and avoids browser prompts", () => {
  const source = readFileSync("src/app/ops/company-brain/page-client.tsx", "utf8");

  assert.match(source, /Intern sichern/);
  assert.match(source, /Daten korrigieren/);
  assert.match(source, /Kundenkontakt/);
  assert.match(source, /Freigabe prüfen/);
  assert.match(source, /Diese Aktion kann Kundenkontakt auslösen/);
  assert.match(source, /serverseitigem Duplicate-, Bounce- und Empfängercheck/);
  assert.match(source, /Source of Truth/);
  assert.match(source, /Kundenakte prüfen/);
  assert.match(source, /trello:/);
  assert.match(source, /Sofortbild/);
  assert.match(source, /Ursache in Klartext/);
  assert.match(source, /Erlaubter nächster Schritt/);
  assert.match(source, /Strukturierter Audit-Befund/);
  assert.match(source, /Empfohlener Fix/);
  assert.match(source, /Sicherer Fix/);
  assert.match(source, /run\.issueKey/);
  assert.match(source, /run\.recommendedFix/);
  assert.match(source, /run\.safeFix/);
  assert.match(source, /Direktaktion/);
  assert.match(source, /Action Center:/);
  assert.match(source, /action\.payloadPreview/);
  assert.match(source, /Benötigte Runtime-Variablen/);
  assert.match(source, /MICROSOFT_GRAPH_TENANT_ID/);
  assert.match(source, /N8N_API_KEY/);
  assert.match(source, /COOLIFY_API_TOKEN/);
  assert.match(source, /Setup-Paket kopieren/);
  assert.match(source, /keine Secret-Werte/);
  assert.doesNotMatch(source, /window\.prompt/);
});
