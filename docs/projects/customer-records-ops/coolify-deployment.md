# Coolify Deployment

Stand: 2026-05-27

Ziel: `Customer Records` und `Sales Calls` auf dem bestehenden Hetzner/Coolify-Server betreiben, ohne Render und ohne oeffentlichen ungeschuetzten Zugriff.

## Empfehlung

Coolify ist fuer dieses Projekt ein guter Zielhost, weil bereits ein Hetzner-Server mit Docker vorhanden ist. Die App bleibt eine Next.js Server-App mit API-Routen und Secrets. Sie darf nicht in die statische Cloudflare-Pages-Landingpage kopiert werden.

## Voraussetzungen

- Coolify-Zugriff auf dem Hetzner-Server.
- Source-Code muss fuer Coolify verfuegbar sein:
  - bevorzugt Git-Repository mit `Dockerfile.ops`, `package.json`, `package-lock.json`, `src/`, `public/`, `scripts/`
  - alternativ manueller Upload/Private Git Source in Coolify
- DNS-Zugriff fuer `ops.neontrip.de`.
- Secrets liegen nur in Coolify Environment Variables, nicht im Repo.

## Aktueller Repo-Hinweis

Der lokale Checkout hat aktuell keinen Git-Remote eingetragen. Viele Ops-Dateien sind lokal noch untracked. Coolify kann diese App erst bauen, wenn die relevanten Dateien in einem von Coolify erreichbaren Git-Repo liegen oder anderweitig nach Coolify uebertragen wurden.

Relevante Dateien:

- `Dockerfile.ops`
- `.dockerignore`
- `package.json`
- `package-lock.json`
- `next.config.ts`
- `tsconfig.json`
- `postcss.config.mjs`
- `tailwind.config.js`
- `src/`
- `public/`
- `scripts/`
- `tests/`

## Coolify Application

In Coolify:

1. Neues Project oder bestehendes internes Project auswaehlen.
2. Neue Resource `Application` anlegen.
3. Source: Git Repository mit diesem Projekt.
4. Build Pack: Dockerfile.
5. Dockerfile Path: `Dockerfile.ops`.
6. Exposed/Internal Port: `3000`.
7. Domain: `https://ops.neontrip.de`.
8. Auto Deploy erst nach erfolgreichem manuellem Deploy aktivieren.

## Environment Variables

Pflicht:

```env
NODE_ENV=production
NODE_OPTIONS=--dns-result-order=ipv4first
PORT=3000
SUPABASE_URL=https://klibiejfisijpagzkxls.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret>
TRELLO_API_KEY=<secret>
TRELLO_TOKEN=<secret>
```

Final mit Cloudflare Access:

```env
OPS_CLOUDFLARE_ACCESS_ISSUER=https://<team>.cloudflareaccess.com
OPS_CLOUDFLARE_ACCESS_AUD=<cloudflare-access-aud>
OPS_REQUIRE_CLOUDFLARE_ACCESS=true
OPS_ALLOWED_EMAIL_DOMAINS=neontrip.de
```

Preview-/Uebergangsmodus ohne Cloudflare Access:

```env
OPS_REQUIRE_CLOUDFLARE_ACCESS=false
OPS_PORTAL_TOKEN=<langes-zufaelliges-token>
```

Der Uebergangsmodus ist nicht der Zielzustand. Er darf nur genutzt werden, wenn zusaetzlich auf Proxy-/Coolify-Ebene ein Zugriffsschutz existiert oder die URL noch nicht breit verteilt ist.

Nicht setzen in finaler Production:

```env
OPS_PORTAL_TOKEN=
```

Optional:

```env
OPS_ALLOWED_EMAILS=person1@neontrip.de,person2@neontrip.de
OPS_PLACETEL_CONTACT_URL_TEMPLATE=<template>
```

## DNS

Aktueller oeffentlicher Befund:

- `neontrip.de` nutzt `ns.udag.*`.
- `neontrip.de` und `www.neontrip.de` zeigen auf Shopify.
- `anfrage.neontrip.de` zeigt auf Cloudflare Pages.
- `ops.neontrip.de` existiert noch nicht.

Fuer Coolify:

1. Bei United Domains einen DNS-Record fuer `ops.neontrip.de` setzen.
2. Wenn Coolify direkt erreichbar sein soll: `A` Record auf die Hetzner-Server-IP.
3. Wenn Cloudflare Access genutzt werden soll: Subdomain/Route so einrichten, dass Traffic ueber Cloudflare laeuft. Ohne Cloudflare-Proxy gibt es kein Cloudflare-Access-JWT.

## Zugriffsschutz

Zielzustand:

- `ops.neontrip.de/*` ist durch Cloudflare Access geschuetzt.
- App validiert `Cf-Access-Jwt-Assertion`.
- `OPS_REQUIRE_CLOUDFLARE_ACCESS=true`.
- Kein Token-Fallback.

Kurzfristig moeglich, aber nicht final:

- Coolify/Reverse-Proxy Basic Auth plus App-Token.
- `OPS_PORTAL_TOKEN` nur als Uebergang.
- Keine breite Verteilung der URL.

## Validierung

Vor Freigabe:

```bash
npm run check:ops-deploy
npm run check:ops-schema
npm audit --omit=dev
npx tsc --noEmit
npm run test:quotes
```

Nach Deploy, wenn Cloudflare Access aktiv ist:

```bash
OPS_SMOKE_EXPECT_PROTECTED=true node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

Danach mit erlaubtem Login:

```bash
node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

Browser-QA:

- `https://ops.neontrip.de/ops/customer-records`
- `https://ops.neontrip.de/ops/customer-records/calls`
- Kontakt suchen.
- Calls-Liste laden.
- Bild sichtbar.
- Segment bestaetigen/aendern.
- Rueckruf speichern.
- Tagesliste aktualisiert sich.
- Trello-Karte oeffnen.

## Rollback

- Coolify auf vorheriges Deployment zurueckrollen oder Application stoppen.
- DNS `ops.neontrip.de` entfernen oder auf vorherigen Zielhost setzen.
- Cloudflare Access nicht lockern, solange ein oeffentlicher Origin existiert.
- Datenbank-Migrationen nicht blind zurueckrollen.
