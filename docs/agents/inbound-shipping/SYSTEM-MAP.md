# Inbound Shipping System Map

## Besitz- und Source-of-Truth-Grenzen

| Bereich | Aktueller Zustand | Evidenz / Ziel |
| --- | --- | --- |
| Inbound-Sendungen, Status und naechster Check | Ops Supabase `inbound_shipments` | `[verifiziert]` Kanonischer operativer Zustand nach Aufnahme. |
| 17TRACK-Registrierungen | `inbound_tracking_registrations` und `shipping_tracking_registrations` | `[verifiziert]` Eine stabile Row pro Sendung/Provider; Status und Retry-Zeit werden persistiert. |
| Tracking-Ereignisse | `inbound_tracking_events` beziehungsweise Shipping-Events | `[verifiziert]` Event-Keys dienen der Replay-Deduplizierung. |
| Ausnahmezustand | `inbound_incidents` | `[verifiziert]` Board und interne Aufgaben werden daraus abgeleitet. |
| Interne Benachrichtigungen | `inbound_notifications` / Shipping-Notification-Tabellen | `[verifiziert]` Durable Queue vor Outlook-Side-Effects. |
| Neue Inbound-Kandidaten | Aktuell Trello-Liste `sign shipped` | `[verifiziert]` Architekturabweichung: Capability-Manifest fordert DB-Loop mit Trello nur als Projektion. |
| Outbound-Sendungen | Shopify-Projektion in Ops Shipping-Tabellen | `[verifiziert]` 17TRACK registriert nur gespeicherte, aktuelle DHL-/DPD-Sendungen. |
| Zeitsteuerung | n8n | `[verifiziert]` Transport/Schedule, keine fachliche Autoritaet. |
| Providerstatus | 17TRACK-Antworten/Webhook, danach normalisiert in Postgres | `[verifiziert]` Externe Quelle fuer Carrier-Ereignisse; Postgres speichert den operativen Zustand. |
| Agent Control Tower | Diagnose-/Ausnahmeprofil | `[verifiziert]` Kein Scheduler und kein Side-Effect-Executor. |

## Deterministischer Loop

```text
n8n Every Hour
  -> Gate Europe/Berlin [09, 11, 13]
  -> POST /api/internal/.../17track-register {limit:20}
  -> Postgres claim RPC + lease/next_attempt_at
  -> 17TRACK /register (batch <= 40)
  -> record registration result + tracking_error incident on failure
  -> POST /api/internal/.../17track-sync {limit:20}
  -> Postgres claim accepted due shipments
  -> 17TRACK /gettrackinfo (sequential, 450 ms spacing)
  -> persist events/status + evaluate/resolve incidents
```

Der Agent steht ausserhalb dieses Pfads:

```text
Operator / Control Tower
  -> read-only Diagnose
  -> Evidenz + Risikoklasse + vorgeschlagener Runbook-Schritt
  -> Mensch bestaetigt jede Mutation
  -> deterministischer Executor fuehrt freigegebene Aktion aus
```

## Inbound-Datenfluss

1. `[verifiziert]` Der aktive n8n-Workflow liest Trello-Board, `sign shipped`-Liste und Custom Fields und ruft `inbound_record_trello_candidates` auf.
2. `[verifiziert]` Die RPC normalisiert Carrier/Trackingnummer und upsertet die Sendung idempotent.
3. `[verifiziert]` Um 09:00, 11:00 und 13:00 Europe/Berlin claimt `inbound_claim_due_17track_registrations` hoechstens 20 Rows pro normalem Route-Aufruf.
4. `[verifiziert]` Die App registriert den Batch bei 17TRACK. `already registered` wird als akzeptiert behandelt.
5. `[verifiziert]` Fehler setzen `failed`/`rejected`, `next_attempt_at = now() + 1 hour` und erzeugen beziehungsweise aktualisieren einen `tracking_error`-Incident.
6. `[verifiziert]` Akzeptierte Registrierungen werden durch `inbound_claim_due_17track_tracking_shipments` fuer den Sync geclaimt; `next_check_at` wird um eine Stunde verschoben.
7. `[verifiziert]` `gettrackinfo` wird in der App sequentiell verarbeitet. Events laufen in `inbound_record_carrier_response`, werden normalisiert und idempotent gespeichert.
8. `[verifiziert]` Akzeptierte Registrierung beziehungsweise erfolgreicher Sync bereinigen passende offene 17TRACK-Trackingfehler.
9. `[verifiziert]` Ein separater authentifizierter Webhook kann Inbound-Events liefern; fehlen Events, fragt die Route einmal `gettrackinfo` nach.

## Outbound-Datenfluss

1. `[verifiziert]` Der Shipping-Workflow projiziert aktuelle Shopify-Fulfillments in Ops.
2. `[verifiziert]` `shipping_claim_due_17track_registrations` beruecksichtigt nur aktuelle, nicht abgeschlossene DHL-/DPD-Sendungen mit Trackingnummer.
3. `[verifiziert]` Registrierung und Ergebnisaufzeichnung verwenden dieselbe TypeScript-Implementierung wie Inbound, aber Shipping-RPCs und Shipping-Incidents.
4. `[verifiziert]` Akzeptierte Rows werden ueber `shipping_claim_due_17track_tracking_shipments` synchronisiert und als Shipping-Events persistiert.

