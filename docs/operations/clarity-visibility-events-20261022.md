# Clarity: Konfigurator-Maskierung und Auswahlereignisse

Stand: 22.10.2026. NEONTRIP, ausschließlich `anfrage.neontrip.de`, Projekt `vvb78gxiwp`.

## Ziel und Grenze

Öffentliche Preise und feste Bedienbeschriftungen sichtbar machen, private Entwürfe und Kundendaten maskiert halten, fehlende Auswahl- und Fehlerereignisse über den bestehenden CRO-Tracker ergänzen. Statistikzustimmung, Kennungen, Berechnungen, Warenkorb, Checkout und bestehende Funnel-Ereignisse bleiben erhalten. Keine Anfrage, E-Mail, Bestellung oder Zahlung im Test. Shopify und Dashboard-Segmente werden nicht geändert.

Basis: `bf5a909e2644922ffc75441b2c356f33db9bd653`, Pages-Deployment `dce741ac-5e6c-4179-80d7-b8e0903bb6d6`. 39 Live-Dateihashes geprüft. Das vollständige veröffentlichte Paket enthält 1.910 Dateien; der Kandidat verändert 13 davon und erhält 1.897 sowie die Functions. Die bereits veröffentlichten Module `budget-advisor.js`, `funnel-tracking.js`, `nt-cro.js` und `nt-cro-page.js` waren bisher nicht in Git enthalten und werden jetzt in ihrer aktuellen Fassung mit den begrenzten Ergänzungen versioniert. Keine historische Modulversion wird zurückgespielt.

## Maskierung

Im Dashboard war bereits **Entspannt** ausgewählt; keine zusätzlichen Selektoren waren eingetragen. Diese Einstellung wurde nicht verändert. Die grobe Maskierung der Schriftkarten und des Budgetbereichs kommt aus den DOM-Attributen.

- Freigegeben: feste Schriftbezeichnungen, Schriftkarten-Preise und Maße, Preisrabatte/Steuerhinweise, Budgetkarten-Preise und Auswahlknöpfe, feste Optionen/Filter, Zubehörbedienung.
- Geschützt: Schildertext und Schriftproben, Schild-/Raumvorschau, private Farb-SVGs, eigene Schriftdateinamen, Uploadstatus, E-Mail-/Teilen-Dialoge, private Warenkorb-/Budgetinhalte.
- Die übergeordneten privaten Bereiche bleiben maskiert; nur sichere Kinder erhalten eigene Freigaben. Native Eingabefelder und Dropdowns bleiben gemäß Clarity maskiert.

## Neue Ereignisse und Filter

Alle Auswahlereignisse laufen als GA4 `configurator_choice` mit ausschließlich erlaubtem `choice_id` und `choice_value`, sowie als Clarity `nt_choice_<choice_id>`. Der Clarity-Tag `config_<choice_id>` enthält den erlaubten Auswahlwert. Es werden keine Texte, Dateinamen, Upload-IDs oder exakten Privatdaten gesendet.

| choice_id | Erlaubte Werte / Auslöser |
| --- | --- |
| font_source | bundled, catalog, uploaded; übernommene Schriftauswahl |
| font_library | neon, free, upload; geöffnete Bibliothek |
| color | feste IDs der 17 angebotenen Farben |
| light_mode | static, rgb |
| usage | indoor, outdoor |
| backing | contour, rectangle, square, freestanding |
| finish | clear, solid, uv-print, mirror-gold, mirror-silver |
| size | width, height; bestätigte manuelle Eingabe, Reglerabschluss oder Größenvorgabe |
| accessory | feste Zubehör-ID nach erfolgreicher Mengenänderung im Editor |
| delivery | standard, express; bestätigte Lieferauswahl vor Checkout |

Größeneingaben werden erst beim Bestätigen gemessen, nicht bei jedem Tastendruck. Regler senden beim Abschluss, nicht pro Bewegung. Wiederholte echte Aktionen bleiben sichtbar; bestehende Warenkorb-/Checkout-Deduplizierung bleibt unverändert.

