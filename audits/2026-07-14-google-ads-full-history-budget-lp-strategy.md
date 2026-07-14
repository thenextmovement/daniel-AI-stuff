# NEONTRIP: Google-Ads-Gesamthistorie, Budget- und Landingpage-Entscheidung

Stand: 14. Juli 2026
Datenfenster: 19. August 2021 bis 13. Juli 2026
Status: Analyse und Entscheidungsvorlage; keine Ads-, Budget-, Tracking-, Routing- oder Produktionsänderung

## Kurzentscheidung

Die erste Auswertung war tatsächlich durch zwei Statusfilter eingeschränkt: `Kampagnenstatus: Aktiviert` und `Anzeigengruppenstatus: Aktiviert`. Dadurch wurden nur drei aktive Kampagnen ausgewertet. Für diese Auswertung stehen beide Filter auf `Alle`; die Ansicht umfasst 48 Kampagnen. Davon haben 28 Kampagnen ausgewiesene Suchbegriffszeilen: 23 Search- und fünf Performance-Max-Kampagnen.

Die richtige Konsequenz ist nicht, alte Kampagnen pauschal wieder einzuschalten. Historische Conversion-Zahlen enthalten nachweisbare Messartefakte. Stattdessen werden belastbare Suchmuster in neue, nach Intention getrennte Exact-/Phrase-Gruppen übernommen und jeweils auf die passende Landingpage geschickt.

Priorität für zusätzliche kontrollierte Tests haben:

1. Logo und beleuchtetes Firmenlogo
2. Firmenschilder und Außenanwendungen
3. personalisierte LED-/Neon-Schilder
4. Leuchtbuchstaben und 3D-Buchstaben
5. Lichtwerbung und Leuchtreklame außen
6. LED-Schriftzüge, zunächst enger als bisher

Generische Neon-Suchen, Leuchtkästen und Messe/Event erhalten vorerst kein zusätzliches Paid-Budget.

## Datengrundlage

Rohdatenexport: `/Users/danielklesse/Downloads/Bericht zu Suchbegriffen (2).csv`
Dateigröße: 57.184.132 Byte
SHA-256: `a78dd5354dfeb0e6a0e46e5dcc6b892a8a009636da09ec44fb080181c49dc611`

| Ebene | Klicks | Conversions laut Google Ads | Kosten |
|---|---:|---:|---:|
| Konto gesamt | 141.414 | 7.775,51 | 413.624,69 € |
| Search gesamt | 102.677 | 6.174,91 | 363.660,72 € |
| Performance Max gesamt | 35.110 | 1.477,60 | 46.720,89 € |
| einzeln ausgewiesene Suchbegriffe, alle Typen | 71.606 | 4.299,68 | 221.009,11 € |
| ausgewiesene Search-Suchbegriffe | 52.856 | 3.565,33 | 194.043,08 € |
| ausgewiesene PMax-Suchbegriffe | 18.750 | 734,31 | 26.966,23 € |
| vorheriger Export mit Aktiv-Filtern | 4.410 | 367,76 | 25.511,33 € |

Google fasst weitere 56.057 Klicks, 2.973,42 Conversions und 183.671,07 Euro als `Sonstige Suchbegriffe` zusammen. Diese Anfragen sind nicht einzeln verfügbar und werden nicht erfunden oder rückwirkend klassifiziert.

## Warum der historische CPA nicht direkt budgetfähig ist

Die Spalte `Conversions` ist über die Jahre nicht konsistent als eindeutige, qualifizierte Anfrage interpretierbar:

- `Search | Logo` weist 638 Klicks, 770,96 Conversions und nur 792,68 Euro Kosten aus. Mehr eindeutige Leads als Klicks sind hier kein belastbarer Lead-CPA.
- Der Suchbegriff `ledkicker.com erfahrungen` weist 59,59 Conversions bei sechs Klicks aus.
- In einer historischen PMax-Kampagne erhielt `skateboard` sechs Conversions bei 69 Klicks, obwohl die Suchabsicht nicht zu einer individuellen Lichtwerbeanfrage passt.
- Dieselbe PMax-Historie kaufte unter anderem `happy birthday`, `happy birthday to you` und `geburtstag` mit zusammen 1.738 Klicks und 755,32 Euro Kosten ohne Conversion.

