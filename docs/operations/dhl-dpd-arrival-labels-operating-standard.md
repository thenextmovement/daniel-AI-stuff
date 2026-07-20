# Betriebsstandard — DHL-Eingänge und DPD-Etiketten

Version: 1.0, festgehalten am 20.07.2026.

Status: verbindlicher Safety-Baseline für die weitere Umsetzung. Der produktive EasyDPD-Schreibpfad bleibt deaktiviert. Dieser Standard erlaubt keine Aktivierung, keinen Kauf und keinen automatischen Druck.

## Quellen und Entscheidungsgrenze

- Outlook liefert die DHL-Express-Eingangsmeldung und die vollständige DHL-Sendungsnummer.
- Shopify und die persistierte Ops-Datenbank sind die fachlichen Quellen für Bestellung, Adresse, Hinweise, Fulfillment, vorhandene Sendungen und Idempotenz.
- Trello ist nur eine Projektion und ein Zuordnungshinweis. Trello darf Automation zusätzlich sperren, aber niemals allein einen Kauf oder Druck freigeben.
- EasyDPD muss vor jedem zukünftigen Kauf gegen vorhandene Labels abgeglichen werden.
- Die KI darf Fälle lesen, zusammenfassen und zur Prüfung vorschlagen. Nur deterministische Regeln dürfen Kauf, Download und Druck freigeben.

## Voraussetzungen für einen automatisierbaren Standardfall

Alle folgenden Bedingungen müssen gleichzeitig erfüllt sein:

1. Die vollständige DHL-Nummer stammt aus einer erlaubten DHL-Express-Mail und ist für den Berliner Kalendertag relevant.
2. Genau eine Trello-Karte enthält die vollständige DHL-Nummer. Ein Treffer nur über die letzten vier oder sechs Ziffern ist verboten.
3. Genau eine Shopify-Bestellung ist über die explizite Bestellnummer oder einen eindeutigen, geprüften Abgleich zugeordnet.
4. Shopify enthält entweder keine Notiz oder ausschließlich das freigegebene vierzeilige NEONTRIP-Angebotsformat. Zusatzfelder entsprechen exakt dem freigegebenen Schema.
5. Es gibt keinen Hinweis auf Abholung, Ladenlokal, Selbstabholung, Sonderwunsch oder widersprüchliche Versandart.
6. Lieferland, vollständige Lieferadresse, Versandklasse und freigegebenes DPD-Produkt sind eindeutig.
7. Es existiert weder in Shopify noch in der Ops-Datenbank oder bei EasyDPD bereits eine zweite Sendung, die einen erneuten Kauf verbietet.
8. Die vollständige Idempotenzkennung `Shopify-Order-ID + vollständige DHL-Nummer` ist noch nicht verarbeitet.

Fehlt eine Bedingung oder widersprechen sich Quellen, ist der Fall manuell.

## Harte Stopper

Ohne Kauf, Download oder Druck in die manuelle Prüfung gehen:

- unvollständige oder nur handschriftliche Endziffern ohne eindeutig belegte vollständige DHL-Nummer;
- keine, mehrere oder widersprüchliche Trello-/Shopify-Zuordnungen;
- Trello-Listen mit manueller Bedeutung, insbesondere `Problem with Sign`, `Problem mit Schild`, `Manual Review`, `Manuelle Prüfung` oder `Sonderfälle`;
- Shopify-Hinweise wie `Abholer`, `Ladenlokal`, `holt ab`, `Selbstabholung`, `vor Ort` oder sonstiger Text außerhalb des Standardformats;
- bereits erfüllte Bestellung, altes Versandtracking, Ersatz-, Reklamations- oder Nachlieferungsfall, solange kein aktuelles und unbenutztes Label für genau diesen Eingang belegt ist;
- Schweiz, sonstiges Nicht-EU-Land, fehlendes Land oder bekannte EU-Zoll-/Umsatzsteuer-Sondergebiete;
- EU außerhalb Deutschlands ohne vollständige Adresse, freigegebenes EU-DPD-Produkt oder vor dem Labelkauf bestätigten, preisfreien A4-Lieferschein;
- ein A4-Lieferschein, der nicht ausdrücklich an den separaten HP-Bürodrucker statt an den Brother-Etikettendrucker geroutet ist;
- Express-/Eilanforderung ohne exakt freigegebene Produktzuordnung;
- der Dimmer-Sonderfall `100 pieces single color dimmers` ohne erwartete Shopify-Bestellung;
- jede technische Ungewissheit nach einer externen Schreib- oder Druckgrenze.

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
- Operativer Rollback: n8n-Workflows deaktivieren, beide Print-Worker stoppen, `ARRIVAL_LABEL_WRITES_ENABLED=false` setzen und den vorher freigegebenen Ops-Commit wiederherstellen.
- Auditdaten werden beim Rollback bewahrt. Unsichere Käufe oder Druckjobs werden nicht automatisch storniert, wiederholt oder gelöscht.

Der konkrete manuelle Batch vom 20.07.2026 ist in [dhl-dpd-arrival-labels-manual-batch-2026-07-20.md](dhl-dpd-arrival-labels-manual-batch-2026-07-20.md) festgehalten.