Zusätzliche Fehlerstufen: `font_catalog`, `font_upload`, `size`, `options`, `cart`. Clarity-Ereignisse: `nt_<stage>_error`; Filter-Tags `error_stage` und `error_code`. Erlaubte Fehlercodes bleiben network, persistence_unconfirmed, storage, validation, unavailable. Keine rohen Fehlermeldungen. Wo ein Versuchsschlüssel existiert, wird derselbe Fehler desselben Versuchs nur einmal gemessen. Größen-/Optionsfehler entstehen aus konkreten Bedienversuchen.

## Nachweis und offene Punkte

Echte Aufnahme vom **21.10.2026, 18:25** (Dashboard-Anzeige), Dauer **10:08**, Benutzer `sj08rq`: [Aufnahme](https://clarity.microsoft.com/player/vvb78gxiwp/sj08rq/kze7zp/). Wiedergabe startete bei 00:00, lief bis 03:15 und wurde angehalten. Die Aufnahme zeigt tatsächlich maskierte Schriftkarten/Entwurfsbereiche; der Gesamtpreis war bereits sichtbar. Sitzungskennung `nts_db5d31f5cf29fb7dcfe79992ca57d2c0` im Informationen-Tab vorhanden. Dies ist eine vorhandene Aufnahme, kein Nachweis des noch unveröffentlichten Kandidaten.

Lokaler Browser: Text NEON QA, Warmweiß, Schriftwechsel Amsterdam → Nevada, ungültige Breite 1 cm → sichtbarer Mindestmaßfehler, gültige Breite 80 cm → aktualisierte Maße/Preise. Maskierungsattribute für Schriftproben, private Wurzeln und alle 17 Farb-SVGs gelesen. Keine Browserfehler gemeldet. Lokale Preise und Bedienung sind geprüft; die tatsächliche Aufnahme/Filterbarkeit der **neuen** Ereignisse muss nach Freigabe und Veröffentlichung erneut im Dashboard geprüft werden.

Tests: 7 neue Tracking-/Datenschutztests und 6 Warenkorbtests bestanden. 29 vorhandene Checkout-/Attributionstests gegen das vollständige Paket bestanden. 11 bestehende Kennungs-Laufzeittests bestanden. Ein vorhandener Template-Versionscheck schlägt bereits auf unverändertem `origin/main` fehl: `base.html` referenziert `4105556a9003`, während der aktuelle Helferhash `efd2b0ffba35` ist. Dieser unabhängige Versionsabgleich wurde nicht stillschweigend repariert oder als bestanden gewertet. Die erste Checkout-Testausführung scheiterte an in Git fehlenden veröffentlichten Modulen; gegen das verifizierte vollständige Paket bestehen die Tests. Der reproduzierbare Build warnt unverändert vor einem doppelten Schlüssel im übernommenen Fontkit-Vendorcode.

Quelle: [Microsoft Clarity Masking](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking). Maskierungsänderungen gelten nur für neue Aufnahmen; alte Aufnahmen lassen sich nicht nachträglich freigeben.

## Veröffentlichung und Rücknahme

Kandidat noch nicht veröffentlicht. Exakte SHA-Freigabe nach `AGENTS.md` erforderlich. Vor Veröffentlichung aktuellen Main-/Providerstand erneut abgleichen und `codex-predeploy ops` im sauberen Aufgabenworktree ausführen. Nur den geprüften vollständigen Pages-Kandidaten verwenden, nicht den unvollständigen Git-Ordner allein hochladen. Evidence-/Paketpfad: `/Users/danielklesse/Documents/Codex/2026-10-13/c/work/clarity-visibility-20261022/`.

Rollback bei unverändertem Stand: Pages-Deployment `dce741ac-5e6c-4179-80d7-b8e0903bb6d6`. Falls inzwischen andere Änderungen veröffentlicht sind, nur diese 13 Dateidifferenzen auf dem dann aktuellen Paket zurücknehmen.
