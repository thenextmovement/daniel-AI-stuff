import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("Ops exposes a dedicated searchable dunning work center", () => {
  const switcher = read("src/app/ops/ops-app-switcher.tsx");
  const client = read("src/app/ops/mahnwesen/page-client.tsx");
  assert.match(switcher, /label: "Mahnwesen"/);
  assert.match(switcher, /href: "\/ops\/mahnwesen"/);
  assert.match(client, /active="dunning"/);
  assert.match(client, /Bestellnummer, Firma, Name, E-Mail oder Rechnung/);
  assert.match(client, /Arbeitsstatus/);
  assert.match(client, /Mahnstufe/);
  assert.match(client, /Lieferung/);
  assert.match(client, /Überfälligkeit/);
  assert.match(client, /Mindestbetrag/);
  assert.match(client, /Gericht prüfen/);
  assert.match(client, /Fallakte/);
  assert.match(client, /Chronologisch aus Shopify, Easybill, Outlook und Mahnnachweisen/);
  assert.doesNotMatch(client, /dangerouslySetInnerHTML/);
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
