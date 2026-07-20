# Audit-Snapshot — manueller Fotobatch 20.07.2026

Dieser Snapshot hält die vier manuell zu klärenden Fälle und den separat erfolgreich abgeschlossenen vorhandenen-Label-Fall fest. Er ist kein Freigaberegister für zukünftige Carrier-Aktionen.

## Die vier manuellen Fälle

| Fall | Eingangshinweis | Gesicherte Zuordnung | Festgehaltene Entscheidung |
| --- | --- | --- | --- |
| 1 | Handschrift `7196`, vollständige DHL `4958167196` | Trello [RpPLBFNI](https://trello.com/c/RpPLBFNI), Lilith Engelhardt; Shopify `#NEONT4129`; altes DPD-Tracking `01476810438995` | Gesperrt. Bestellung bereits erfüllt; Ersatz-/Nachlieferungsfall. Das alte Versandlabel darf nicht wiederverwendet werden. Ein neues Label braucht eine bewusste manuelle Entscheidung. |
| 2 | Handschrift `8103` | Keine vollständige DHL-Nummer und keine eindeutige Trello-/Shopify-Zuordnung | Gesperrt. Nicht über Endziffern raten oder fuzzy zuordnen; vollständige DHL-Nummer beziehungsweise lesbarer Beleg erforderlich. |
| 3 | Handschrift `1432`, vollständige DHL `2527991432` | Trello [QszIAmX7](https://trello.com/c/QszIAmX7), Anastasia Kaszuba / FLATPAY; Liste `Problem with Sign`; keine eindeutige Shopify-Bestellung | Gesperrt. Trello-Spezialliste und fehlende eindeutige Shopify-Zuordnung erzwingen manuelle Prüfung. |
| 4 | Handschrift `65735500`, vollständige DHL `5065735500` | Trello [prWkIQFB](https://trello.com/c/prWkIQFB), Emil Hallo; Liste `Problem with Sign`; keine eindeutige Shopify-Bestellung; älterer DHL-Hinweis `2661709245` | Gesperrt. Keine Zusammenführung mit der älteren DHL-Nummer; Trello-Spezialliste und fehlende eindeutige Shopify-Zuordnung erzwingen manuelle Prüfung. |

Für alle vier Fälle galt: keine neue DPD-Marke gekauft, kein PDF heruntergeladen, kein Druckauftrag ausgelöst und keine Shopify-Erfüllung geändert. Eine interne Sammelmail wurde aus `support@neontrip.de` an `info@neontrip.de` gesendet; Betreff: `Manuelle Prüfung nötig: 4 DHL-Eingänge nicht automatisch verarbeitet`.

## Separat abgeschlossener vorhandener-Label-Fall

- DHL `2619113486`, Shopify `#NEONT4498`, DPD `01476817678011`.
- EasyDPD-Archiv: vorhandenes aktuelles Label am 20.07.2026 um 09:53 CEST bestätigt; kein zweites Label gekauft.
- Zusatz auf freier Fläche: `113486`, also die letzten sechs DHL-Ziffern.
- Druckdatei-SHA-256: `435caae71568371d613ed514588b56a1d88a750a6a8ed05bcb2fc7b9a88b395a`.
- QA: eine A6-Seite, keine Schutzflächenüberschneidung; Aztec und Code 128 vor und nach der Ergänzung mit identischer Symbologie, Nutzdatenlänge und Nutzdaten-Prüfsumme dekodierbar.
- Genau ein Druckauftrag an `Brother_QL_1110NWB`, CUPS-Job `Brother_QL_1110NWB-144`; danach Queue leer und Drucker `idle`; kein automatischer Nachdruck.

## Seiteneffektbilanz

- Neue DPD-Labels: `0`.
- Shopify-Änderungen: `0`.
- Kundenmails: `0`.
- Trello-Änderungen: `0`.
- Serveränderungen: `0`.
- Interne Prüfmail: `1`.
- Physische Druckaufträge: `1`, ausschließlich der geprüfte vorhandene-Label-Fall.

Die lokalen Originale, Sechs-Ziffern-PDFs und QA-Artefakte liegen unter `~/NEONTRIP/arrival-labels/2026-07-20/`. Der dauerhafte Entscheidungsstandard steht in [dhl-dpd-arrival-labels-operating-standard.md](dhl-dpd-arrival-labels-operating-standard.md).
