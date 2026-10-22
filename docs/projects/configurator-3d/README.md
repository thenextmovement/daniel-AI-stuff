# NEONTRIP 3D-Schilder-Konfigurator

Stand: 22.10.2026. Implementierung und Veröffentlichungskandidat; noch nicht live.

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
Mengen, Entfernen und weiteren Entwürfen. Vier Schritte: Look, Farben, Größe und
Prüfen. Die Zusammenfassung erlaubt direkte Rücksprünge zum jeweiligen Bereich.
Kein Logo-Upload in diesem Umfang.

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

Silber hat eine eigene Edelstahl-Abstimmung: neutrale Reflexionsflächen über
einem mittleren Grauton, eine etwas schärfere gerichtete Metallreflexion und
eine zurückhaltendere Lackreflexion. Die Tagesintensität begrenzt weiße Flächen;
in der Nacht bleibt genügend Reflexionslicht für lesbares gebürstetes Metall.
Das Profil wird ausdrücklich für Natur-Edelstahl und die vorhandenen Silber-
RAL-/Eigenfarbzuordnungen verwendet, einschließlich Seiten, Schiene und Platte.
Gespeicherte Farbwerte und Gold-Abstimmung bleiben erhalten. Die feinen
Bürsttexturen werden weiter gemeinsam genutzt.

Geprüft: alle 29 Modell-/Geometrietests, einschließlich Silber-/Goldprofilen
über alle Lackbereiche, unveränderten Materialfarbwerten und nichtmetallischem
Acryl; Syntax- und Diffprüfung. Im Browser normale Perspektive, Frontalansicht,
Nacht sowie −60°, 30° und 60° in der lokalen Winkelprüfung. Keine erfassten
Browserfehler oder Warnungen. Nur lokale Vorschau.

Die Silberreflexe sind stärker auf den Blickwinkel abgestimmt: geringere
Reflexionsunschärfe, breitere, in der Spitze begrenzte Lichtflächen und eine
fein strukturierte Lackreflexion. Die stärkere Reflexionsintensität wird für
die Grundbeleuchtung ausgeglichen, um den bisherigen silbrigen Grundton zu
bewahren. Farb-, Rauheits- und Normalentextur bleiben erhalten; dieselbe feine
Rauheitsstruktur wirkt zusätzlich auf die Lackreflexion.
Geprüft im direkten Vergleich zum vorherigen Renderer bei gedrehten Ansichten,
zuletzt bei −30° und 60°, sowie normale Perspektive und Nacht im Konfigurator.
Dort keine erfassten Browserfehler oder Warnungen. Beide betroffenen Material-/
UV-Tests, Syntax- und Diffprüfung bestehen. Nur lokale Vorschau.

Die Silber-Reflexionsumgebung gleicht helle und dunkle Bereiche nun mit einer
neutralen Füllung an. Das reduziert den Helligkeitsunterschied zwischen den
Enden des Schriftzugs, ohne die Lichtflächen weichzuzeichnen. Materialrauheit,
Glanzschicht, Bürsttexturen und deren Maßstab bleiben unverändert. Geprüft im
direkten Vorher-/Nachher-Vergleich in normaler Perspektive, bei −30° und 60°
sowie in der Nachtansicht. Keine erfassten Browserfehler oder Warnungen im
Konfigurator. Beide betroffenen Material-/UV-Tests, Syntax- und Diffprüfung
bestehen. Nur lokale Vorschau.

Für Silber ist die feine Bürstung in normaler Perspektive deutlicher: eine
separate Farbtextur erhöht den Kontrast der vorhandenen Schliffspuren um ihren
bisherigen Mittelwert. Linienbreite, Verlauf, Texturmaßstab, Rauheitsmuster und
Normalenwirkung bleiben gleich; die abgestimmte Reflexionsumgebung und der
Metallglanz werden nicht verändert. Gold verwendet weiterhin die bisherige
Textur. Geprüft in normaler Ansicht, Detail und Nacht sowie im direkten Vergleich
bei −30° und 60°. Keine erfassten Browserfehler oder Warnungen im Konfigurator.
Beide betroffenen Material-/UV-Tests, Syntax- und Diffprüfung bestehen.
Nur lokale Vorschau.

Die Silberbürstung verwendet jetzt unterschiedlich lange, weich auslaufende
Schliffspuren. Ein ausgeglichener Helligkeitsmittelwert je Texturzeile verhindert
durchgehende helle oder dunkle Bänder. Das natürliche Muster wirkt auf Farbe
und Rauheit; mittlere Rauheit, feine Linienbreite, Texturmaßstab und die
abgestimmten Glanz- und Umgebungsparameter bleiben erhalten. Gold ist unverändert.
Geprüft in normaler Perspektive, Detail und Nacht sowie im direkten Vergleich
bei −30° und 60°. Keine erfassten Browserfehler oder Warnungen im Konfigurator.
Beide betroffenen Material-/UV-Tests, Syntax- und Diffprüfung bestehen.
Nur lokale Vorschau.

