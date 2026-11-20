# Zentrale Kundendaten fuer NEONTRIP

Stand: 20.11.2026. Projekt PROJ-001. Status: Architekturentwurf zur Nutzerpruefung; noch keine Produktionsaenderung.

## Gewuenschtes Ergebnis

Ein Kunde hat eine dauerhafte Identitaet in der vorhandenen Supabase-Datenbank. Mehrere E-Mail-Adressen und Telefonnummern gehoeren zu dieser Identitaet. Bestellungen, Anfragen, Nachrichten und Telefonate bleiben mit ihr verbunden, auch wenn eine Kontaktadresse korrigiert wird. Kundenakte und Telefonzentrale verwenden denselben Bearbeitungsweg. Manuell gepflegte Kontaktdaten werden durch einen Import nicht wieder ersetzt.

Die sichtbare Bestellanzeige lautet beispielsweise: **Bisherige Bestellungen: 5 Stueck · Gesamt: 2.584,93 €**. Sie bleibt zum Bestellpopup anklickbar. Ein Stift neben dem Namen sowie die anklickbaren Hinweise auf fehlende Telefonnummer/E-Mail oeffnen denselben Editor. Bestehendes Salbei-Layout, Anrufbestaetigung und kompakte Hoehe bleiben erhalten.

## Verifizierter Ist-Zustand

- Codebasis: thenextmovement/daniel-AI-stuff, main 7d27ee3cbd069062887a37a18e25b893666294f2.
- Supabase klibiejfisijpagzkxls: 8.973 master_customers-Zeilen; 8.849 normalisierte E-Mail-Werte. 123 wiederholte normalisierte Adressen betreffen 247 Zeilen. Das ist ein Zuordnungskonflikt, kein Beweis gleicher Personen.
- 706 Kundenzeilen tragen eine Shopify-Kunden-ID; acht Shopify-ID-Gruppen kommen mehrfach vor. 3.379 Kundenzeilen tragen request_id. 7.603 master_requests haben customer_id. Diese bestehenden Bezeichnungen/Fremdschluessel bleiben erhalten.
- master_customers.email ist exakt UNIQUE, nicht nach lower/trim normalisiert. Alle aktuell gelesenen Kunden haben den gleichen Mandanten organization_id. customer_organization_id ist bei keinem Kunden belegt; customer_organizations ist leer. crm_organizations ist die Mandantenebene und darf nicht mit Kundenfirmen verwechselt werden.
- 3.875 shopify_orders-Zeilen. Der Spiegel hat shopify_order_id, E-Mail, Telefon und Adressen, aber keine shopify_customer_id und keinen zentralen Kundenverweis.
- Aktiver Workflow m6VJ0hvDT7I40xy0, RH | Shopify Orders Sync → Supabase: vollstaendiger paginierter Bestellabgleich alle 15 Minuten, verifizierter Snapshot, anschliessend refresh_shopify_customer_totals_v1. Die Funktion aktualisiert ausschliesslich total_orders, total_revenue und orders_synced_at anhand exakter normalisierter E-Mail.
- Aktiver Workflow I9vCp27sS3jcH1am, Shopify → Supabase Sync (stuendlich): nur 250 neuere Bestellungen seit 2026. Upsert Customer verwendet on_conflict=email und merge-duplicates. Name, Telefon und Firma werden erneut geschrieben, fehlende Werte teilweise als leere Zeichenfolge. Manuelle Korrekturen koennen dadurch verloren gehen. Anschliessend werden operative master_orders und bestehende Request-Verknuepfungen aktualisiert.
- Hauptkontakte stehen in master_customers; Zusatznummern in voice_customer_phone_numbers. Die Telefonzentrale liest diese Zusatznummern, die gemeinsame Kundenakten-Historie verwendet bisher primaer phone/original_phone und E-Mail-Kandidaten.
- Kundenakte updateCustomerRecord schreibt master_customers und zugehoerige followup_queue, lead_followup_plans und document_journey mit Audit/Ruecknahmeversuch. billing_email und cc_emails haben Versandbedeutung und sind keine neutralen Kontaktaliases.

## Entscheidung und begrenzter Umfang

Die bestehende Datenbank und master_customers bleiben erhalten. Kein Ersatz-CRM, keine zweite Datenbank und keine Loeschung alter Kunden-/Vorgangszeilen. Eine additive Identitaetsverknuepfung verbindet vorhandene Zeilen mit einem kanonischen master_customers-Datensatz; bestehende IDs bleiben fuer alte Verbraucher gueltig.