Für die konservative Langzeitsicht wurden deshalb die komplett unplausible Kampagne `Search | Logo` und einzelne Zeilen mit mehr Conversions als Klicks ausgeschlossen. Das reduziert den sichtbaren Search-Datensatz auf 52.119 Klicks, 2.532,19 Conversions und 192.544,16 Euro Kosten beziehungsweise 76,04 Euro konservativen CPA. Auch dieser Wert ist noch kein qualifizierter Lead-CPA; er ist lediglich robuster als der rohe historische Wert.

Vor einer echten Budgeterhöhung müssen die primären Conversion-Aktionen, Zählmethode und Offline-Qualität beziehungsweise angenommene Leads geprüft werden.

## Intent-Potenzial: gesamte Historie und aktueller Trend

Die Langzeitwerte der folgenden Tabelle sind konservativ berechnet. Der 30-Tage-Trend stammt aus den aktuell aktiven Kampagnen.

| Intent | Langzeit-Klicks | konservative Conversions | Kosten | konservativer CPA | letzte 30 Tage: Conversions / CPA | Entscheidung |
|---|---:|---:|---:|---:|---:|---|
| Logo allgemein | 7.910 | 581,19 | 42.597,92 € | 73,29 € | 15,50 / 88,44 € | größte Paid-Landingpage; kontrolliert skalieren |
| Firmenlogo / CI | 609 | 49,08 | 3.240,13 € | 66,02 € | 3,00 / 43,97 € | eigene Seite behalten und priorisieren |
| Firmenschild / Außen | 1.968 | 86,13 | 7.346,60 € | 85,30 € | 7,00 / 64,02 € | aktuell einer der stärksten Cluster |
| Neon personalisiert | 6.026 | 291,65 | 23.731,04 € | 81,37 € | 5,00 / 102,37 € | wichtig, aber nur mit passender Custom-Seite erhöhen |
| Leuchtbuchstaben / 3D | 1.504 | 66,94 | 5.580,08 € | 83,36 € | 2,00 / 45,53 € | kleiner, aktuell effizient; eigener Testtopf |
| Lichtwerbung / Leuchtreklame | 2.603 | 106,23 | 9.901,09 € | 93,20 € | 3,00 / 54,41 € | Außen-/Standortintention gesondert ausspielen |
| LED-Schriftzug / Text | 5.927 | 206,92 | 20.598,17 € | 99,55 € | 2,50 / 134,27 € | einzelne Winner nutzen, breite Gruppe begrenzen |
| Neon-/LED-Schild allgemein | 5.597 | 238,84 | 21.491,78 € | 89,98 € | 1,50 / 168,57 € | vorerst nicht skalieren; Seite als Router umbauen |
| Leuchtkasten | 352 | 5,44 | 1.266,32 € | 232,78 € | 1,00 / 73,27 € | Paid-Traffic pausieren, später Exact-Test |
| Messe / Event | 10 | 0 | 101,62 € | – | 0 / – | keine eigene Paid-Landingpage rechtfertigbar |

Die 15.958 konservativ nicht eindeutig zugeordneten Search-Klicks kosteten 49.441,24 Euro. Darin stecken generische englische Suchen, Wettbewerber, Neonlampen, Motive und andere gemischte Absichten. Daraus darf keine universelle Landingpage entstehen; diese Begriffe brauchen Suchbegriffs- und Negativkeyword-Arbeit.

## Keyword-Fokus

### A. Jetzt als klar abgegrenzte Exact-/Phrase-Tests priorisieren

