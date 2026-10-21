# NEONTRIP 3D-Schilder-Konfigurator

Stand: 21.10.2026. Lokale Implementierung; keine Veröffentlichung.

## Auftrag und aktueller Umfang

Eigener Konfigurator im Stil des vorhandenen Neon-Editors. Zwei Lichtarten
(Frontlicht / Rücklicht), drei Montagearten (einzeln / Schiene / Platte).
Der Kunde soll später Direktpreise sehen und über Shopify kaufen. Die hierfür
notwendige Kalkulation wird vom Auftraggeber geliefert und liegt noch nicht vor.

Umgesetzt: Text (auch einzelne Buchstaben, bis zwei Zeilen), drei Schriftstile,
Licht-/Korpusfarbe, Plattenfarbe, Wunschbreite, proportionale Höhe, Wunschtiefe,
Buchstabenabstand, echte WebGL-Geometrie mit Tiefe und Schatten, Konturlicht,
Tag/Nacht, drei Wandfarben, Perspektiven und manuelle Drehung/Zoom, PNG-Export,
Entwurfswiederherstellung sowie separater lokaler 3D-Warenkorb mit Bearbeiten,
Mengen, Entfernen und weiteren Entwürfen. Kein Logo-Upload in diesem Umfang.

## Ablage und lokale Vorschau

Neue Route: `/3d-konfigurator/`, sämtliche produktspezifischen Dateien in
`deploy/3d-konfigurator/`. Gemeinsame Marke, Inter und Favicon werden aus
vorhandenen `/assets/`-Pfaden geladen. Keine CDN-Abhängigkeit.

Aus dem Worktree:

    python3 -m http.server 18876 --bind 127.0.0.1 --directory deploy

Vorschau: http://127.0.0.1:18876/3d-konfigurator/

- `app.js`: UI, Eingaben, Entwurf und Warenkorb.
- `model.js`: Konfigurationsvertrag, Normalisierung, Validierung, Zusammenfassung.
- `renderer.js`: Schriftgeometrie und 3D-Darstellung.
- `pricing.js`: gesperrte Preis-Schnittstelle ohne erfundene Regeln.
- `vendor/`: Three.js 0.170.0 aus der vorhandenen neontrip-ar-Installation.
- `fonts/`: drei mit Three.js gelieferte Schriften, Lizenzhinweise liegen bei.

Previews sind keine Fertigungsfreigabe. Plattenrand 8 cm, Schienenposition,
Distanz zur Wand, Tiefenauswahl und Breitenbereich sind vorläufige
Darstellungsparameter. Sie sind mit der späteren Produktkalkulation und
Fertigung abzugleichen. Lichtwirkung ist visuell, keine photometrische Simulation.

## Preis und Checkout – noch erforderlich

1. Bestätigte 3D-Preisregeln: Front/Rück, Berechnungsbasis, Größenstaffeln,
   Mindestpreis, Material-/Tiefenunterschiede, Schiene/Platte, Farben,
   Menge, Mehrwertsteuer, Versand und Lieferoptionen.
2. Eigener serverseitiger 3D-Vertrag und verbindliche Preisberechnung im
   Offers-Backend. Der bisherige Neon-Vertrag prüft Schlauchgeometrie und darf
   hierfür weder umgangen noch mit 3D-Konfigurationen beschickt werden.
3. Deterministisch gespeicherte Konfiguration, geprüfte Maße, versionsgebundene
   Preise und wiederverwendbarer Shopify-Checkout pro identischem Warenkorb.
4. Echte Vorschau-/Bestellreferenz und Zuordnung zur nachgelagerten Produktion.
5. Passende bestehende Einwilligungs-/Messlogik, erfolgreiche Kaufmessung erst
   auf der bestätigten Bestellung. Die lokale Vorschau lädt keine Tracker.

`quote3D` gibt bis dahin ausschließlich `grossCents:null` und
`purchaseEnabled:false` zurück. Der Kassenbutton ist deaktiviert. Es gibt
keinen API-Aufruf, keine Bestellung und keine alternative Angebotsanfrage.

## Veröffentlichung

Die neue Route ist für dieselbe anfrage.neontrip.de-Website vorbereitet. Der
bestehende Neon-Konfigurator und Landingpages sind unverändert. Nach der
Kaufanbindung den Einstieg auf der Leuchtbuchstaben-Seite ergänzen und das
vollständige aktuelle Pages-Release um die neue Route erweitern; origin/main
enthält nicht alle bestehenden Konfigurator-Assets. Nie den unvollständigen
`deploy/`-Ordner allein als kompletten Seitenersatz ausliefern.

AGENTS.md verlangt vor Produktion den überprüften vollständigen Commit,
konkrete Freigabe, Abgleich mit aktuellem Main und `codex-predeploy ops` sowie
`codex-safe-push-main`. Kein Produktionspush in diesem Zwischenstand.

## Prüfung

    node --test tests/configurator-3d/model.test.mjs
    node --check deploy/3d-konfigurator/app.js
    node --check deploy/3d-konfigurator/renderer.js

6 Tests: gespeicherte Daten/Optionen, ungültige Eingaben, echte Schriftkonturen
inklusive Innenräumen und fehlender Glyphen, Abstände/Proportionen, gesperrte
Preis- und Kaufberechnung für alle sechs Kombinationen, vollständige Übersicht.

Browser: Desktop 1440×1000 sowie Mobil 390×844 und 320×740. Front/Rück, Tag/Nacht,
Schiene/Platte, Einzelbuchstabe, Schriftwechsel, 180-cm-Maß und 8-cm-Tiefe,
Zusammenfassung, lokales Hinzufügen/Bearbeiten, Menge mit Reload und
Eingabesperre bei drei Zeilen geprüft. Kein horizontaler Überlauf an den
geprüften Breiten. Keine erfassten Browserfehler. Kein Realgeräte-/Safari- oder
Kauftest. Der Browsertest fand eine bei Fokuswechsel nicht gespeicherte Menge;
die Mengenänderung speichert nun direkt auf `input`, erneut mit Reload belegt.
