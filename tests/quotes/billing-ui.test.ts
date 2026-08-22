import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("Ops exposes a dedicated NEONTRIP billing department", () => {
  const switcher = read("src/app/ops/ops-app-switcher.tsx");
  const client = read("src/app/ops/rechnungen/page-client.tsx");
  assert.match(switcher, /label: "Rechnungen"/);
  assert.match(switcher, /href: "\/ops\/rechnungen"/);
  assert.match(client, /Pro-forma, Rechnungen und Korrekturen/);
  assert.match(client, /active="billing"/);
  assert.match(client, /Rechnung · \{days\} Tage/);
  assert.match(client, /Neue Pro-forma-Version/);
  assert.match(client, /Zahlung eingegangen/);
  assert.match(client, /Zugestellt/);
  assert.match(client, /Rechnung jetzt erstellen/);
  assert.match(client, /Audit-Log protokolliert/);
  assert.match(client, /Rechnungsversand/);
  assert.match(client, /project_number/);
});

test("customer portal is invoice-only and becomes read-only after final invoice", () => {
  const portal = read("src/app/rechnung/[token]/portal-client.tsx");
  const middleware = read("src/middleware.ts");
  assert.match(portal, /Rechnungsdaten bearbeiten/);
  assert.match(portal, /Speichern und zur Prüfung senden/);
  assert.match(portal, /readOnly=\{!editing\}/);
  assert.match(portal, /nicht verändert/);
  assert.match(portal, /Änderungen sind nicht mehr möglich/);
  assert.match(portal, /Live-Vorschau/);
  assert.match(portal, /Nettobetrag/);
  assert.match(portal, /Umsatzsteuer/);
  assert.match(portal, /Gesamtbetrag/);
  assert.match(portal, /Bestellung \{billing\.shopify_order_name\}/);
  assert.match(portal, /Zahlung ausstehend/);
  assert.match(portal, /Das Lieferland ist für die steuerliche Behandlung maßgeblich/);
  assert.match(middleware, /rechnung\.neontrip\.de/);
  assert.doesNotMatch(portal, /Kauf auf Rechnung anfragen/);
  assert.match(portal, /PDF öffnen/);
  assert.match(portal, /Projektnummer \(optional\)/);
  assert.match(portal, /projectNumber/);
  const download = read("src/app/api/rechnung/[token]/documents/[documentId]/route.ts");
  assert.match(download, /getBillingPortalDocument/);
  assert.match(download, /Content-Disposition/);
  assert.match(download, /easybill\.de\/rest\/v1\/documents/);
});