| Suchbegriff | konservative Historie: Conv. / CPA | letzte 30 Tage: Conv. / CPA | Zielseite | Handlung |
|---|---:|---:|---|---|
| `led logo` | 49,23 / 70,84 € | 3 / 75,33 € | `/logo/` | höchster belastbarer Non-Brand-Einzelbegriff; Budgettest |
| `led logo wand` | 16,98 / 52,94 € | 1 / 44,05 € | `/logo/` | eigene Anzeigenformulierung und DKI-Variante |
| `led schild personalisiert` | 23 / 79,26 € | 2 / 54,84 € | `/neon-schild-personalisieren/` | Custom-Neon-Test erhöhen |
| `neonschild personalisiert` | 5 / 94,48 € | 1 / 46,21 € | `/neon-schild-personalisieren/` | kleiner Exact-/Phrase-Test |
| `led schriftzug` | 10,47 / 101,56 € | 2 / 35,49 € | `/led-schriftzuege/` | aktuelle Dynamik gut; getrennt vom allgemeinen Custom-Cluster testen |
| `firmenlogo beleuchtet innen` | 5 / 41,93 € | 1 / 21,13 € | `/firmenlogo-beleuchtet/` | sehr hohe Intent-Übereinstimmung; priorisieren |
| `firmenschild außen` | 3 / 43,73 € | 1 / 18,23 € | `/firmenschilder/` | Fassaden-/Außen-Hero und Standortfoto |
| `leuchtreklame außen` | 4 / 73,59 € | 1 / 11,95 € | `/leuchtreklame/` | Standort- und Außenvariante separat testen |
| `lichtwerbung` | 4 / 85,68 € | 1 / 20,71 € | `/leuchtreklame/` | fachliche Auswahlseite statt generischem Neon-Hero |
| `3d buchstaben beleuchtet` | 2 / 23,05 € | 1 / 6,58 € | `/leuchtbuchstaben/` | kleines Volumen, hoher Intent; Exact priorisieren |

Budget wird nicht accountweit pauschal erhöht. Jede Familie erhält einen getrennten Testtopf; Erhöhungen erfolgen maximal um 15 bis 20 Prozent pro sieben Tage, sobald mindestens drei angenommene, eindeutige Leads im aktuellen Fenster vorliegen und deren qualifizierter CPA im Ziel liegt.

### B. Historisch stark, aber erst nach neuem Landingpage-Match reaktivieren

- `neon logo`, `neon logo erstellen`, `neon schild logo`
- `neon schild personalisiert`, `leuchtschild personalisiert`
- `firmenlogo beleuchtet`, `firmenschild beleuchtet`
- `leuchtbuchstaben`
- `leuchtreklame schild`

Diese Begriffe hatten historisch Volumen, zuletzt aber keine oder zu wenig bestätigte Dynamik. Sie werden nicht durch Wiederanschalten alter Kampagnen reaktiviert, sondern als neue Intent-Gruppen mit sauberer Zielseite, Anzeige und Conversion-Messung.

### C. Nicht skalieren oder negativ prüfen

- `logo erstellen`: 119 Klicks, 171,28 Euro, keine Conversion; häufig Logo-Design statt Schildkauf
- `3d buchstaben`: 68 Klicks, 235,19 Euro, keine Conversion; zu unspezifisch
- `leuchtkasten`: 53 Klicks, 177,44 Euro, eine Conversion; historisch zu schwach
- Wettbewerber und Erfahrungs-Suchen wie `the neon company`, `neonsfeer`, `ledkicker`: niemals aus dem historischen Conversion-Wert automatisch skalieren
- Komponenten, DIY, Vorlagen und reine Motivsuchen als Negativkeyword-Kandidaten prüfen
- alte PMax-Motiv- und Geburtstagsstreuung nicht wieder aktivieren

## Landingpage-Entscheidungen

