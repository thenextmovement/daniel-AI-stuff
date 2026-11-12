# KI-vorbereitete Produktionsvergabe

Stand 2026-11-12: lokal implementiert, nicht veröffentlicht. NEONTRIP, Quentin-Board
62bae9b97705e7419ed64593. Veröffentlichung benötigt die exakte saubere Commit-SHA.

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

- Graph verwendet microsoftGraphToken aus arrival-labels/clients. Ausschließlich
  support@neontrip.de, /users/{mailbox}/messages, vollständige Text-Bodies inklusive
  ausgehender Nachrichten. Teilnehmer-Suche plus bestehende Request-ID-Verknüpfungen,
  direkte letzte 24 Stunden gegen Suchindex-Verzug, danach vollständige Threads.
  Pagination, Provider-Suchlimit, maximal 40 Threads/250 Nachrichten/450.000 Zeichen:
  bei Überschreitung expliziter Abbruch, kein abgeschnittener „Erfolg“.
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
- Vor Produktionsfreigaben fehlen noch der neue Reader mit der Ops-Runtime-Identität
  sowie ein ausdrücklich freigegebener Datei-Upload/Download-Test dieser Runtime.
  Lokale Provider-Tests ersetzen diesen Betriebsnachweis nicht. Keine produktive
  Kundenkarte, Kundenmail oder Produktionsliste wurde für Tests verändert.

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
für den noch offenen Test des echten Graph-Readers und der Dateiablage unter Ops-Runtime-
Identität. Kein Livegang und keine Produktionsfreigabe wurden durchgeführt.

Die bestehende UI-Smoke-Prüfung deckt zusätzlich die Quentin-Prüfmaske, eine belegte
Entscheidung ohne Pflichttext, Dateientscheidung, responsive Ansicht, Abbruch und
Bestätigung der unbezahlten Vergabe sowie den zurückgelesenen Übergabestand ab.
Eine separate lokale Ansicht mit dem echten Apel-Entwurf wurde auf 1440/390 px geprüft.
Der IAB hing beim Zahlungsdialog; der entsprechende Ablauf wurde im bestehenden
isolierten Chromium-Smoke mit Dialog-Handler erfolgreich bis zum Ende geprüft.
