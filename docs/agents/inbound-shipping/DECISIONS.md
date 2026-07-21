# Inbound Shipping Decisions

## Dauerhafte Entscheidungen

| Entscheidung | Status | Konsequenz |
| --- | --- | --- |
| Wiederkehrende 17TRACK-Arbeit ist ein deterministischer Loop, kein Agentenjob. | `[verifiziert]` | n8n startet feste App-/RPC-Pfade; `agent.json` hat `schedule_supported=false`. |
| Das Agentenprofil dient nur Diagnose und Ausnahmen. | `[verifiziert]` | Keine Provideraufrufe, Trigger, Aktivierungen, Kaeufe oder Kundenkommunikation. |
| Postgres ist nach der Aufnahme die operative Source of Truth. | `[verifiziert]` | Registrierungs-, Event-, Incident- und Notification-Zustand wird dort entschieden und dedupliziert. |
| Trello darf langfristig nur Projektion sein. | `[verifiziert]` Zielentscheidung | Der aktuelle Trello-Kandidaten-Intake ist als `source_of_truth_review_required` markiert und muss spaeter ersetzt werden. |
| 17TRACK laeuft nur um 09:00, 11:00 und 13:00 Europe/Berlin. | `[verifiziert]` | Beide aktiven Graphen nutzen ein explizites Zeitzonen-Gate hinter einem stuendlichen Trigger. |
| Pro normalem Route-Aufruf werden 20 Rows bearbeitet. | `[verifiziert]` | n8n sendet `limit:20`; die Route akzeptiert 1 bis 50. |
| Der gemeinsame Tagesrahmen ist nominell 100 Registrierungs-Rows. | `[verifiziert]` mit Einschraenkung | Advisory Lock verhindert paralleles Ueberschreiten fuer neu/aktuell gezaehlte Rows; der Mechanismus ist kein exakter API-Call-Cap. |
| Provider-Registrierung ist pro Sendung/Provider idempotent. | `[verifiziert]` | Unique Row und stabiler `registration_key`; Providerantwort `already registered` gilt als akzeptiert. |
| Tracking-Events muessen replay-sicher sein. | `[verifiziert]` | Persistierte `event_key`-Deduplizierung; Latest-Status-Snapshots erhalten stabile Keys. |
| Akzeptierte 17TRACK-Registrierung ersetzt den direkten Inbound-Trackingpfad. | `[verifiziert]` | Direkter Claim wird fuer akzeptierte Rows unterdrueckt; alte direkte DHL/FedEx-Nodes sind aktuell unerreichbar. |
| Ausnahmen werden intern bearbeitet. | `[verifiziert]` | Trackingfehler erzeugen Incidents; Aufgaben sind idempotent. Keine 17TRACK-Fehlermeldung darf ungeprueft an Kunden gehen. |
| Quota-Kauf ist eine menschliche Account-Owner-Aktion. | `[verifiziert]` | Diagnose darf Bedarf schaetzen, aber keine kostenpflichtige Aktion ausloesen. |
| Direkte DHL-/DPD-APIs bleiben eine moegliche Alternative, nicht der aktuelle Hauptpfad. | `[historisch verifiziert]` | Business-Zugaenge wurden erwaehnt; Credentials und produktive Integration sind nicht belegt. |

## Quota-Entscheidung und ihre Grenze

Die Migration `20260702162807_add_17track_daily_registration_cap.sql` wurde als kombinierte Drossel fuer Inbound und Outbound eingefuehrt:

1. Berliner Tagesgrenzen werden DST-sicher aus `p_now` berechnet.
2. Inbound und Outbound teilen eine nominelle Kapazitaet von 100.
3. Ein Advisory Transaction Lock serialisiert beide Claim-Funktionen.
4. Jeder Claim setzt `last_attempt_at`, `attempts`, `registering` und eine 30-Minuten-Lease.

`[verifiziert]` Die Implementierung zaehlt jedoch Rows mit `last_attempt_at` im Tag, nicht jeden Versuch. Dieselbe Row kann am selben Tag mehrfach bei `/register` landen, ohne den Count erneut zu erhoehen. Zusaetzlich kann `refresh17TrackRegistrationIfNeeded` waehrend des Inbound-Syncs `/register` aufrufen, ohne vorher Kapazitaet zu claimen. Die Bezeichnung "Hard Cap 100 API-Versuche" ist deshalb verworfen; korrekt ist "nomineller Tagesrahmen fuer unterschiedliche aktuell versuchte Registrierungs-Rows".

## Carrier-Entscheidungen

- `[verifiziert]` Inbound: DHL Express (`100001`) und FedEx (`100003`).
- `[verifiziert]` Historische DHL-Paket-ID `7041` wird auf DHL Express normalisiert und kann einen Refresh ausloesen.
- `[verifiziert]` Outbound: DHL mit fester ID, DPD mit Carrier `0` zur Provider-Erkennung.
- `[verifiziert]` Unbekannte/sonstige Inbound-Carrier werden nicht durch den 17TRACK-Registrierungsclaim aufgenommen.

## Historische Entscheidungen und Ereignisse

| Datum / Commit | Entscheidung oder Befund | Heutige Einordnung |
| --- | --- | --- |
| 2026-06-05 / `6e439fe` | Inbound Shipping Fundament, Board und Postgres-Modell | `[verifiziert]` im aktuellen Main enthalten. |
| 2026-06-06 / `a3ceb55`, `e3c9524`, `f6c584a` | 17TRACK-Registrierung, Batching, Incident-Cleanup | `[verifiziert]` im aktuellen Main enthalten. |
| 2026-06-07 / `12408ec`, `68c6306` | Tracking-Sync und stabile Snapshot-Event-Keys | `[verifiziert]` im aktuellen Main enthalten. |
| 2026-06-16 / `13b3ae3` bis `53c3065` | DHL-Carrier-Korrektur, leere Snapshots, Refresh, Already-Registered | `[verifiziert]` im aktuellen Main enthalten. |
| 2026-06-17/29 / `460354c`, `036321c`, `0a238b9` | Idempotentes manuelles Zustellen, Lieferschein, Link-/PDF-Haertung | `[verifiziert]` im aktuellen Main enthalten. |
| 2026-06-23 / `6574dae` | Outbound DHL/DPD ueber 17TRACK | `[verifiziert]` im aktuellen Main enthalten. |
| 2026-07-02 / `9ab2081` | 09/11/13-Drossel und gemeinsamer nomineller Tagesrahmen | `[verifiziert]` Code/Migration; historischer CI-/Deploy-Lauf erfolgreich. |
| 2026-07-15 | 52 quota-bedingt abgelehnte Rows; kleinste Kaufoption diskutiert | `[historisch verifiziert]`; heutiger Stand offen, kein Kaufbeleg. |
| 2026-07-21 | Agent-Handoff ordnet Schedule als Loop und Agent als Diagnoseprofil ein | `[verifiziert]` nur Dokumentationsentscheidung, keine Produktmutation. |

## Nicht getroffene Entscheidungen

- Kein Wechsel auf direkte DHL-/DPD-APIs wurde beschlossen oder implementiert.
- Kein aktueller 17TRACK-Tarif oder Kauf wurde in dieser Migration bestaetigt.
- Keine automatische Quota-Aufladung und kein automatischer manueller Retry wurden freigegeben.
- Keine Abschaltung der unerreichbaren direkten DHL-/FedEx-Nodes wurde vorgenommen.
- Keine Produktlogik wurde im Rahmen dieses Handoffs korrigiert.
