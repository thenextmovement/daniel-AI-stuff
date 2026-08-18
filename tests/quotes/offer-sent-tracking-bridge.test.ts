import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/internal/offer-call-tasks/route.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260818102145_repair_google_ads_offer_conversion_source.sql",
  "utf8",
);

test("offer call task records the sent offer with the resolved request id", () => {
  const handler = route.slice(
    route.indexOf("async function createCallTask"),
    route.indexOf("async function createShopifySyncFailureTask"),
  );

  assert.match(route, /import \{ recordOfferSentForSalesCalls \} from "@\/lib\/ops\/customer-call-module"/);
  assert.match(handler, /if \(action === "create_offer_sent_call_task"\)/);
  assert.match(handler, /recordOfferSentForSalesCalls\(\{/);
  assert.match(handler, /requestId: record\.requestId/);
  assert.match(handler, /idempotencyKey: `ops-call:offer:\$\{offerId\}:offer-sent-record`/);
  assert.match(handler, /source: "neontrip_offers_call_task_api"/);
  assert.match(handler, /offerSentSync/);
});

test("tracking sync failure does not undo the existing call task", () => {
  const handler = route.slice(
    route.indexOf("async function createCallTask"),
    route.indexOf("async function createShopifySyncFailureTask"),
  );
  const taskCreation = handler.indexOf("const task = await createCustomerInternalTask");
  const trackingSync = handler.indexOf("offerSentSync = await recordOfferSentForSalesCalls");

  assert.ok(taskCreation >= 0);
  assert.ok(trackingSync > taskCreation);
  assert.match(handler, /catch \(syncError\)/);
  assert.match(handler, /offerSentSync = \{\s*ok: false,/);
});

test("offer conversion source keeps legacy quotes and adds GCLID-only current offer events", () => {
  assert.match(migration, /from public\.master_quotes q/);
  assert.match(migration, /from public\.ops_offer_events oe/);
  assert.match(migration, /oe\.event_type = 'offer_sent'/);
  assert.match(migration, /nullif\(btrim\(mr\.gclid\), ''\) is not null/);
  assert.match(migration, /null::text as email/);
  assert.match(migration, /gc\.conversion_name = 'Offline: Angebot versendet'/);
  assert.match(migration, /distinct on \(candidate\.request_id\)/);
});
