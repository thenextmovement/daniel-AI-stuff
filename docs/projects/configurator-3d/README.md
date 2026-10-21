# NEONTRIP 3D-Schilder-Konfigurator

Stand: 21.10.2026. Implementierung und Veröffentlichungskandidat; noch nicht live.

## Auftrag und aktueller Umfang

Eigener Konfigurator im Stil des vorhandenen Neon-Editors. Zwei Lichtarten
(Frontlicht / Rücklicht), drei Montagearten (einzeln / Schiene / Platte).
Der Kunde soll später Direktpreise sehen und über Shopify kaufen. Die hierfür
notwendige Kalkulation wird vom Auftraggeber geliefert und liegt noch nicht vor.
Der Auftraggeber hat am 21.10.2026 ausdrücklich Platzhalter bis dahin gewählt:
„kommt später nimm platzhalter“. Die Anzeige lautet „— €“ / „Preis folgt“.

Umgesetzt: Text (auch einzelne Buchstaben, bis zwei Zeilen), neun Schriftstile,
Lichtfarbe, Edelstahloberflächen, freie Acryl-/Lack-/Schienen-/Plattenfarben, Wunschbreite, proportionale Höhe, Wunschtiefe,
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
- `fonts/`: drei Three.js-Schriften sowie sechs zusätzliche lokale Outline-Schriften mit Lizenzhinweisen und SVG-Vorschauen.

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
einen direkt sichtbaren Einstieg unter dem Einleitungstext, auch mobil. Die bisherigen Anfragebuttons bleiben erhalten. Im Builder
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

15 Tests: gespeicherte Daten/Optionen und Migration, ungültige Eingaben, echte
Schriftkonturen inklusive Innenräumen, Abstände/Proportionen, gesperrter Kauf,
Materialtrennung, Acrylrückseite, unabhängige Oberflächen sowie der vorläufige
Farbaufpreis der Schiene mit Länge, Menge und Ausschluss anderer Montagearten.

Browser: Desktop 1440×1000 sowie Mobil 390×844 und 320×740. Front/Rück, Tag/Nacht,
Schiene/Platte, Einzelbuchstabe, Schriftwechsel, 180-cm-Maß und 8-cm-Tiefe,
Zusammenfassung, lokales Hinzufügen/Bearbeiten, Menge mit Reload und
Eingabesperre bei drei Zeilen geprüft. Kein horizontaler Überlauf an den
geprüften Breiten. Keine erfassten Browserfehler. Kein Realgeräte-/Safari- oder
Kauftest. Der Browsertest fand eine bei Fokuswechsel nicht gespeicherte Menge;
die Mengenänderung speichert nun direkt auf `input`, erneut mit Reload belegt.

Zusatzprüfung des Veröffentlichungskandidaten: Das bisherige mobile Menü
hat keinen sichtbaren Auslöser. Der neue Einstieg steht deshalb direkt im Hero
und ist ohne Menüöffnung erreichbar. Preisplatzhalter und gesperrte Kasse
wurden im Browser bestätigt.

## Material- und Aufbaukorrekturen vom 21.10.2026

Vorgaben des Auftraggebers:

- Rückbeleuchtung startet bei neuen Entwürfen mit gebürstetem, gold lackiertem
  Edelstahl. Weitere Oberflächen: Edelstahl gebürstet in Natur, poliert/
  verspiegelt oder farbig lackiert. Alte Entwürfe werden nicht still auf Gold
  geändert.
- Vorne Metall, hinten eine eigene weiße, opale Acrylschicht in exakt derselben
  Buchstabenform mit denselben Innenräumen. Die Acrylschicht wird von innen
  beleuchtet; der Lichtaustritt zeigt zur Wand. Metallflächen emittieren nicht.
- Frontbeleuchtung: freie Farbe der Acrylfront, Edelstahlkorpus und Edelstahl-
  Rückseite. Die Acrylfarbe ist unabhängig von der LED-Farbe des Rückleuchters.
- Separate gespeicherte Oberflächen für Front-/Rückbeleuchtung; Entwurfsvertrag
  Version 2 migriert Version 1 und erhält Text, Lichtart und bisherige Farben.
- Drei Schritte: Look (Beleuchtung zuerst, Text, Schrift), Material (abhängige
  Oberflächen und Farben), Aufbau (Montage, Schienen-/Plattenfarbe, Maße).

