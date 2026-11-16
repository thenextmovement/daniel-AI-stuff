# KI-vorbereitete Produktionsvergabe

Aktueller Stand 2026-11-16: Produktionsbasis ist `7d4aba8b89b25b1f83aac7a899d568354a7697ac`.
Die nachfolgende Korrektur von Produktzuordnung und fehlenden Hinweisen ist lokal
geprüft, nicht veröffentlicht. NEONTRIP, Quentin-Board 62bae9b97705e7419ed64593.
Veröffentlichung benötigt die exakte saubere Commit-SHA. Ältere Abschnitte dokumentieren
den damaligen Prüf-/Veröffentlichungsstand.

## Korrektur Produktzuordnung und Liefer-/Montagehinweise (16. November)

Ziel: Keine automatische Zuordnung von Mail-Aufzählungen zu mehreren gekauften
Produkten; explizite Lieferschein-Anweisung und bestellte Montageschablone erhalten.
Nachbar: angenommene Positions-/Bild-IDs, Mengen, Sonderhinweise, Zahlungsentscheidung,
Dateiauswahl und Produktionsfreigabe unverändert. Wirkung im Test: ausschließlich
lokale Entwürfe; alle DB-/Trello-Schreibzugriffe abgefangen.

- Bei mehreren Produkten benötigen produktbezogene KI-Änderungen einen Beleg aus
  genau dieser bestellten Position. Mail-/Kartenreihenfolge beweist keine Bildzuordnung.
  Unbelegte Zuordnungen werden zu offenen Fragen ohne Produktionswert. Die vorhandene
  Zuordnung von angenommener Positions-ID und gekauftem Bild bleibt unverändert.
- Die angenommene Angebotsnummer wird zusätzlich zur Shopify-Nummer übermittelt.
  Ein exakter Betreffbezug auf diese A/N kann eine falsche `unrelated`-Einordnung
  korrigieren. Ähnliche Nummern, zitierter Body und Betreffe mit mehreren Referenzen
  reichen nicht für eine automatische eindeutige Zuordnung.
- Die ausdrückliche Bitte aus einer zugeordneten eingehenden Mail, den Lieferschein
  mitzusenden, wird unabhängig vom KI-Befund übernommen. Zitierte Historie, fremde
  Aufträge, Fragen und negierte/bedingte Bitten erzeugen keinen automatischen Hinweis.
  Datei und Lieferadresse bleiben ausdrücklich zu prüfen; Anhänge werden nicht gelesen.
- Vermischt ein Vorschlag zugehörige und fremde/ungeklärte Belege, wird sein Wert
  verworfen und eine offene Frage mit ausschließlich zugehörigen Belegen erzeugt.
  Fehlende Beleg-IDs oder ausschließlich fremde Belege brechen weiterhin ab.
  Eine solche Frage darf keinen vorhandenen Karten-Sonderhinweis als erledigt verdecken.
- `Inklusive: Montageschablone` wird als `Included: Mounting template` übernommen.
  Optionale/negierte Erwähnungen werden nicht als bestellt dargestellt.

Echtdatenprüfung: aktuelle Sale-/Annahmedaten und die am selben Tag in Produktion
gespeicherten vollständigen Mail-/Kartenquellen wurden lokal erneut durch die
Vorbereitung verarbeitet. Neue KI-Aufrufe und echte Bild-GETs; Graph/Trello/DB wurden
aus diesen Snapshots beantwortet, Schreibzugriffe nur lokal simuliert. Dies ist kein
neuer produktiver Graph-E2E-Test und keine produktive Vorbereitung des neuen Codes.

