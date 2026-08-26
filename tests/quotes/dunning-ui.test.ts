import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("Ops exposes a dedicated searchable dunning work center", () => {
  const switcher = read("src/app/ops/ops-app-switcher.tsx");
  const client = read("src/app/ops/mahnwesen/page-client.tsx");
  assert.match(switcher, /label: "Mahnwesen"/);
  assert.match(switcher, /href: "\/ops\/mahnwesen"/);
  assert.match(client, /active="dunning"/);
  assert.match(
    client,
    /Name, Firma, E-Mail, Telefon, Bestellung, Rechnung oder Sendungsnummer/,
  );
  assert.match(client, /shipment\.trackingNumber/);
  assert.match(client, /Arbeitsstatus/);
  assert.match(client, /Mahnstufe/);
  assert.match(client, /Versandnachweis/);
  assert.match(client, /Sendungsnummer vorhanden/);
  assert.match(client, /Carrier-Zustellung bestätigt/);
  assert.match(client, /Fulfilled, Zustellbeleg fehlt/);
  assert.match(client, /Weitere Filter/);
  assert.doesNotMatch(client, /Bezahlt \/ erledigt/);
  assert.doesNotMatch(client, /Mindestbetrag/);
  assert.doesNotMatch(client, /Höchstbetrag/);
  assert.match(client, /Solvenz\/Gericht/);
  assert.match(client, /Insolvenzprüfung/);
  assert.match(client, /Daten geprüft – kein Hinweis/);
  assert.match(client, /Amtliche Insolvenzprüfung/);
  assert.match(client, /Das beweist keine Zahlungsfähigkeit/);
  assert.match(client, /Es wurde weder ein Mahnantrag/);
  assert.match(client, /Keine Telefonnummer/);
  assert.match(client, /Nächste Aktion/);
  assert.match(client, /Kein automatischer Versand geplant/);
  assert.match(client, /Bezahlte Fälle sind ausgeblendet/);
  assert.match(client, /Bezahlter Shopify-Ausnahmefall/);
  assert.match(client, /Versand- und Zustellnachweis/);
  assert.match(
    client,
    /ein separates POD-Dokument ist damit noch\s+nicht archiviert/,
  );
  assert.match(client, /Carrier-POD oder/);
  assert.match(client, /Fallakte/);
  assert.match(
    client,
    /Chronologisch aus Shopify, Easybill, Outlook und\s+Mahnnachweisen/,
  );
  assert.doesNotMatch(client, /dangerouslySetInnerHTML/);
});

test("the automated insolvency check is internal-only, bounded and never starts legal action", () => {
  const route = read(
    "src/app/api/internal/ops/dunning/insolvency-scan/route.ts",
  );
  const lookup = read("src/lib/ops/dunning-insolvency.ts");
  const migration = read(
    "supabase/migrations/20260826003000_create_dunning_insolvency_checks.sql",
  );
  assert.match(route, /configuredInternalKeys/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /body_too_large/);
  assert.match(route, /content_type_required/);
  assert.match(route, /new TextEncoder\(\)\.encode\(rawBody\)\.byteLength/);
  assert.match(route, /value > 3/);
  assert.match(route, /entry\.state === "court_review"/);
  assert.match(route, /legalActionTriggered: false/);
  assert.match(route, /customerCommunicationSent: false/);
  assert.match(lookup, /hostname !== "neu\.insolvenzbekanntmachungen\.de"/);
  assert.match(lookup, /redirect: "error"/);
  assert.doesNotMatch(lookup, /solvent/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /event_key text not null unique/);
});

test("the existing report schedule has a validated, secret-free insolvency scan patch", () => {
  const artifact = JSON.parse(
    read("workflows/dunning/ticket-159-official-insolvency-scan.json"),
  ) as {
    workflowId: string;
    validation: { applied: boolean };
    operations: Array<Record<string, unknown>>;
  };
  const serialized = JSON.stringify(artifact);
  assert.equal(artifact.workflowId, "DomnXhPG8ambg9qb");
  assert.equal(artifact.validation.applied, false);
  assert.match(
    serialized,
    /https:\/\/ops\.neontrip\.de\/api\/internal\/ops\/dunning\/insolvency-scan/,
  );
  assert.match(serialized, /OPS_INTERNAL_API_KEY/);
  assert.match(serialized, /Reports and Alerts Every 15 Minutes/);
  assert.doesNotMatch(serialized, /Bearer [A-Za-z0-9_-]{24,}/);
});

test("manual stage actions require auth, same-origin, a fresh snapshot, confirmation and idempotency", () => {
  const route = read("src/app/api/ops/dunning/[orderKey]/actions/route.ts");
  const domain = read("src/lib/ops/dunning.ts");
  assert.match(route, /hasOpsSession/);
  assert.match(route, /resolveOpsRequestActor/);
  assert.match(route, /sameOrigin/);
  assert.match(route, /content_type_required/);
  assert.match(route, /payload_too_large/);
  assert.match(route, /new TextEncoder\(\)\.encode\(rawBody\)\.byteLength/);
  assert.match(route, /allowedKeys/);
  assert.match(route, /stale_preview/);
  assert.match(route, /confirmation_mismatch/);
  assert.match(route, /invalid_idempotency_key/);
  assert.match(domain, /DUNNING_MANUAL_SEND_ENABLED/);
  assert.match(domain, /DUNNING_MANUAL_SEND_ALLOWED_HOSTS/);
  assert.match(domain, /redirect: "error"/);
  assert.match(domain, /X-Idempotency-Key/);
  assert.match(domain, /Shopify-Sperrtag ist gesetzt/);
  assert.match(domain, /Neue Kundenantwort muss zuerst geprüft werden/);
  assert.match(domain, /Alt- und Neuverlauf haben unterschiedliche Mahnstufen/);
});