Die 3D-Darstellung verwendet separate Front-, Zargen- und Rückseitengeometrien.
Beim Rückleuchter entfällt der verschlossene metallische Rückdeckel. Die
Acrylschicht liegt innerhalb der gewählten Gesamttiefe, mit illustrativer
Schichtdicke von bis zu 1 cm. Diese Visualisierung ersetzt keine freigegebene
Fertigungskonstruktion. Ein lokal erzeugtes Studio-Umgebungslicht erzeugt
blickwinkelabhängige Spiegelungen; die gebürsteten Oberflächen verwenden eine
feine gerichtete Struktur. Es werden keine Kamera-/Umgebungsbilder aufgenommen.

Abgeglichene Referenz für die opale Rückseite (keine Übernahme fremder Preise,
Lieferzeiten oder Maße als verbindliche NEONTRIP-Produktdaten):
https://www.buchstaben-jaeckel.de/profil-3-leuchtbuchstaben-199.html

## Bestätigter vorläufiger Farbaufpreis der Schiene

Der Auftraggeber nennt ca. 110 Euro pro laufendem Meter und bestätigt auf
Rückfrage ausdrücklich: **nur Aufpreis für die Wunschfarbe**.

- Standardausführung: kein Farbaufpreis; kein kostenloser Schienen-Grundpreis.
- Wunschfarbe: freie Farbe, auch in der Vorschau, im Entwurf und Warenkorb.
- Vorschau-Schienenlänge entspricht der gewählten Schriftzugbreite. Der
  vorläufige Aufpreis ist `Breite in cm / 100 × 110 Euro × Menge`.
- Beispiele: 120 cm → ca. 132 Euro; zwei Stück → ca. 264 Euro.
- Keine Anwendung auf Platte oder Einzelbuchstaben. Kein Aufrunden auf volle
  Meter. Eine abweichende spätere echte Schienenlänge muss aus der Fertigungs-
  und Preislogik kommen.
- `railColorEstimate` kennzeichnet den Wert als vorläufig und lässt die
  Steuerbasis offen. Gesamtpreis und Shopify-Kasse bleiben gesperrt, bis
  Grundkalkulation, Steuerbasis und verbindliche Backendberechnung vorliegen.

Browsernachweis dieser Erweiterung: Front/Rück und unabhängige Oberflächen,
Gold als neuer Standard, verspiegeltes Metall, weiße Acrylrückseite mit/ohne
Licht, freie Acrylfarbe `#D74275`, Schiene `#23594E`, 132/264-Euro-Farbaufpreis,
Warenkorb und Neuladen. 320×740, 390×844 und 1440×1000 geprüft, kein horizontaler
Überlauf, keine erfassten Konsolenfehler. Testeintrag wieder entfernt.


## Vorschaukorrekturen und Schriften vom 21.10.2026

- Glatte Acrylfront: Die Kamera passt ihre Nah-/Fernbegrenzung an die Entfernung
  an. Der bisher feste Nahwert von 0,1 cm verursachte bei großen Schildern
  Tiefenkonflikte zwischen Front und Lichtschein. Beide behalten ihre räumliche
  Position; Material und Schatten werden nicht zur Kaschierung abgeschaltet.
- „Zurück zu Weiß“ setzt nur die Acrylfront zurück. „Look zurücksetzen“ stellt
  für Frontlicht Weiß/Naturedelstahl, für Rücklicht Gold/Warmweiß her. Text,
  Schrift, Maße, Montage, Schienenfarbe und die andere Lichtvariante bleiben
  erhalten. Bedienung ist bei 320 px Breite erreichbar.
- Schiene: nach abschließender Klarstellung mittig hinter dem Schriftzug an
  der Wand. Ihre Vorderseite endet bei z=4 cm, die Rückseite des gesamten
  Buchstabenbauteils beginnt bei z=9 cm. Nur Abstandshalter überbrücken diese
  Lücke. Kontaktpunkte liegen in massiven Konturbereichen. Durch offene
  Buchstaben-Zwischenräume und Innenräume bleibt die Schiene sichtbar.
  Die zwischenzeitlich besprochene Montage unterhalb wurde ausdrücklich
  verworfen und ist nicht umgesetzt. Maße der Halter bleiben illustrativ.
- Sechs zusätzliche Schriften: Montserrat, Poppins, Oswald, Bebas Neue,
  Cormorant Garamond sowie Serif Soft (Outline-Ableitung von Lora mit eigenem
  Familiennamen). Die bisherigen Modern/Klassisch/Elegant bleiben für bestehende
  Entwürfe erhalten. Jede Auswahlkarte zeigt die tatsächlich verwendeten
  Konturen. Alle sechs neuen Schriften enthalten deutsche Umlaute und ß.
- Die alte Helvetiker-„Modern“-Datei hat weiterhin ihren ursprünglichen
  Zeichenvorrat ohne deutsche Umlaute. Nicht unterstützte Zeichen werden wie
  bisher explizit gemeldet; es gibt keinen stillen Austausch der Schrift.
