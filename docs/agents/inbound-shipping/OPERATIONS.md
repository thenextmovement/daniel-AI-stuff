# Inbound Shipping Operations

## Betriebsmodell

Der normale Betrieb benoetigt keinen Agentenlauf:

- n8n startet beide Shipping-Workflows stuendlich.
- Das 17TRACK-Gate laesst nur 09:00, 11:00 und 13:00 Uhr Europe/Berlin passieren.
- Registrierung und Sync laufen als deterministische, begrenzte Claims aus Postgres.
- Der Diagnose-Agent wird nur bei Incident, Quota-Frage, Datenabweichung oder geplanter Aenderung aufgerufen.

Ein manuelles Starten der Workflows ist kein normaler Recovery-Schritt. Bei unklarem Provider-Ergebnis zuerst den persistierten Zustand und den Providerstatus abgleichen; nie blind replayen.

## Read-only Schnellcheck

1. Aktuellen Ops-Commit und Arbeitsbaum pruefen:

   ```bash
   git status --short --branch
   git rev-parse HEAD
   git log -5 --oneline
   ```

2. n8n fuer beide IDs im Modus `active` lesen und bestaetigen:

   - `active=true`
   - genau ein Schedule-Trigger
   - aktiver `17TRACK: Gate 09/11/13`
   - Gate -> Register -> Sync
   - `limit: 20`

3. Beide Workflows mit Strict-Profil validieren. Fehler blockieren jede Aenderung. Warnungen zu unerreichbaren Nodes, TLS und Retry bleiben bekannte Risiken und duerfen nicht als "gruen" ignoriert werden.

4. Datenbank nur aggregiert/read-only pruefen. Die eingebaute Funktion ist eine Row-Zaehlung, keine exakte Call-Zaehlung:

   ```sql
   select
     public.seventeen_track_daily_registration_count(now()) as rows_touched_today,
     public.seventeen_track_daily_registration_capacity(100, now()) as nominal_row_capacity;
   ```

5. Status-/Fehlerverteilung ohne Kunden- oder Trackingdaten auswerten:

   ```sql
   with registrations as (
     select 'inbound'::text as scope, status, last_error, last_attempt_at, next_attempt_at
     from public.inbound_tracking_registrations
     where provider = '17track'
     union all
     select 'outbound', status, last_error, last_attempt_at, next_attempt_at
     from public.shipping_tracking_registrations
     where provider = '17track'
   )
   select scope, status, coalesce(last_error, '') as error, count(*)::integer
   from registrations
   where last_attempt_at >= now() - interval '30 days'
   group by scope, status, coalesce(last_error, '')
   order by count(*) desc;
   ```

6. Faellige Rows nur zaehlen, nicht anzeigen:

   ```sql
   select 'inbound' as scope, count(*)::integer as due
   from public.inbound_tracking_registrations
   where provider = '17track'
     and status in ('pending', 'failed', 'rejected')
     and coalesce(next_attempt_at, now()) <= now()
   union all
   select 'outbound', count(*)::integer
   from public.shipping_tracking_registrations
   where provider = '17track'
     and status in ('pending', 'failed', 'rejected')
     and coalesce(next_attempt_at, now()) <= now();
   ```

Diese Queries duerfen keine Raw Responses, Trackingnummern, Namen, E-Mails oder Secret-Werte in Tickets oder Agentendokumente kopieren.

## Diagnosematrix

| Symptom | Wahrscheinlicher Zustand | Read-only Pruefung | Erlaubter naechster Schritt |
| --- | --- | --- | --- |
| `Quota is not enough for use.` | Provider-Quota leer | Fehleraggregation, Provider-Dashboard manuell | Account Owner entscheidet Kauf; danach naechstes regulaeres Fenster beobachten. |
| Viele `registering` > 30 Minuten | Route/Provider-Antwort abgebrochen | Count nach Status und Alter | Ursache klaeren; normaler Claim darf stale Rows spaeter uebernehmen. Kein Blind-Trigger. |
| `failed`/`rejected`, `next_attempt_at` faellig | Retry wartet auf Zeitfenster | Due-Counts und Gate-Zustand | Naechstes 09/11/13-Fenster beobachten. |
| Registrierung `accepted`, kein Event | Provider kennt Nummer, noch kein verwertbares Event | Registration-Status, Shipment `next_check_at`, Incident-Typ | Sync-Fenster abwarten; `recorded_no_events` ist ein gueltiger Zustand. |
| Trackingfehler bleibt nach Acceptance offen | Cleanup/Incident-Aufloesung fehlgeschlagen | Registration + Incident nur aggregiert oder gezielt durch Operator | Manuell fachlich pruefen; keine Statusmutation durch Diagnose-Agent. |
| Workflow aktiv, keine gespeicherte Execution | Success-Speicherung/Retention liefert keine Historie | Published Graph + DB-Zeitstempel | Nicht als Erfolg werten; durable Receipt-Luecke dokumentieren. |
| Lieferschein-/Shopify-Link fehlerhaft | Datenmatch oder PDF-Quelldaten fehlen | Board-API/Codepfad und konkrete Row durch berechtigten Operator | Incident/Task anlegen; keine geratenen Order-Verknuepfungen schreiben. |

## Quota wieder verfuegbar

Nach einem manuell bestaetigten Quota-Kauf:

