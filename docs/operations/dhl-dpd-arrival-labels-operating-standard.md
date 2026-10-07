# Betriebsstandard — DHL-Eingänge und DPD-Etiketten

Version: 1.3, Acryl-Zusatzpaket als Release-Kandidat ergänzt am 24.09.2026; noch nicht produktiv aktiviert.

Status: verbindliche Safety-Baseline. Produktive EasyDPD-Käufe und Drucke sind nur hinter den dokumentierten Schreib-, Audit-, Idempotenz- und Aktivierungsgates zulässig.

Implementierungsstand 23.07.2026: Der vorgesehene lokale Browserpfad ist die [Existing-Chrome-Bridge](easydpd-existing-chrome-bridge-2026-07-23.md). Sie verwendet ausschließlich einen bereits geöffneten, angemeldeten easyDPD-Auftragstab im normalen Chrome-Profil. Ohne diesen Tab wird kein Auftrag reserviert; ein neues Fenster oder separates Profil wird nicht automatisch geöffnet. Die Live-Freigabe bleibt an die dokumentierten Canary-Gates gebunden.

## Quellen und Entscheidungsgrenze

- Outlook liefert DHL-Express-Zustellmeldungen und die vollständige DHL-Sendungsnummer, aber keine eigenständige Freigabe für einen neuen Labelkauf oder Druck.
- Shopify und die persistierte Ops-Datenbank sind die fachlichen Quellen für Bestellung, Adresse, Hinweise, Fulfillment, vorhandene Sendungen und Idempotenz.
- Trello ist Projektion und deterministischer Eingangskanal. Nur die aktuelle Mitgliedschaft in der exakt freigegebenen Quentin-Liste `Sign SHIPPED (NEON TRIP)` bei aktiviertem Trigger darf einen neuen Fall zur Labelerstellung freigeben, wenn der Kartentitel mit genau einer zusammenhängenden zehnstelligen DHL-Express-Nummer endet. `Create Invoice (With Tracking)` und alle anderen Listen sind keine Druckauslöser, auch nicht zusammen mit einer DHL-Mail. Erst der persistierte Datenbankfall darf nach allen Shopify-, Existing-Label-, Produkt- und Idempotenzprüfungen Kauf und Druck freigeben.
- EasyDPD muss vor jedem zukünftigen Kauf gegen vorhandene Labels abgeglichen werden.
- Die KI darf Fälle lesen, zusammenfassen und zur Prüfung vorschlagen. Nur deterministische Regeln dürfen Kauf, Download und Druck freigeben.

## Voraussetzungen für einen automatisierbaren Standardfall

Alle folgenden Bedingungen müssen gleichzeitig erfüllt sein:

1. Die Karte liegt aktuell in `Sign SHIPPED (NEON TRIP)` auf dem freigegebenen Quentin-Board, der Trigger ist aktiviert und der Titel endet mit genau zehn DHL-Ziffern. Eine DHL-Mail allein genügt nicht; vor diesem Listenstatus wird kein neuer Kauf- oder Druckauftrag angelegt.
2. Genau eine Trello-Karte enthält die vollständige DHL-Nummer. Ein Treffer nur über die letzten vier oder sechs Ziffern ist verboten.
3. Genau eine Shopify-Bestellung ist über die explizite Bestellnummer oder einen eindeutigen, geprüften Abgleich zugeordnet.
4. Shopify enthält entweder keine Notiz, ausschließlich das freigegebene vierzeilige NEONTRIP-Angebotsformat oder eine einzelne interne UUID ohne menschlichen Hinweistext. Zusatzfelder entsprechen exakt dem freigegebenen Schema.
5. Es gibt keinen Hinweis auf Abholung, Ladenlokal, Selbstabholung, Sonderwunsch oder widersprüchliche Versandart.
6. Lieferland, vollständige Lieferadresse, Versandklasse und freigegebenes DPD-Produkt sind eindeutig.
7. Es existiert weder in Shopify noch in der Ops-Datenbank oder bei EasyDPD bereits eine zweite Sendung, die einen erneuten Kauf verbietet.
8. Die vollständige Idempotenzkennung `Shopify-Order-ID + vollständige DHL-Nummer` ist noch nicht verarbeitet.

