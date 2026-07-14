# Go-Live Status 2026-05-26

Ziel: `Customer Records` und `Sales Calls` heute intern nutzbar machen, aber nicht oeffentlich ohne Access-Schutz veroeffentlichen.

## Aktueller Stand

- Lokaler Ops-Server laeuft auf `http://127.0.0.1:3104/ops/customer-records`.
- LAN-Ops-Server laeuft fuer heutige Nutzung auf `http://192.168.0.220:3104/ops/customer-records`.
- Lokaler Smoke-Test gegen `http://127.0.0.1:3104` ist gruen.
- LAN-Smoke-Test gegen `http://192.168.0.220:3104` ist gruen und authentifiziert per `OPS_PORTAL_TOKEN`.
- Supabase-Migrationen fuer CC-E-Mails und Sales-Call-Bild-Snapshots wurden angewendet.
- `npm run check:ops-schema` ist gruen.
- Production-Dependency-Audit ist gruen: `npm audit --omit=dev` meldet `found 0 vulnerabilities`.
- Container-Pfad ist vorbereitet ueber `Dockerfile.ops`.
- Docker-Build `docker build -f Dockerfile.ops -t neontrip-ops-check .` ist gruen.
- Render-Blueprint ist vorbereitet ueber `render.yaml`; Secret-Werte sind dort als `sync: false` markiert.
- Runtime-Env-Vorlage liegt in `.env.ops.example`.
- Go-live-Gate-Kommando liegt vor: `npm run go-live:ops -- https://ops.neontrip.de`.
- Node Runtime setzt `NODE_OPTIONS=--dns-result-order=ipv4first`, damit Supabase-REST-Aufrufe nicht sporadisch an IPv6/IPv4-Aufloesung scheitern.
- Quick-Tunnel via `trycloudflare.com` ist aktuell nicht verfuegbar: Cloudflare liefert beim Tunnel-Request `500 Internal Server Error`.

## Harte Go-Live-Blocker

### 1. Supabase-Migrationen angewendet

Pruefung am 2026-05-26 gegen Projekt `klibiejfisijpagzkxls` nach Apply:

- `sales_call_runs`: vorhanden
- `sales_call_cadence_state`: vorhanden
- `master_customers.cc_emails`: vorhanden
- `sales_call_list_items.visual_candidates_json`: vorhanden
- `sales_call_list_items.visual_snapshot_created_at`: vorhanden
- `sales_call_list_items_visual_snapshot_idx`: vorhanden

Anwendung:

```text
Dry-Run: status=201, mit ROLLBACK.
Apply 202605210004_add_sales_call_visual_snapshots.sql: status=201.
Apply 202605210005_add_customer_cc_emails.sql: status=201.
npm run check:ops-schema: Customer Records Ops Schema-Check: Pflichtspalten vorhanden.
```

Rollback-Artefakt:

- `supabase/security-backups/customer-records-ops-go-live-rollback-20260526.sql`

## Harte Go-Live-Blocker

### 1. Cloudflare Access / named Tunnel nicht konfiguriert

`cloudflared tunnel list` findet kein lokales Origin-Zertifikat:

```text
Cannot determine default origin certificate path.
```

Damit kann aktuell kein named Tunnel fuer `ops.neontrip.de` aus der lokalen Shell erstellt werden.

## Heute nutzbarer Fallback

Wenn ein Quick-Tunnel wieder erzeugt werden kann, kann das Portal kurzfristig per `OPS_PORTAL_TOKEN` getestet werden. Das ist nur ein Preview-/Testmodus und kein finaler interner Go-live.

Der LAN-Server wurde am 2026-05-26 mit frischem Portal-Token gestartet. Token nicht in Dateien committen.

Heute nutzbarer Link im gleichen Netzwerk:

```text
http://192.168.0.220:3104/ops/customer-records
```

Der Laptop muss eingeschaltet bleiben. Bei Neustart muss der Server neu gestartet werden.

Reale Calls-API-Pruefung:

- `storageReady`: true
- `itemCount`: 20
- `withVisuals`: 11
- `withTrello`: 20
- `visualSources`: `followup_mockup`, `trello_mockup`, `crm_quote_image`, `trello_reference`
- Segmente sind in der aktuellen Call-Liste noch nicht gesetzt; UI fordert deshalb zur Segment-Auswahl/Bestaetigung auf.

## Zielzustand

1. App als Next.js Server Runtime deployen, z. B. Render/Fly/Railway/eigener Server.
2. `ops.neontrip.de/*` mit Cloudflare Access schuetzen.
3. Deployment-Env setzen:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TRELLO_API_KEY`
   - `TRELLO_TOKEN`
   - `OPS_CLOUDFLARE_ACCESS_ISSUER`
   - `OPS_CLOUDFLARE_ACCESS_AUD`
   - `OPS_REQUIRE_CLOUDFLARE_ACCESS=true`
4. Smoke-Test gegen `https://ops.neontrip.de` ausfuehren.
5. Realfall-QA: Suche, Calls, Segment, CC, echte Bilder, Trello-Bearbeitung.
6. Erst danach intern an Mitarbeiter geben.