Alternativen: Nur den Stift an die bisherige PATCH-Route anschliessen wuerde weder Zusatzadressen vereinheitlichen noch Import-Ueberschreibungen verhindern. Alle Kundentabellen ersetzen waere fuer den gewuenschten Nutzen unnoetig riskant. Die additive Erweiterung bietet einen schrittweise pruefbaren Weg.

### Gemeinsames Modell

1. master_customers bleibt Kundenstamm. Ein optionaler canonical_customer_id verweist auf den kanonischen Datensatz im gleichen Mandanten; ohne Verweis gilt die eigene ID. Keine Zyklen oder mandantenuebergreifenden Verknuepfungen.
2. customer_contact_points speichert E-Mail/Telefon, normalisierten Wert, primaere Rolle, Quelle, manuelle Pflege und Zeitstempel pro kanonischem Kunden. E-Mails werden getrimmt/kleingeschrieben, Telefonnummern mit bestehender Laenderpruefung nach E.164 normalisiert. Rechnungsadresse und CC bleiben explizite getrennte Rollen; Hinzufuegen eines Kontaktaliases aktiviert keinen Mailversand.
3. customer_external_identities verbindet Mandant, Plattform/Shop und unveraenderliche externe Kunden-ID eindeutig mit dem kanonischen Kunden. Shopify-Kunden-ID ist staerker als Name oder eine nachtraeglich geaenderte Adresse.
4. Manuelle Feldwerte werden als Overrides mit Autor, Zeitpunkt und Version festgehalten. Der effektive Kundenstamm projiziert diese Werte fuer bestehende Leser. Ein Datenbankschutz verhindert, dass alte Import-Upserts diese geschuetzten Felder ueberschreiben. Explizite manuelle Aenderung/Entfernung des Overrides erfolgt nur im gemeinsamen Bearbeitungsweg.
5. shopify_orders erhaelt additiv Shopify-Kunden-ID und zentralen Kundenbezug. Die originale Bestell-E-Mail und Rechnungs-/Lieferadressen bleiben historische Quelldaten. Bestellzeilen werden nicht auf neue Kontaktdaten umgeschrieben.

### Zuordnungsregeln

- Bereits bestaetigte externe Identitaet gewinnt. Danach ist eine eindeutig zugeordnete exakte normalisierte Kontaktadresse moeglich.
- Widerspruechliche Shopify-ID und E-Mail oder mehrere moegliche Kunden erzeugen einen sichtbaren Klaerfall. Keine Namens-/Telefon-/Domain-basierte automatische Personenverschmelzung.
- Neue eindeutige Identitaeten koennen beim Import idempotent angelegt werden; Gastbestellungen ohne ID benutzen ausschliesslich eindeutige Adresse, andernfalls bleiben sie sichtbar unzugeordnet.
- Historische Mehrfachzeilen werden nicht pauschal zusammengefuehrt. Initial bleibt jede bestehende ID erhalten; unklare Gruppen werden vor manueller Verknuepfung mit betroffenen Vorgangs-/Bestellzahlen angezeigt.
- Firmenzusammenfassung ist von Personenidentitaet getrennt. Bestehende Domainregeln einschliesslich Freemail-/interner Domainausnahmen bleiben bestehen. Eine Firmenzuordnung aendert keine Rechnungsdaten oder Empfaenger.

### Gemeinsame Bearbeitung

Ein authentifizierter serverseitiger Kontaktservice mit GET/PATCH wird von Kundenakte und Telefonzentrale genutzt. Lesen liefert Identitaet, primaere/weitere Kontakte und eine Version. Schreiben validiert UUIDs, Mandant, Laenderformat, E-Mail-Format, Grenzen der Kontaktliste und Version. Versionskonflikt ergibt HTTP 409 statt stiller Ueberschreibung. Fremde Identitaet/fehlende Berechtigung wird abgewiesen.

Eine Datenbanktransaktion speichert Kontakte, Overrides, erforderliche Kompatibilitaetswerte und Audit gemeinsam. Eine fehlgeschlagene Speicherung wird nicht als Erfolg angezeigt. Die bisherigen vorgangsbezogenen Folgeaktualisierungen der Kundenakte bleiben erhalten und werden in die Transaktionsgrenze einbezogen; keine Benachrichtigung oder Mail wird durch den Editor selbst versendet.

Nach Speichern werden Kontaktkopf, Verzeichnis, Kundenakte, Bestellzuordnung und betroffene Zusammenfassungs-Caches aktualisiert. Die bisherige Nummer-hinzufuegen-Route verwendet denselben Service. Fuer Kunden ohne Anfrage funktioniert Kontaktpflege weiterhin ohne erfundene request_id.

### Shopify-Import und andere Verbraucher

