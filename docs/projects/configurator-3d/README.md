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

25 Tests: gespeicherte Daten/Optionen und Migration, 17 Farboptionen, farberhaltende Frontaufhellung, ungültige Eingaben, echte
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
- Frontbeleuchtung: Leuchtfarbe der Acrylfront und separate Lackfarbe der
  Edelstahlseiten. Die Metalloberflächen-Auswahl erscheint nur bei Rücklicht.
- Entwurfsvertrag Version 3 migriert Version 1 und 2. Frühere Frontoberflächen
  werden als Seitenfarbton übernommen; Rücklicht-Material und -Lackfarbe bleiben
  unabhängig. Text, Lichtart und bisherige Leuchtfarben bleiben erhalten.
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
  für Frontlicht Weiß/Schwarz, für Rücklicht Gold/Warmweiß her. Text,
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
  weicher aus und bleibt von der massiven Acrylkante getrennt.
  Frontlicht hat eine stärkere Emission und Lichtstreuung. Licht aus entfernt
  Emission und Halo, lässt die weiße Acrylschicht aber bestehen.
- Rücklicht-Karte, aktuelle Materialbeschreibung und Bildunterschrift nennen
  Edelstahl bzw. beim Gold-Look ausdrücklich „Edelstahl gold lackiert“.
  Naturstahl und verspiegelt werden weiterhin nicht als lackiert bezeichnet.
- Browserprüfung: rotes Rücklicht mit sichtbarer Acrylkante, Gold/Rücklicht,
  Frontlicht bei Tag/Nacht, Licht aus, 30/120/400 cm, Detail/Montage und mobile
  Bedienung bei 320 px ohne horizontalen Überlauf. Preisaufschlag weiterhin
  33/132/440 EUR für 30/120/400 cm Wunschfarbe; Kauf bleibt gesperrt.

## Farbpalette und Lichtwirkung

- 17 benannte Lichtfarben nach der vorhandenen Neon-Palette; auch die Acrylfront
  bietet 17 Vorgaben und weiterhin eine freie Farbe. Alle bisherigen Farbwerte
  bleiben gültig. Die Farbnamen stehen direkt unter den Auswahlpunkten, mobil
  in vier Spalten. Gespeicherte Entwürfe erhalten ihre Auswahl.
- Ein weißer, weichgezeichneter Konturmasken-Verbund bestimmt die Lichtverteilung.
  Die gewählte Farbe und ihre Intensität werden separat angewendet. Das ergibt
  einen deutlich kräftigeren, farbigen Wandschein, besonders bei Nacht.
- Die Acrylgeometrie behält exakt die Metallkontur und deren Innenräume.
  Ihre Seiten sind weiß; es gibt keine zusätzliche verbreiterte weiße Kontur
  um die Vorderseite. Frontal verdeckt der Edelstahl die gleich große
  Acrylrückseite. Die normale Perspektive zeigt den Schriftzug etwas schräger
  und näher, sodass die echte seitliche Schicht besser erkennbar ist.
- Browserprüfung: schwarze Edelstahlfront mit grünem Rücklicht frontal und
  perspektivisch bei Tag/Nacht, Neon-Pink samt Wiederherstellung, violette
  Frontbeleuchtung, Licht aus und alle 17 Farben bei 320 px Breite. Keine
  erfassten Konsolenfehler. Lichtwirkung bleibt eine Gestaltungsvorschau.

## Acrylschicht in der Gesamtansicht

Eine maßstäbliche 1-cm-Schicht an einem 400-cm-Schriftzug wird in der normalen
Vorschau kaum einen Bildpunkt breit. Die Darstellung betont deshalb ab 120 cm
Schriftzugbreite ausschließlich die Tiefe dieser Schicht: bis maximal 3 cm
Darstellungstiefe bei unveränderter 1-cm-Produktvorgabe. Der Hinweis unter der
Vorschau kennzeichnet dies. Maße, Entwurf, Warenkorb und Preisbasis bleiben
unverändert. Frontbeleuchtung verwendet diese Hervorhebung nicht.