Der Shopify-Zahlungsstatus ist ausdrücklich nur Audit-Information. `pending`, `authorized`, `partially_paid`, `unknown` oder ein anderer offener Zahlungszustand sind allein kein Stopper: Wenn eine DHL-Eingangsmeldung eindeutig einem ansonsten freigegebenen Standardfall zugeordnet ist, darf die Versandvorbereitung unabhängig vom Zahlungseingang fortgesetzt werden. Alle übrigen Stopper gelten unverändert.

Fehlt eine Bedingung oder widersprechen sich Quellen, ist der Fall manuell.

## Sign-SHIPPED-Soforttrigger und Sign-Arrived-Grenze

- Der Sign-SHIPPED-Trigger setzt den Zustellstatus auf `unknown`; eine Zustell- oder Auslieferungsmeldung ist für Labelkauf und A6-Druck nicht erforderlich.
- Der Titel-Suffix ist nur der Eingang. Vollständige Trello-, Shopify-, Existing-Label-, Produkt-, Ziel- und Notizprüfungen bleiben verpflichtend.
- Das A6-Label wird unverändert mit den letzten sechs Ziffern der vollständigen DHL-Nummer annotiert.
- `Sign Arrived` bleibt strikt getrennt: Die Karte darf erst nach `delivered_today`, bestätigtem Labeldruck und Archivierung aller exakt zugehörigen Outlook-Mails verschoben werden.
- Der Trigger besitzt eine explizite Aktivierung. Maßgeblich ist die aktuelle Listenmitgliedschaft, nicht `dateLastActivity`; wiederholte Läufe bleiben durch bestehende Label- und Idempotenzprüfungen geschützt.
- Bereits behandelte Fälle behalten auch außerhalb von `Sign SHIPPED` den nachgelagerten Zustell- und Mailabgleich. Sie werden ausschließlich als `existing_label` verarbeitet und erlauben keinen erneuten Kauf oder Druck.

## Harte Stopper

Ohne Kauf, Download oder Druck in die manuelle Prüfung gehen:

- unvollständige Endziffern, mehr oder weniger als zehn Ziffern am Trello-Titelende oder eine nicht vollständig belegte DHL-Nummer;
- keine, mehrere oder widersprüchliche Trello-/Shopify-Zuordnungen;
- Trello-Listen mit manueller Bedeutung, insbesondere `Problem with Sign`, `Problem mit Schild`, `Manual Review`, `Manuelle Prüfung` oder `Sonderfälle`;
- Shopify-Hinweise wie `Abholer`, `Ladenlokal`, `holt ab`, `Selbstabholung`, `vor Ort` oder sonstiger menschlicher Text außerhalb des Standardformats;
- bereits erfüllte Bestellung, altes Versandtracking, Ersatz-, Reklamations- oder Nachlieferungsfall, solange kein aktuelles und unbenutztes Label für genau diesen Eingang belegt ist;
- vollständig erstattete, stornierte oder abgelaufene Shopify-Bestellung (`refunded`, `voided`, `expired`); diese Zustände sind keine bloß offene Zahlung;
- Schweiz, sonstiges Nicht-EU-Land, fehlendes Land oder bekannte EU-Zoll-/Umsatzsteuer-Sondergebiete;
- EU außerhalb Deutschlands ohne vollständige Adresse, freigegebenes EU-DPD-Produkt oder vor dem Labelkauf bestätigten, preisfreien A4-Lieferschein;
- ein A4-Lieferschein, der nicht ausdrücklich an den separaten HP-Bürodrucker statt an den Brother-Etikettendrucker geroutet ist;
- Express-/Eilanforderung ohne exakt freigegebene Produktzuordnung;
- der Dimmer-Sonderfall `100 pieces single color dimmers` ohne erwartete Shopify-Bestellung;
- jede technische Ungewissheit nach einer externen Schreib- oder Druckgrenze.

Ein offener Shopify-Zahlungsstatus gehört nicht zu den harten Stoppern und darf nicht als Ersatz für eine der oben genannten Sicherheitsprüfungen verwendet werden. Rückabgewickelte oder beendete Bestellungen bleiben davon ausdrücklich ausgenommen.

