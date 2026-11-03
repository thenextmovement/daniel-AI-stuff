# NEONTRIP: offene Kundenfaelle und wiederholte Meldungen, 03.11.2026

Fortschreibung nach Freigabe: Monitor-Datenbankkorrektur ist live. Daniel hat 17TRACK
als nicht mehr genutzt bestaetigt und seine Stilllegung beauftragt; die unten genannten
Kontingent-Aufladungen entfallen. Aktueller Stand und die neue Commit-Freigabe nach
fortgeschrittenem main stehen in [17TRACK-Stilllegung](17track-retirement-20261103.md).

## Umfang und Ausgangspunkt

Ziel: belegbare offene Fallangaben korrigieren; gleiche Shipping-Monitor-Meldungen
nicht stuendlich wiederholen; neue oder geaenderte Probleme weiterhin melden.
Nachbar: Backlit-Freigabe, ungeklaerte Kunden-Sends, Zahlungen, Labelkauf und Druck bleiben
an ihren bestehenden Pruefungen. Keine Provider-Migration oder neue Automation.
Wirkung: drei eng begrenzte, protokollierte Live-Datenkorrekturen; der Code-/SQL-Kandidat
ist lokal getestet, noch nicht veroeffentlicht. Kein Kundenversand, Labelkauf oder Druck.

Erlaubte Systeme: NEONTRIP Ops, dessen Shipping-Daten, die konkret genannten
Shopify-Auftraege und die Lingener-Karte. Keine RIESENOBJEKTE-Aenderungen.

Produktions- und Git-Basis: `4606491a5c548c15b4c70058751a5370fd416359`,
via Ops Health und frisch abgefragtem `origin/main` bestaetigt.
Shipping-Workflow `QtG2XHw7DsvOEPtQ`, aktive Version
`185b606b-606c-475d-841f-73e8f7b107dc`.
Quoting-Workflow `EtEpzMp10EmaqXIS`, aktive Version
`9c970791-cff4-4d28-99e2-f534b664aac5`.
Keine n8n-Graph-, Credential-, Trigger- oder Aktivierungsaenderung.

## Bereits live korrigiert und zurueckgelesen

| Fall | Aenderung und Beleg | Verbleibender Punkt |
| --- | --- | --- |
| #NEONT4783 | Vorhandene DPD-Nummer aus EasyDPD-Archiv und passendem Shopify-Fulfillment dem Fall zugeordnet. Details und Rollback in [Fallabgleich](shipping-case-4783-reconciliation.md). | Lieferschein/Druck weiter manuell und unbestaetigt. |
| #NEONT4627 | Nur den falschen Zusatzgrund `unknown_product` entfernt; `pending`, 0 Versuche und keine Provider-ID unveraendert. Echte Sperre `backlit_manual_not_cleared` bleibt. | Laut Daniel existiert keine freigegebene Montageanleitung. Fachlich richtige Backlit-/Montageschienen-Anleitung erstellen und pruefen, danach den bestehenden Freigabeweg verwenden. |
| Lingener / FEEL THE MANA | Bestaetigung von Daniel: Buero. Kanonische Request-Beschreibung und das vorhandene Trello-Beschreibungsfeld korrigiert. Alle anderen Custom Fields, Name und Liste per Readback unveraendert. | Mockup-Warnung bleibt; keine neue Bildfreigabe oder Gesamtfertigstellung behauptet. |

Auditbelege:

- #NEONT4783: `arrival_label_events.event_key =
  manual-label-reconciliation:NEONT4783:01476813229337:v1`; alte geaenderte Felder
  und Quellen im Payload. Korrektur 09:11:41Z.
- #NEONT4627: `shipping_audit_log.idempotency_key =
  installation-review-reconciliation:NEONT4627:20261103:v1`; alter Grund und
  Parallelitaetsmarker im Metadata-Backup. Notification
  `14ea4cb7-021a-44a9-a115-67306cb089ed`, Korrektur 09:19:18Z.
  `metadata.expected` bleibt leer; keine Sendefreigabe. Andere Metadaten bleiben erhalten.
- Lingener: Request `cd585a68-dc35-4546-8da0-ed88f5065004`,
  `workflow_audit_log.id = 90442d20-ce63-f32b-6feb-ade4dbdd071b`.
  Beschreibung vorher leer, `application` unveraendert Indoor.
  Karte `6ae99279dcaef12774369bb2`, Feld `699d986489ebd38030a0d1eb`:
  "FEEL THE MANA – Schriftzug fuer ein Buero." (gespeichert mit Umlaut).
  Trello-Idempotenz `manual-context-6ae99279-office-20261103-v1`, Readback bestaetigt.

Die Datenkorrekturen wurden bedingt auf den beobachteten Vorzustand und mit atomarem
Audit durchgefuehrt. Bei Rollback nur die geaenderten Felder anhand des jeweiligen
Audit-Backups wiederherstellen und neuere Bearbeitungen nicht ueberschreiben.
Ein erster #NEONT4783-Auditversuch scheiterte am Pflichtfeld run_id; die Transaktion
blieb unveraendert. Nach Schemaabgleich wurde einmal mit der bestehenden run_id korrigiert.

## Fertiger, noch unveroeffentlichter Code-/SQL-Kandidat

1. Dokumentklassifizierung: "rueckleuchtend" korrekt als Backlit erkennen; exakt
   bekannte Versand-/Outdoor-Zusatzzeilen als Zubehoer behandeln. Unbekannte physische
   Produkte und fehlende Anleitung bleiben gesperrt.
2. `shipping_claim_notification_monitor_alert`: statt eines neuen Schluessels je
   UTC-Stunde je Fall Status/Art/Grund vergleichen. Neue/geaenderte Faelle beim naechsten
   Poll; unveraenderte Faelle hoechstens nach 24 Stunden erneut claimen.
   Aktualisierte Poll-Zeitstempel/Zaehler sind keine neuen Probleme oder Genesung.
   Beobachtete Erledigung und echtes Wiederauftreten werden unterschieden.
3. Maximal 20 Faelle je Digest, ueberzaehlige Faelle beim naechsten Poll; atomare
   Sperre gegen parallele Doppelclaims. Alle variablen HTML-Werte escaped.
   Bestehende Audit-Tabelle wird verwendet; keine neue Tabelle, Queue oder Workflow.
4. Echte manuelle Dokumentfreigaben klar von fehlgeschlagenen/unklaren Sends getrennt.
   Nur nie versuchte, fachlich obsolete Incident-/Pickup-Hinweise ausblenden.
   Fehlende Unterlagen und unsichere Sends bleiben sichtbar, auch nach Paketzustellung.

Der Claim-Auditstatus bedeutet nur erfolgreiche Reservierung. Der bestehende
Outlook-Monitor hat keinen Versandbestaetigungs-Rueckkanal; `delivery_confirmed=false`
ist ausdruecklich gespeichert. Ein ausgefallener interner Versand wird nicht automatisch
wiederholt; vor jedem Retry muss dessen Provider-/Ausfuehrungszustand geklaert werden.

## Nicht erledigte Faelle und naechster benoetigter Beleg

| Fall | Verifizierter Stand | Naechster Schritt |
| --- | --- | --- |
| #NEONT4753 | Kaufjob `d092c0c5-2e94-48d0-bdc9-5448fd5d1857` hat ungeklaerten Ausgang seit 29.10.; EasyDPD zeigt nur das alte Label vom 19.10. mit DPD 01476812707592. Das beweist keinen neuen Kauf vom 29.10. | Buchungs-/Abrechnungsnachweis des Providers fuer den 29.10. abgleichen. Bis dahin kein neuer Kauf und keine Wiederverwendung des alten Labels. |
| #NEONT4779 | Letzter kanonischer Zustand Zustellversuch fehlgeschlagen; DHL-Webabfrage lieferte keine auswertbare neue Information. 17TRACK-Incident vom 03.11.: "Quota is not enough for use." | Kontingent im bestehenden 17TRACK-Konto wiederherstellen, danach aktuelle Traegereignisse pruefen. Kein Zustellabschluss ohne Beleg. |
| #NEONT4627 Tracking | Derselbe 17TRACK-Quota-Fehler; die fehlende Montageanleitung ist ein unabhaengiger Punkt. | Bestehendes Kontingent wiederherstellen; Anleitung gesondert fachlich freigeben. |
| #NEONT4751 | Alter Zollhinweis widerspricht neuerem kanonischem Delivered-Status; aktuelle Label-Pruefung verlangt explizite Carrier-Ereignisse. | Vor einer Aenderung neueren Carrier-Beleg korrelieren. Keine Zoll-Sperre pauschal lockern. |
| A/N 14912 | Angebot abgeschlossen/angenommen, aber `PRODUCT_WITHOUT_VISUAL` ist durch Annahme allein nicht widerlegt. | Tatsaechliche passende Visualisierung pruefen; keine Medien blind aktivieren. |
| Mahnpruefung | 74 manuelle Prueffaelle sind keine 74 technischen Fehler. Shopify fuehrt #4485, #4652 und #4653 noch PENDING. Vorhandene Notizen nennen Paypal/Sammelzahlung, ersetzen keinen abgeglichenen Zahlungsbeleg. | Zahlungsjournal/Provider-Transaktionen zuordnen, dann gegebenenfalls gezielte Buchungskorrektur. Keine Mahnung oder Bezahlt-Markierung ausgefuehrt. |
| MCP ops_tasks_post | `MCP_INVALID_PATH_PARAMETERS`; der konkrete Originalaufruf und ein passender aktueller Gateway-Vertrag fehlen. | Originalargumente und aktiven Operationsvertrag korrelieren. Nicht aus dem Fehlertext eine Aufgabe erzeugen oder einen fremden Codepfad patchen. |

Es wurde keine 17TRACK-Aufladung und kein Anbieterwechsel beauftragt oder gekauft.
Die Quota-Stoerung wird nicht durch aggressivere Wiederholungen oder einen zusaetzlichen
Polling-Waechter verdeckt.

## Verifikation

- Fokussierte Dokumentauswahl: 21 Tests bestanden.
- Gesamte bestehende Quote-/Ops-Suite: 1.740 bestanden, 2 bestehende Skips, 0 Fehler.
- TypeScript ohne Fehler; Produktionsbuild erfolgreich.
- Bestehender DB-Testlauf mit isoliertem PostgreSQL 17, ohne Netzwerk: 33 Tests bestanden,
  davon 15 fuer Monitor-Deduplizierung, Fristen, echte Wiederkehr, Nebenfaelle,
  Parallelitaet, Escaping, Digest-Limit, Berechtigungen und ausbleibende Kundenmutation.
- DB-Test nach der Abschlusskorrektur fuer einen aktualisierten Pending-Zeitstempel
  wiederholt. Der unveraenderte TypeScript-/Anwendungscode wurde nicht erneut getestet.
- UI-Smoke nicht angewandt: keine UI-Aenderung; dokumentierter Smoke-Filter ist selbst
  nicht deterministisch. Keine Tracking- oder Routingaenderung.
- Supabase-Advisors vor Release gelesen. Bestehende projektweite Hinweise gehoeren
  nicht zu dieser Reparatur; die geaenderte Funktion bleibt SECURITY INVOKER,
  bekommt einen festen search_path und ist nur fuer service_role ausfuehrbar.

## Release und Rollback

Vor Veroeffentlichung: abschliessenden Diff pruefen, sauberen Commit erstellen,
`codex-predeploy ops` aus diesem Worktree, volle SHA gemaess AGENTS freigeben lassen.
Noch nicht nach main gepusht, SQL-Funktion noch nicht live ersetzt.

Nach dieser Freigabe die aktive Funktionsdefinition/Berechtigungen und n8n-Version
erneut mit dem Backup vergleichen. Abweichungen zuerst aufloesen. Nur die Migration
`20261103090555_shipping_monitor_case_dedup.sql` anwenden; keine Sammelmigration
ungepruefter Dateien. Anwendung ausschliesslich per `codex-safe-push-main` vom
geprueften Worktree veroeffentlichen. Die bestehende Funktionssignatur bleibt gleich.
Anschliessend Ops-Health auf genau diese SHA pruefen, Funktionsdefinition/Berechtigungen
zuruecklesen und den natuerlichen Monitor-Lauf sowie Outlook-Belege pruefen.
Keine manuelle Funktionsausfuehrung, die einen Alert-Claim konsumiert, als Read-only-Test
ausgeben. Kein Kundentestversand.

SQL-Rollback: exakte erfasste Live-Definition in
`supabase/rollbacks/20261103090555_shipping_monitor_case_dedup.sql`.
Audit-Historie und Kundenbenachrichtigungen werden dabei nicht geloescht. Der alte
stuendliche Alarm kann nach Rollback wieder auftreten. Code-Rollback ueber gezielten,
separat freigegebenen Revert nach normalem Release-Gate.