| Fall | Ergebnis | Noch offene Prüfung im letzten neuen KI-Lauf |
| --- | --- | --- |
| #NEONT4857 Amazon, 88 Volltexte | Mockup6027 bleibt Produkt 1, Mockup6028 Produkt 2; keine geratenen Textzuordnungen; Lieferschein und Do not split erhalten | 23 Punkte: 17 unsichere Mailzuordnungen, 1 gemischter KI-Beleg, 1 Lieferscheinprüfung, 4 Dateien |
| #NEONT4856 Kinderarztpraxis, 16 Volltexte | Montageschablone in Produktmerkmalen und fertigem Text | 4 inhaltliche Punkte und 9 Dateientscheidungen; UI zählt 12 statt 13 wegen zweier gleichnamiger image.png |
| #NEONT4849 Apel, 5 Volltexte | Gleiches Bild, Doppellinie erhalten, alle 5 Threads zugehörig | 1 wiederholter Sonderhinweis und 2 Dateien |

Die schwankende Mailzuordnung beim großen Amazon-Verlauf erreicht das Ziel
„nur prüfen/bestätigen“ noch nicht. Die drei Korrekturen sind belegt; dieser Befund
wird separat berichtet und nicht durch manuelles Entfernen der Prüfpunkte kaschiert.
Kein Livegang empfohlen, bevor dieser Bedienungsbefund bewertet wurde.

Verifikation: Original-Amazon-Fehlanalyse erneut validiert (beide falschen
Produktzuordnungen blockiert); Bild-IDs, Bildhashes und Mengen für alle drei Fälle
identisch. 1.809 Tests: 1.807 bestanden, 2 plattformbedingt übersprungen; 8 Deployment-
Tests, TypeScript, Build und vorhandener UI-Smoke bestanden. Echte lokale Prüfkomponente
für alle drei Fälle bedient; Freigabeknöpfe gesperrt. Produktionsdaten zurückgelesen:
alte Review-IDs unverändert, kein Handoff, jeweils null Assignment Attempts.

Gespeicherte produktive Entwürfe werden durch die Codeänderung nicht rückwirkend
verändert. Erst nach einem separat genehmigten Deployment ist „Neu vorbereiten“ mit
dem neuen Code möglich. Es wurden weder Karten, Dateien, Nachrichten noch Aufträge
verändert. Keine Migration, neue Anbindung oder Workflow-Änderung.

## Vertrag und Bedienung

Ziel: Im bestehenden Sale „Vergabe prüfen“ öffnen, Bestellung und Mailvolltexte
abgleichen, fertigen Titel/Beschreibung, Dateien, Cover und Ziel prüfen, dann
„Geprüft – an Produktion freigeben“. Belegte Konflikte benötigen eine Auswahl;
nur offene technische Fragen und nicht belegte Ausnahmen benötigen eine Prüfnote.
Bei offener/unklarer Zahlung bleibt die zusätzliche ausdrückliche Zahlungsbestätigung
erhalten. Shopify-only-Aufträge ohne Offers-Annahme behalten den manuellen Vergabeweg.
Vorhandene Additional Information werden in der Vorschau übernommen.
Nachbar: Zahlungsfreigabe, Kundenänderungssperre, andere Lieferanten, optionale
Vergabeaufgabe und Kundenkommunikation behalten ihre bestehenden Pfade.
Wirkung: Zurückgelesene Texte, bytegleiche gekaufte Designs, gewähltes Cover,
gesicherte/entfernte Varianten, Shopify-Tag und Position oben in der Zielliste.

Offers bleibt unverändert. Produkte, Mengen, Zubehör und gekauftes Bild kommen
aus den bereits vorhandenen Annahmedaten. Fehlende Annahme-/Bildzuordnung blockiert
diese Vorbereitung; sie wird nicht durch eine geratenen Auswahl ersetzt.
Standard: Sign Approved (6347e0971a7efc0482e6c3fe). Bestellte Express-/Eilleistung:
Super Urgent Orders (6544ca38c328c64bbcabf4e8). Nur Lieferpositions-Titel bestimmen
den Vorschlag; „kein Express“ im Standard-Beschreibungstext wird nicht als Express
gewertet. Eine Prioritätsänderung braucht eine Prüfnote. Karten bereits in diesen
Produktionslisten werden nicht erneut vorbereitet.

## Vorhandene Anbindungen

### Zahlungsstatus beim Angebots-Replay (16. November 2026)