Die Trello-Listensperre ist ausschließlich ein zusätzlicher Stopper. Ein Wechsel in eine normale Liste ist keine Freigabe, solange Shopify, Datenbank und EasyDPD nicht ebenfalls alle Bedingungen erfüllen.

## Vorhandene und alte Labels

`existing_label` bedeutet zunächst nur: kein zweites Carrier-Label kaufen.

Ein vorhandenes Tracking allein erlaubt keinen automatischen Download oder Druck. Vor dem manuellen Verwenden muss belegt sein, dass das Label aktuell, für genau diesen DHL-Eingang bestimmt und noch verwendbar ist. Ein bereits für den ursprünglichen Kundenversand benutztes oder zeitlich nicht zuordenbares Label darf niemals für eine Ersatz- oder Nachlieferung wiederverwendet werden. Bei Zweifel bleibt der Fall manuell.

Der geschützte Referenzfall `#NEONT4498` / DHL `2619113486` / DPD `01476817678011` ist ein dokumentierter Einzelfall: Das am selben Tag im EasyDPD-Archiv bestätigte Label wurde geprüft, mit `113486` ergänzt und genau einmal gedruckt. Daraus entsteht keine allgemeine Wiederverwendungsfreigabe.

## Sechs-Ziffern-Regel

- Auf dem finalen A6-Label stehen ausschließlich die letzten sechs Ziffern der vollständigen DHL-Nummer.
- Führende Nullen bleiben erhalten.
- Die vollständige DHL-Nummer bleibt Identität, Abgleichs- und Idempotenzschlüssel.
- Vier Ziffern sind verboten, weil am 20.07.2026 bereits zwei verschiedene DHL-Nummern auf `5500` endeten.
- Vor dem Druck werden A6-Format, Schutzflächen, SHA-256 und die unveränderte Lesbarkeit der vorhandenen Barcodes geprüft.

## Freigegebene Funktionsänderung: Acryl-Zusatzpaket (Release-Kandidat)

Nach gesonderter Freigabe und Veröffentlichung des geprüften Commits gilt diese eng begrenzte Ausnahme zur Ein-Label- und Sechs-Ziffern-Regel:

- Enthält ein **neu geplanter** Shopify-Schildversand den Artikel `Acryl LED-Tischgerät` mit positiver Stückzahl, wird genau ein zusätzliches kostenpflichtiges DPD-Paket **pro Shopify-Bestellung** geplant. Bindestrich/Leerzeichen, Unicode-Dash und Groß-/Kleinschreibung werden normalisiert; Teiltreffer oder andere Artikel lösen nichts aus. Auch mehrere Stück erzeugen nur das eine angeforderte Zusatzpaket.
- Das Zusatzpaket erbt Standard/Express-Produkt und die Preisgrenze von maximal 15 EUR je Label. Es hat eine eigene DPD-Sendungsnummer, eigene Artefakte und einen eigenen CUPS-Drucknachweis.
- Auf seinem A6-Etikett steht anstelle der sechs DHL-Ziffern exakt `Acryl LED-Tischgerät`, nötigenfalls zweizeilig im bestehenden geschützten Aufdruckbereich. Das Hauptlabel bleibt unverändert.
- Die Bridge darf es erst nach bestätigtem Hauptdruck und nur mit passender Build-/Paket-Unterstützung reservieren. Als History-Ausnahme ist ausschließlich genau das persistierte Hauptlabel zulässig. Eine fremde/weitere Sendung, fehlende Zuordnung oder Unsicherheit bleibt gesperrt. Eine Recovery lädt ausschließlich das neue Label herunter, niemals das Hauptlabel erneut.
- Die bestehende Bestell-, Sign-SHIPPED-, EU-Lieferschein-, Notiz- und Versandsperre gilt weiterhin. Alte Bestellungen werden nicht rückwirkend nachgebucht. Outlook-Archivierung und Trello-Abschluss warten auf beide bestätigten Drucke.

Implementierung, Prüfbelege und Release-/Rollback-Reihenfolge: [Acryl-Zusatzpaket](arrival-acryl-second-label-2026-09-24.md).

## Verbindliche Druckertrennung