Gold nutzt ebenfalls die natürlichen, unterschiedlich langen und weich
auslaufenden Schliffspuren. Die gemeinsame Mustererzeugung bewahrt die bereits
abgestimmte Silbertextur. Bei Gold bleiben Farbkontrast, Grundfarbe, mittlere
Rauheit, Texturmaßstab und sämtliche Glanz-/Umgebungsparameter erhalten.
Geprüft in normaler Perspektive, Detail und Nacht sowie im direkten
Vorher-/Nachher-Vergleich bei −30° und 60°: feine Bürstung, Goldton und bewegte
Metallreflexe bleiben erkennbar. Keine erfassten Browserfehler oder Warnungen
im Konfigurator. Beide betroffenen Material-/UV-Tests, Syntax- und Diffprüfung
bestehen. Nur lokale Vorschau.


## Kundenführung und responsive Bedienung

Der Ablauf umfasst vier sichtbare Schritte: Look (Lichtart, Text, Schrift),
Farben (abhängig von Front-/Rücklicht), Größe (Maße vor Montage) und Prüfen.
Der bisherige Prüf-Dialog ist durch eine strukturierte Zusammenfassung im
Editor ersetzt. Jeder Bereich hat einen direkten „Ändern“-Einstieg und führt
mit „Änderungen prüfen“ zurück. Buchstabenabstand steht unter Feinabstimmung.
Ungültige Maße, fehlender Text und offene relevante RAL-Eingaben sperren die
Prüfung. Eine Suche in einer ausgeblendeten Lackauswahl blockiert andere
Licht-/Montagevarianten nicht mehr.

Unter 980 px bleiben eine kompakte, einklappbare 3D-Vorschau, die Schrittnavigation
und die untere Aktionsleiste erreichbar. Tatsächliche Elementhöhen bestimmen
die Abstände; Safe-Area-Padding und größere Touch-Flächen sind berücksichtigt.
Auf Desktop und iPad quer stehen Vorschau und Formular nebeneinander. RAL-Gruppen
lassen sich auf schmalen Geräten horizontal durchsehen. Die Kamera berücksichtigt
alle Ecken des gedrehten Schilds und freie Flächen für die Vorschau-Schalter,
statt breite, flache Vorschauen an den Rändern abzuschneiden.

Trust-Icons benennen belegbare Eigenschaften: individuelle Gestaltung nach Maß,
Live-Vorschau, Prüfung der eigenen Auswahl und persönliche telefonische Beratung.
Es wurden keine Zahlungsarten, Zertifikate, Bewertungen oder Lieferzusagen erfunden.
Preisplatzhalter und deaktivierter Checkout bleiben erhalten. Einstieg, Aktionsleiste,
Zusammenfassung und Warenkorb unterscheiden Entwurfsspeicherung und Bestellung.

Der Warenkorb bietet beschriftete Minus-/Plus-/Zahleneingaben für 1–99 Stück,
zeigt den vorläufigen Schienen-Farbaufpreis passend zur Menge und behält Mengen
beim Neuladen und Bearbeiten. Ein bearbeiteter Entwurf wird ersetzt, nicht dupliziert.
Der leere Warenkorb zeigt keine scheinbaren Bestellsummen. Der Schließen-Button
bleibt beim Scrollen im Warenkorb erreichbar.

Verifikation: 30 Modell-/Geometrie-/Framingtests bestanden; Syntax- und Diffprüfung.
Browser-Viewports 320×740, 390×844, 768×1024, 1024×768, 1440×1000 und 1920×1080:
kein horizontaler Überlauf in den geprüften Ansichten. Geprüft wurden Navigation,
direktes Ändern und Zurückkehren, Größenvalidierung (20 cm gesperrt, 120 cm gültig),
Front/Rück, Schiene/Platte mit passenden Angaben, ausgeblendete RAL-Suche,
Preview-Einklappen, Warenkorb-Speicherung, Menge 2 nach Reload, Bearbeitung ohne
Duplikat und Entfernen des Testentwurfs. Kein erfasster Browserfehler oder Warnung.
Kein physischer iPad-/Safari-Test und kein echter Kauf; nur lokale Vorschau.


## Automatisch kompakte Handy-Vorschau (22.10.2026)

Unter 600 px Breite verkleinert sich die Vorschau beim Scrollen in die Einstellungen.
Das Schild bleibt als echte, drehbare 3D-Vorschau sichtbar. Sekundäre Ansichtsschalter,
Maßzeile und Bildoptionen werden in dieser Ansicht ausgeblendet. Bei 390×844 px
sinkt die gesamte Vorschauhöhe von rund 334 auf 186 px, bei 320×740 px auf 169 px.
Die Schrittnavigation folgt weiterhin der tatsächlich gemessenen Vorschauhöhe.

„Vergrößern“ holt alle Vorschauoptionen zurück und hält diese Wahl beim weiteren
Scrollen; „Verkleinern“ wechselt zurück. Vollständiges Ein-/Ausblenden bleibt separat
möglich. Beim Zurückscrollen zum Anfang wird die normale Größe automatisch
wiederhergestellt. Der feste Bezugspunkt am Editoranfang und unterschiedliche
Ein-/Austrittsschwellen verhindern Größenwechsel durch die eigene Höhenänderung.
Scroll-Anchoring ist in diesem Bereich abgeschaltet, reduzierte Bewegung wird
berücksichtigt. Tablet- und Desktop-Aufteilung bleiben unverändert.