Ursache der vorübergehenden falschen Apel-Zahlungswarnung: Der bestehende
Completed-Offers-Abgleich importiert zuerst den Annahme-Snapshot und liest erst
danach aktuelle Shopify-Bestellungen. Ein Snapshot ohne Zahlungsangabe setzte
bereits verknüpfte Sales zwischenzeitlich von `paid / paid_confirmed` auf
`unknown / pending`. Die anschließende Shopify-Phase reparierte den Stand; eine
inzwischen geladene Übersicht behielt die falsche Anzeige bis zum nächsten Lesen.

Am natürlichen Lauf `12217608` von Workflow `xFQTm4E7qw38C9cF` wurde dies rein
lesend nachgewiesen: Apel war um 09:14:03 UTC bezahlt, ab dem Write um 09:14:11.580
UTC unbekannt und ab 09:14:49.335 UTC wieder bezahlt. `raw_shopify.financial_status`
blieb währenddessen durchgehend `paid`. Der aktive veröffentlichte Workflow
(`bcdd0785-7beb-440c-b060-4d6f6f7b9304`) wurde weder geändert noch manuell ausgeführt.

Der lokale Korrekturkandidat erhält beim `offer.completed`-Import für bereits mit
einer Shopify-Order verknüpfte Sales den vorhandenen Zahlungsstatus und die
Zahlungsentscheidung. Neue/unverknüpfte Angebote behalten ihr bisheriges Verhalten.
Aktuelle Shopify-Imports dürfen weiterhin Zahlungen, Rückerstattungen und Stornos
übernehmen; eine bekannte Zahlung wird nicht dauerhaft festgeschrieben. Der
bestehende `updated_at`-Vergleich schützt weiter gegen konkurrierende Writes.

Mit den echten Apel-Annahmedaten isoliert wiederholt: alter Code schreibt
`unknown / pending`, Kandidat bleibt bei `paid / paid_confirmed`, auch ohne
anschließende Shopify-Reparatur. Eine simulierte neue Shopify-Erstattung setzt
weiterhin `refunded / refunded` und `canceled`. Keine echte Zahlung, Vergabe,
Trello-Karte oder Nachricht wurde im Test verändert. Dieser Zahlungs-Kandidat
ist noch nicht veröffentlicht; eine neue exakte Commit-Freigabe ist erforderlich.

### Korrekturen aus der angemeldeten Apel-Prüfung (16. November 2026)

Die Mailzuordnung unterscheidet Auftragszugehörigkeit von technischen Änderungen.
Eine als fremd eingestufte Rechnung/Auftragsbestätigung mit exakt der aktuellen
NEONT-Nummer im Betreff wird dem Auftrag zugeordnet, auch ohne Änderungsvorschlag.
Zitierte Mailtexte und ähnliche Nummern sind kein Zuordnungsbeleg. Enthalten die
Betreffe eines Threads mehrere Bestellnummern, bleibt eine manuelle Entscheidung
offen; vorhandene `uncertain`-Entscheidungen werden nicht automatisch aufgehoben.

Die ältere Aktion „Approved Design pruefen“ und deren Upload verwenden ebenfalls
die vorhandene exakte `Offer Item ID`-Zuordnung zum angenommenen Snapshot. Das
gekaufte Bild ersetzt dort einen fehlenden/veralteten Import-Bildverweis. Fehlende,
doppelte, entfernte Positionen, Mengenänderungen und fehlende gekaufte Bild-IDs
blockieren weiterhin. Ohne Annahme-Positionen bleibt der bisherige manuelle
Bildpfad erhalten. Datenbank-Positions-ID und Upload-Idempotenz bleiben unverändert.

