# NEONTRIP Shipping Agent

## Status

Stand: 2026-06-05

Der Shipping-Agent speichert Sendungen, Tracking-Events und Incidents in Supabase. Das Dashboard ist unter `/ops/customer-records/shipping` erreichbar. Trello/Tasks bleiben Projektionen; Supabase ist die Source of Truth.

Der n8n-Agent schreibt nicht mehr ueber die Ops-App/API, sondern direkt ueber Supabase REST/RPC. Damit kann die Ueberwachung weiterlaufen, auch wenn das Dashboard-Deployment nicht erreichbar ist.

## Datenquellen

- Shopify Fulfillments: Quelle fuer Order-, Fulfillment-, Carrier- und Trackingnummern.
- Shopify GraphQL Fulfillment Events: Quelle fuer `ATTEMPTED_DELIVERY`, `READY_FOR_PICKUP`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILURE` und weitere Fulfillment-Status, sofern Shopify diese Carrier-Events kennt.
- DHL/DPD Direkttracking: noch nicht aktiviert. Dafuer muessen Carrier-API-Credentials und Rate-Limits separat verifiziert werden.

## n8n Draft

Workflow: `NEONTRIP Shipping Agent v0.1`

Workflow-ID: `QtG2XHw7DsvOEPtQ`

Status: aktiv, validiert am 2026-06-05 mit 0 Fehlern und 5 Warnungen. Die Warnungen betreffen Code-Node-Fehlerpfade und eine n8n-Expression-Warnung im Shopify-GraphQL-Body.

Der Workflow ist auf den zentralen Error-Workflow `NEONTRIP Error Alerting v1.0` (`ArT3LN25Mb1PAuBE`) konfiguriert. Fehler-Executions werden gespeichert, Success-Executions nicht.

Der Draft nutzt diese bestehenden n8n-Credentials:

- Shopify Access Token Credential fuer Shopify REST und GraphQL Fulfillment Events.
- Supabase Header Auth Credential mit Service-Role-Rechten fuer REST/RPC.

Aktivierungsstand:

- Ein temporaerer Webhook-Smoke-Workflow mit denselben Shopify/Supabase-Schritten und Shopify-Limit 5 wurde zweimal erfolgreich ausgefuehrt.
- Supabase enthielt danach 5 reale Sendungen, 7 Tracking-Events und 3 Incidents fuer die Smoke-Sendungen.
- Replay-Check: 0 doppelte `shipment_key`, 0 doppelte `event_key`, 0 doppelte `incident_key`.
- Der temporaere Smoke-Workflow wurde deaktiviert und geloescht.
- Der produktive Schedule-Workflow wurde anschliessend aktiviert.

## Verifizierte Fixes

- `carrier_status_mapping_v2_20260605` verhindert, dass deutsche Negativtexte wie `nicht zugestellt` als `delivered` klassifiziert werden.
- Supabase-RPC-Check: `nicht zugestellt` und `Paket konnte nicht zugestellt werden` ergeben `delivery_failed`; `Ruecksendung zugestellt` ergibt `returned`; echte Zustellung bleibt `delivered`.
- Supabase-RPC-Write-Smoke: ein kuenstliches DPD-Fehler-Event erzeugte genau eine Sendung, genau ein Tracking-Event und genau einen dringenden `delivery_failed`-Incident. Der doppelte RPC-Aufruf blieb idempotent. Testdaten wurden danach geloescht.
- RPC-Funktionsrechte: `anon` und `authenticated` haben kein Execute-Recht; `service_role` hat Execute-Recht.
- Produktiv-Smoke ueber n8n: 5 reale Shopify-Sendungen wurden in Supabase geschrieben/aktualisiert; 3 Incidents wurden erkannt; keine Schluesselduplikate.

## Aktivierung

1. Workflow `QtG2XHw7DsvOEPtQ` ist aktiv und laeuft stuendlich.
2. Nach den ersten regulaeren Schedule-Laeufen n8n-Fehler-Executions und Supabase-Incident-Volumen pruefen.
3. `/ops/customer-records/shipping` als operative Queue nutzen.
4. Bei Fehlern Workflow deaktivieren und Rollback-Pfade unten nutzen.

## Rollback

- n8n: Workflow `QtG2XHw7DsvOEPtQ` deaktivieren.
- n8n Draft: lokales Backup `workflows/backups/neontrip-shipping-agent-v0.1.pre-supabase-rpc-20260605.json` wieder einspielen.
- DB RPC: Rollback in `supabase/rollbacks/202606050018_shipping_ops_rpc_rollback.sql`.
- DB Mapping-Fix: Rollback in `supabase/rollbacks/20260605151716_fix_shipping_negative_delivery_status_rollback.sql`.
- DB Schema: Rollbacks in `supabase/rollbacks/202606050016_create_shipping_ops_rollback.sql` und `supabase/rollbacks/202606050017_harden_shipping_ops_indexes_rollback.sql`.
- Code: Shipping-Routen und Dashboard-Unterpunkt koennen ohne Datenverlust entfernt werden, solange die DB-Tabellen bestehen bleiben.

## Grenzen

Shopify-Fulfillment-Events sind nur so gut wie die Carrier-Events, die Shopify empfaengt. Fuer vollstaendige DPD/DHL-Abdeckung braucht der Agent spaeter direkte Carrier-Polling-Schritte mit verifizierten Credentials.

Der aktuelle Draft sendet nur eine eng begrenzte automatische Kundenkommunikation: eine deterministische Abholbenachrichtigung bei `pickup_available`. Ruecklauf- und Zustellproblemfaelle werden intern gemeldet, aber nicht automatisch an Kunden kommuniziert.

## Benachrichtigungen

Ziel: Fruehwarnung, bevor Pakete zurueckgehen.

Automatische Kundenmail:

- Nur bei `pickup_available`.
- Empfaenger ist die Kunden-E-Mail aus der Sendung.
- Interne `@neontrip.de`- und `@neontrip.test`-Adressen werden blockiert.
- Text ist deterministisch, ohne KI-Freiformulierung.
- Inhalt: Paket liegt zur Abholung bereit, Trackingdaten/Ort falls vorhanden, Bitte zeitnah abholen, Signatur `Fabienne / NEONTRIP`.

Interne Warnung:

- Bei `delivery_failed`, `return_to_sender` und `returned`.
- Empfaenger: `info@neontrip.de`.
- Inhalt: Kunde, Request-ID, Shopify-Nummer, Carrier, Trackingnummer, letzter Carrier-Status und Link zum Shipping Board.
- Keine automatische Kundenmail bei Ruecklauf oder nicht zugestellt, weil der Fall zuerst intern geprueft werden muss.

Idempotenz:

- Supabase-Tabelle `shipping_notifications` ist die Source of Truth fuer Mail-Side-Effects.
- Kunden-Abholmail: ein Key pro Sendung, `customer:pickup_available:{shipment_id}`.
- Interne Warnung: ein Key pro Incident, `internal:delivery_problem:{incident_id}`.
- n8n claimt `pending` Notifications, sendet ueber Outlook und markiert danach `sent`.
- Wenn Outlook oder Markierung fehlschlaegt, bleibt der Eintrag retryfaehig und wird nach Stale-Timeout erneut geclaimt.

Rollback:

- n8n: Notification-Nodes entfernen oder Workflow auf `workflows/backups/neontrip-shipping-agent-v0.1.pre-notifications-20260605.json` zuruecksetzen.
- DB: `supabase/rollbacks/202606051840_create_shipping_notifications_rollback.sql`.