Verifiziert im Browser: 320×740 und 390×844 px, Scrollen hin/zurück, Schrittwechsel
mit kompakter Vorschau, manuelles Vergrößern mit anschließendem Scrollen,
Verkleinern und vollständiges Ein-/Ausblenden. Wechsel auf 768×1024 und
1440×1000 px stellt das vorhandene Layout wieder her; kein horizontaler Überlauf.
Keine erfassten Browserwarnungen/-fehler. 30 bestehende Modell-/Framingtests,
JavaScript-Syntaxprüfung und Diffprüfung bestanden. Kein physischer Handytest.
Nur lokal aktualisiert, nicht veröffentlicht.


## Größerer Schild-Ausschnitt in der kompakten Vorschau (22.10.2026)

Die kompakte Kamera nutzt den Platz der ausgeblendeten Ansichtsschalter für das
Schild: geringere Abstände zum Rand und ein kleinerer, proportionaler Rahmen um
die Geometrie. Die Vorschauhöhe und der Platz für das Formular bleiben unverändert
(390×844: 135 px Bild / 186 px Gesamtbereich; 320×740: 118 px / 169 px).
Die Kamera berücksichtigt weiterhin alle Ecken der gedrehten Geometrie und zeigt
im kompakten Modus den gesamten Schriftzug. Manueller Zoom und Detailauswahl der
großen Ansicht werden dabei nur vorübergehend übergangen und beim Vergrößern
wieder verwendet.

Verifikation: 32 Tests bestanden, darunter kompakte Ausschnitte für schmale,
breite und hohe Schilder über mehrere Drehwinkel und Seitenverhältnisse sowie
die Wiederherstellung von Detailansicht und Zoom. Browserprüfung bei 320×740 und
390×844 px einschließlich Drehung: Schild größer, keine abgeschnittenen Buchstaben,
Vorschauhöhe unverändert, kein horizontaler Überlauf, keine Browserwarnungen/-fehler.
Syntax- und Diffprüfung bestanden. Nur lokal, nicht veröffentlicht.


## Zentrierung im kompakten Ausschnitt (22.10.2026)

Die kompakte Vorschau zentriert die projizierten Außenkanten der tatsächlichen
Buchstaben und Montageelemente horizontal und vertikal. Dazu wird nur der
Kameraausschnitt verschoben; Kameraposition, Blickwinkel, dargestellte Breite und
Höhe des Schilds bleiben unverändert. Die Geometriepunkte werden je Entwurf einmal
gesammelt, vor dem Hinzufügen der Halo-Fläche. Lichtschein und Wand beeinflussen
die Zentrierung dadurch nicht. Beim Drehen wird die Bildmitte neu ermittelt;
beim Vergrößern wird die Verschiebung für die normale Ansicht wieder aufgehoben.

Verifikation: 33 Tests bestanden. Die reale PRADA-Geometrie mit Schiene wurde über
mehrere Winkel, Neigungen und Seitenverhältnisse auf gleiche Ränder, unveränderte
Bildgröße und wiederholtes Neuzeichnen ohne Drift geprüft. Die große Ansicht
stellt auch ihre ursprüngliche Projektionsmatrix wieder her. Browserprüfung bei
390×844 und 320×740 px: mittiger Schriftzug, unveränderte Vorschauhöhen von
135/186 bzw. 118/169 px (Bild/Gesamtbereich), Drehung und manuelles Vergrößern.
Kein horizontaler Überlauf oder erfasster Browserfehler. Nur lokal aktualisiert.


## Einheitliche NEONTRIP-Akzentfarbe (22.10.2026)

Die UI verwendet das Pink `#FA31A2` des bestehenden Neon-Konfigurators
(`deploy/configurator/index.html`) und dessen helle Auswahlfläche `#FFF4FA`.
Primärbuttons, Auswahlrahmen, Fortschritt, Rücksetz-/Bearbeitungslinks und mobile
Vorschau-Bedienelemente nutzen gemeinsame CSS-Variablen. Die CSS-Version ist 36;
Material-, Lack- und Leuchtfarben sowie JavaScript bleiben unverändert.

Verifikation: Browserprüfung bei Desktopbreite und 390×844 px, einschließlich
kompakter Vorschau. Berechnete Button-, Rahmen-, Fortschritts- und Linkfarben
entsprechen dem Pink; kein horizontaler Überlauf mobil und keine erfassten
Browserwarnungen/-fehler. Alte UI-Beerentöne entfernt, Diffprüfung bestanden.
Nur lokal aktualisiert, nicht veröffentlicht.


## Erneuter mobiler Kundendurchlauf (22.10.2026)

Den Ablauf in der lokalen Browser-Vorschau bei 390×844 und 320×568 px
durchlaufen: Look → Farben → Größe → Prüfen, die Rückwärtsschritte sowie
direktes Ändern und Rückkehr zur Zusammenfassung. Front- und Rückbeleuchtung,
alle drei Montagearten, RAL-Goldfilter, Farbauswahl und Korrektur einer erfolglosen
RAL-Suche waren bedienbar. Leerer Text und 20 cm Breite sperren Weiter mit
Fehlermeldung; korrigierte Eingaben geben den nächsten Schritt wieder frei.
Vergrößern, Verkleinern, vollständiges Ein-/Ausblenden und automatisches
Kompaktwerden der Vorschau wurden auf dem kleinen Handy geprüft.

