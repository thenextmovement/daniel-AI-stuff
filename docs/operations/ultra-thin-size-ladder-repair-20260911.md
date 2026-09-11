# Ultra-Thin-Preisleiter: Reparatur vom 2026-09-11

## Auftrag und Grenze

- **Ziel:** Die vorhandene Standard-Indoor-Preistabelle in die bestehende Quote-Ready-Preisleiter und deren Trello-Projektion einbinden; keine zusätzliche Preis-Engine.
- **Nachbar:** Neon, Full Glow/Neon-Mischgruppen, generische/doppelseitige Lichtboxen, ausgeschlossene Sonderausführungen sowie Offers-Versand und Mehrwertsteuer beibehalten.
- **Wirkung:** Nach Veröffentlichung entstehen die vorhandenen `offer_size_quote_anchor_sets` und `offer_items_json`. Der Import übernimmt fertige Kunden-Nettopreise genau einmal. Bereits versendete Angebote werden durch diesen Release nicht pauschal neu importiert oder erneut verschickt.
- **Erlaubte Systeme:** NEONTRIP-Preisleiter in Ops und genau der Selektor im bestehenden Workflow `7YRFB56vbc4Iem6A`; keine Migration, neue Queue oder zusätzlicher Workflow.

## Bestätigte Ursache

Am 2026-09-11 meldete Ops `/api/health` den aktuellen Main `bd116fba2cf29a5912708290296f37e3999cc471`. Dieser Stand enthält die vorbereitete Ultra-Thin-Tabelle noch nicht. Die reale Eingabe von Karte 34987 wird lokal mit exakt diesem Quellstand als `ultra_thin` erkannt, aber mit `special_product_uses_existing_offer_flow` übersprungen; der generische Acryl-Pfad liefert keine freigegebenen Größen.

Der aktive Vorbereitungsworkflow, Version `864775cb-77e2-4009-b97f-fdf1d9e3a6f8`, schließt `Ultra Thin` außerdem ausdrücklich im Knoten `Select Preparation Card` aus. Für die Karte existierten weder ein Preisleiter-Datensatz noch eine `offer_items_json`-Projektion. Angebot A/N15476 enthielt nur 30 × 26 cm zu 179 EUR netto plus 30 EUR Versand.

Die alte lokale Vorbereitung wird gezielt übernommen, nicht ihr gesamter alter Branch. Der frühere Worktree mit uncommitteten Änderungen bleibt unverändert. Beim Abgleich bleiben die aktuellen Zuordnungsregeln für gemischte Produkte erhalten. Zusätzlich wird der bestätigte Fehler behoben, dass bereits das Label `Indoor/Outdoor: Indoor` den Outdoor-Ausschluss auslöste.

Die 13 Tabellenwerte und Prüfkorridore wurden erneut gegen `Ultra-Thin-Acrylic-Lightbox-Preisleiter.xlsx`, Blatt `Preisleiter`, A9:G21, abgeglichen. 110–150 cm enthalten teilweise modellierte Werte; `configured_guidance_only` bleibt dafür sichtbar. Diese Werte sind keine Lieferantenzusage.

## Prüfung vor Veröffentlichung

- Ops: 77 Preisleiter-Tests und insgesamt 1.080 Quote-Tests erfolgreich; TypeScript und Produktionsbuild erfolgreich.
- Selektor: zwei Tests zu zulässigen Produkten, unveränderten Nachbarn und Erkennung zwischenzeitlicher Quelländerungen erfolgreich. Der vollständig aktive Selektor wurde mit der konkreten Karteneingabe lokal ausgeführt: vorher übersprungen, nachher ausgewählt; kein Netzwerkaufruf und keine produktive Ausführung.
- Offers: 149 Import-/Preistests gegen den aktuell veröffentlichten Quellstand `8ace170b90e5b352e0aa0dbffc5444b699ebbd50` erfolgreich. Alle 13 erzeugten Preise unverändert übernommen; jede Größe einzeln gewählt und mit exakt einmal 30 EUR Versand sowie 19 Prozent MwSt berechnet.
- Die echte Karteneingabe erzeugt 30–150 cm; die bestehende Offers-Auswahllogik würde beim Neuimport die im Anfragefeld genannten 150 cm vorauswählen. Das ist kein Auftrag, die Auswahl eines bereits angesehenen Angebots zu überschreiben.
- Kein erneuter Kundenversand, kein produktiver Import und keine Änderung der Karte oder des Kundenangebots während dieser Prüfung.

## Offene Einzelfallentscheidung

Karte 34987 nennt Indoor, die Lieferanten-PDF dagegen ausdrücklich `extra info: outdoor`. Die PDF belegt 26,49 cm Breite, 30 cm Höhe und 78 USD Gesamtkosten (37 Produktion + 41 Versand). Das veröffentlichte Angebot verwendet die gerundete Trello-Größe. Die Anfrage nennt zusätzlich 150 cm. Die Frage zur vorgesehenen Indoor-/Outdoor-Ausführung ist beim Nutzer offen.

Vor einer Korrektur dieses Angebots muss diese Entscheidung vorliegen. Danach aktuelle Karte und kanonisches Angebot erneut lesen, den unterstützten versionierten Offer-Patch mit Revisionsgrund zuerst als Dry-run prüfen und die bestehende Auswahl gezielt erhalten. Keine Wiederholung des vollständigen Versandworkflows.

## Veröffentlichung und Rückweg

1. Exakten sauberen Ops-Commit freigeben lassen; im selben Worktree `codex-predeploy ops`, anschließend nur nach Freigabe `codex-safe-push-main` verwenden. Die tatsächliche Ops-Health-SHA nach Deployment prüfen.
2. Aktiven und Entwurfsstand des Workflows frisch vollständig sichern, Version und Aktivierungszustand unmittelbar vor Änderung erneut vergleichen. `scripts/patch-ultra-thin-size-ladder-selector.mjs` erzeugt ausschließlich das Update des bekannten Selektors; bei Quellabweichung wird abgebrochen. Keine sonstigen Knoten, Verbindungen, Parameter oder Credential-Referenzen ändern.
3. Nach Veröffentlichung Graph vollständig gegen das Backup vergleichen. Einen natürlichen passenden Durchlauf anhand der kanonischen Preisleiter und Trello-Projektion nachweisen; kein Kundenversand als Test.
4. Bei Rücknahme zuerst den ursprünglichen Selektor aus dem gesicherten Graph wiederherstellen. Backend-Revert separat nach den normalen Release-Gates. Bereits erzeugte Projektionen nicht blind löschen oder Kundenangebote neu importieren.

UI-Layout, Routing, Tracking und Sales-Vergabe wurden nicht geändert; entsprechende UI-/Tracking-Smokes sind für diesen Preisbaustein nicht betroffen. Die Kundenansicht neuer Größen wurde noch nicht in einer veröffentlichten Laufzeit bestätigt.