1. Keine Workflows manuell triggern.
2. Vor dem naechsten Fenster nominale Kapazitaet und Due-Counts read-only erfassen.
3. Das naechste regulaere Fenster beobachten.
4. Danach Statusverteilung, neue Acceptance und Quota-Fehler aggregiert vergleichen.
5. Bei unklarem HTTP-Ausgang keine erneute POST-Ausfuehrung erzwingen; erst Registration-Row und Providerkonto abgleichen.
6. Beachten: maximal 20 Rows pro normalem Inbound- und 20 pro normalem Outbound-Aufruf, aber n8n-HTTP-Retries koennen bei Transportfehlern weitere Route-Aufrufe ausloesen.

## Ausnahmebearbeitung im Ops-Board

- `Aufgabe`: erzeugt oder verknuepft eine interne Aufgabe ueber `sourceRef=inbound_shipping_incident:{incident_id}`.
- `Gesehen`: setzt den Incident auf `acknowledged`.
- `Erledigt`: setzt `resolved` und `resolved_at`.
- `Ignorieren`: setzt `ignored` und `resolved_at`.
- `In Zustellung`: schreibt ein idempotentes manuelles Carrier-Event und verschiebt den Check um vier Stunden.
- `Lieferschein`: generiert ein PDF aus persistierten Shipment-/Offer-Daten; der Download hat `private, no-store`.

Statusaktionen sind produktive Mutationen und bleiben menschliche Operatoraktionen. Der Diagnose-Agent darf nur die passende Aktion vorschlagen.

## Fokus-Tests

```bash
npm ci --ignore-scripts
node --import tsx --test tests/quotes/seventeen-track.test.ts tests/quotes/inbound-shipping-route.test.ts
```

Vor einer Produktlogik-Aenderung zusaetzlich:

```bash
npm run test:quotes
npx tsc --noEmit
npm run build
```

Ein frischer, exakt zum verifizierten Commit gehoerender CI-Build kann den lokalen Full Build ersetzen; die fokussierten Tests sollen trotzdem laufen.

## Sichere Aenderungsreihenfolge

1. `codex-new-worktree ops <topic>`.
2. Aktuellen Main-Stand und Scope erfassen.
3. Bei n8n: aktive Published Version vollstaendig exportieren; Version-ID und Aktivstatus festhalten.
4. Bei DB: betroffene Funktionen/Constraints sichern, Vorab-Counts erheben und Rollback-SQL vorbereiten.
5. Kandidat nur inaktiv beziehungsweise lokal aendern.
6. Struktur-Diff, Strict Validation, Replay-, Race-, Timeout-, Quota- und Rollback-Test ausfuehren.
7. Nur Task-Dateien committen; keine Secrets, Exports mit Credentials oder Execution-Payloads.
8. Push/Deploy nur nach ausdruecklicher Freigabe mit `codex-safe-push-main` und danach zwingend `codex-predeploy ops`.
9. Nur den vom Predeploy ausgegebenen Commit deployen.

## Rollback

### n8n

- Neuen Trigger deaktivieren, bevor eine alte Version restauriert wird.
- Vorherige vollstaendige Published Version wiederherstellen, Verbindungen/Nodezahl vergleichen und strict validieren.
- Nur nicht quittierte DB-Jobs erneut verarbeiten; keine externen Side Effects blind wiederholen.

### Quota-Migration

- Rollback-Datei: `supabase/rollbacks/20260702162807_add_17track_daily_registration_cap_rollback.sql`.
- Sie entfernt den nominellen Tagesrahmen und stellt uncapped Claim-Funktionen wieder her. Das erhoeht unmittelbar das Kostenrisiko und ist kein Standard-Recovery-Schritt.
- Vor Anwendung: Backup, Function-Diff, Due-Counts, explizite Freigabe und getesteter Reapply-Pfad.

### Inbound-Fundament

- Basisschema-Rollback: `supabase/rollbacks/20260605201640_create_inbound_shipping_ops_rollback.sql`.
- 17TRACK-, Cleanup-, Mapping- und Sync-Migrationen haben korrespondierende Rollback-Dateien. Abhaengigkeiten in umgekehrter Reihenfolge behandeln.
- Ein Schema-Rollback kann operative Historie entfernen und darf nur nach Datenbackup und Impact-Pruefung erfolgen.

### App

- Exakten fehlerhaften Commit revertieren, Tests ausfuehren, ueber `codex-predeploy ops` den Rollback-Commit bestimmen und erst nach Freigabe deployen.

## Runtime-Variablennamen

Nur Namen, keine Werte:

- `SEVENTEEN_TRACK_API_TOKEN`, Fallbacks `TRACK17_API_TOKEN`, `INBOUND_17TRACK_API_TOKEN`
- `SEVENTEEN_TRACK_WEBHOOK_TOKEN`, Fallback `INBOUND_17TRACK_WEBHOOK_TOKEN`
- `OPS_INTERNAL_API_KEY`, Fallbacks `QUOTE_INTERNAL_API_TOKEN`, `INTERNAL_API_KEY`
- serverseitige Supabase-Konfiguration gemaess bestehender Ops-Runtime

Secret-Werte duerfen weder in Workflow-JSON, Dokumentation, Logs noch Chat-Ausgaben erscheinen.
