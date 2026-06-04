# Operations Runbook

Stand: 2026-06-04

Dieses Runbook beschreibt, wie die interne NEONTRIP Ops-App betrieben, geaendert und sicher deployed wird.

## Aktueller Betrieb

- Live-URL: `https://ops.neontrip.de/ops/customer-records/calls`
- Basis-URL: `https://ops.neontrip.de`
- Hosting: Hetzner Server mit Coolify und Docker
- Coolify Service: `neontrip-ops-calls`
- Coolify Projekt: `neontrip-ops`
- Environment: `production`
- GitHub Repo: `https://github.com/thenextmovement/daniel-AI-stuff`
- Branch: `main`
- Dockerfile: `Dockerfile.ops`
- App-Port im Container: `3000`
- DNS: `ops.neontrip.de` zeigt per `A` Record auf `91.99.61.158`

## Zugriffsschichten

Die App hat aktuell zwei Schutzschichten:

1. Traefik/Coolify HTTP Basic Auth
   - Username: `neontrip`
   - Passwort liegt nicht im Repo und kann nicht aus dem Hash zurueckgelesen werden.
   - Neues Passwort wird in Coolify gesetzt: `neontrip-ops-calls` -> `Configuration` -> `General` -> `HTTP Basic Authentication`.

2. App-Token Login
   - Env Var: `OPS_PORTAL_TOKEN`
   - Wird in Coolify unter `Environment Variables` gesetzt.
   - Wenn der Token verloren geht, einen neuen erzeugen, in Coolify ersetzen und Service neu starten oder redeployen.

Zielzustand fuer spaeter: Cloudflare Access vor `ops.neontrip.de` und `OPS_REQUIRE_CLOUDFLARE_ACCESS=true`. Bis dahin bleibt Basic Auth plus App-Token Pflicht.

## Wo Aenderungen gemacht werden

Code-Aenderungen werden lokal im sauberen Ops-Repo gemacht:

```text
/Users/danielklesse/Desktop/neontrip-ops-coolify
```

Nicht direkt im Docker-Container oder auf dem Server editieren. Diese Aenderungen waeren beim naechsten Redeploy weg.

Der alte grosse Projektordner unter `/Users/danielklesse/Desktop/neontrip` enthaelt weiterhin Historie und andere Landingpage-Arbeit. Fuer diese App ist der saubere Coolify-Checkout die Arbeitsbasis.

## Standard-Ablauf fuer Code-Aenderungen

1. Lokal ins Repo wechseln:

```bash
cd /Users/danielklesse/Desktop/neontrip-ops-coolify
```

2. Aenderung machen.

3. Lokal pruefen:

```bash
npm run test:quotes
npx tsc --noEmit
docker build -f Dockerfile.ops -t neontrip-ops-check .
```

4. Commit erstellen:

```bash
git status --short
git add .
git commit -m "Kurze Beschreibung der Aenderung"
```

5. Nach GitHub pushen:

```bash
git push
```

6. Nach dem Push startet GitHub Actions den Coolify-Deploy automatisch, wenn das
   GitHub Secret `COOLIFY_DEPLOY_WEBHOOK` gesetzt ist.

   Falls kein automatisches Deployment startet:
   - GitHub -> `thenextmovement/daniel-AI-stuff` -> Actions -> `Deploy Ops App to Coolify` pruefen.
   - Wenn der Workflow mit `COOLIFY_DEPLOY_WEBHOOK is not configured` scheitert, das Secret nachtragen.
   - Wenn der Workflow mit `COOLIFY_API_TOKEN is not configured` scheitert, einen Coolify API Token als Secret nachtragen.
   - Das Secret muss der app-spezifische Deploy-Webhook aus Coolify fuer `neontrip-ops-calls` sein, nicht der generische GitHub-Webhook.
   - Der Deploy-Webhook in Coolify ist als `auth required` markiert. Deshalb braucht GitHub Actions zusaetzlich `COOLIFY_API_TOKEN`.

7. In Coolify nur noch manuell redeployen, wenn GitHub Actions ausgefallen ist oder eine Env-Var geaendert wurde.