- Vollspiegel m6VJ0hvDT7I40xy0: Nur Mapping/Identitaetszuordnung und nachgelagerte Zaehler erweitern; Pagination, Verifikation, Zeitplan, Credentials und Aktivierung erhalten.
- Stuendlicher Import I9vCp27sS3jcH1am: Upsert Customer ueber denselben identitaetsbewussten Importweg. Antwort behaelt das benoetigte id-Feld fuer Find Matching Request und Upsert Order. Operative Bestelllogik, Tags, Supplier-Zuordnung und Zeitplan unveraendert.
- Import aktualisiert Quelldaten, ergaenzt ungeschuetzte fehlende Kontakte und respektiert manuelle Overrides. Leerwerte loeschen keine bestaetigten Kontakte. Wiederholung erzeugt keine doppelten Identitaeten oder Kontaktpunkte.
- Kundenakte/Telefonzentrale suchen auch nach Zusatzadressen/-nummern und lesen die gemeinsame Identitaet. Kommunikation und Bestellungen werden ueber diese Identitaet gesammelt, jeder Datensatz nur einmal.
- Vor Freigabe werden weitere direkte master_customers-Schreiber sowie Mail-/Telefonverbraucher inventarisiert. Bestehende Hauptfeld-Leser bleiben durch die Kompatibilitaetsprojektion versorgt. Vollstaendige plattformuebergreifende Nutzung darf erst nach belegtem Lesetest der jeweiligen Anwendung behauptet werden.
- Shopify, Trello, Easybill und andere externe Plattformen werden nicht automatisch rueckwaerts beschrieben. Dieser Auftrag zentralisiert den Supabase-Stand und seine angebundenen Verbraucher.

## Sichere Einfuehrung und Fehlerverhalten

Additive Migration zuerst in isoliertem PostgreSQL mit repraesentativen Fixtures testen. Bestandsuebernahme ist wiederholbar, paginiert und protokolliert; keine existierende ID oder Historie wird geloescht. Keine Nachbefuellung von master_orders, die Lieferanten-/Versandablaeufe ausloesen koennte. Jeder Zwischenschritt muss mit der bisherigen App lesbar bleiben. App-Aktivierung erst nach bestandenen Schema- und Importtests. Rueckfall auf bisherigen Leser darf keinen leeren Bestand vortaeuschen.

Ungeklaerte Zuordnung, veralteter oder unvollstaendiger Spiegel wird als solcher angezeigt, niemals als bestaetigte null Bestellungen. Vorhandener deduplizierter Fehlerpfad bleibt bestehen; die neueren Nutzerverbote fuer bestimmte Fehlermails und rh@neontrip.de werden respektiert. Keine Testmail an Kunden und keine Annahme, dass support@neon-trip.de funktioniert.

## Verbindliche Abnahme

- Ein Kunde mit zwei E-Mails und zwei Nummern wird ueber jede Adresse/Nummer gefunden; beide Oberflaechen zeigen denselben Stand nach Neuladen.
- Manuelle Telefon-/Namens-/E-Mail-Korrektur uebersteht beide Shopify-Importwege, auch bei leeren Quelldaten und Wiederholung.
- Aenderung der Haupt-E-Mail verliert keine ueber die bestaetigte Kunden-ID zugeordneten Bestellungen; historische Rechnungsdaten bleiben unveraendert.
- Wiederholte Bestell-ID wird nur einmal gezaehlt. Storno/Test und Fremdwaehrung behalten die bestehenden Regeln.
- Gleicher Name, geteilte Telefonnummer, geteiltes Postfach, abweichende Shopify-ID, Gross-/Kleinschreibung, Leerzeichen und konkurrierendes Speichern sind abgedeckt. Mehrdeutigkeit wird nicht automatisch aufgeloest.
- Kein Kontaktalias wird automatisch CC-Empfaenger; keine Erweiterung einer Personenidentitaet allein durch Firmendomain.
- Unauthentifizierte/mandantenfremde Aenderungen scheitern. Transaktionsfehler hinterlassen keine halbe Aenderung.
- Vorhandene Such-, Anrufbestaetigungs-, Notiz-, Summary- und Bestellpopup-Tests bleiben erfolgreich; Typecheck/Build und isolierte UI-Pruefung mit langen/fehlenden Werten.
- Vor Veröffentlichung aktuelles origin/main, gepruefter PR/Preview, exaktes Coolify-Ziel und Commit; danach Live-Health und read-only UI-Kontrolle. Keine echten Kundenkontakte fuer Schreibtests verwenden.

## Naechster Schritt

Pruefung dieses Entwurfs durch Rahim, danach dateigenauer Implementierungsplan und Umsetzung im eigenen Remote-Worktree. Noch nicht behauptet: zentrale Speicherung fertig, alle Plattformen migriert, Bestandskonflikte geloest oder Produktion geaendert.
