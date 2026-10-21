# NEONTRIP 3D-Schilder-Konfigurator

Stand: 21.10.2026. Implementierung und Veröffentlichungskandidat; noch nicht live.

## Auftrag und aktueller Umfang

Eigener Konfigurator im Stil des vorhandenen Neon-Editors. Zwei Lichtarten
(Frontlicht / Rücklicht), drei Montagearten (einzeln / Schiene / Platte).
Der Kunde soll später Direktpreise sehen und über Shopify kaufen. Die hierfür
notwendige Kalkulation wird vom Auftraggeber geliefert und liegt noch nicht vor.
Der Auftraggeber hat am 21.10.2026 ausdrücklich Platzhalter bis dahin gewählt: 
„kommt später nimm platzhalter“. Die Anzeige lautet „— €“ / „Preis folgt“.

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

`quote3D` gibt bis dahin `status:placeholder`, ausschließlich `grossCents:null` und
`purchaseEnabled:false` zurück. Der Kassenbutton ist deaktiviert. Es gibt
keinen API-Aufruf, keine Bestellung und keine alternative Angebotsanfrage.

## Veröffentlichung

Die neue Route ist für dieselbe anfrage.neontrip.de-Website vorbereitet.
Die Leuchtbuchstaben-Seite erhält einen zusätzlichen Link im Produktmenü und
im mobilen Menü. Die bisherigen Anfragebuttons bleiben erhalten. Im Builder
aktiviert nur diese Seitenkonfiguration `show_3d_configurator`.

Die bestehende generierte Landingpage ist nicht bytegleich aus dem älteren
Builder reproduzierbar. Deshalb wurden nur beide Links gezielt eingefügt;
Entfernen dieser Einfügungen ergibt exakt das bisherige HTML. Die Quellen
sind ebenfalls aktualisiert. Kein umfassender Neuaufbau fremder Seiten.

Produktionsbasis ist Pages-Deployment `5840b9ed-0f46-4313-b317-75264f5b0744`,
Commit `273351ddabfb72958dedcc928f903c414f2477af`. Sein vollständiges Artefakt
liegt unter `/Users/danielklesse/Documents/Codex/2026-10-20/https-clarity-microsoft-com-projects-view/work/step-latency/candidate`.
Die daneben liegenden Functions werden unverändert übernommen.
Das Veröffentlichungspaket dieses Chats liegt unter
`/Users/danielklesse/Documents/Codex/2026-10-21/kan-2/work/3d-release/`.
Es ergänzt ausschließlich die neue Route, die beiden Links und ihre Quellen.
Das bestehende Neon-Bundle bleibt bytegleich zum veröffentlichten Stand.
`origin/main` enthält nicht alle Konfigurator-Assets. Nie den unvollständigen
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
