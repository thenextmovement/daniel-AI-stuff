# Exportversand/Schweiz Decisions

## Fachlich bestätigte Anforderungen aus dem Ursprungschat

| Entscheidung | Status | Konsequenz |
| --- | --- | --- |
| Mitarbeiter startet den Exportversand bewusst aus der Shipping-Software. | `[verifiziert]` | Kein unbeaufsichtigter Poller darf Labels kaufen. |
| Shopify-Order wird vom Mitarbeiter angegeben und serverseitig geladen. | `[verifiziert]` | Keine heuristische Orderwahl ohne eindeutigen Treffer. |
| Firmenadresse, eigene USt-ID und EORI werden einmalig gepflegt. | `[verifiziert]` | Stammdaten gehören in eine geschützte DB, nicht in Code oder Prompt. |
| Kunden-UID/USt-ID ist ein manuelles Feld. | `[verifiziert]` | Im Prototyp für B2B Pflicht; fachliche Ausnahmefälle müssen noch beschlossen werden. |
| Warenbeschreibung, Warentarifnummer, Ursprung und Gewicht werden je Position geprüft. | `[verifiziert]` | Shopify-/SKU-Werte sind Vorschläge; der freigegebene Snapshot ist maßgeblich. |
| Paketmaße, Bruttogewicht und Verpackungswert werden manuell ergänzt. | `[verifiziert]` | Werte müssen vor Carrier-Side-Effect validiert und in Rechnung/Audit gespeichert werden. |
| Ergebnis sind DPD-Label und Handelsrechnung als Downloads. | `[verifiziert]` | Beide Dokumente brauchen private Ablage, Integritätsprüfung und nachvollziehbare Herkunft. |
| Tracking wird in Shopify geschrieben und kann die Shopify-Mail auslösen. | `[verifiziert]` | Shopify-Schreiben und Kundenmail bleiben getrennte Freigabegates. |
| Handelsrechnung sollte möglichst im DPD-Prozess ausgefüllt werden. | `[verifiziert]` | Der historische Cloud-Pfad erfüllt nur ein lokales PDF, keine belegte myDPD-interne Ablage. Diese Abweichung bleibt offen. |

## Historische Architekturentscheidungen des Prototyps

Diese Entscheidungen sind dokumentiert und getestet, aber nicht in `origin/main` übernommen.

| Entscheidung | Begründung | Status |
| --- | --- | --- |
| DPD Cloud statt klassischem Shipment Service 4.5 | offizielle DPD-Seite verweist myDPD Business auf Cloud | `[historischer Prototyp]`, extern am 2026-07-21 erneut bestätigt |
| Handelsrechnung lokal erzeugen | kein belastbarer Cloud-Vertrag für Zoll-/Rechnungsupload nachgewiesen | `[historischer Prototyp]` |
| Phase 1 nur `CH`, ein Paket, eine offene Fulfillment Order, alle offenen Items | Scope und Idempotenz begrenzen | `[historischer Prototyp]` |
| Shopify vor Prepare serverseitig neu lesen | stale/manipulierte Browserdaten nicht vertrauen | `[historischer Prototyp]` |
| kanonischer Snapshot plus SHA-256 | Freigabe an unveränderte Eingaben binden | `[historischer Prototyp]` |
| Postgres als Job-/Idempotenz-SoT | deterministische Zustände und Audits | `[historischer Prototyp]` |
| private PDFs, Download nur über Ops-Route | keine öffentlichen Handels-/Kundendokumente | `[historischer Prototyp]` |
| kein Retry nach unklarem Providerausgang | Doppelkäufe und Doppelfulfillment verhindern | `[historischer Prototyp]` |
| Shopify Write nur bei DPD-Produktionsmodus | Sandboxlabel darf keine reale Order erfüllen | `[historischer Prototyp]` |
| Cloudflare-Access-Identität für Side Effects | Kosten-/Kundenaktion eindeutig einem Mitarbeiter zuordnen | `[historischer Prototyp]` |
| KI nicht im kritischen Pfad | AI schlägt höchstens vor; deterministische Logik führt aus | `[historischer Prototyp]` |

## Entscheidungen aus dem aktuellen `main`, die zu respektieren sind

- `[verifiziert]` Arrival-Labels nach Schweiz/Nicht-EU sind manuell und dürfen den dortigen EasyDPD-Worker nicht erreichen.
- `[verifiziert]` Der vorhandene EasyDPD-Worker nutzt mehrere unabhängige Live-Schalter, eine Produkt-Allowlist, eine Preisobergrenze und `dispatching` vor dem Kauf.
- `[verifiziert]` Nach einer unsicheren Kaufgrenze führt der aktuelle Worker in `manual_review`, nicht in automatischen Retry.
- `[verifiziert]` EasyDPD kann im Arrival-Scope Shopify erfüllen und die Kundenmail auslösen; eine zweite Shopify-Mutation wäre gefährlich.
- `[verifiziert]` Trello ist nur Zuordnungs-/Projektionshilfe; Shopify und Postgres bleiben die fachlichen Quellen.

## Noch zu treffende Entscheidungen

1. `Provider`: DPD Cloud oder neuer, separat qualifizierter EasyDPD-Exportpfad.
2. `Handelsrechnung`: Reicht ein lokales PDF oder ist myDPD-interne Speicherung zwingend?
3. `Versandprodukt`: exakter Schweizer Service, Tarif, Gewichts-/Größenregeln und Zuschläge.
4. `Incoterm/Steuer`: erlaubte Incoterms und verantwortete Darstellung von Waren-, Verpackungs- und Frachtwerten.
5. `Kunden-UID`: Pflichtregel für B2B sowie dokumentierte Ausnahme für Kunden ohne UID.
6. `Rechnungsadresse`: eigene Billing-Adresse oder bewusst geprüfte Versandadresse.
7. `Retention`: Rechtsgrundlage, Aufbewahrungsfrist, Löschverantwortung und Export/Audit bei Kunden-/Zolldaten.
8. `Shopify-Effekt`: erzeugt der gewählte Provider Fulfillment/Mail selbst oder übernimmt Ops genau einmal?
9. `Mehrpaket/Teilmenge`: weiterhin harter Phase-1-Stopper oder neues Daten-/Idempotenzmodell.
10. `Storno`: zulässiger manueller Storno- und Reconcile-Pfad nach realer Labelerzeugung.

## Supersession-Regel

Keine historische Prototypentscheidung gilt automatisch als aktuelle Produktentscheidung. Vor Übernahme muss ein neuer Worktree:

1. gegen aktuelles `origin/main` rebased oder neu implementiert werden;
2. die heutige Arrival-/EasyDPD-Logik auf Überschneidungen prüfen;
3. Provider- und Shopify-Side-Effects eindeutig festlegen;
4. Migration, Auth, Dokumente, Tests und Rollback erneut reviewen;
5. die getrennten Freigabegates aus [OPERATIONS.md](./OPERATIONS.md) einhalten.