- A6-/4x6-Versandetiketten gehen ausschließlich an `Brother_QL_1110NWB` (`shipping-a6`).
- Preisfreie A4-Lieferscheine gehen ausschließlich an `HP_Color_LaserJet_Pro_MFP_3302` (`shipping-a4-delivery-note`, Medium `A4`).
- Beide Drucker werden pro Auftrag ausdrücklich ausgewählt; der Systemstandarddrucker darf nie die Zuordnung bestimmen.
- Sind beide logischen Schlüssel identisch, fehlt eine Queue oder ist A4 nicht bestätigt, bleibt der EU-Fall ohne Labelkauf in manueller Prüfung.
- Eine Änderung der physischen Zuordnung erfordert erneut einen beaufsichtigten Zwei-Drucker-Test.

## Manueller Klärungsweg

1. Fall ohne Carrier- oder Druckseiteneffekt sperren.
2. Eine idempotente interne Prüfmeldung an `info@neontrip.de` erstellen. Sie nennt DHL-Nummer, Grund, Trello-Link und – wenn eindeutig vorhanden – den vertrauenswürdigen Shopify-Admin-Link. Es geht keine Nachricht an Kunden.
3. Ein Mensch entscheidet getrennt über Zuordnung, Ersatz-/Nachlieferung, neues Label, vorhandenes aktuelles Label oder Abschluss ohne Versand.
4. Vor einem manuellen Druck Labelherkunft, Nutzbarkeit, Sechs-Ziffern-Zusatz und PDF-/Barcode-QA dokumentieren.
5. Ein unsicherer CUPS-Status wird physisch und in der CUPS-Historie geprüft. Es gibt keinen automatischen Nachdruck.

## Audit, Wiederholung und Rollback

- Jeder Lauf protokolliert Fallstatus, Gründe, vollständige Idempotenzkennung, Artefakt-Prüfsummen und externe Job-IDs.
- Wiederholte Läufe müssen dieselben Entscheidungen und Schlüssel erzeugen und dürfen keine zweite Prüfmail, keinen zweiten Kauf und keinen zweiten Druck erzeugen.
- Operativer Rollback: `arrival_label_trello_trigger_settings.enabled=false` setzen, n8n-Workflows deaktivieren, beide Print-Worker stoppen, `ARRIVAL_LABEL_WRITES_ENABLED=false` setzen und den vorher freigegebenen Ops-Commit wiederherstellen.
- Auditdaten werden beim Rollback bewahrt. Unsichere Käufe oder Druckjobs werden nicht automatisch storniert, wiederholt oder gelöscht.

Der konkrete manuelle Batch vom 20.07.2026 ist in [dhl-dpd-arrival-labels-manual-batch-2026-07-20.md](dhl-dpd-arrival-labels-manual-batch-2026-07-20.md) festgehalten.

## Aktualisierung vom 07.10.2026: frische Shopify-Prüfung und Tischgerät-Aufdruck

Release-Kandidat, noch nicht produktiv: Vor `dispatching` für jeden Browserkauf und jeden A6-/A4-Druck wird die zugehörige Bestellung anhand ihrer unveränderlichen Shopify-ID direkt aus `galaxybuzzdk.myshopify.com` gelesen. Eine nicht vollständig belegte Antwort erlaubt keinen Dispatch. Menschliche Sonderhinweise und Abholung werden mit der bestehenden Shopify-Regel geprüft; erlaubte Angebotsmetadaten und interne UUIDs bleiben erlaubt. Ein Acryl-Tischgerät als Artikel allein ist kein Sperrgrund.

Eine neue Sperre hält den reservierten Auftrag und den Fall atomar auf `manual_review`, protokolliert `shopify_dispatch_held` einmal pro Auftrag und verändert keine vorhandenen Kauf-/Druckbelege. Die private Leo-Kontrolle kann den neuen Zustand erkennen; dieser Patch sendet selbst keine E-Mail oder WhatsApp-Nachricht. Der bisherige Worker darf die belegte Shopify-Sperre quittieren und seinen lokalen Auftragsslot freigeben, ohne die Datenbanksperre zurückzusetzen. Nach bereits erfolgtem Dispatch bleiben Abschlussquittungen unverändert verarbeitbar. Der Zeitpunkt der Shopify-Abfrage und der externe Kauf/Druck sind keine gemeinsame Transaktion; spätere Änderungen benötigen weiterhin eine manuelle Behandlung.

