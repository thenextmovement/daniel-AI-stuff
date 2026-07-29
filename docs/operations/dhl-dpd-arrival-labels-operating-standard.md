# Betriebsstandard — DHL-Eingänge und DPD-Etiketten

Version: 1.1, festgehalten am 20.07.2026 und erweitert am 29.07.2026.

Status: verbindliche Safety-Baseline. Produktive EasyDPD-Käufe und Drucke sind nur hinter den dokumentierten Schreib-, Audit-, Idempotenz- und Aktivierungsgates zulässig.

Implementierungsstand 23.07.2026: Der vorgesehene lokale Browserpfad ist die [Existing-Chrome-Bridge](easydpd-existing-chrome-bridge-2026-07-23.md). Sie verwendet ausschließlich einen bereits geöffneten, angemeldeten easyDPD-Auftragstab im normalen Chrome-Profil. Ohne diesen Tab wird kein Auftrag reserviert; ein neues Fenster oder separates Profil wird nicht automatisch geöffnet. Die Live-Freigabe bleibt an die dokumentierten Canary-Gates gebunden.

## Quellen und Entscheidungsgrenze

- Outlook liefert DHL-Express-Zustellmeldungen und die vollständige DHL-Sendungsnummer.
- Shopify und die persistierte Ops-Datenbank sind die fachlichen Quellen für Bestellung, Adresse, Hinweise, Fulfillment, vorhandene Sendungen und Idempotenz.
- Trello ist Projektion und deterministischer Eingangskanal. Eine neue Karte in der exakt freigegebenen Quentin-Liste `Sign SHIPPED (NEON TRIP)` darf nach dem Aktivierungszeitpunkt einen Fall anlegen, wenn ihr Titel mit genau einer zusammenhängenden zehnstelligen DHL-Express-Nummer endet. Erst der persistierte Datenbankfall darf nach allen Shopify-, Existing-Label-, Produkt- und Idempotenzprüfungen Kauf und Druck freigeben.
- EasyDPD muss vor jedem zukünftigen Kauf gegen vorhandene Labels abgeglichen werden.
- Die KI darf Fälle lesen, zusammenfassen und zur Prüfung vorschlagen. Nur deterministische Regeln dürfen Kauf, Download und Druck freigeben.

## Voraussetzungen für einen automatisierbaren Standardfall

Alle folgenden Bedingungen müssen gleichzeitig erfüllt sein:

1. Die vollständige DHL-Nummer stammt entweder aus einer erlaubten DHL-Express-Mail oder aus einer nach Aktivierung geänderten Karte in der exakt freigegebenen Quentin-Liste, deren Titel mit genau zehn DHL-Ziffern endet.
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
- Der Trigger ist standardmäßig deaktiviert und besitzt einen produktiven Aktivierungszeitpunkt. Karten mit älterer `dateLastActivity` werden nicht rückwirkend verarbeitet.

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