Verifiziert mit den am 16. November gelesenen Apel-Daten (#NEONT4849) und den fünf
vollständigen Mailquellen des produktiven Prüfentwurfs: neuer KI-Aufruf, alle fünf
Threads zugehörig, „Logo in double line“ erhalten, „Mockup6006.jpg“ in beiden
Bildpfaden identisch. Vorbereitung 9,6 Sekunden im isolierten Replay; kein Benchmark
der produktiven Graph-/Trello-Latenz. Nur `image.png` und `aoe.pdf` benötigen noch
Dateientscheidungen. Provider-Schreibzugriffe wurden lokal abgefangen, keine
Produktionsfreigabe ausgeführt. Dieser Korrekturkandidat ist noch nicht live.
Gespeicherte ältere Entwürfe werden nicht rückwirkend geändert; nach einem
freigegebenen Deployment lädt „Neu vorbereiten“ die aktuellen Quellen neu.

- Graph verwendet microsoftGraphToken aus arrival-labels/clients. Ausschließlich
  support@neontrip.de, /users/{mailbox}/messages, vollständige Text-Bodies inklusive
  ausgehender Nachrichten. Teilnehmer-Suche plus bestehende Request-ID-Verknüpfungen,
  direkte letzte 24 Stunden gegen Suchindex-Verzug, danach vollständige Threads.
  Pagination, Provider-Suchlimit, maximal 40 Threads/250 Nachrichten/450.000 Zeichen:
  bei Überschreitung expliziter Abbruch, kein abgeschnittener „Erfolg“.
  Suche und letzte 24 Stunden liefern nur Zuordnungsdaten; Volltexte werden danach
  einmal aus den vollständigen Threads geladen, mit 25 Nachrichten je Seite.
  Graph-Seitenlinks mit `@` statt `%40` bleiben exakt an dasselbe Postfach gebunden.
  Unterschiedliche Such-/Immutable-IDs werden über exakte Internet-Message-ID innerhalb
  desselben Threads abgeglichen; jeder Suchtreffer muss vollständig abgedeckt sein.
  Nur vorübergehende GET-Fehler/Timeouts werden höchstens dreimal versucht. Retry-After
  wird eingehalten; über 10 Sekunden geforderte Wartezeit stoppt die Prüfung explizit.
- Mailanhänge werden als vorhanden gekennzeichnet, ihre Inhalte nicht automatisch
  gelesen. Änderungen, die nur daraus hervorgehen, müssen manuell geprüft werden.
- Ein Responses-Aufruf mit bestehendem OPS_OPENAI_API_KEY oder OPENAI_API_KEY;
  Modell OPS_COPILOT_OPENAI_MODEL / OPENAI_MODEL / bestehender Default gpt-5-mini.
  Striktes Schema mit Pflichtschlüssel je Thread und kurzen Beleg-IDs. Wiederholte
  Mailabsätze werden einmal mit vollständigen Quellenverweisen übermittelt; es wird
  kein Verlauf abgeschnitten. Zitate werden aus Originalabsätzen rekonstruiert, nicht
  vom Modell geschrieben. Zahlen, zitierte Namen und Montageschablonen werden belegt.
  Einzelne ungültige Werte werden als offene Frage ohne Produktionswert dargestellt. Keine Tools, keine Nachrichten, store:false; Bild-URLs und
  Quellenlinks werden nicht an das Modell übermittelt.
- Trello nutzt die vorhandenen Credentials. Gekaufte Bildbytes werden hochgeladen,
  zurückgelesen und gehasht; ein externes URL-Attachment ist kein Inhaltsnachweis.
- Bestehender privater Supabase-Bucket customer-documents, Service Role.
  Pfad neontrip/sales/{sale}/{card}/{attachment}/{sha256}. Kein neuer Bucket,
  keine Policy, Migration, Queue oder Workflow. Vor jeder Entfernung unabhängiges
  Lesen und SHA-256-/Größenvergleich der Sicherung. 25 MB Obergrenze je Datei.

## Speicherung und Freigabe

supplier_sales.metadata.production_review hält die letzte Vorbereitung mit
Quellenstand. supplier_assignment_attempts hält Vorschau, Mitarbeiterentscheidungen,
Originalsnapshot und Fortschritt; metadata.production_handoff verweist darauf.
Beide Tabellen haben im Live-Lesecheck RLS und ausschließlich service_role-Policies.
Die API liefert Mailvolltexte und Sicherungen ausschließlich unter bestehender
Ops-Sitzung, Cache-Control private/no-store. Automations-Token autorisieren diese
Mitarbeiteraktionen nicht.

Vor Provider-Schreibzugriffen: aktuelle Bestellung/Mails/Karte vergleichen, Sale
per updated_at bedingt beanspruchen und vorhandenen Assignment Attempt reservieren.
Vorbereitungen und andere Metadaten-Schreiber dürfen den Fortschritt nicht verlieren.
Teilübergaben bleiben trotz gesetztem Shopify-Tag aktiv sichtbar. Die Listenbewegung
ist die letzte externe Freigabewirkung; danach Karte und Spitzenposition zurücklesen.

Ein erneuter Aufruf liest vorhandene Uploads (Name plus Bytehash) und Sicherungen.
Nach unklarer Verschiebeantwort wird der bereits erreichte Stand geprüft, nicht
erneut verschoben. Eine geänderte Quelle fordert eine neue Vorbereitung, solange
noch keine Produktionsfreigabe versucht wurde. Pending nach hartem Prozessabbruch
wird bewusst nicht automatisch übernommen: Assignment Attempt und Trello erst
manuell abgleichen. Keine Lease, kein Watchdog und kein blindes Wiederholen.
Eine bereits möglicherweise ausgelöste Produktion wird nicht automatisch rückgängig
gemacht oder mit geänderten Entscheidungen fortgesetzt.

## Prüfungen und verbleibender Betriebsnachweis

- Gezielte Tests: supplier-production-review.test.ts plus supplier-sales.test.ts und
  acceptance.test.ts. Einfacher Auftrag, getrennte 3D-/Mehrproduktfelder, alter
  Angebots-Thread/Logoänderung und abweichende Kabelposition, feste Mengen,
  Quellen-/Zahlenprüfung, volle Mails/Pagination, Sicherung, verlorene Upload-/
  Verschiebeantwort, neue Mail, fremde Kartenänderung, Doppelaufruf/Row-Claim und
  Sichtbarkeit bei Teilfehlern.
- Bestehender UI-Smoke verwendet weiterhin gemockte APIs. Die Legacy-Vergabetests
  wählen Saeid explizit; Quentin öffnet nun die Vorbereitung. Eine asynchrone
  Board-Aktualisierung wird vor der nächsten Supplier-Auswahl abgewartet.
- Zusätzlich wurde die echte Prüfkomponente in der lokalen App mit isolierter
  Test-API auf Desktop und Mobilansicht bedient, bis zur bestätigten Testübergabe.
- Vorab live read-only: customer-documents ist privat, erlaubt die benötigten
  Dateitypen; aktuelle Graph-gestützte Arrival-Läufe und Mailspiegel wurden gesehen.
  Das beweist die vorhandene Anbindung, nicht den neuen all-folder-Leseaufruf.
- Beide Betriebsnachweise wurden am 12. November mit der produktiven Ops-Identität
  erbracht (siehe unten). Der Anwendungskandidat ist weiterhin nicht veröffentlicht.
  Keine produktive Kundenkarte, Kundenmail oder Produktionsliste wurde für Tests verändert.

Release folgt OPERATIONS.md: vollständige Tests, TypeScript, Build, UI, sauberer
Diff/Commit, exact-SHA-Freigabe, codex-predeploy ops, codex-safe-push-main.
Code-Rollback benötigt ebenfalls eine freigegebene SHA. Dateiwiederherstellung:
Sicherung über production_file_backup herunterladen und gezielt auf derselben Karte
wiederherstellen; Originaltext liegt im Assignment Attempt. Ein Code-Rollback nimmt
keine bereits ausgelöste Produktion zurück.


## Nachbesserung nach Echtdatenprüfung (12. November 2026)

Die importierten Shopify-Positionen enthalten weiterhin die ursprüngliche `Offer Item ID`.
Die Vorbereitung verknüpft sie exakt mit `offer_snapshot.lineItems`; aktuelle Mengen,
Texte und Lieferpositionen bleiben erhalten. Fehlende, doppelte oder entfernte
Positionen und geänderte/ungültige Mengen stoppen die Vorbereitung. Die Bildauswahl
kommt ausschließlich aus dem angenommenen Snapshot. Eine fehlende Bildzuordnung
bei nur einem von mehreren Produkten darf nicht als Zubehör verborgen werden.
Der Aktualitätsvergleich hängt nicht mehr an austauschbaren Datenbank-Zeilen-IDs.
Ein Live-Lesecheck von 15 unzugeordneten NEONTRIP-Offers-Sales ergab 15 eindeutige
Positionszuordnungen und 14 vorhandene gekaufte Bildauswahlen. Ein Altfall hat weiterhin
keine Bildauswahl im Annahme-Snapshot.

KI-Abgleich: kurze stabile IDs, verpflichtende Thread-Schlüssel, deduplizierte
Originalabsätze, unveränderte Quellenchronologie und `reasoning.effort=low` beim
bestehenden Modell. Die Zusammenfassung der offenen Punkte kommt aus dem validierten
Ergebnis. Explizite wörtliche Logo-Korrekturen werden auch bei ausgelassenem KI-Befund
vorgelegt. Bei unsicherer Projektzuordnung muss die Mitarbeiterin die Korrektur dem
Auftrag zuordnen; die zugehörige Mailentscheidung wird mit derselben Auswahl gespeichert.
Eine automatische Projektzuordnung anhand desselben Absenders findet nicht statt.

Markdown-UPDATE/Additional-Information-Hinweise werden unabhängig vom Modell auf
Auslassungen geprüft. Gleiche Maße mit cm/mm, Dezimalkomma, Multiplikationszeichen,
Farbübersetzungen und anderer Farbreihenfolge erzeugen keinen Scheinkonflikt.
Überholte Angaben können keine gekauften Produktionsfelder löschen. Fragen werden
niemals als Größe/Farbe eingesetzt. Ausdrücklich ungeklärte Produktionsdetails bleiben
auch dann eine Pflichtfrage, wenn das Modell sie als Ergänzung bezeichnet.

Bedienung: fertige Karte zuerst als Vorschau; „Text anpassen“ bei Bedarf. Belegte
Ergänzungen sind übernommen und zusammengeklappt, Konflikte bieten konkrete Knöpfe.
Eine einzige Vektordatei wird zum Behalten vorgeschlagen; unklare Bild-/PDF-Varianten
benötigen weiterhin die Dateiauswahl. Keine rein optische automatische Variantenwahl.
Entfernen bleibt an die vorhandene bytegeprüfte Sicherung gebunden. Cover und aus der
bestellten Lieferleistung bestimmte Zielliste sind vorausgewählt. Ein ausdrücklicher
Freigabeknopf ersetzt das zusätzliche allgemeine Bestätigungs-Häkchen.

Echtdatenprüfung: sechs echte Aufträge mit zuvor vollständig gelesener Korrespondenz,
erneut gelesenen Bestell-/Kartenständen und echten Responses-Aufrufen. Der letzte Lauf
brauchte 8,2 s (Apel), 19,0 s (Eisedicht) und 19,4 s (Autoland). Apel ergibt einen
nutzbaren Entwurf, Eisedicht erkennt Claim und Kabelkonflikt. Autoland zeigt EPS/RAL und
offene Montage; sein alter Snapshot hat kein gekauftes Bild, daher bleibt die Freigabe
blockiert. Ritter benötigt eine eindeutige Quentin-Karte; Saeid und Shopify-only bleiben
in ihren bestehenden Wegen. Bereits produzierte Karten werden nicht erneut freigegeben.

Diese Läufe sind lokale Replays echter Daten mit echter KI; DB-/Trello-Schreibzugriffe
wurden abgefangen. Reale Kundenkarten wurden nicht als Testobjekte verändert. Die
Outlook-Suche lieferte beim abschließenden Aktualisieren einen internen Connectorfehler,
während das Profil support@neontrip.de erreichbar blieb. Maildaten stammen deshalb aus
dem vollständigen Abruf derselben Sitzung. Teilweise fehlende Conversation-IDs wurden
im Test aus dem Mailspiegel bzw. ersatzweise Betreffgruppen gebildet. Das ist kein Ersatz
für einen Test des echten Graph-Readers und der Dateiablage unter Ops-Runtime-Identität.
Dieser zunächst offene Nachweis wurde anschließend separat erbracht (siehe unten).
Kein Livegang und keine Produktionsfreigabe wurden durchgeführt.

Die bestehende UI-Smoke-Prüfung deckt zusätzlich die Quentin-Prüfmaske, eine belegte
Entscheidung ohne Pflichttext, Dateientscheidung, responsive Ansicht, Abbruch und
Bestätigung der unbezahlten Vergabe sowie den zurückgelesenen Übergabestand ab.
Eine separate lokale Ansicht mit dem echten Apel-Entwurf wurde auf 1440/390 px geprüft.
Der IAB hing beim Zahlungsdialog; der entsprechende Ablauf wurde im bestehenden
isolierten Chromium-Smoke mit Dialog-Handler erfolgreich bis zum Ende geprüft.

## Produktive Identitätsprüfung (12. November, 21:08–21:17 UTC)

Der bestehende HTTPS-Zugang `https://coolify.fuajob.online` stellt das Terminal wieder
bereit. Beim direkten IP-Zugang waren die Ports 6001/6002 nicht erreichbar. Keine
Firewall-, Berechtigungs-, Credential- oder Serveränderung war nötig. Die Anwendung
lief unverändert auf `d4cd4172a708862f8a41a2694efa0c29db479d0a`; geprüft wurden die
Kandidatenfunktionen als temporäres, hashverifiziertes Skript im laufenden Ops-Container,
mit dessen vorhandenen Umgebungsvariablen. Es gab keinen Feature-Deploy und keinen Neustart.

Der erste echte Reader-Test fand drei Probleme: ein Such-Timeout, einen transienten
Graph-HTTP-500-Fehler und die abweichende URL-Kodierung im Seitenlink. Der reduzierte
Metadatenabruf zeigte außerdem unterschiedliche Such-/Immutable-IDs. Die oben
beschriebene Reparatur ist durch Regressionstests und folgenden Wiederholungslauf belegt:

| Fall | Vollständige Nachrichten | Eingang / Ausgang | Threads | Dauer |
| --- | ---: | ---: | ---: | ---: |
| #NEONT4849 | 5 | 1 / 4 | 5 | 2,9 s |
| #NEONT4823 | 24 | 5 / 19 | 9 | 14,0 s |
| #NEONT4839 | 16 | 3 / 13 | 11 | 4,9 s |

Alle 45 Nachrichten wurden als volle Text-Bodies gelesen. Die wörtliche Logo-Korrektur
aus dem älteren Eisedicht-Verlauf wurde dabei gefunden. Im erfolgreichen Lauf trat
erneut ein HTTP 500 auf, den der begrenzte Lese-Retry erfolgreich auffing. Diese Zeiten
messen nur den Mailabruf, nicht KI-Aufbereitung oder Produktionsübergabe.

Dateiablage: ein isolierter synthetischer Text mit 97 Bytes wurde im vorhandenen privaten
`customer-documents` gespeichert und zweimal unabhängig zurückgelesen. Bytegleichheit
und SHA-256 stimmten überein; Dauer 1,2 s. Die Storage-Tabelle bestätigte den gespeicherten
97-Byte-Testdatensatz. Kein Kundenanhang wurde entfernt. Die synthetische Datei bleibt
als Nachweis unter Test-Sale `00000000-0000-4000-8000-202611120001` erhalten; temporäre
Prüfskripte/Protokolle liegen ausschließlich unter `/tmp` des Containers.

Abschließende DB-Gegenprüfung: auf allen sechs Testfällen weiterhin keine
`production_review` und keine `production_handoff`. Keine Kundenmail, Vergabe, Shopify-
oder Trello-Mutation wurde ausgelöst. Die Mailprüfung bleibt bei fehlenden Volltexten,
nicht abgedeckten Suchtreffern oder überschrittenen Grenzen ausdrücklich offen.