| Route | Entscheidung | neue klare Aufgabe |
|---|---|---|
| `/logo/` | behalten und als Hauptseite ausbauen | Logo-Datei → kostenlose 3D-Vorschau → Angebot; Varianten für LED-Logo, Wandlogo und Neon-Logo |
| `/firmenlogo-beleuchtet/` | behalten und schärfen | CI-treues Firmenlogo für Büro, Empfang oder Innenwand; Einsatzort und Standortfoto optional erfassen |
| `/firmenschilder/` | behalten und ausbauen | Firmenschild, Fassade und Außenwirkung; Fassadenfoto, Sichtabstand, Montage und Außenbeständigkeit |
| `/neon-schild-personalisieren/` | behalten | Text oder eigenes Design; nicht mit Logo-/Fassadenberatung vermischen |
| `/led-schriftzuege/` | behalten, enger modellieren | Texteingabe zuerst; Schrift, Farbe, Größe und Wandkontext; breite generische Keywords begrenzen |
| `/leuchtbuchstaben/` | behalten | Front-, Rück- oder Seitenlicht, 3D-/Profilbuchstaben, Fassade versus Innenraum |
| `/leuchtreklame/` | behalten, zum fachlichen Produkt-Router umbauen | Lichtwerbung und Leuchtreklame nach Standort, Sichtweite und Bauart auswählen |
| `/neon-schilder/` | stark ummodellieren | generischer Router mit früher Wahl `Logo`, `Schriftzug`, `Firmenschild` oder `freie Idee`; vorerst kein zusätzliches Broad-Budget |
| `/leuchtkaesten/` | Paid-Traffic deaktivieren, URL für SEO behalten | Fachseite erhalten; nur späterer Exact-Test bei nachgewiesener Nachfrage |
| `/messe-event/` | aus dem Paid-Routing nehmen | als organischen Use Case oder Untersektion behalten; keine eigene Ads-Budgetlinie |

Bestehende URLs werden nicht allein für eine bessere Keywordformulierung umbenannt. H1, Seitentitel, Anzeigenbezeichnung und Intent-ID können geändert werden, ohne SEO-Signale zu zerstören. Eine spätere Slug-Änderung benötigt eine vollständige 301-Redirect-Matrix und Pfad-QA.

## Empfohlene Reihenfolge der zusätzlichen Testbudgets

Die Prozentwerte beziehen sich nur auf ein neues, begrenztes Testbudget, nicht auf den gesamten bestehenden Account:

1. 30 % Logo allgemein
2. 15 % Firmenlogo / CI
3. 20 % Firmenschild / Außen
4. 15 % Neon personalisiert
5. 10 % Leuchtbuchstaben / 3D
6. 5 % Lichtwerbung / Leuchtreklame außen
7. 5 % LED-Schriftzug-Winner

Leuchtkasten, Messe/Event und generische Neon-/LED-Schild-Gruppen erhalten aus diesem zusätzlichen Budget zunächst null Prozent.

## Ads-Neuaufbau statt Wiederbelebung alter Kampagnen

- Brand bleibt separat und darf nicht als Produkt-CPA verkauft werden.
- Eine Winner-Ebene enthält ausschließlich validierte Exact-/enge Phrase-Begriffe mit eigener Final URL.
- Eine Core-Ebene enthält pro Intent eine Anzeigengruppe und eine Landingpage.
- Broad/AI-Max und Exploration erhalten erst nach sauberer Primary-Conversion und Offline-Lead-Qualität einen kleinen getrennten Topf.
- Alte Kampagnen wie `Search | Logo`, `Name Kampagnen NEONTRIP` oder die historischen PMax-Kampagnen werden nicht als Ganzes reaktiviert. Es werden nur die verwertbaren Suchmuster übernommen.

## Pflicht-QA vor Budgetänderungen

1. In Google Ads alle primären und sekundären Conversion-Aktionen, Zählmethode und Gültigkeitszeiträume exportieren.
2. Form-Submit, angenommener Lead, Angebot und Auftrag trennen; Budgetentscheidung auf angenommene Leads oder Offline-Conversion stützen.
3. Pro Intent Final URL, Suffix, DKI-Allowlist, GCLID/GBRAID/WBRAID und versteckte Formularfelder prüfen.
4. Jede Landingpage auf Mobile, Desktop, Upload/Textpfad, Fehlerzustand und echte Ladezeit testen.
5. Testbudget dokumentieren; nach sieben Tagen beziehungsweise ausreichendem Volumen anhand qualifizierter Leads entscheiden.
6. Vor jeder Ads-Änderung Kampagnen-, Keyword-, Anzeigen-, URL- und Conversion-Zustand exportieren, damit ein Rollback möglich ist.