Im Querformat gab es einen Engpass: Bei 844×390 px ließen die gestapelte Vorschau
und die feste untere Leiste praktisch keine sichtbare Formularfläche. Bis 550 px
Höhe stehen Vorschau und Formular bei 600–979 px Breite jetzt nebeneinander; die
Schrittnavigation haftet oben am Formular. Geprüft bei 844×390 und 667×375 px,
mit rund 200 px freier Formularhöhe und erreichbaren Weiter-/Zurück-Buttons.
Auf schmalen Ansichten mit höchstens 550 px Höhe scrollt die Vorschau mit der
Seite weg, damit Eingaben Platz haben. Bei 390×480 px blieben das fokussierte
Textfeld und die Navigation sichtbar. CSS-Version 37; keine JS-Änderung.

Warenkorb: Speichern, Menge 2, Aktualisieren ohne Duplikat, Reload, neuer Entwurf,
Bearbeiten des gespeicherten Entwurfs sowie Schließen und Zurück zum Entwurf
geprüft. Der Schließen-Button bleibt beim Scrollen erreichbar. Testeintrag
entfernt und ursprünglichen PRADA-Entwurf wiederhergestellt. Keine erfassten
Browserwarnungen/-fehler, kein horizontaler Überlauf in den geprüften Ansichten.
Diffprüfung bestanden. Bestehende Modelltests nicht erneut ausgeführt, da nur
CSS und dessen Cache-Version geändert wurden.

Grenze der Prüfung: simulierte Browsergrößen, kein physischer iPhone-/Android-
Test und keine native Bildschirmtastatur. Kein Zahlungsdurchlauf: verbindliche
Preise fehlen weiterhin, der Checkout ist absichtlich deaktiviert. Nur lokal
aktualisiert, nicht veröffentlicht.


## Mobile Eingabe mit Bildschirmtastatur (22.10.2026)

Beim Fokus auf Text-, Such- und Zahlenfelder unter 980 px Breite macht die
Vorschau vorübergehend Platz. Die untere Aktionsleiste zeigt Weiter/Zurück und
„Fertig“ in einer schmalen Zeile. `mobile-input.js` richtet sie am sichtbaren
Viewport aus und hält das aktive Feld mit Abstand darüber, auch wenn eine
Fehlermeldung die Leiste vergrößert. Die Texteingabe kann bei wenig Höhe kleiner
werden. Das Warenkorbfenster nutzt ebenfalls den sichtbaren Bereich und scrollt
seine Mengeneingabe innerhalb des Dialogs ins Blickfeld.

Der Controller unterstützt sowohl alleinige Visual-Viewport-Änderungen als auch
das Verkleinern des Layout-Viewports (`interactive-widget=resizes-content`).
Pinch-Zoom wird nicht als Tastatur interpretiert. Ein Tippen auf Weiter/Zurück
hält den Fokus bis zum Klick, damit der Button nicht vor dem abgeschlossenen
Tippen verrutscht. Erst nach dem Schließen der Tastatur werden die Vorschau und
der neue Schritt positioniert; ein begrenzter Fallback verhindert einen hängenden
Eingabemodus bei fehlendem Viewport-Ereignis. „Fertig“ beendet nur die Eingabe.
Manuell versteckte oder vergrößerte Vorschauzustände bleiben erhalten. RAL-Auswahl
und der Wechsel zwischen Feldern unterbrechen den Eingabemodus nicht.
CSS, App und neues Modul verwenden Cache-Version 38.

Verifikation: acht gezielte Controller-/Geometrietests bestanden, einschließlich
Visual-Viewport-Offsets, beider Resize-Verhaltensweisen, Fokuswechsel,
Tastatur-Schließen, Navigation, Desktop, Zoom und API-Fallback. Syntax- und
Diffprüfung bestanden. Im Browser Text und RAL bei 390×460 bzw. 320×360 px,
Maßfehler bei 390×360 px, direkte Weiter-Navigation, „Fertig“, Wiederherstellung
der zuvor versteckten Vorschau und Warenkorb-Menge geprüft. Textfeld und
Aktionsleiste haben bei 390×460 px rund 12 px Abstand; kein horizontaler Überlauf.
Desktop bei 1440×1000 px behält die Vorschau während der Texteingabe. Keine
erfassten Browserwarnungen/-fehler. Testeintrag entfernt, ursprünglicher Entwurf
wiederhergestellt und temporäre Browsergröße zurückgesetzt.