Der Edelstahlkörper behält seine eigene Tiefe und liegt direkt vor dem Acryl.
Die Rückseite des Bauteils und die Abstandshalter zur Schiene bleiben an ihrem
Platz. Außenkontur und Innenräume werden nie verbreitert; frontal bleibt die
Acrylschicht durch den Edelstahl verdeckt. Die normale Perspektive ist etwas
schräger und näher. Die Tiefenhervorhebung bleibt beim Drehen und beim Wechsel
in die Detailansicht konsistent.

Geprüft: unveränderte Konturen und Produktdaten sowie alle bisherigen
Schienen-Raycasts zusätzlich mit der dargestellten Schichtdicke. Browser:
400 cm / 8 cm, schwarzer Edelstahl und grünes Rücklicht, normale Perspektive,
Frontal, Tag/Nacht, Licht aus, Desktop 1440×1150 und Mobil 320×740 ohne Überlauf.

## Farbtreue der Frontbeleuchtung

Die eingeschaltete Acrylfront verwendet eine glatte, überall gleich helle Leuchtfläche
mit dem gewählten Farbton, ohne zusätzliche Aufhellung durch das Szenen-Tonemapping
oder weiße Studioreflexionen. Der weiche Frontschein spart die massive
Buchstabenfläche aus und leuchtet um die Außenkontur und in die Innenräume.
Damit überstrahlen Material und Lichtschein die Front nicht mehr doppelt.
Ausgeschaltetes Acryl reflektiert nur die Umgebung und bleibt sichtbar dunkler.
Edelstahl, Rückbeleuchtung und die hervorgehobene rückseitige Acrylschicht
verwenden weiterhin ihre vorhandenen Materialien und Geometrien.

Browserprüfung: Blau und Rot bei Nacht, Pink und Grün bei Tag, sowie Ein-/Aus-
Vergleich von Grün. Die eingeschaltete Fläche bleibt farblich zur Auswahl passend;
der Lichtschein bleibt sichtbar. Die 18 Modell-/Geometrieprüfungen bestehen.

Eine begrenzte HSV-Aufhellung erhält den Farbton und mindestens 76 % der
ursprünglichen HSV-Sättigung. Die gesamte Front erhält dieselbe Leuchtfarbe,
innerhalb des darstellbaren RGB-Bereichs. Es gibt keinen Helligkeitsverlauf zur
Kontur und keine Fronttextur, die eine gewölbte Oberfläche vortäuschen könnte.
Der äußere Frontschein bleibt breit und kräftig; die Buchstabenfläche bleibt
davon ausgespart. Weiß bleibt neutral; nahezu schwarzes Acryl wird nicht
künstlich zu einer weißen Lichtquelle.

Zusätzlich geprüft: Blau/Rot bei Nacht, Grün bei Tag und mobile Darstellung bei
320×740. Test 18 prüft Farbton, Sättigung und RGB-Grenzen für alle Acrylvorgaben
und mehrere freie Farben. Keine erfassten Browserfehler. Rücklicht unverändert.


## Leuchtfarbe und Seitenlackierung bei Frontlicht

Der Materialschritt zeigt bei Frontbeleuchtung ausschließlich „Leuchtfarbe vorne“
(17 Vorgaben und eigene Farbe) und „Lackfarbe der Seiten“ (freie Farbe). Der
Edelstahlkorpus erhält die gewählte Lackfarbe; Gold-, Natur- und Spiegeloberflächen
werden nur für Rückbeleuchtung angeboten. Die flache, gleichmäßig leuchtende
Acrylfront und ihr farbiger Lichtschein bleiben unverändert.

`sideColor` ist im Entwurfsvertrag v3 von `body` (Rücklicht-Lackfarbe) getrennt.
Alte v1-/v2-Entwürfe und Warenkörbe werden beim Laden migriert, wobei die bisherige
Frontoberfläche ihren Farbton als Seitenlackierung behält. „Zurück zu Weiß“ und
„Zurück zu Schwarz“ setzen jeweils nur eine Farbe zurück; „Look zurücksetzen“
stellt weißes Licht mit schwarzen Seiten her. Die Rücklicht-Auswahl bleibt erhalten.
Zusammenfassung und Warenkorb führen beide Farben getrennt auf.

