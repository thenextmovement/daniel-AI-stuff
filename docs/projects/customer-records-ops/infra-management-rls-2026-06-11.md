# Infra, Management Dashboard und RLS Review

Stand: 2026-06-11

## Git-/Arbeitsstand

- Ops-Repo `/Users/danielklesse/Desktop/neontrip-ops-coolify`: sauberer Startzustand vor dieser Arbeit.
- Offers-Repo `/Users/danielklesse/neontrip-offers`: fremde offene Shopify-Altlasten, nicht angefasst:
  - `lib/shopify-sale-sync.ts`
  - `tests/shopify-sale-sync.test.ts`
  - `scripts/replay-shopify-sale.ts`

## RLS Befund

Produktiv relevante Tabellen mit deaktivierter RLS im Supabase-Projekt:

| Tabelle | Zweck | Risiko | Vorschlag |
| --- | --- | --- | --- |
| `sales_tasks` | Interne Sales-/Call-/E-Mail-Aufgaben, Postgres ist Source of Truth | Internes Aufgaben- und Kundensignal-Leak bei direktem `anon`/`authenticated` Zugriff | RLS aktivieren, direkte `anon`/`authenticated` Grants entziehen, nur `service_role` Policy |
| `ops_offer_events` | Bridge-Events aus Angebotssoftware in Ops/Sales | Angebotsereignisse, Empfaenger und URLs duerfen nicht public lesbar/schreibbar sein | RLS aktivieren, direkte `anon`/`authenticated` Grants entziehen, nur `service_role` Policy |
| `crm_customer_change_log` | CRM-Aenderungslog | Interne Historie | Separat im CRM-Scope klaeren |
| `crm_inventory_*` | Inventar/Glossar/Lock/Movements | Interne Bestandsdaten | Separat im Inventory/CRM-Scope klaeren |
| `ops_customer_*_20260604` | Rollback-/Backfill-Tabellen | Alte personenbezogene Backups | Separat Cleanup-/Archivierungsentscheidung treffen |
| `social_post_schedule` | Social Posting Plan | Interne Marketingplanung | Separat Marketing-/Content-Scope klaeren |

## Zugriffsmuster

`sales_tasks`
- Reads: Management KPI API, Customer Records/Calls, Tasks-Modul.
- Writes/Updates: Sales-Call-Cadence, interne Tasks-Fallbacks, Offer-Sent RPC.
- Deletes: kein regulaerer App-Pfad gefunden.
- Rolle: App nutzt serverseitig `SUPABASE_SERVICE_ROLE_KEY` via `src/lib/quotes/supabase-rest.ts`.
- Public/anonymous: nicht erforderlich.

`ops_offer_events`
- Reads: Customer Records Offer-Bridge Lookup.
- Writes/Updates: `ops_record_offer_sent`, `ops_record_offer_lifecycle_event`.
- Deletes: kein regulaerer App-Pfad gefunden.
- Rolle: Server/RPC mit Service Role.
- Public/anonymous: Event-Ingestion darf nur kontrolliert ueber Server/API, nicht direkt per Tabelle.

## Migration

Neue Migration:

- `supabase/migrations/20260611190000_harden_sales_tasks_offer_events_rls.sql`

Wirkung:

- aktiviert RLS auf `sales_tasks` und `ops_offer_events`
- erstellt explizite `service_role` Policies
- entzieht direkte Tabellenrechte von `anon` und `authenticated`
- haertet `ops_record_offer_sent`, analog zu `ops_record_offer_lifecycle_event`, auf `service_role`

Rollback:

- `supabase/rollbacks/20260611190000_harden_sales_tasks_offer_events_rls_rollback.sql`

## Management Dashboard

Aktuelle echte Datenquellen:

- Supabase REST via Service Role
- `master_orders` fuer Shopify-Umsatz/Orders
- `master_requests`, `master_quotes`, `crm_quotes` fuer Funnel/Pipeline
- `ops_cost_entries`, `sea_campaign_daily`, `google_ads_daily_spend` fuer Kosten/SEA-Status
- `sales_tasks`, `sales_call_results` fuer offene Aufgaben und Calls

Nicht erfunden:

- Microsoft Clarity wird als `Nicht konfiguriert`/`partial` ausgewiesen, solange keine Projekt-ID/API-Kennzahlen angebunden sind.
- Fehlende Marge-/Kostenquellen bleiben explizit als fehlend sichtbar.

## Navigation/Auth

- Interne Ops-Navigation sitzt zentral in `src/app/ops/ops-app-switcher.tsx`.
- Vorhandene Module: Kundenakte, Preispruefung, Management, Anrufe, Teamaufgaben, Angebote, Sales-Vergabe, Paketversand, Wareneingang.
- Auth ist aktuell Cloudflare-Access-faehig via `src/lib/ops/auth.ts`.
- Production-Zielzustand bleibt `OPS_REQUIRE_CLOUDFLARE_ACCESS=true`; Token-Fallback nur Preview/Tunnel.

## Coolify Deployment

Vorher:

- GitHub Actions pruefte nur Coolify-Secrets und triggerte direkt den Webhook.

Nachher:

- `npm ci`
- `npm run test:quotes`
- `npx tsc --noEmit`
- `npm run build`
- erst danach Coolify Webhook
- optionaler geschuetzter Smoke, wenn `OPS_SMOKE_BASE_URL` als GitHub Secret gesetzt ist

Secrets bleiben in GitHub/Coolify, nicht im Repo.