Die Prüfung kombiniert simulierte Browsergrößen und automatisierte
Viewport-Ereignisse; ein physischer iPhone-/Android-Test mit nativer Tastatur
steht noch aus. Nur lokal aktualisiert, nicht veröffentlicht.
Technische Grundlagen: [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
und [Chrome: Viewport-Verhalten bei Bildschirmtastaturen](https://developer.chrome.com/blog/viewport-resize-behavior).


## Vorschau direkt beim Einstieg und stabiles mobiles Scrollen (22.10.2026)

Der große Marken-Vorspann und die Vorteilszeile entfallen auf allen Geräten.
Desktop-Vorschau und Formular beginnen 16 px unter der jetzt 64 px hohen
Kopfzeile. Die zusätzliche Information steht dort weiterhin unter dem Editor.
Auf dem Handy entfallen auch die nachgelagerten Marketingblöcke; die Kopfzeile
ist 48 px hoch. Die normale Vorschau nutzt 230–280 px, die kompakte Vorschau
150–190 px Bildhöhe. Das Schild wird in schmalen Vorschauen größer und mittig
eingepasst, einschließlich kurzer und hoher Entwürfe sowie gedrehter Ansichten.

Mobile Bild-/Wandoptionen öffnen über „Ansicht & Bild“ direkt in der Vorschau.
Geöffnete Optionen scrollen im normalen Seitenfluss ohne eigenen Scrollbereich;
nach dem Schließen greift die automatische Verkleinerung wieder. Redundante
Schrittüberschriften und Preis-/Speicherzeilen der Aktionsleiste entfallen auf
dem Handy und im kurzen Querformat. Die zugänglichen Überschriften bleiben für
Fokus und Screenreader erhalten. Vor/Zurück bleiben immer erreichbar.

Die mobile Aktionsleiste wechselt beim Eintritt/Austritt des Editors nur noch
ihre Sichtbarkeit, nicht zwischen normalem Seitenfluss und fixer Position.
Ihr Platz wird dadurch genau einmal reserviert. Die animierte Vorschauhöhe
und das weiche Scrollen beim mobilen Schrittwechsel entfallen ebenfalls, damit
Layoutänderungen nicht mit Benutzerscrollen konkurrieren. Cache-Version 39 für
HTML-Verweise, App, CSS und Renderer; Eingabemodul bleibt Version 38.

Verifikation: 34 Modell-/Geometrietests und acht Eingabecontroller-Tests bestanden.
Zusätzlicher Geometrietest deckt vergrößerte/zentrierte normale Handy-Vorschauen,
Drehwinkel und Wiederherstellung der Desktop-Kamera ab. Browserprüfung bei
393×641, 320×568, 768×1024, 844×390, 1280×720 und 1440×900 px. Alle vier Schritte,
Vor/Zurück, Optionen, automatisches Verkleinern und Formularende geprüft. Bei
393×641 px verbleiben am Look-Ende rund 17 px zwischen Panel und 65 px hoher
Aktionsleiste; kein innerer Formular-Scrollbereich und kein horizontaler Überlauf.
Simulierte Eingabe bei 393×360 px: Feld endet 12 px oberhalb der Leiste, direkter
Weiter-Tipp wechselt nach Wiederherstellung der Höhe zum nächsten Schritt.
Die neun Schriftvorschauen laden vollständig.

Der reale iPhone-Bericht des Auftraggebers und dessen Layoutmessungen waren die
Grundlage dieser Korrektur. Die neue Version wurde bisher mit Browsergrößen
geprüft; eine erneute physische iPhone-Prüfung samt nativer Tastatur steht aus.
Die separate lokale WLAN-Testseite zeigte beim ersten Aufruf im In-App-Browser
vereinzelt einen Modul-Ladefehler; erneutes Laden funktionierte. Kein Android-
Gerät verfügbar. Nur lokale Vorschau aktualisiert, nicht veröffentlicht.


## Kompakte Auswahlübersichten und Safari-Lichtschein (22.10.2026)

Look und Farben zeigen nun eine Übersicht statt aller Auswahlraster gleichzeitig.
Beleuchtungsart und Text sind unmittelbar bedienbar; Schrift, Leuchtfarbe,
Oberfläche und aktive Lackfarbe erscheinen als Auswahlzeilen mit dem aktuellen
Wert. Ein Klick öffnet genau diese Palette im bestehenden Formularbereich, neben
der weiterhin sichtbaren Vorschau. Zurück, Escape und „Auswahl übernehmen“ führen
zur Übersicht. Die Auswahl wirkt wie bisher sofort auf den Entwurf. Ein Wechsel
des Hauptschritts schließt die Palette; Rücksprünge aus der Zusammenfassung
behalten „Änderungen prüfen“. RAL, freie Farbe und Zurücksetzen bleiben erhalten.
Frontbeleuchtung zeigt weiterhin nur Leuchtfarbe und Lackfarbe der Seiten.

Die Handy-Vorschau berücksichtigt die verfügbare Bildschirmhöhe und Safe Area.
Beim Öffnen einer Palette wird sie kompakt. Auf 393×641 sowie 320×568 px sind
Lichtart, Text und Schrift beim Einstieg ohne manuelles Scrollen erreichbar.
Bei 320×568 endet die Schriftzeile bei 492 px, die Aktionsleiste beginnt bei
503 px. Auch alle neun Schriften passen in die geöffnete Auswahl. Bei 1280×720
liegt der gesamte Look-Bereich einschließlich Weiter bei 80–646 px. Tablet
768×1024 ebenfalls geprüft; keine inneren Formular-Scrollbereiche hinzugefügt.
Lange RAL-Ergebnislisten bleiben gezielt scrollbar.

Der bisherige Halo verwendete Canvas-2D-`filter`, das Safari nicht zuverlässig
bereitstellt. Stattdessen erzeugt `paintGlow` eine weiche Schattenmaske mit
`shadowBlur` und einem transparenten Silhouettenmuster. Quelle und Schatten liegen
auf einer Zwischenfläche; nur der weiche Schatten wird kopiert, damit keine
harte weiße Silhouette entsteht. Frontflächen werden wie zuvor ausgespart;
Leuchtfarben, Radiance, Geometrie und Material bleiben erhalten. Die längste
Maskenseite ist auf 2048 Pixel begrenzt, auch bei hohen Einzelbuchstaben.
Grundlagen: [Canvas filter](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter)
und [shadowBlur](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/shadowBlur).

Verifikation: 44 Tests bestanden (34 Modell/Geometrie, acht Eingabecontroller,
zwei neue echte Canvas-Pixeltests). Die Pixeltests prüfen Licht außerhalb der
Silhouette, abfallende Helligkeit, beleuchtete Innenräume und eine ausgesparte
Front auf einem Kontext, der jede Verwendung von `filter` zurückweist. Sie
nutzen optional `@napi-rs/canvas`; im lokalen Lauf über `NODE_PATH` aus dem
gebündelten Runtime geladen, keine Tests übersprungen. Ohne Canvas-Modul werden
nur diese beiden Tests übersprungen. Syntax- und Diffprüfung bestanden.
Browser: Übersicht/Paletten, Schriftwechsel, Front/Rück, Spiegelstahl/Gold,
ungültige RAL-Suche und Rückkehr, Änderungen aus der Zusammenfassung, Nacht und
Licht aus/an geprüft. Simulierter Tastaturbereich 393×360: Textfeld endet bei
207 px, Aktionsleiste beginnt bei 295 px; direkter Weiter-Tipp und Rückkehr zu
393×641 funktionieren. Ursprünglicher PRADA-Entwurf wiederhergestellt.
Cache-Version 40. Kein erneuter physischer iPhone-Test; lokal aktualisiert.

### Supplier-Materialtafel als spätere Erweiterung

Der Auftraggeber hat die fotografierte Materialtafel am 22.10.2026 ausdrücklich
zunächst zur Information übergeben. Sichtbare Gruppen: Rose Gold, Titanium Gold,
Champagne Gold und dunkle Gun-Black-Töne mit Sand/Mirror/Frosted-Varianten;
zusätzlich Water-Plated Rose Gold, Bronze, Red/Brass Copper, Black Bronze,
K Gold, Shagin, Sand Steel, Mirror Steel und Black-Yellow Copper. Benennungen
stammen vom Musterfoto und sind noch keine bestätigten Produkt-/Materialverträge.
Als spätere Struktur bietet sich Metallton plus Oberflächenart an. Herstellart
(z. B. Lackierung/Beschichtung), verbindliche Kundennamen, Verfügbarkeit,
Aufpreise und physische Farbmuster müssen vor dem Angebot abgeglichen werden.
Noch keine zusätzlichen auswählbaren oder kaufbaren Varianten eingebaut.

## Plan für die ergänzenden Seitensektionen (22.10.2026)

Status: Planung nach Nutzerbriefing; keine neuen Medien generiert, keine
Seitensektionen eingebaut oder veröffentlicht. Der gemeinsame Konfigurator für
Front- und Rückbeleuchtung bleibt erhalten und steht direkt am Seitenanfang.
Die folgenden Medien und Abschnitte werden darunter angeordnet.

### Vom Auftraggeber konkretisiert

- Lieferzeit: ca. 2–3 Wochen von der Bestellung bis zur Lieferung. Keine Garantie
  von exakt 14 Tagen daraus ableiten. Die bestehende Leuchtbuchstaben-Landingpage
  nennt noch 4–6 Wochen; sichtbare Texte, FAQ und strukturierte Angaben müssen im
  späteren Veröffentlichungsumfang auf Widersprüche geprüft werden.
- Einzelbuchstaben: In der Acrylrückseite befinden sich Gewindeeinsätze für die
  mitgelieferten Gewindestangen. Die Wand/Fassade wird für die Befestigung
  vorbereitet. Die Kabel der einzelnen Buchstaben werden hinter der Wand oder
  Fassade zusammengeführt und mit dem Netzteil verbunden; dieses hat einen
  Schuko-Stecker. Diese konkrete Acrylkonstruktion beschreibt Rückbeleuchtung;
  sie darf nicht ungeprüft auf den Edelstahlrücken der Frontbeleuchtung
  übertragen werden. Dübel, Befestigungsdetail je Untergrund, Kabellängen und
  Netzteilposition sind noch nicht spezifiziert.
- Schiene: Buchstaben bereits vormontiert. Verkabelung läuft in der Schiene;
  am Ende tritt ein Anschlusskabel aus. Schiene wird als Einheit an der Wand
  befestigt. Der weitere Anschluss wird mit Netzteil/Schuko dargestellt.
- Platte: Buchstaben bereits vormontiert; Kabel auf der Rückseite zusammengeführt,
  anschließend zum Netzteil und Schuko-Stecker.
- Zusätzliche Produkt- und Einsatzbilder dürfen für die Seite generiert werden.
  Der aktuelle Auftrag ist zunächst die Planung; Higgsfield und mehrere Agenten
  wurden als mögliche Produktionswege genannt, noch kein Generierungslauf gestartet.

### Vorgeschlagene Reihenfolge und Medien

1. **Inspiration – So könnte dein Schild aussehen.** Vier Motive: Empfang,
   Laden/Fassade, Gastronomie, Materialdetail. Geeignete vorhandene Bilder
   wiederverwenden, fehlende Motive ergänzen. Generierte Motive sichtbar als
   Visualisierung kennzeichnen; nur nachgewiesene Kundenprojekte als Referenzen
   bezeichnen. Bildkarten mit Lichtart, Oberfläche und Montage beschriften.
   „Diesen Look gestalten“ ändert nur die gezeigten Gestaltungseigenschaften und
   erhält den Kundentext; beim späteren Bau die tatsächlich verfügbaren Optionen
   verwenden. Kein zusätzlicher großer Hero vor dem Editor.
2. **Front oder Rück – zwei Lichtwirkungen.** Zwei zusammengehörige Bilder mit
   demselben neutralen Schriftzug, gleicher Wand, Kamera und Belichtung. Front:
   gleichmäßig leuchtendes Acryl, lackierte Edelstahlseiten. Rück: sichtbare
   Edelstahlfront, passgenaues ca. 1 cm Acryl hinten und Licht zur Wand. Keine
   frontseitige weiße Kontur. Bei Bedarf eine kleine seitliche Schnittdarstellung.
   Mobil Umschalter mit klarer Beschriftung, Desktop direkter Bildvergleich.
3. **Materialien und Oberflächen.** Sechs konsistente Nahaufnahmen: Gold gebürstet,
   Edelstahl gebürstet, Edelstahl verspiegelt, Schwarz lackiert, Weiß lackiert,
   Beispiel einer RAL-Lackierung. Gleiches Muster, Licht und Perspektive, Bezug
   auf die vorhandenen Optionen. Fotos/Renderings illustrieren die Oberfläche;
   RAL-Farbwirkung am Bildschirm ist kein verbindliches physisches Farbmuster.
   Frontbeleuchtung erklärt hier Acrylfront plus lackierte Seiten. Die zusätzliche
   Supplier-Palette bleibt ein späterer Ausbau nach Bestätigung.
4. **Drei Montagearten.** Drei kurze, stumme 3D-Erkläranimationen, ca. 12–18 Sekunden,
   mit statischem Vorschaubild und Text, der auch ohne Wiedergabe verständlich ist.
   Einzelbuchstaben: Rückansicht/Gewindeeinsätze → Gewindestangen und Wand →
   Buchstaben befestigt → einzelne Leitungen zusammengeführt → Netzteil/Stecker.
   Schiene: vormontierte Einheit → Befestigung der Schiene → Kabelweg innerhalb
   der Schiene → ein austretendes Kabel → Netzteil/Stecker.
   Platte: vormontierte Einheit → Rückansicht der Verkabelung → Wandbefestigung →
   Netzteil/Stecker. Für die technische Geometrie kontrollierte 3D-Animationen
   verwenden; generierte Kamerafahrten können später ergänzt werden, sofern
   Bauteile, Kabelwege und Schichten unverändert bleiben. Keine frei erfundenen
   Befestiger oder Montageanweisung für einen ungeklärten Wandaufbau darstellen.
5. **Bestellen, fertigen, liefern.** Kurzer Ablauf mit ca. 2–3 Wochen ab Bestellung,
   individueller Fertigung und Montage je gewählter Variante. Lieferumfang aus
   den bestätigten Angaben erklären. Bei Freischaltung des Direktkaufs echte
   Bestell-/Bezahlschritte zeigen. Icons für bestätigte Aussagen verwenden;
   Zahlungslogos erst passend zu tatsächlich verfügbaren Zahlungsmethoden.
6. **FAQ und persönliche Beratung.** Aufklappbare Fragen zu Front/Rück,
   Montagewahl, Aufwand der Einzelmontage, Kabelwegen/Netzteil/Steckdose,
   Lieferumfang, Lieferzeit, RAL, Größen und Sonderlogos. Außenbereich,
   Dimmung, Kabelverlängerung, technische Grenzen und Garantiedetails erst nach
   Produktbestätigung beantworten. Sonderlogos zur bestehenden Beratung führen,
   da der aktuelle Konfigurator Text gestaltet und keinen Logo-Upload bietet.

### Bestandssichtung und Produktionsfolge

- Quelle: https://anfrage.neontrip.de/leuchtbuchstaben/ und die dort verlinkten
  Produktpfade zur Anfrage für front-buchstaben und halo-buchstaben.
- Visuell geprüft: `deploy/assets/images/hero-poster-desktop-leuchtbuchstaben.webp`
  (1920×1080, goldene Makroaufnahme),
  `deploy/assets/images/beispiele/halo-buchstaben/01-prada-backlit.webp`
  (800×535, tatsächlich Apothekenfassade, Dateiname beschreibt den Inhalt nicht),
  `deploy/assets/images/produkte/halo-buchstaben.webp` (512×362, kleine
  PRADA-Produktdarstellung). Herkunft und Projektzuordnung vor Wiederverwendung
  als Kundenreferenz prüfen. Die Makroaufnahme ist ein Kandidat für Atmosphäre,
  kein verbindliches technisches Schnittbild.
- `deploy/assets/images/beispiele/front-buchstaben/02-berlin-frontlit.webp`
  zeigt ein Neonmotiv; nicht als Front-Acrylbuchstaben-Beispiel verwenden.
  Weitere Bestandsbilder erst nach visueller Prüfung zuordnen.
- Produktionsvorschlag: zunächst das Vergleichspaar und ein Materialmuster als
  Stilanker erstellen, dann fehlende Einsatzmotive und restliche Materialbilder.
  Anschließend pro Montagevideo drei bis fünf technisch geprüfte Schlüsselbilder
  und erst danach die Animation. Higgsfield-Zugang/Videoausgabe ist noch nicht
  geprüft; keine Toolverfügbarkeit behaupten.
- Mobil: Videos erst auf Wunsch laden/abspielen, Standbilder für reduzierte
  Bewegung; keine drei parallel laufenden Clips. Bildgrößen reservieren,
  Medien unterhalb des Editors nachladen. Beim Lesen der Sektionen sollen
  Vorschau und Bestellleiste keine Inhalte überdecken. Rückkehr zum Editor
  erhält den bestehenden Entwurf.

## Warenkorb und Shopify-Vorbereitung (22.10.2026)

Status: lokal umgesetzt und geprüft, nicht veröffentlicht. Preise bleiben
Platzhalter; Kauf und Shopify-Weiterleitung sind ausdrücklich gesperrt.

- Warenkorb mit lokalem Vorschaubild, Stückzahl, Maßen, Oberfläche, Lichtart,
  Montage und aufklappbarer vollständiger Spezifikation einschließlich RAL.
  Bearbeiten ersetzt den bestehenden Eintrag und erhält dessen Stückzahl.
  Bestehende gespeicherte Entwürfe werden migriert. Bei knappem Browserspeicher
  können Vorschaubilder entfallen; Konfigurationen und Stückzahlen bleiben
  erhalten. Es werden keine Bilder oder Konfigurationen an Shopify gesendet.
- Lieferhinweis in Prüfung und Warenkorb: **Ca. 2–3 Wochen ab Bestellung**,
  von Bestellung bis Lieferung. Das Speichern eines Entwurfs startet noch keine
  Fertigung. Der Hinweis ist gemeinsam in `delivery.js` definiert. Die oben
  vermerkte Korrektur der bestehenden Landingpage bleibt spätere Seitenscope.
- Eigener 3D-Vertrag in `checkout-contract.js`: ausschließlich aktive
  Produktmerkmale, Stückzahlen und lokale Eintrags-IDs. Vorschaumaße sind
  ausdrücklich keine serverseitig verifizierten Fertigungsmaße. Preise,
  Checkout-URLs und Freischaltflags werden weder aus lokalen Entwürfen übernommen
  noch im Serververtrag akzeptiert.
- Vorbereiteter Pages-Handler unter
  `/api/public/configurator-3d/checkout`: prüft Methode, JSON, Nutzlastgröße und
  Vertrag; gültige Anfragen erhalten ausnahmslos HTTP 409 mit `BLOCKED`,
  `purchaseEnabled: false`, `grossCents: null` und `checkoutUrl: null`.
  Es gibt keine Umgebungsvariable, die diesen Handler freischaltet, und keine
  Shopify-/Datenbank-Aufrufe. Das Frontend löst derzeit keine Anfrage aus.
- `functions/_shared/configurator-3d-shopify.js` bereitet nur Positionsmetadaten
  vor. `shopify-cart-create.graphql` ist gegen Storefront API **2026-10** validiert,
  aber noch unbenutzt. Shopify benötigt echte Produktvarianten mit verbindlichem
  Preis; Positionsattribute ersetzen keine Preisberechnung. Keine Nullpreis-
  Produkte oder scheinbar bestellbaren Platzhalter anlegen.

### Vor einer echten Freischaltung

Bestätigte Kalkulation und Preisversion, serverseitige Geometrie-/Fertigungsprüfung,
Steuern und Versand sowie die verbindliche Shopify-Produkt-/Preiszuordnung fehlen
noch. Konfiguration und Vorschau müssen serverseitig nachvollziehbar der Position
zugeordnet werden. Die spätere kaufende Route benötigt außerdem Session-/Origin-
und Missbrauchsschutz, idempotente Verarbeitung, geprüfte Preisangebote und eine
validierte Shopify-Checkout-URL samt Fehlerbehandlung. Die vorhandene
Neon-Kalkulation wird nicht für 3D-Buchstaben wiederverwendet.

Der lokale HTTP-Server liefert nur statische Dateien. Der neue API-Handler ist
im Quellbaum vorbereitet und direkt automatisiert getestet; er ist weder unter
dem lokalen HTTP-Link noch produktiv aktiv. Das lokale `site-release` enthält
die aktualisierten Browserdateien, aber keine neue Functions-Bereitstellung.
Vor Veröffentlichung müssen die Functions inklusive ihrer gemeinsamen
Modulabhängigkeiten aus dem aktuellen Quellbaum gebaut und geprüft werden;
zusätzlich gilt weiterhin die nötige Aktualisierung der Produktionsbasis.

### Prüfung

53 Tests bestanden, kein Test übersprungen: 34 Modell-/Geometrietests,
8 Tastaturtests, 2 echte Canvas-Pixeltests und 9 Warenkorb-/Checkouttests.
Die neuen Tests decken Migration, Speicherknappheit, Mengenvalidierung,
Manipulation des Übergabevertrags, Nutzlastgrenzen und die unveränderliche
Kaufsperre ohne Provider-Aufrufe ab. GraphQL-Schemavalidierung erfolgreich.

Browserprüfung bei 1280×800/1000, 393×741 und 320×568: Speichern, Neuladen,
Mengenänderung, ungültige Menge beim Verlassen des Feldes, Bearbeiten ohne
Duplikat, vollständige Angaben, Lieferzeit und gesperrte Kasse geprüft. Keine
horizontalen Überläufe in den geprüften Handyansichten und keine erfassten
Browserwarnungen/-fehler. Temporären Testartikel wieder entfernt. Kein echter
Shopify-Kauf und kein erneuter Test mit physischer iPhone-/Android-Tastatur.