- Schriftwahl bleibt beim Neuladen und beim Warenkorb-Bearbeiten erhalten;
  die Zusammenfassung und Warenkorbzeile nennen die gewählte Schrift.

Font-Quellen sind auf den Google-Fonts-Commit in `fonts/sources.json` festgelegt.
OFL-Texte/Copyright bleiben in separaten Dateien und den Outline-Metadaten.
`fonts/FONTLOG.txt` dokumentiert Konvertierung und Umbenennung. Die einmalige
Konvertierung läuft mit `tools/configurator-3d/build-fonts.py` und den Versionen
in `requirements.txt`, anschließend `node tools/configurator-3d/build-font-previews.mjs`.
Die Website lädt nur lokale JSON-/SVG-Dateien, keine Font-API. Das Entfernen
überlappender Konturen ist nötig: Variable Fonts speichern etwa A-Querbalken
teilweise separat; erst ihre Vereinigung erhält korrekte Innenräume und Zargen.

Prüfung: 15 bestandene Tests einschließlich tatsächlicher Font-Triangulation,
Umlauten der neuen Schriften, Innenräumen sowie Raycasting: 9 Schriften ×
3 Breiten (30/120/400 cm) × 2 Lichtarten × 2 Tiefen. An jedem geprüften
Montagepunkt verdeckt die massive Front die Schiene frontal und schräg;
alle Bauteile einschließlich Acryl liegen vollständig davor. Der Detailausschnitt
behält mehrteilige Zeichen einschließlich Umlauten zusammen. Browserprüfung aller
9 Schriften, 400-cm-Frontlicht bei Tag/Nacht und schräger Sicht, 30-cm-Format,
Rücksetzungen, gespeicherte Montserrat-Auswahl mit „MÜNCHEN“ und lokalem
Warenkorb-Bearbeiten. Testposition wieder entfernt. Keine echte Bestellung.

Die zusätzlich angesprochenen Acryl-Tischgeräte unter localhost:18773 werden
in einem separaten lokalen Artefakt bearbeitet. In diesem Chat wurden die dort
bereits aktualisierten Dateien nur gelesen und die Vorschau geprüft: Logo-Rand
blendet aus, weißer Sockel sichtbar, USB/Batterie-Text nennt beide Betriebsarten,
4 Stück wählen die 3–4er-Staffel mit 316 Euro. Diese Dateien sind kein Bestandteil
des 3D-Releases und wurden hier nicht überschrieben.


## Sichtbarer Schichtaufbau und Nachtansicht

- Rücklicht bleibt ein echtes Bauteil aus Edelstahlkörper und 1 cm weißem,
  opalem Acryl direkt an dessen Rückseite. Die gewählte Gesamttiefe enthält
  diese Schicht. Innenliegende LEDs beleuchten das Acryl und strahlen zur Wand.
  Die Acrylseiten verwenden eine eigene Materialintensität, damit ihre Kante
  neben dem hellen Lichtschein auf der Wand erkennbar bleibt. Der Lichtschein
  ist eine getrennte Fläche an der Wand und ersetzt keine Acrylgeometrie.
- Detail und „Montage von der Seite ansehen“ rahmen den letzten Buchstaben
  vergrößert ein. Letzteres zeigt die Befestigung auf der Schiene. Perspektive,
  Frontal und Ansicht zurücksetzen zeigen wieder den gesamten Schriftzug.
- Nacht reduziert auch die Umgebungsreflexionen der Wand und Halter sowie die
  direkte Beleuchtung. Nur den Hintergrund zu verdunkeln hatte zuvor die
  tatsächlich sichtbare Wand zu hell gelassen. Der mehrstufige Halo läuft
  weicher aus; seine Intensität bleibt unter der leuchtenden Acrylkante.
  Frontlicht hat eine stärkere Emission und Lichtstreuung. Licht aus entfernt
  Emission und Halo, lässt die weiße Acrylschicht aber bestehen.
- Rücklicht-Karte, aktuelle Materialbeschreibung und Bildunterschrift nennen
  Edelstahl bzw. beim Gold-Look ausdrücklich „Edelstahl gold lackiert“.
  Naturstahl und verspiegelt werden weiterhin nicht als lackiert bezeichnet.
- Browserprüfung: rotes Rücklicht mit sichtbarer Acrylkante, Gold/Rücklicht,
  Frontlicht bei Tag/Nacht, Licht aus, 30/120/400 cm, Detail/Montage und mobile
  Bedienung bei 320 px ohne horizontalen Überlauf. Preisaufschlag weiterhin
  33/132/440 EUR für 30/120/400 cm Wunschfarbe; Kauf bleibt gesperrt.
