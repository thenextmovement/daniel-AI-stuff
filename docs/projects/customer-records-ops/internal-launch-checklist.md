# Internal Launch Checklist

Stand: 2026-05-21

Ziel: `Customer Records` und `Sales Calls` intern stabil bereitstellen, ohne Quick-Tunnel als dauerhafte Loesung.

## 1. Datenbank-Gate

Pflicht:

```bash
npm run check:ops-schema
```

Gruen bedeutet:

- `master_customers.cc_emails` existiert fuer CC-Empfaenger.
- `sales_call_list_items.visual_candidates_json` existiert fuer stabile Call-Bild-Snapshots.
- `sales_call_list_items.visual_snapshot_created_at` existiert fuer Snapshot-Audit.

Wenn rot:

- `supabase/migrations/202605210004_add_sales_call_visual_snapshots.sql` anwenden.
- `supabase/migrations/202605210005_add_customer_cc_emails.sql` anwenden.
- Danach `npm run check:ops-schema` erneut ausfuehren.

## 2. Hosting-Gate

Die App braucht eine Next.js Server-Runtime. Kein rein statisches Cloudflare-Pages-Deploy.

Zulaessige Optionen:

- Vercel/Render/Fly/Railway mit Node Runtime hinter Cloudflare Access.
- Eigener Server mit named Cloudflare Tunnel und Cloudflare Access.
- Cloudflare Workers/Pages nur mit validiertem Next-Adapter und Server-Secret-Support.

Pflicht-Env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRELLO_API_KEY`
- `TRELLO_TOKEN`
- `OPS_CLOUDFLARE_ACCESS_ISSUER`
- `OPS_CLOUDFLARE_ACCESS_AUD`
- `OPS_REQUIRE_CLOUDFLARE_ACCESS=true`

Empfohlen:

- `OPS_ALLOWED_EMAIL_DOMAINS=neontrip.de`
- oder konkrete `OPS_ALLOWED_EMAILS`

## 3. Cloudflare Access Gate

Pflicht:

- Access Application fuer `ops.neontrip.de/*`
- Policy auf erlaubte Mitarbeiter begrenzen
- AUD und Issuer in App-Env uebernehmen
- Direct-Origin-Zugriff blockieren oder App mit `OPS_REQUIRE_CLOUDFLARE_ACCESS=true` betreiben

Erwartung:

- nicht eingeloggte Nutzer sehen Cloudflare Access
- eingeloggte erlaubte Nutzer koennen Seiten und APIs nutzen
- nicht erlaubte Nutzer werden von Cloudflare oder App geblockt

## 4. Build- und Smoke-Gate

Vor Go-live:

```bash
npm run check:ops-deploy
npm run check:ops-schema
npm audit
npx tsc --noEmit
npm run test:quotes
npm run build
node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

Vor dem eingeloggten Smoke-Test:

```bash
OPS_SMOKE_EXPECT_PROTECTED=true node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

Zusatzpruefung:

- ohne Login blockt Cloudflare Access alle Ops-Seiten und Ops-APIs
- `/ops/customer-records` laedt
- `/ops/customer-records/calls` laedt
- `/ops/customer-records/price-review` laedt
- `/api/ops/customer-records/calls` liefert `ok=true`
- `/api/ops/customer-records/price-predictions?status=pending&limit=10` liefert `ok=true`
- `/api/ops/customer-records?query=<request-id>` liefert `ok=true`
- Trello-Bildproxy liefert echte Bilder und `Cache-Control: private, max-age=3600`
- falsche Trello-IDs liefern `400`
- `npm audit` meldet `found 0 vulnerabilities`

## 5. Functional Gate

Manuell pruefen:

- Kontakt suchen
- CC-E-Mails setzen, mindestens zwei Adressen
- Segment in Calls bestaetigen oder aendern
- Call-Status speichern
- Tagesliste zeigt Follow-up-Mockup vor Trello/CRM-Bildern
- Trello-Karte aus Kontaktkontext oeffnen und Felder bearbeiten

## 6. Rollback

- Hosting-Deployment auf vorherige Version zuruecksetzen.
- Cloudflare DNS fuer `ops.neontrip.de` auf vorherigen Origin zuruecksetzen oder deaktivieren.
- Cloudflare Access nicht lockern, solange ein oeffentlicher Origin existiert.
- Datenbank-Migrationen nicht blind entfernen; erst pruefen, ob `cc_emails` oder Call-Snapshots bereits Daten enthalten.
