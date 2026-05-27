# Go-Live Status 2026-05-27

Ziel: `Customer Records` und `Sales Calls` intern produktionsnah bereitstellen, nicht als dauerhaften Laptop-/Quick-Tunnel-Betrieb.

## Heute erledigt

- Sales-Call-Tagesliste stabilisiert: Downstream-Kontexte werden gedrosselt geladen, damit Supabase-REST bei grossen Listen nicht durch zu viele parallele Requests ausfaellt.
- Fresh-Sales-Calls-Refresh erfolgreich getestet:
  - `itemCount`: 20
  - `allowed`: 20
  - `withVisuals`: 20
  - Bildquellen: `crm_quote_image`, `followup_mockup`, `trello_mockup`, `trello_reference`
- Quick-Tunnel fuer Kolleginnen-Test wiederhergestellt.
- Smoke-Test gegen den Tunnel erfolgreich:
  - `/ops/customer-records`
  - `/ops/customer-records/calls`
  - `/api/ops/customer-records/calls`
  - `/api/ops/customer-records?query=<request-id>`
- Produktions-Auth gehaertet: Wenn `OPS_REQUIRE_CLOUDFLARE_ACCESS=true` gesetzt ist, wird der Token-Fallback nicht mehr akzeptiert.
- Smoke-Skript erweitert: `OPS_SMOKE_EXPECT_PROTECTED=true` prueft, dass ein externer Ops-Host ohne Cloudflare-Access-Login geblockt ist.
- Lokaler Smoke-Test gegen `http://127.0.0.1:3104` ist gruen.
- `npm audit --omit=dev` meldet `found 0 vulnerabilities`.
- `cloudflared tunnel list` blockiert weiterhin, weil kein lokales Origin-Zertifikat vorhanden ist. Ein named Tunnel fuer `ops.neontrip.de` kann von dieser Shell aus erst nach Cloudflare-Login/Origin-Zertifikat erstellt werden.
- Hosting-Ziel konkretisiert: bestehender Hetzner/Coolify-Server statt Render als bevorzugter Weg.
- `docker build -f Dockerfile.ops -t neontrip-ops-coolify-check .` ist gruen. Der Coolify-Dockerfile-Pfad ist lokal validiert.

## Aktueller Nutzungsstand

- Lokale Entwicklung laeuft ueber Next.js Server Runtime.
- Der aktuelle Quick-Tunnel ist nur ein Preview-/Testweg und nicht fuer dauerhafte interne Nutzung gedacht.
- Ops-Token bleibt nur fuer Preview/Tunnel. Er gehoert nicht in Dateien und nicht in Production.
- Fuer Production ist `ops.neontrip.de` mit Cloudflare Access der Zielzustand.

## Funktionaler Stand

- Calls-Seite hat die gewuenschten Arbeitsbereiche:
  - `Neue Anfragen`
  - `Erste Angebote gesendet`
  - `Meine Anrufe`
- Suche fuer Kontakte ausserhalb der Tagesliste ist vorhanden.
- Ad-hoc-Anrufe koennen ohne Call-List-Item gespeichert werden.
- Call-Ergebnis kann Kunden aus der Tagesliste entfernen oder in Rueckruf-/Reminder-Status schieben.
- Segment wird in der Calls-Ansicht sichtbar und kann bestaetigt/geaendert werden.
- VIP/wichtig ist in der Liste sichtbar und priorisierbar.
- CC-E-Mails werden auf Customer-Ebene gespeichert.
- Trello-Bilder und Follow-up-Mockups werden fuer die Tagesliste als stabile Bildkandidaten genutzt.

## Noch offen vor internem Production-Go-live

1. Aktuellen Ops-Code in ein fuer Coolify erreichbares Git-Repo bringen oder anderweitig in Coolify bereitstellen.
2. Coolify Application mit `Dockerfile.ops`, Port `3000` und Domain `ops.neontrip.de` anlegen.
3. Secrets in Coolify-Env setzen:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TRELLO_API_KEY`
   - `TRELLO_TOKEN`
   - `OPS_CLOUDFLARE_ACCESS_ISSUER`
   - `OPS_CLOUDFLARE_ACCESS_AUD`
   - `OPS_REQUIRE_CLOUDFLARE_ACCESS=true`
4. DNS `ops.neontrip.de` bei United Domains auf den Hetzner/Coolify-Origin setzen.
5. Cloudflare Access Application fuer `ops.neontrip.de/*` anlegen, falls die Subdomain ueber Cloudflare geroutet wird.
6. Erlaubte Mitarbeiter-E-Mails oder Gruppen im Zugriffsschutz hinterlegen.
7. Schutztest ausfuehren:

```bash
OPS_SMOKE_EXPECT_PROTECTED=true node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

8. Eingeloggten Smoke-Test und Realfall-QA ausfuehren:

```bash
node scripts/smoke_customer_records_ops.mjs https://ops.neontrip.de
```

9. Realfall-QA mit Kollegin:
   - Login
   - Kontakt suchen
   - Bild sichtbar
   - Segment bestaetigen/aendern
   - Rueckruf speichern
   - Tagesliste aktualisiert sich
   - Trello-Karte oeffnen und Feld bearbeiten

## Rollback

- Hosting-Deployment auf vorherige Version zuruecksetzen.
- Cloudflare DNS/Access-Route fuer `ops.neontrip.de` deaktivieren oder auf vorherigen Origin stellen.
- `OPS_REQUIRE_CLOUDFLARE_ACCESS=true` nicht entfernen, solange ein oeffentlicher Host existiert.
- Datenbank-Migrationen nicht blind zurueckrollen; erst pruefen, ob `cc_emails` oder Call-Bild-Snapshots bereits Daten enthalten.
