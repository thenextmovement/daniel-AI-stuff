# NEONTRIP Suchintention- und Upload-Funnel-Plan

Stand: 13. Juli 2026
Status: Architekturvorschlag zur Freigabe; keine Produktions-, Ads-, Tracking- oder Routing-Änderung

> Hinweis vom 14. Juli 2026: Die folgenden Leistungswerte basieren nur auf einem 30-Tage-Trendfenster. Für Budget- und Landingpage-Priorisierung ist die vollständige, über 48 Kampagnen ausgewertete Historie in `audits/2026-07-14-google-ads-full-history-budget-lp-strategy.md` maßgeblich. Die Routingdetails stehen ergänzend in `audits/2026-07-14-google-ads-keyword-landingpage-matrix.md`. Dieses Dokument bleibt für Funnel- und Seitenarchitektur erhalten.

## 1. Ziel

Die Paid-Landingpages sollen genau eine Hauptaufgabe erfüllen:

> Ein Besucher lädt ein Logo oder Design hoch beziehungsweise gibt einen gewünschten Text ein und hinterlässt ausreichend Kontaktdaten, damit NEONTRIP ein passendes Angebot samt 3D-Vorschau erstellen kann.

Der Google-Ads-Qualitätsfaktor ist dabei ein Diagnosewert, nicht das Geschäftsziel. Google bewertet unter anderem, ob Anzeige und Landingpage die Erwartung hinter der konkreten Suche erfüllen, ob die Seite nützlich ist und ob sie leicht bedienbar ist. Das Geschäftsziel bleibt eine valide, attribuierbare Anfrage. Siehe [Google Ads: Quality Score](https://support.google.com/google-ads/answer/6167118) und [Google Ads: Anzeigenauktion](https://support.google.com/google-ads/answer/6366577).

## 2. Datengrundlage und wichtigste Erkenntnis

Der Suchbegriffsbericht umfasst den Zeitraum 13. Juni bis 12. Juli 2026. Google weist nur einen Teil der einzelnen Suchbegriffe aus:

- Konto gesamt: 1.934 Klicks, 117 Conversions, 9.906,29 Euro Kosten
- einzeln sichtbare Suchbegriffe: 822 Klicks, 49,5 Conversions, 4.244,03 Euro Kosten
- Abdeckung: 42,5 % der Klicks und 42,3 % der Conversions

Die sichtbaren Suchbegriffe wurden regelbasiert nach Kaufintention geclustert. Das ist eine belastbare Priorisierung, aber keine vollständige Kontozuordnung; unbekannte und mehrdeutige Longtails müssen vor Ads-Änderungen weiterhin manuell geprüft werden.

| Priorität | Intent-Familie | Klicks | Conversions | CPA | Zielroute(n) |
|---:|---|---:|---:|---:|---|
| 1 | Logo / CI | 195 | 19,5 | 86,04 € | `/logo/`, `/firmenlogo-beleuchtet/` |
| 2 | Firmenschild / Außen | 79 | 7,0 | 59,39 € | `/firmenschilder/` |
| 3 | Neon personalisiert | 132 | 5,0 | 114,49 € | `/neon-schild-personalisieren/` |
| 4 | Schriftzug / Text | 62 | 3,5 | 69,72 € | `/led-schriftzuege/` |
| 5 | 3D- / Leuchtbuchstaben | 19 | 2,0 | 44,90 € | `/leuchtbuchstaben/` |
| 6 | Leuchtreklame breit | 26 | 2,0 | 77,86 € | `/leuchtreklame/` |
| 7 | Neon-/LED-Schild allgemein | 61 | 1,5 | 173,18 € | `/neon-schilder/` |
| 8 | Leuchtkasten | 11 | 1,0 | 62,65 € | `/leuchtkaesten/` |
| 9 | Messe / Event | 1 | 0 | — | `/messe-event/` |

Separat sichtbar sind 139 Brand-Klicks und 6 Brand-Conversions. Brand-Traffic darf nicht mit generischem Produkt-Traffic vermischt werden und erhält eine eigene Zielseitenentscheidung.

### Konsequenz

Der erste Pilot gehört auf die Logo-/CI-Familie: Dort liegen das größte sichtbare Conversion-Volumen und die meisten verwertbaren Suchintentionen. Firmenschilder/Außen folgt als zweite Familie, weil dieser Cluster bei gutem sichtbarem CPA einen deutlich anderen Entscheidungsbedarf hat. Ein universeller Hero mit ausgetauschtem H1 reicht nicht.

## 3. Empfohlene Seitenarchitektur

Die Reihenfolge folgt der Entscheidung des Besuchers. Jede Sektion muss mindestens eine dieser Aufgaben erfüllen: Suchintention bestätigen, Unsicherheit abbauen, belastbaren Beweis liefern oder zum Upload zurückführen.

### Bisherige und vorgeschlagene Logik

| Heute auf allen zehn Seiten | Vorgeschlagene Conversion-Logik |
|---|---|
| Header und Promo-Leiste | kompakter Landingpage-Header |
| generischer Hero | intent-genauer Upload-Hero |
| Stats-Bar | belastbare Vertrauensleiste |
| Projekte | drei exakt passende Projekte |
| Events | intent-spezifische Entscheidungshilfe |
| erstes neues Anfrageformular | Vorher-/Nachher-Prozess mit Fortsetzung des Hero-Formulars |
| Vorteile | passende Fallstudie und Expertenwissen |
| Bewertungen und Testimonials | Proof dort, wo er den jeweiligen Einwand beantwortet |
| zweites beziehungsweise drittes neues Formular | ein persistenter Formularzustand, keine Neustarts |
| allgemeine FAQ und Kundenlogos | Preis-/Montagefaktoren, direkte Fachantworten und Abschluss-CTA |

### 0. Kompakter Landingpage-Header

- NEONTRIP-Logo, optional Telefonnummer und ein CTA „Angebot anfragen“
- keine Promo-Leiste und keine vollständige Shop-Navigation oberhalb des Heroes
- alle Anker führen innerhalb der Seite; keine gleichwertigen Ablenkungs-CTAs

### 1. Intent-genauer Upload-Hero

- H1 bestätigt den Produkttyp und Anwendungskontext der Anzeige
- ein echtes, zum Intent passendes Hauptmotiv statt eines Hero-Videos
- konkretes Ergebnis: kostenlose 3D-Vorschau plus Angebot, sofern diese Zusage operativ gehalten wird
- Desktop: Upload-/Texteingabe sichtbar im ersten Viewport
- Mobile: kompakter Upload-Start und sticky CTA; kein großes Desktopbild im Hintergrund
- drei unterschiedliche Prozessbilder: Ausgangsdatei → passendes 3D-Mockup → realisiertes Schild
- ein primärer CTA: „Logo hochladen & 3D-Vorschau erhalten“

### 2. Vertrauensleiste direkt unter dem Hero

- verifizierte Bewertungsquelle und ein überall konsistenter Bewertungsstand
- höchstens drei belegbare Zusagen, zum Beispiel Reaktionszeit, individuelle Fertigung oder Außen-Eignung
- echte Trustpilot-/Google-Icons, keine nachgezeichneten Platzhalter
- Kundenlogos optisch auf gleiche wahrgenommene Größe normieren

### 3. Drei exakt passende Projekte

- nur Projekte derselben Produkt- und Anwendungsklasse
- jeweils Ausgangslage, Produkttyp, Ort/Setting und Ergebnis
- kein generischer Bilderteppich; ein Empfangslogo beweist keine Fassadenkompetenz und umgekehrt

### 4. Intent-spezifische Entscheidungshilfe

Diese Sektion ist je Familie anders. Sie beantwortet die wichtigste Auswahlfrage, bevor der Nutzer abbrechen oder zur Konkurrenz zurückgehen muss.

- Logo/CI: Neon, 3D-Buchstaben oder Leuchtkasten – was bildet das Logo am genauesten ab?
- Firmenschild/Außen: Fassade, Eingang, Ausleger oder Empfang; Sichtabstand und Montage
- Leuchtbuchstaben: front-, rück- oder seitenbeleuchtet; Material und Profil
- Leuchtkasten: ein- oder doppelseitig; Wand, Ausleger oder freistehend
- Neon/Text: Text oder Datei, Schriftart, Farbe und Größe
- Event: Messestand, Bühnenbild oder Markenfläche; Termin und Montagefenster

### 5. Vom Entwurf zur realen Umsetzung

- visueller Vorher-/Nachher-Ablauf statt einer abstrakten Prozessgrafik
- Logo/Design → 3D-Vorschau im gewünschten Setting → Produktionsfreigabe → fertige Installation
- verdeutlicht, warum Datei und Setting-Angaben für ein besseres Angebot nützlich sind

### 6. Formular-Fortsetzung

- kein zweites unabhängiges Formular
- derselbe gespeicherte Formularzustand aus dem Hero wird fortgesetzt
- Besucher ohne Upload erhalten erneut die konkrete Möglichkeit „Datei hochladen“, „Text eingeben“ oder „Design später senden“

### 7. Fallstudie und Expertenwissen

- eine passende Referenz mit realen Fakten, Problemen und getroffenen Entscheidungen
- NEONTRIP-Expertise wird als konkrete Beratung gezeigt, nicht als lange Selbstdarstellung
- besonders geeignet für CI-Treue, Sichtbarkeit, Montage, Materialwahl und Außenbeständigkeit

### 8. Preis-, Liefer- und Montagefaktoren

- erklärt transparent, woraus der Preis entsteht, ohne nicht belastbare Pauschalpreise zu erfinden
- Größe, Material, Beleuchtungsart, Unterkonstruktion, Innen/Außen, Montage und Termin
- klare Aussage, welche Angaben für ein belastbares Angebot fehlen dürfen und welche später ergänzt werden können

### 9. Antwortschicht für SEO und KI-Systeme

- kurze, direkte Antworten in normalem HTML unter klaren Fragen
- tatsächliche Such- und Beratungsthemen statt Keyword-Textwände
- First-Party-Beispiele mit Material, Abmessung, Einsatzort und Entscheidungsgrund
- FAQ-Markup kann technisch korrekt ergänzt werden, erzeugt für kommerzielle Seiten aber in der Regel kein sichtbares FAQ-Rich-Result mehr; Google beschränkt diese Darstellung weitgehend auf bekannte Behörden- und Gesundheitsseiten. Siehe [Google Search Central](https://developers.google.com/search/blog/2023/08/howto-faq-changes).

### 10. Abschluss-CTA

- führt in denselben Formularzustand zurück
- wiederholt Ergebnis und geringe Einstiegshürde
- kein konkurrierender WhatsApp-, Shop- oder Konfigurator-CTA mit gleicher visueller Stärke

## 4. Varianten nach Landingpage-Familie

| Familie | Suchauftrag | Hero-Eingabe | Drei Hero-Bilder | Entscheidungshilfe direkt nach Projekten |
|---|---|---|---|---|
| Logo / CI | eigenes oder Firmenlogo beleuchten | Logo hochladen; „später senden“ möglich | Logodatei → Mockup im Büro/Fassade → reales Markenlogo | CI-Treue und passende Bauart |
| Firmenschild / Außen | Firma oder Laden außen sichtbar beschildern | Logo plus optional Fassadenfoto | Fassade vorher → maßstäbliches Mockup → fertige Außenanlage | Standort, Sichtabstand, Montage und Außen-Eignung |
| Leuchtbuchstaben / 3D | einzelne Profil- oder 3D-Buchstaben planen | Logo/Schriftzug hochladen | Vektordatei → Beleuchtungsprofil → installierte Buchstaben | Front-, Rück- oder Seitenlicht und Material |
| Leuchtkasten | Motiv als Leuchtkasten umsetzen | Motiv/Logo plus gewünschtes Format | Artwork → Tag-/Nacht-Mockup → Montage | ein-/doppelseitig, Wand/Ausleger, Innen/Außen |
| Neon / Text | individuellen Text oder ein Neonmotiv erstellen | Text eingeben oder Design hochladen | Text/Skizze → Farb- und Größenvisualisierung → reales Schild | Schrift, Farbe, Größe und Befestigung |
| Leuchtreklame breit | Produkttyp noch nicht entschieden | Logo/Design plus Einsatzort | Logo → drei geeignete Produkttypen → empfohlenes Setting | früher Produkt-Router, danach spezifische Empfehlung |
| Messe / Event | Markenfläche für festen Termin planen | Design, Termin und optional Standansicht | Standplan → Markenmockup → realer Messestand | Termin, Abmessungen, Montagefenster, Eigen-/Kundenprojekt |

`/logo/` und `/firmenlogo-beleuchtet/` dürfen denselben technischen Hero verwenden, brauchen aber getrennte Botschaften: `/logo/` deckt den breiten Auftrag „Logo als Leuchtschild“ ab, `/firmenlogo-beleuchtet/` den Unternehmenskontext mit Empfang, Büro und Fassade. Dasselbe gilt für `/neon-schilder/`, `/neon-schild-personalisieren/` und `/led-schriftzuege/`: Produkt, konkrete Personalisierungsabsicht und reiner Textauftrag sind drei unterschiedliche Jobs.

## 5. Upload- und Formularlogik

### Schritt 1: Projekt starten

- Route setzt den Produkttyp bereits voraus; der Nutzer muss ihn nicht erneut auswählen
- Logo/Design hochladen oder bei Text-Seiten Text eingeben
- Alternative „Design später senden“ sichtbar, damit Mobile-Nutzer nicht blockiert werden
- optionale Angabe Innen/Außen beziehungsweise Setting, wenn sie für die jeweilige Familie kaufentscheidend ist

### Schritt 2: Kontakt speichern

Minimal erforderlich:

- Name
- E-Mail-Adresse
- Datenschutzbestätigung beziehungsweise Datenschutzhinweis nach rechtlicher Prüfung

Telefon, Firma, Maße und Termin sollten nur dann verpflichtend sein, wenn das Vertriebsteam ohne diese Angaben keine sinnvolle Erstreaktion leisten kann. Ansonsten werden sie optional oder in die Nachqualifizierung verschoben.

### Primärer Abschluss

Sobald Schritt 2 erfolgreich abgeschickt wurde:

1. Anfrage sofort in der Datenbank speichern; nicht fünf Minuten im Browser zurückhalten.
2. Upload mit derselben Lead-ID verknüpfen.
3. genau ein primäres Conversion-Ereignis senden.
4. GCLID/GBRAID/WBRAID, UTM-Parameter, Route, Intent-Variante und Gerätekontext am Lead speichern.
5. Bestätigungszustand anzeigen und optionale Nachqualifizierung starten.

### Optionale Nachqualifizierung, maximal fünf Minuten

- „Was ist für dieses Projekt wichtiger?“
  - möglichst genaue Umsetzung unserer Marke/CI
  - möglichst günstiger Preis
- „In welchem konkreten Umfeld soll das Schild visualisiert werden?“
  - Büro/Empfang
  - Unternehmenszentrale/Fassade
  - Laden/Gastronomie
  - Messe/Event
  - privater Innenraum
  - eigener Ort oder Adresse als Freitext
- optionales Foto des Raums, Gebäudes oder Messestands
- „Ist die Anfrage für Ihr eigenes Unternehmen oder für einen Kunden?“
- gewünschter Termin und ergänzende Hinweise

Die Nachqualifizierung aktualisiert immer denselben Datensatz. Nach „Jetzt senden“, Abschluss oder fünf Minuten wird eine Trello-Projektion erzeugt beziehungsweise aktualisiert. Die Datenbank bleibt Source of Truth. Ein Idempotency-Key verhindert doppelte Karten, doppelte Benachrichtigungen und doppelte Conversions.

## 6. DKI und Routing

- kein ungeprüfter Suchbegriff in H1, Proof, Seitentitel oder Bildbeschreibung
- H1 nur aus einer kuratierten Allowlist pro Route, zum Beispiel `logo`, `firmenlogo`, `fassadenschild`, `leuchtbuchstaben`, `neon-text`
- Bilder, Formularvorauswahl und Proof wechseln mit derselben Intent-ID wie die Überschrift
- unbekannte Parameter fallen auf den statischen, grammatikalisch korrekten Seitenstandard zurück
- Query-Parameter und Click-IDs bleiben über Upload, Formular, Bestätigung und Nachqualifizierung erhalten
- geerbte Final URLs werden vor jeder Ads-Änderung auf Anzeigen- und Anzeigengruppenebene aufgelöst
- Broad-/Close-Variant-Traffic wird regelmäßig anhand echter Suchbegriffe überprüft; Komponenten-, DIY-, Fremdmarken- und irrelevante Geschenk-/Dekosuchen sind Kandidaten für eine Negativliste, aber niemals ungeprüft automatisch auszuschließen

## 7. Inhalt, SEO und KI-Antwortfähigkeit

Die Seite soll nicht länger werden, nur um umfangreich zu wirken. Inhalte erhalten eine Position, wenn sie eine reale Frage beantworten oder eigene Erfahrung belegen.

Priorisierte Wissensfragen:

1. Welche Schildart bildet ein komplexes Firmenlogo am genauesten ab?
2. Wie werden CI-Farben in RAL, Pantone oder LED-Licht übertragen, und wo sind physikalische Grenzen?
3. Welche Ausführung eignet sich für innen, außen, große Sichtabstände oder Tageslicht?
4. Welche Datei reicht für eine erste 3D-Vorschau, und wann wird eine Vektordatei benötigt?
5. Wovon hängen Preis, Lieferzeit und Montageaufwand ab?
6. Wie werden Stromzufuhr, Kabel, Unterkonstruktion und Befestigung geplant?
7. Welche Abmessungen wirken aus dem vorgesehenen Betrachtungsabstand lesbar?
8. Wann werden Genehmigung, Vermieterfreigabe oder Fassadenprüfung relevant?

Für KI- und Suchsysteme besonders wertvoll sind belegbare First-Party-Projektdaten, eindeutige Produktbegriffe, Bildunterschriften, konsistente Unternehmensangaben und namentlich verantwortete Fachinhalte. Generische KI-Texte ohne eigene Fakten schaffen keinen zusätzlichen Beweis.

## 8. Performance und mobile Anforderungen

- kein Video im ersten Viewport
- eigene AVIF/WebP-Varianten für Desktop und Mobile, passende `srcset`-/`sizes`-Angaben
- Hero-Abmessungen vorab reservieren; keine Layoutverschiebung durch Formular, Bewertungen oder Logos
- Hero-Bild priorisieren, alle Galerie-, Video- und Bewertungsmedien unterhalb des Folds lazy laden
- unnötige Drittanbieter-Skripte und doppelte Formularbibliotheken entfernen
- reales Ziel nach Google: LCP höchstens 2,5 s, INP unter 200 ms, CLS unter 0,1 am 75. Perzentil. Siehe [Google Search Central: Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals).

## 9. Messplan

### Funnel-Ereignisse

1. `lp_view`
2. `upload_started` oder `text_started`
3. `asset_attached`
4. `contact_step_viewed`
5. `lead_saved` – einziges primäres Ads-Conversion-Ereignis
6. `enrichment_started`
7. `enrichment_completed` oder `enrichment_timeout`
8. serverseitig: `trello_projected`

Jedes Ereignis enthält `lead_id`, Route, Intent-ID, Variante und Attribution. Client- und Serverereignisse werden dedupliziert. Ein Trello-Fehler darf weder die gespeicherte Anfrage noch das Conversion-Ereignis rückgängig machen.

### Freigabekriterien des Logo-/CI-Piloten

- visueller Desktop-/Mobile-Vergleich gegen Referenz und aktuelle Produktion
- Upload funktioniert mit erlaubten Dateitypen, Größenlimits, Abbruch und Wiederholung
- Lead wird auch bei geschlossenem Tab nach dem primären Submit nicht verloren
- keine doppelte Conversion oder Trello-Karte bei Reload, Back/Forward oder Retry
- alle UTM-/Click-ID-Parameter bleiben erhalten
- drei mobile Lighthouse-Läufe; kein Lauf über 4,0 s LCP, Arbeitsziel höchstens 2,5 s; CLS unter 0,05
- Tastaturbedienung, Kontrast, Fehlermeldungen und Screenreader-Beschriftung geprüft
- alle direkten und geerbten Ads-Zielpfade samt Query-Parametern getestet

Der Pilot wird nach dem technischen Go-live anhand Upload-Rate, `lead_saved`-Rate, qualifizierter Lead-Rate, CPA und mobiler Abbruchrate bewertet. Die Ads-Landingpage-Erfahrung und der Qualitätsfaktor werden erst nach zwei bis vier Wochen als nachlaufende Diagnose beurteilt; sie aktualisieren sich nicht sofort.

## 10. Umsetzungsschritte und Abhängigkeiten

1. **Funnel-Architektur freigeben.** Abschnittsreihenfolge, Pflichtfelder und primäre Conversion festziehen.
2. **Logo-/CI-Designsystem finalisieren.** Hero, responsive Bilder, optisch normierte Logos, echte Review-Icons und belegte Trust-Zahlen.
3. **Formularvertrag definieren.** Datenbankschema, Uploadspeicher, Lead-ID, Idempotency, Attribution, Timeout und Trello-Projektion.
4. **Tracking-Spezifikation festziehen.** GTM/GA4/Ads-Ereignisse, Deduplizierung und Testfälle vor Codeänderung dokumentieren.
5. **Logo-/CI-Pilot lokal implementieren.** Nur `/logo/` und danach `/firmenlogo-beleuchtet/`; keine Ads-URL-Änderung.
6. **Visuelle, mobile, technische und End-to-End-QA.** Screenshots, Upload, Webhook, Datenbank, Trello, Conversion und Performance.
7. **Kontrollierter Release.** Backup, Diff, Pfadvalidierung, vorgeschriebenes `codex-predeploy offers`, exakter Commit und dokumentierter Rollback.
8. **Ads-Routing erst danach anpassen.** Final URLs, Suffixe, DKI-Allowlist und Negativkandidaten separat freigeben.
9. **Familienweise ausrollen.** Firmenschild/Außen → Text/3D → personalisiertes Neon → Leuchtkasten/breit/Event.

Abhängigkeiten:

- freigegebene Bilder und echte Projektbeispiele pro Familie
- verifizierte Bewertungszahlen und zulässige Markenlogos
- Zugriff auf bestehenden Formular-Webhook und seine Payload
- Datenbank- und Uploadspeicher als Source of Truth
- GTM, GA4 und Google-Ads-Conversion-Konfiguration
- vollständige Liste direkter und geerbter Final URLs
- Datenschutz-, Speicher- und Löschkonzept für Logo-, Gebäude- und Innenraumfotos

## 11. Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Datei-Upload erhöht Reibung | Upload stark empfehlen, aber „später senden“ anbieten; Textpfad auf Schriftzugseiten |
| Lead geht während fünfminütiger Nachqualifizierung verloren | primären Lead sofort speichern, danach denselben Datensatz ergänzen |
| doppelte Karte oder Conversion | Lead-ID und Idempotency-Key über alle Side Effects |
| DKI erzeugt unpassende Versprechen | kuratierte Intent-Allowlist statt Rohsuchbegriff |
| Hero sieht gut aus, bleibt aber langsam | responsive statische Bilder, feste Maße, Messung in drei mobilen Läufen |
| Seiten konkurrieren um denselben Intent | klare Keyword-/Search-Term-Zuordnung und unterschiedliche Jobs pro Route |
| Trust-Angaben widersprechen sich | eine verifizierte Quelle für Bewertungsstand und Zusagen |
| Trello wird versehentlich Source of Truth | Datenbank speichern; Trello nur projizieren und wiederholbar aktualisieren |
| sensible Standortfotos werden unkontrolliert gespeichert | Zweck, Zugriff, Aufbewahrung, Löschung und Uploadvalidierung vor Release klären |

## 12. Rollback

- Arbeit ausschließlich im separaten Offers-Worktree
- bestehende Produktionsartefakte und Routen vor Release sichern
- Hero/Form als eigener, rücksetzbarer Commit
- vor Deploy `codex-predeploy offers` ausführen und nur den ausgegebenen Commit veröffentlichen
- Ads-Final-URLs erst nach erfolgreicher Seiten- und Tracking-QA ändern
- Seiten-Commit und Ads-Routing unabhängig auf die dokumentierten vorherigen Stände zurücksetzen können

## 13. Benötigte Freigabe

Vor Implementierung zu bestätigen:

1. Die oben vorgeschlagene Abschnittsreihenfolge gilt als Basis.
2. `lead_saved` nach Upload/Text plus Name/E-Mail ist die primäre Conversion.
3. Datei-Upload ist empfohlen, aber nicht zwingend.
4. CI-Treue versus möglichst günstiger Preis bleibt eine optionale Nachqualifizierungsfrage mit genau diesen zwei Antworten.
5. Der Logo-/CI-Pilot wird vor allen anderen Familien umgesetzt.
