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
  assert.match(client, /label="Status"/);
  assert.match(client, /Mahnstufe/);
  assert.match(client, /label="Bestellalter"/);
  assert.match(client, /Älter als 1 Monat/);
  assert.match(client, /Älter als 2 Monate/);
  assert.match(client, /Älter als 3 Monate/);
  assert.match(client, /matchesDunningOrderAge\(entry\.orderCreatedAt, filters\.orderAge\)/);
  assert.match(client, /label="Bestelljahr"/);
  assert.match(client, /2024 \+ index/);
  assert.match(client, /length: 11/);
  assert.match(client, /Exakt Stufe/);
  assert.match(client, /Mindestens Stufe/);
  assert.match(client, /matchesDunningStage\(entry\.currentStage, filters\.stage\)/);
  assert.match(client, /Erstellte Mahnanträge ausblenden/);
  assert.match(client, /hasCreatedDunningCourtApplication\(entry\.courtEvents\)/);
  assert.match(client, /Versandnachweis/);
  assert.match(client, /Sendungsnummer vorhanden/);
  assert.match(client, /Carrier-Zustellung bestätigt/);
  assert.match(client, /Fulfilled, Zustellbeleg fehlt/);
  assert.match(client, /Weitere Filter/);
  const primaryControls = client.split("<details")[0] || "";
  assert.match(primaryControls, /label="Sortieren"/);
  assert.match(primaryControls, /Empfohlen: Priorität/);
  assert.match(client, /sort: "priority"/);
  assert.match(primaryControls, /Höchster Betrag zuerst/);
  assert.match(primaryControls, /Niedrigster Betrag zuerst/);
  assert.match(primaryControls, /Höchste Mahnstufe zuerst/);
  assert.match(primaryControls, /Niedrigste Mahnstufe zuerst/);
  assert.match(primaryControls, /Früheste Aktion zuerst/);
  assert.match(primaryControls, /Älteste Bestellung zuerst/);
  assert.match(primaryControls, /Name \/ Firma: A–Z/);
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

test("court application steps remain visibly distinct and seed only the real pilot draft", () => {
  const client = read("src/app/ops/mahnwesen/page-client.tsx");
  const domain = read("src/lib/ops/dunning-court.ts");
  const statusCatalog = read("src/lib/ops/dunning-status.ts");
  const migration = read(
    "supabase/migrations/20260826143000_create_dunning_court_events.sql",
  );
  const seededPilot = migration.split(
    "insert into public.dunning_court_events",
  )[1] || "";
  assert.match(client, /Offizielles gerichtliches Mahnverfahren/);
  assert.match(statusCatalog, /Mahnantrag erstellt/);
  assert.match(client, /Noch nicht beim Gericht eingereicht/);
  assert.match(client, /entry\.courtEvents\.flatMap/);
  assert.match(client, /DUNNING_CASE_STATE_LABELS/);
  assert.match(client, /DUNNING_COURT_EVENT_LABELS/);
  assert.match(client, /matchesDunningStatus\(entry, filters\.status\)/);
  assert.match(client, /Gerichtliches Verfahren/);
  assert.match(client, /Aktueller Status/);
  assert.match(statusCatalog, /An Amtsgericht gesendet/);
  assert.match(
    client,
    /entry\.courtEvent && entry\.state !== "court_review"/,
  );
  assert.match(
    client,
    /entry\.state === "court_review" && entry\.courtEvent/,
  );
  assert.match(client, /event\.sourceReference/);
  assert.match(
    client,
    /noch nicht als gelber Brief\s+zugestellt/,
  );
  assert.match(domain, /application_draft_created/);
  assert.match(domain, /application_submitted/);
  assert.match(domain, /court_order_served/);
  assert.match(domain, /Widerspruchsfrist überwachen/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /Append-only audit trail/);
  assert.match(seededPilot, /#NEONT2993/);
  assert.match(seededPilot, /date '2026-08-25'/);
  assert.match(seededPilot, /application_draft_created/);
  assert.match(seededPilot, /nicht beim Mahngericht eingereicht/);
  assert.doesNotMatch(seededPilot, /application_submitted/);
  assert.doesNotMatch(seededPilot, /court_order_served/);
});

test("one-click court preparation uses the official portal and sends only an internal PDF", () => {
  const client = read("src/app/ops/mahnwesen/page-client.tsx");
  const route = read("src/app/api/ops/dunning/[orderKey]/actions/route.ts");
  const profileRoute = read(
    "src/app/api/ops/dunning/[orderKey]/court-profile/route.ts",
  );
  const application = read("src/lib/ops/dunning-court-application.ts");
  const migration = read(
    "supabase/migrations/20260826143000_create_dunning_court_events.sql",
  );
  assert.match(client, /Gerichtsdaten prüfen/);
  assert.match(client, /Amtlichen Antrag vorbereiten/);
  assert.match(client, /PDF erstellen und intern senden/);
  assert.match(client, /reicht nichts beim Gericht ein/);
  assert.match(client, /versendet keine Kundenmail/);
  assert.match(route, /preview_court_application/);
  assert.match(route, /prepare_court_application/);
  assert.match(route, /expectedSnapshotHash/);
  assert.match(route, /confirmation_mismatch/);
  assert.match(route, /ops-court:/);
  assert.match(profileRoute, /resolveOpsRequestActor/);
  assert.match(profileRoute, /communicationReviewed/);
  assert.match(profileRoute, /unternehmensregister[.]de/);
  assert.match(profileRoute, /handelsregister[.]de/);
  assert.match(application, /https:\/\/www[.]online-mahnantrag[.]de\//);
  assert.match(application, /DUNNING_COURT_PORTAL_ORIGIN_INVALID/);
  assert.match(application, /hostname[.]toLowerCase\(\) ===/);
  assert.match(application, /_bVersandart/);
  assert.match(application, /Barcode/);
  assert.match(application, /Ich stimme zu/);
  assert.match(application, /Werkvertrag\/Werklieferungsvertrag/);
  assert.match(application, /Amtsgericht Hagen/);
  assert.match(
    application,
    /const AMTSGERICHT_MAX_AMOUNT_CENTS = 1_000_000/,
  );
  assert.match(
    application,
    /amountCents > AMTSGERICHT_MAX_AMOUNT_CENTS/,
  );
  assert.doesNotMatch(application, /amountCents > 500_000/);
  assert.match(
    application,
    /Der erste\/einzige Antragsteller ist Kontoinhaber/,
  );
  assert.match(application, /PDFDocument[.]load/);
  assert.match(application, /Command=barcodeMB/);
  assert.match(application, /application\/pdf/);
  assert.match(application, /DUNNING_COURT_INTERNAL_RECIPIENT/);
  assert.match(application, /neontrip\[\.\]de\|daranova\[\.\]de/);
  assert.doesNotMatch(application, /summary[.]email/);
  assert.match(application, /status: "email_dispatching"/);
  assert.match(application, /status: "manual_review"/);
  assert.match(application, /\["pending", "retryable_error"\]/);
  assert.match(application, /DUNNING_COURT_GRAPH_SEND_UNCERTAIN/);
  assert.match(application, /MICROSOFT_GRAPH_CLIENT_ID_NEXT/);
  assert.match(application, /MICROSOFT_GRAPH_CLIENT_SECRET_NEXT/);
  assert.match(application, /nicht beim Gericht eingereicht/);
  assert.match(migration, /create table public[.]dunning_court_profiles/);
  assert.match(migration, /create table public[.]dunning_court_draft_jobs/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /to service_role/);
});