8. Nach dem Deploy pruefen:

```bash
curl -I https://ops.neontrip.de/ops/customer-records/calls
```

Erwartung ohne Login:

```text
HTTP/2 401
www-authenticate: Basic realm="traefik"
```

Danach im Browser mit Basic Auth und App-Token testen.

## Konfiguration und Secrets

Secrets werden nur in Coolify gesetzt, nie im Repo.

Pflicht-Env:

```env
NODE_ENV=production
NODE_OPTIONS=--dns-result-order=ipv4first
PORT=3000
SUPABASE_URL=https://klibiejfisijpagzkxls.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret>
TRELLO_API_KEY=<secret>
TRELLO_TOKEN=<secret>
OPS_REQUIRE_CLOUDFLARE_ACCESS=false
OPS_PORTAL_TOKEN=<secret>
```

Nach Aenderungen an Env Vars immer Service neu starten oder redeployen.

## Was welche Aenderung ausloest

- UI, Call-Logik, API-Routen, Bilder, Trello-/Supabase-Code: Code-Aenderung, Commit, Push, Coolify Redeploy.
- Supabase URL, Service Role, Trello Key/Token, Ops Token, Offers API Key: Coolify Env Var aendern, Restart/Redeploy.
- Basic Auth Username/Passwort: Coolify General Settings, Restart falls noetig.
- Domain `ops.neontrip.de`: DNS-Anbieter fuer `neontrip.de`.
- Server-Firewall: Hetzner Cloud Console.
- Container-Routing/HTTPS: Coolify Proxy/Traefik.

## Angebotseditor in Customer Records

Der Tab `Angebot` kann ein Angebot aus `neontrip-offers` ueber die Trello-Karten-ID laden und bearbeiten. Falls keine eindeutige Karte vorhanden ist, kann nach Angebotsnummer, Angebotslink, E-Mail, Firma, Name oder Trello-Link gesucht werden. Die Ops-App schreibt dabei nicht direkt in die Offers-Datenbank. Alle Aenderungen laufen serverseitig ueber die interne Offers-API.

Erlaubt:

- DRAFT und SENT bearbeiten.
- VIEWED nur mit Aenderungsgrund bearbeiten.
- Texte, Preise, Mengen, Vergleichspreise, Rabattlabels, Gültigkeit, Lieferzeit und aktivierte Bilder anpassen.
- Danach das aktualisierte Angebot separat per E-Mail senden.
- Manuell gefundene Angebote oeffnen, ohne sie automatisch mit dem Customer-Record zu verknuepfen.

Gesperrt:

- ACCEPTED, DOWNLOADED oder Angebote mit Acceptance.
- EXPIRED in V1.
- Neue Positionen oder neue Bild-URLs direkt aus Ops anlegen.
- Finale PDFs erzeugen oder Annahmen ausloesen.
- Versand aus Customer Records, wenn die Kunden-E-Mail im Angebot nicht zur E-Mail des geoeffneten Datensatzes passt.

Noetige Env Vars in `neontrip-ops-calls`:

```env
NEONTRIP_OFFERS_BASE_URL=https://angebote.neontrip.de
NEONTRIP_OFFERS_INTERNAL_API_KEY=<secret>
```

Das gleiche Secret muss in `neontrip-offers` als `NEONTRIP_OFFERS_INTERNAL_API_KEY` gesetzt sein.

## Mailverlauf in Customer Records

Der Mailverlauf liest aus `public.customer_email_messages` im Ops-Supabase-Projekt.

Wichtige Felder:

- `linked_request_id`: interne UUID aus `master_requests.id`, nicht die sichtbare `request_id`.
- `linked_customer_id`: UUID aus `master_customers.id`.
- `received_at`, `sent_at`, `message_created_at`: echte Outlook-/Graph-Zeitstempel.
- `created_at`: nur Sync-/Insert-Zeit und kein fachlicher Mail-Zeitpunkt.

