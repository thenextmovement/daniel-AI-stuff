# Internal Deployment

Stand: 2026-05-21

Ziel: Customer Records Ops und Sales Calls intern veroeffentlichen, ohne lokalen Rechner, ohne oeffentlichen Zugriff und ohne Secrets im Client.

## Zielarchitektur

- Eigene interne Subdomain: `ops.neontrip.de`
- Hosting als Next.js App mit Server/API-Unterstuetzung auf dem bestehenden Hetzner/Coolify-Server
- Cloudflare DNS zeigt auf den App-Origin
- Cloudflare Access schuetzt `ops.neontrip.de/*`
- Die App validiert zusaetzlich das `Cf-Access-Jwt-Assertion` JWT gegen Cloudflare Access
- Erlaubte Nutzer werden per Cloudflare-Access-Policy und optional zusaetzlich per App-Env begrenzt

## Warum nicht in die bestehende Landingpage kopieren?

Die bestehende Neontrip-Landingpage ist eine oeffentliche Website. Das Ops-Portal ist eine serverseitige interne App:

- Next.js API Routes lesen und schreiben Supabase
- Trello-Token werden serverseitig genutzt
- Supabase Service Role darf nie im Browser oder in statischem Cloudflare-Pages-HTML landen
- Customer Records und Calls enthalten personenbezogene und vertriebliche Daten

Darum bleibt die Landingpage oeffentlich und das Ops-Portal wird getrennt als interne App veroeffentlicht.

## Pflicht-Env

Diese Werte muessen nur in der Deployment-Umgebung gesetzt werden:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRELLO_API_KEY`
- `TRELLO_TOKEN`
- `OPS_CLOUDFLARE_ACCESS_ISSUER`
- `OPS_CLOUDFLARE_ACCESS_AUD`
- `SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN`

Empfohlen:

- `OPS_REQUIRE_CLOUDFLARE_ACCESS=true`
- `OPS_ALLOWED_EMAILS=person1@neontrip.de,person2@neontrip.de`
- oder `OPS_ALLOWED_EMAIL_DOMAINS=neontrip.de`
- `OPS_PLACETEL_CONTACT_URL_TEMPLATE=...`

Fallback fuer Preview/Tunnel:

- `OPS_PORTAL_TOKEN`

In Production sollte `OPS_REQUIRE_CLOUDFLARE_ACCESS=true` gesetzt sein. Dann reicht ein altes Token-Cookie allein nicht mehr aus, wenn kein gueltiges Cloudflare-Access-JWT vorhanden ist.

## Cloudflare Access Setup

1. In Cloudflare Zero Trust eine Self-hosted Access Application fuer `ops.neontrip.de` anlegen.
2. Login-Methode festlegen, idealerweise Google oder Microsoft mit Unternehmensaccounts.
3. Policy auf erlaubte Mitarbeiter-E-Mails oder Gruppen begrenzen.
4. Application Audience (AUD) Tag kopieren und als `OPS_CLOUDFLARE_ACCESS_AUD` setzen.
5. Team Domain als `OPS_CLOUDFLARE_ACCESS_ISSUER` setzen, z. B. `https://<team>.cloudflareaccess.com`.
6. Cloudflare DNS fuer `ops.neontrip.de` auf den Hosting-Origin setzen.
7. Direct-Origin-Zugriff blockieren oder in der App nur Access-JWTs akzeptieren.

## App-Schutz

Die zentrale Pruefung liegt in `src/lib/ops/auth.ts`.

Reihenfolge:

1. Lokale Hosts (`localhost`, `127.0.0.1`) bleiben fuer Entwicklung freigeschaltet.
2. Wenn Cloudflare Access konfiguriert ist, wird `Cf-Access-Jwt-Assertion` geprueft:
   - Signatur gegen Cloudflare JWKS
   - `iss`
   - `aud`
   - Ablaufzeit
   - optionale E-Mail-Allowlist
3. Wenn `OPS_REQUIRE_CLOUDFLARE_ACCESS=true` gesetzt ist, gibt es keinen Token-Fallback.
4. Ohne diese Pflicht kann fuer Tunnel/Preview weiterhin `OPS_PORTAL_TOKEN` genutzt werden.

## Deploy-Preflight

Vor einem Deploy:

```bash
npm run check:ops-deploy
npm run check:ops-schema
npm audit
npx tsc --noEmit
npm run test:quotes
npm run build
```

Alternativ als einzelnes Gate-Kommando:

```bash
npm run go-live:ops -- https://ops.neontrip.de
```

Der Preflight gibt keine Secret-Werte aus.

## Container-Deploy

Fuer Coolify/eigenen Server liegt ein portabler Node-Container bereit:

```bash
docker build -f Dockerfile.ops -t neontrip-ops .
docker run --env-file .env.ops -p 3000:3000 neontrip-ops
```

`.env.ops` darf nicht committed werden. Sie muss mindestens die Pflicht-Env aus diesem Dokument enthalten.
Der Container-Build muss `npm ci` ohne Vulnerabilities und `npm run build` erfolgreich abschliessen.