## Aktuelle n8n-Laufzeitstruktur

| Workflow | Published Version | Aktiv | Trigger | 17TRACK-Pfad | Strict Validation |
| --- | --- | --- | --- | --- | --- |
| `rYmSl4D0nNmEEU0M` Inbound | `18429ec6-e647-4c97-bd05-0f0e5ae794e7` | `[verifiziert]` ja | stuendlich | Gate -> Register Inbound -> Sync Inbound | 0 Fehler, 28 Warnungen |
| `QtG2XHw7DsvOEPtQ` Shipping | `3d967102-34ff-4f36-abf9-532ffb5f8d2f` | `[verifiziert]` ja | stuendlich | Gate -> Register Outbound -> Sync Outbound | 0 Fehler, 19 Warnungen |

- `[verifiziert]` Beide gespeicherten Graphen haben 27 Nodes; die Strict-Validierung zaehlt jeweils 26 aktivierte ausfuehrbare Nodes und einen Trigger.
- `[verifiziert]` Beide 17TRACK-Zweige verwenden interne `coolify-proxy`-URLs, `limit: 20`, 30 Sekunden Timeout, `retryOnFail=true`, `maxTries=3` und deaktivierte TLS-Zertifikatspruefung.
- `[verifiziert]` Der Inbound-Validator meldet zehn nicht vom Trigger erreichbare direkte DHL-/FedEx-Nodes. Der aktive 17TRACK-Zweig ist erreichbar.
- `[verifiziert]` Erfolgreiche Executions werden nicht dauerhaft gespeichert; die read-only Execution-Liste lieferte fuer beide Workflows keine Rows. Das beweist weder einen Fehler noch einen erfolgreichen letzten Zeitfensterlauf.

## Datenmodell

| Tabelle | Aufgabe | Idempotenz / Zustand |
| --- | --- | --- |
| `inbound_shipments` | Kanonische Inbound-Sendung | `shipment_key`, Status, Risiko, Check-Zeit |
| `inbound_tracking_registrations` | Provider-Registrierung Inbound | Unique `(shipment_id, provider)`, `registration_key`, Attempts/Retry |
| `inbound_tracking_events` | Carrier-Ereignisse | `event_key` verhindert Duplikate |
| `inbound_incidents` | Deterministische Ausnahmen | `incident_key`, Status, Schwere, Task-Link |
| `inbound_notifications` | Interne Mailqueue | Claim/Status/Retry vor Outlook |
| `shipping_tracking_registrations` | Provider-Registrierung Outbound | Unique `(shipment_id, provider)`, gleiche Statusmaschine |

Alle genannten Registrierungstabellen haben RLS; die relevanten Funktionen entziehen `public`, `anon` und `authenticated` das Execute-Recht und erteilen es `service_role`.

## App-Einstiegspunkte

| Zweck | Pfad |
| --- | --- |
| Inbound UI | `src/app/ops/customer-records/inbound-shipping/page-client.tsx` |
| Inbound Board/API | `src/app/api/ops/customer-records/inbound-shipping/route.ts` |
| Inbound Domain/UI-Aufbereitung | `src/lib/ops/inbound-shipping.ts` |
| 17TRACK Adapter | `src/lib/ops/seventeen-track.ts` |
| Inbound Register | `src/app/api/internal/inbound-shipping/17track-register/route.ts` |
| Inbound Sync | `src/app/api/internal/inbound-shipping/17track-sync/route.ts` |
| Inbound Webhook | `src/app/api/internal/inbound-shipping/17track-webhook/route.ts` |
| Outbound Register | `src/app/api/internal/shipping/17track-register/route.ts` |
| Outbound Sync | `src/app/api/internal/shipping/17track-sync/route.ts` |

## Ausnahmebearbeitung

- `[verifiziert]` Das Board zeigt aktive/problembelastete Sendungen, Status, letztes Event, Bild-/Shopify-Verknuepfung und Incidents.
- `[verifiziert]` Operatoraktionen: interne Aufgabe idempotent anlegen, Incident bestaetigen, erledigen oder ignorieren, Sendung idempotent als `out_for_delivery` markieren und Lieferschein-PDF laden.
- `[verifiziert]` Aufgaben verwenden `inbound_shipping_incident:{incident_id}` als `sourceRef`; Trello wird nicht zur Task-Idempotenz verwendet.
- `[verifiziert]` Manuelles `out_for_delivery` nutzt einen stabilen Event-Key und schreibt danach den naechsten Check-Zeitpunkt.
- `[offen]` Statusaenderungen `acknowledged/resolved/ignored` haben kein eigenes append-only Audit-Ledger; vorhanden sind App-Logs und Row-Zeitstempel.

## Auth- und Secret-Grenzen

- Interne Register-/Sync-Routen akzeptieren nur einen ausreichend langen konfigurierten internen Key per Bearer oder Header; Variablennamen stehen in [OPERATIONS.md](./OPERATIONS.md).
- Der 17TRACK-Webhook hat einen separaten Token und ein Body-Limit von 1 MB.
- Die Ops-UI/API verlangt eine Ops-Session beziehungsweise den ausschliesslich ausserhalb Produktion erlaubten Local Bypass.
- Secret-Werte gehoeren nur in Runtime-Credentials/Environment. Dieses Paket enthaelt keine Werte.