Der n8n-Workflow `NEONTRIP Outlook Customer Email Sync v1.0` muss die Outlook-Nodes mit `output = raw` lesen. Ohne Raw-Output fehlen die Microsoft-Graph-Zeitfelder und die Ops-App kann nur den Sync-Zeitpunkt anzeigen.

Read-only Kontrollquery:

```sql
select
  count(*) as total,
  count(*) filter (where linked_request_id is not null) as linked_request_rows,
  count(*) filter (where received_at is not null or sent_at is not null or message_created_at is not null) as rows_with_message_time,
  count(*) filter (where received_at is null and sent_at is null and message_created_at is null) as rows_without_message_time
from public.customer_email_messages;
```

Wenn `rows_with_message_time = 0`, zuerst den n8n-Outlook-Sync pruefen. Keine UI- oder Supabase-Anzeige kann echte Zeiten rekonstruieren, wenn der Sync sie nicht speichert.

## Visualisierungen anfordern

Im Customer-Records-Tab `Angebot` gibt es einen Block `Neue Visualisierung anfordern`.

Verhalten:

- Mit `OPS_VISUAL_REQUEST_WEBHOOK_URL`: die App sendet eine Generator-Anfrage an den konfigurierten Webhook.
- Ohne `OPS_VISUAL_REQUEST_WEBHOOK_URL`: die App erstellt eine interne Aufgabe im Aufgabenboard.
- Optionaler Bearer-Schutz fuer den Webhook: `OPS_VISUAL_REQUEST_WEBHOOK_TOKEN`.

Die Anfrage aendert kein Angebot und macht nichts kundensichtbar. Ein fertiges Bild wird erst kundensichtbar, wenn es spaeter bewusst im Angebot aktiviert wird.

Noetige Env Vars nur falls ein Generator-/n8n-Webhook angebunden wird:

```env
OPS_VISUAL_REQUEST_WEBHOOK_URL=<webhook-url>
OPS_VISUAL_REQUEST_WEBHOOK_TOKEN=<secret-optional>
```

## Smoke-Tests

Ohne Login muss die App geschuetzt sein:

```bash
curl -I https://ops.neontrip.de/ops/customer-records/calls
```

Erwartung: `401` von Traefik Basic Auth.

Nach Login im Browser:

- `/ops/customer-records/calls` oeffnet.
- Calls-Liste laedt.
- Kontaktbilder/Mockups werden angezeigt.
- Segment ist sichtbar und kann bestaetigt/geaendert werden.
- Rueckruf/Outcome kann gespeichert werden.
- Der Datensatz verschwindet bzw. sortiert sich gemaess Call-Logik aus der Tagesliste.
- Trello-Kartenlinks oeffnen die richtige Karte.

Wenn ein API-Test mit Token noetig ist, den Token nicht in den Chat schreiben und nicht in Shell-History speichern.

## Notfall und Rollback

Wenn ein Deploy kaputt ist:

1. In Coolify auf das vorherige erfolgreiche Deployment zurueckrollen oder Service stoppen.
2. DNS nicht aendern, solange der Fehler nur in der App liegt.
3. Keine Supabase-Schema-Aenderungen blind zurueckrollen.
4. Logs pruefen, ohne Secrets zu kopieren.
5. Erst nach reproduziertem Fix neu deployen.

Wenn `ops.neontrip.de` nicht erreichbar ist:

- DNS pruefen: `dig +short A ops.neontrip.de`
- HTTP/HTTPS pruefen: `curl -I http://ops.neontrip.de` und `curl -I https://ops.neontrip.de`
- Hetzner Firewall pruefen: TCP `80`, `443` muessen offen sein.
- Coolify Dashboard pruefen: `http://91.99.61.158:8000`
- Falls Coolify nicht laedt: Server-RAM/OOM und Container-Status pruefen.

## Server-Stabilitaet

Beim Go-Live gab es einen OOM-Event. Der Server sollte Swap bekommen, damit Docker/Coolify bei RAM-Spitzen nicht Prozesse verliert.

Empfohlene Server-Aenderung:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Diese Aenderung betrifft nur die Server-Stabilitaet, nicht die App-Logik.