Beim Acryl-Zusatzpaket wird die bestehende zweite, gesondert zugeordnete DPD-Buchung beibehalten. Hauptlabel: sechs DHL-Endziffern. Zusatzlabel: dieselben sechs Ziffern gefolgt von `(Tischgerät)`, bei schmaler Druckfläche zweizeilig. Alte Labels werden nicht nachträglich erneut gebucht oder gedruckt.

Geprüft: 132 betroffene Node-Tests; TypeScript ohne Fehler; isolierte PostgreSQL-16-Fixture mit realen Arrival-Migrationen und zwei vollständigen, simulierten Kauf-/CUPS-Ketten, deduplizierten Sperren und Schutz vor Rücksetzen nach Dispatch. Zwei synthetische, klar als TEST gekennzeichnete A6-PDFs über den bestehenden CUPS-Adapter auf Rahims Brother gesendet; CUPS-Abschlussbelege `Brother_QL_1110NWB-88` und `Brother_QL_1110NWB-89`, 07.10.2026 14:14 Europe/Berlin. Kein Carrier-Kauf, kein Kundenauftrag und keine zentrale Produktivqueue für diese Druckprobe geändert. Papierqualität nicht vor Ort bestätigt; kein Nachweis einer Installation auf Daniels Gerät oder einer automatischen Fallback-Umschaltung.

Release-Reihenfolge: In-flight Browser-/Druckjobs prüfen; bei laufendem Dispatch das Schema-/App-Fenster verschieben. Zwei neue Migrationen und exakt freigegebenen App-Commit zusammen bereitstellen; der neue Zusatzaufdruck muss zur SQL-Artefaktprüfung passen. Danach App-Commit/Gesundheit und einen freigegebenen Canary prüfen. Vorhandene n8n-Trigger bleiben durch diesen Patch unverändert; die geplante zusätzliche Drei-Listen-/Deutschland-/Zollfreigabe ist kein Bestandteil dieses Releases.

## Leo carrier release candidate — 2026-10-07

The optional `ARRIVAL_LABEL_CARRIER_RELEASE_ENABLED=true` rollout switches new-case release from Sign SHIPPED membership to carrier evidence. Default is off; do not enable before carrier access, end-to-end shadow comparison, and worker readiness are verified. This is not a completed Leo rollout.

The candidate resolves a ten-digit DHL Express waybill from title or Tracking number custom field and rejects disagreement. It enrolls new trackings from Sign Approved, Only Super Urgent and Prepare Shipping, with Create Invoice catch-up for cards moved between discovery runs. Existing tracking/card associations continue after moves. Multiple card matches and changed associations do not grant release.

Release requires a recent successful check plus explicit physical Germany movement and German customs completion, using individual carrier event text/location rather than the broad shipment-normalized status. A later hold/customs/return event blocks release. The same carrier evidence is checked again before browser purchase and print dispatch; fresh Shopify checks and existing idempotent queues remain in place. No registration or queue write in non-persisting dry-run.

The existing n8n 17TRACK time gate was separately changed to 09:00, 11:00, 13:00 and 15:00 Europe/Berlin. It still has its existing batch limits, registration scope and notifier. 191 historical registrations reported insufficient quota; no top-up performed. Reconcile current eligible shipments before buying quota or replaying old rejections. Webhook route exists, but current provider delivery and immediate label-trigger integration are not verified. API data and webhook authentication need live verification before rollout.

Device priority/fallback, private Kai error-outbox integration, scoped Leo API access and Daniel/Fabienne device acceptance remain open. Existing local scheduler and printers are not deactivated or replaced by this candidate. Do not identify unit tests as a real carrier purchase/print test.

Candidate follow-up: before carrier-gated purchase or print dispatch, re-read the live Quentin board and require the same unique card/tracking association and a known non-manual list. Changed/conflicting tracking, a duplicate card, archived/missing card, foreign board or unavailable list evidence blocks dispatch. This uses the existing Trello reader and remains behind the carrier-release flag. Two regression tests failed before the fix; all 41 carrier/dispatch tests and TypeScript passed afterward. No production activation.