Geprüft: 20 Modell-/Geometrietests inklusive Migration aller v2-Frontoberflächen
und unabhängiger Rücksetzungen. Im Browser: Variantenwechsel, beide Einzelresets,
Neuladen, Warenkorb speichern/erneut laden/bearbeiten sowie Desktop 1440×1150 und
Mobil 320×740. Kein horizontaler Überlauf und keine erfassten Konsolenfehler.
Testeintrag entfernt. Weiterhin nur lokale Vorschau, Preisplatzhalter und kein Kauf.


## Standard-Lackfarben und RAL CLASSIC

Alle vier Lackbereiche (Frontlicht-Seiten, Rücklicht-Front/Korpus, Schiene in
Wunschfarbe und Trägerplatte) bieten Schwarz, Weiß und Gold als direkte Farbfelder,
einen freien Farbwähler und eine optionale RAL-Eingabe mit Vorschlagsliste.
RAL wird ausschließlich für Lackierungen angeboten, nicht für LED-Lichtfarben.
Bei Rücklicht ist die Eingabe auch aus dem goldlackierten Look erreichbar; eine
abweichende Lackwahl wechselt zu „Edelstahl lackiert“.

`ral.js` enthält 216 RAL-CLASSIC-Nummern, deutsche Namen und die näherungsweisen
Bildschirmfarbfelder aus der öffentlichen [RAL-Farben-Übersicht](https://www.ral-farben.de/alle-ral-farben),
abgerufen am 21.10.2026. Das [RAL-CLASSIC-System](https://www.ral-farben.de/ral-classic)
verwendet vierstellige Nummern. Die Auswahl prüft echte Katalogeinträge; „7016“,
„RAL 7016“ und „ral7016“ werden gleich behandelt. Ungültige oder unvollständige
Nummern verhindern die Übernahme eines aktiven Lackbereichs in den Warenkorb.
Es werden keine externen Dienste zur Laufzeit geladen. Der Hinweis am Feld
kennzeichnet die Vorschau als Bildschirmnäherung, nicht als verbindliches Farbmuster.

Die zusätzlichen v3-Felder `sideRal`, `bodyRal`, `railRal` und `plateRal` speichern
die jeweiligen RAL-Spezifikationen unabhängig. Beim Laden bestimmt ein gültiger
RAL-Ton seine Vorschaufarbe; alte Entwürfe ohne RAL bleiben unverändert. Ein
Standardfarbfeld oder eine eigene Farbe entfernt nur die RAL-Zuordnung der
betroffenen Fläche. Beim Entfernen allein der RAL-Zuordnung bleibt die zuletzt
angezeigte Vorschaufarbe erhalten. Generisches Gold wird keinem RAL-Ton gleichgesetzt.
Zusammenfassung und Warenkorb nennen die aktive RAL-Nummer mit Farbnamen.

Geprüft: 24 Modell-/Geometrietests, alle 216 Katalogeinträge, unabhängige
Speicherung/Normalisierung, Farbumschaltung, Rücksetzungen, aktive Eingabeprüfung,
Schienenfarbaufpreis und gesperrter Checkout. Browser: Seiten-Gold, RAL 9016,
freie Farbe und ungültige Nummer; RAL 3000 auf Rücklichtfront, RAL 7016 an der
Schiene, RAL 6005 an der Platte; Neuladen, Warenkorb/Bearbeiten und Variantenwechsel.
Mobile Prüfung bei 320×740 ohne horizontalen Überlauf, Desktop 1440×1150/1410,
keine erfassten Browserfehler. Testeintrag entfernt. Nur lokale Vorschau.


## Visuelle RAL-Auswahl

Die native Vorschlagsliste ist durch einen gemeinsamen RAL-Picker für alle vier
Lackbereiche ersetzt. Jeder Eintrag zeigt ein Farbfeld, den deutschen Farbnamen
und die RAL-Nummer. Die gewählte Farbe bleibt als eigene Zeile mit Farbfeld und
Name sichtbar. Die Liste ist scrollbar, zweispaltig auf Desktop und einspaltig
auf schmalen Mobilgeräten.

Die Suche filtert nach Nummer, Teilname oder Kombination, unabhängig von
Groß-/Kleinschreibung; „weiss“ und „grun“ finden auch Namen mit ß bzw. Umlaut.
Direkte gültige Nummern werden weiterhin übernommen. Suchbegriffe bleiben nur
im Picker und werden nicht als Lack-Spezifikation gespeichert. Klick bzw.
Pfeiltasten/Enter wählen einen realen Eintrag. Escape oder Verlassen des Pickers
bricht eine offene Suche ab und stellt die vorherige Auswahl wieder her.
Während einer offenen, noch nicht gewählten Suche ist die Übernahme deaktiviert.

Geprüft: 25 Modell-/Geometrietests inklusive Suche nach jedem der 216 Namen und
Nummern, Teilnamen, kombinierten Begriffen sowie leeren Treffern. Browser:
Mausauswahl, Pfeiltasten/Enter, direkte Nummer, Escape, Neuladen und Farbfelder
für Seiten, Rücklichtfront, Schiene und Platte. Desktop 1440×1150 und Mobil
320×740 ohne Überlauf, keine erfassten Konsolenfehler. Preis-/Bestellvertrag
und RAL-Speicherung unverändert. Nur lokale Vorschau.

## RAL-Farbgruppen

Alle vier RAL-Picker bieten „Alle“ sowie Weiß, Schwarz, Grau, Blau, Grün,
Gelb / Beige, Orange, Rot, Violett und Braun als kombinierbare Suchfilter.
Die Gruppen folgen den CLASSIC-Nummernfamilien; die neutralen 9xxx-Töne sind
auf Weiß, Schwarz und Grau/Aluminium verteilt. Jeder der 216 Töne ist genau
einer Gruppe zugeordnet. Farbpunkte und ein sichtbarer Auswahlrahmen ergänzen
die Gruppennamen. Auf schmalen Geräten brechen die Gruppen in mehrere Zeilen um.

Ein Gruppenwechsel erhält den Suchtext und verändert die gewählte Lackierung
nicht. Auch das Leeren der Suche erhält die Lackierung; die separate ×-Schaltfläche
entfernt die RAL-Zuordnung. Die gespeicherte Auswahl bleibt unter der Trefferliste sichtbar. Eine
gültige direkt eingegebene RAL-Nummer hebt den Gruppenfilter auf, damit ihr
Treffer sichtbar bleibt. Escape bzw. Verlassen des Pickers stellt das
Auswahlfeld wieder her; beim erneuten Öffnen startet die Suche mit „Alle“.
Ein erneuter Klick öffnet auch ein gerade per Escape geschlossenes Suchfeld.

Geprüft: 26 Modell-/Geometrietests inklusive vollständiger Gruppenzuordnung,
neutraler Sonderfälle und kombinierter Suche. Browser: Gruppenwechsel mit
Suchtext, keine Treffer, „Alle“, Auswahl per Pfeiltasten/Enter, direkte Nummer
aus anderer Gruppe, Escape/Wiederöffnen und alle vier Lackbereiche. Die
bestehenden Lackierungen bleiben beim Filtern erhalten. Desktop 1440×1150 und
Mobil 320×740 ohne horizontalen Überlauf, keine erfassten Browserfehler.
Nur lokale Vorschau; Preis- und Bestelllogik unverändert.

## Gold und Silber direkt finden

Die RAL-Filter beginnen nach „Alle“ mit Gold und Silber. Gold enthält Goldgelb
(RAL 1004) und Perlgold (RAL 1036); Silber enthält Silbergrau (RAL 7001),
Weißaluminium (RAL 9006), Graualuminium (RAL 9007), Perlhellgrau (RAL 9022) und
Perldunkelgrau (RAL 9023). Diese zusätzlichen Suchgruppen belassen alle Töne
auch in ihren bisherigen Gelb-/Beige- und Grau-Gruppen. Sie fügen keine neuen
RAL-Töne hinzu und ändern weder Lack-Spezifikation noch Materialdarstellung.

Geprüft: 27 Modell-/Geometrietests; zusätzliche Gruppen, kombinierte Namens- und
Nummernsuche sowie unveränderte Katalogabdeckung. Browser: Gold/Silber,
„aluminium“ innerhalb Silber, erhaltene Lackierung, Desktop 1440×1150 und
Mobil 320×740 ohne horizontalen Überlauf. Keine erfassten Browserfehler.
Nur lokale Vorschau.

## Gebürstete Gold- und Silbervorschau

Gold und Silber werden mit gerichteten Metallreflexionen, einer feinen
horizontalen Bürststruktur und einer dezenten Lackreflexion dargestellt. Das
gilt für die vorhandenen gebürsteten Edelstahloberflächen, den Standard-Goldton
und die RAL-Töne der zusätzlichen Gold-/Silbergruppen. Die Zuordnung gilt für
Rücklichtfront/Korpus, Frontlichtseiten, Schiene und Platte. Beliebige gelbe oder
graue Eigenfarben erhalten keine automatische Metallzuordnung. Gespeicherte
RAL-Codes, Vorschau-Grundfarben, Produktmaße und Preislogik bleiben erhalten.
Die Oberflächenwirkung ist weiterhin eine illustrative Gestaltungsvorschau.

Der Renderer verwendet dafür `MeshPhysicalMaterial` mit Anisotropie und eine
separate lokale Studio-Umgebung mit breiten Reflexionsflächen. Deterministische
Farb-/Rauheitstexturen bilden feine, längliche Schliffspuren; ihre geringe
Normalenwirkung vermeidet grobe Streifen oder eine gewölbt wirkende Fläche.
Die Texturkoordinaten sind über Buchstaben und Träger ausgerichtet. Gemeinsame
Texturen bleiben beim Materialwechsel erhalten. Andere Lackfarben, die
Spiegelfläche und die leuchtende, gleichmäßig flache Acrylfront behalten ihre
bisherige Darstellung.

Geprüft: 29 Modell-/Geometrietests, einschließlich Metallzuordnung aller sieben
RAL-Töne in allen vier Lackbereichen, Erhalt der Acryl-/Lichtfarben und
UV-Anpassung ohne Geometrieänderung. Browser: Gold und Silber bei Tag, Gold bei
Nacht, normale Perspektive/Frontal/Detail, RAL 1036 und 9006 sowie Goldseiten
bei blauer Frontbeleuchtung. Desktop 1440×1150 und Mobil 390×844 ohne Überlauf
oder erfasste Browserfehler. Nur lokale Vorschau.

Die Bürststruktur wurde anschließend für die normale Perspektive deutlicher
abgestimmt: höherer Kontrast in der Farb- und Rauheitstextur bei unverändert
schmalen, in Längsrichtung wechselnden Schliffspuren. Texturmaßstab, Linienbreite,
Normalenstärke und Licht bleiben gleich. Geprüft in normaler Perspektive,
Detail und Nacht sowie mobil bei 390×844; keine erfassten Browserfehler.
Die zwei betroffenen Material-/UV-Tests und Syntaxprüfung bestehen.

Die lokale Reflexionsumgebung für gebürstetes Metall ist nun weicher aufgehellt:
Dunkle Zwischenräume sind angehoben und helle Reflexionsflächen gedämpft. Dadurch
bleibt der Goldton über den Schriftzug gleichmäßiger, während die gerichteten
Reflexionen mit dem Blickwinkel wechseln. Bürsttexturen, Rauheit, Metallanteil,
Normalenstärke und gespeicherter Farbton sind unverändert. Geprüft: normale
Goldperspektive, Detail, Nacht und Silber; keine erfassten Browserfehler, beide
betroffenen Material-/UV-Tests und Syntaxprüfung bestanden. Nur lokale Vorschau.

Für sichtbarere Glanzwechsel beim Drehen ist die Metallrauheit etwas reduziert
und die Lackreflexion schärfer abgestimmt. Schmale, weich auslaufende Lichtflächen
in der Reflexionsumgebung ergänzen die gleichmäßige Grundbeleuchtung. Deren
Helligkeitsniveau und die feine Bürststruktur bleiben erhalten. Geprüft: normale
Goldperspektive und Nachtansicht sowie seitliche Blickwinkel bei −60°, −30°,
30° und 60° mit dem realen Renderer in einer lokalen Prüfansicht. Keine erfassten
Browserfehler; beide betroffenen Material-/UV-Tests und Syntaxprüfung bestanden.
Nur lokale Vorschau.