## Coolify Application

Der produktive Zielhost ist Coolify auf dem bestehenden Hetzner-Server. Die App nutzt `Dockerfile.ops`; Secret-Werte liegen nur in Coolify Environment Variables, nicht im Repo.

In Coolify:

1. Application aus dem Repository erstellen.
2. Build Pack `Dockerfile` verwenden.
3. Dockerfile Path `Dockerfile.ops` setzen.
4. Internal/Exposed Port `3000` setzen.
5. Domain `https://ops.neontrip.de` setzen.
6. Secrets aus `.env.ops.example` in Coolify setzen:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TRELLO_API_KEY`
   - `TRELLO_TOKEN`
   - `SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN`
   - `OPS_CLOUDFLARE_ACCESS_ISSUER`
   - `OPS_CLOUDFLARE_ACCESS_AUD`
   - optional `OPS_PLACETEL_CONTACT_URL_TEMPLATE`
7. Custom Domain `ops.neontrip.de` erst nach Cloudflare-Access-Konfiguration live schalten.

Nach dem Start:

```bash
node scripts/smoke_customer_records_ops.mjs http://127.0.0.1:3000
```

Nach dem Start der App:

```bash
node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

Bei Token-geschuetzten Preview-/Tunnel-Hosts kann `OPS_PORTAL_TOKEN` als Environment-Variable gesetzt werden. In Production soll der Smoke ueber Cloudflare Access laufen; ohne Access-Login muessen API-Pfade blockiert sein.

Unauthenticated-Schutz separat pruefen:

```bash
OPS_SMOKE_EXPECT_PROTECTED=true node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

Dieser Test muss ohne Login fuer alle Ops-Seiten und Ops-APIs einen Block durch Cloudflare Access oder die App sehen. Der normale Smoke-Test ist danach mit erlaubtem Access-Login auszufuehren.

## Pfadvalidierung

Vor Production-Switch muessen diese Pfade getestet werden:

- `https://ops.neontrip.de/ops/customer-records`
- `https://ops.neontrip.de/ops/customer-records/calls`
- `https://ops.neontrip.de/ops/customer-records/price-review`
- `https://ops.neontrip.de/api/ops/customer-records`
- `https://ops.neontrip.de/api/ops/customer-records/calls`
- `https://ops.neontrip.de/api/ops/customer-records/price-predictions?status=pending&limit=10`
- `https://ops.neontrip.de/api/ops/customer-records/actions`
- `https://ops.neontrip.de/api/ops/customer-records/notes`
- `https://ops.neontrip.de/api/ops/customer-records/trello-card`
- `https://ops.neontrip.de/api/ops/customer-records/trello-fields`
- `https://ops.neontrip.de/api/ops/customer-records/trello-attachments`

Erwartung:

- Ohne Cloudflare-Access-Login: Cloudflare blockt.
- Mit Access-Login und erlaubter E-Mail: Seiten laden.
- Mit Access-Login, aber nicht erlaubter E-Mail: App blockt API-Zugriff.
- Bestehende Landingpage-Pfade bleiben unveraendert.

## Datenbank-Migrationen

Vor Production-Nutzung anwenden:

- `supabase/migrations/202605210004_add_sales_call_visual_snapshots.sql`
- `supabase/migrations/202605210005_add_customer_cc_emails.sql`

Wenn der Supabase-MCP weiter read-only ist, die SQL-Dateien ueber Supabase Dashboard/SQL Editor oder den normalen Migration-Runner anwenden.

Aktueller Gate-Status am 2026-05-21:

- `sales_call_runs` und `sales_call_cadence_state` sind vorhanden.
- `master_customers.cc_emails` fehlt noch.
- `sales_call_list_items.visual_candidates_json` und `visual_snapshot_created_at` fehlen noch.
- `npm run check:ops-schema` muss nach Anwendung der Migrationen gruen sein, bevor CC-Felder und stabile Call-Bild-Snapshots als produktionsbereit gelten.

Ohne diese Migrationen:

- CC-E-Mails koennen nicht dauerhaft in `master_customers` gespeichert werden.
- neue Call-Tageslisten koennen Bildkandidaten nicht stabil snapshotten und sind staerker von Live-Trello/Supabase-Bildquellen abhaengig.

## Rollback

- DNS/Cloudflare Access Route fuer `ops.neontrip.de` deaktivieren oder auf vorherigen Origin zuruecksetzen.
- Hosting-Provider auf vorheriges Deployment zurueckrollen.
- `OPS_REQUIRE_CLOUDFLARE_ACCESS=true` nicht entfernen, solange ein oeffentlicher Host existiert.
- Datenbank-Migrationen nicht blind zurueckrollen; erst pruefen, ob neue Spalten Daten enthalten.

## Offene Entscheidungen

- Coolify-Application fuer den aktuellen Ops-Code deployen.
- Mitarbeiter-Emails oder Domain-Allowlist final festlegen.
- Cloudflare Access Identity Provider festlegen.
- Direct-Origin-Schutz des gewaehlten Hosters pruefen.
