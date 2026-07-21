# Exportversand/Schweiz Known Issues

## Blocker – vor jeder Implementierungsübernahme

### Kein Exportcode in `origin/main`

- `[verifiziert]` Die UI, API, Domainmodule, Migration, Tests und der Monitor-Draft existieren nur uncommittiert im alten Prototyp-Worktree.
- `[verifiziert]` Der Prototyp basiert auf `cc2e199` und liegt 48 Commits hinter `origin/main` `a063f21`.
- Risiko: direkte Übernahme kann aktuelle Shipping-, Arrival-, Auth-, Schema- oder Workflow-Änderungen überschreiben beziehungsweise doppeln.
- Pflicht: neuer Worktree, gezielter Port/Reimplementation und vollständiger Diff gegen aktuellen Stand.

### Providerentscheidung ist offen

- `[verifiziert]` DPD Cloud ist der offizielle Integrationshinweis für myDPD Business.
- `[verifiziert]` Im aktuellen `main` existiert zusätzlich ein EasyDPD-Browser-Worker für einen anderen Scope.
- `[offen]` Für NEONTRIPs Schweizer Exportprodukt sind weder Cloud-Livezugang noch EasyDPD-Exportablauf/Tarif qualifiziert.
- Risiko: Doppelbuchung, falsches Produkt, falsche Preise oder doppeltes Shopify-Fulfillment.

### Keine Live-Evidenz

- Keine echte DPD-Sandbox-/Live-Antwort dieses Agenten.
- Kein echtes Exportlabel, keine scanbare Paketnummer und keine bestätigte Preis-/Produktzuordnung.
- Kein echter Shopify-Fulfillment-/Mail-Canary.
- Keine authentifizierte Prüfung produktiver Exportflags, DB-Tabellen oder Storage-Objekte; Secret-/Runtimezustand wurde bewusst nicht gelesen. Der Auftrag und der fehlende Git-Artefaktstand bestätigen, dass diese Fähigkeit nicht als deployt oder aktiviert behandelt werden darf.

## Hoch

### Gewünschte myDPD-Handelsrechnung ist nicht erfüllt

- `[historischer Prototyp]` Die Rechnung wird lokal erzeugt und nur im privaten Supabase Storage abgelegt.
- `[verifiziert]` In der gelesenen DPD-Cloud-Dokumentation wurde kein belastbarer Zoll-/Handelsrechnungsupload nachgewiesen; internationaler Express wird ausdrücklich ohne Zollangaben beschrieben.
- Risiko: operative oder rechtliche Erwartung „in myDPD ausgefüllt“ bleibt unerfüllt.
- Entscheidung: lokales Dokument ausdrücklich akzeptieren oder einen anderen dokumentierten Providerpfad aufnehmen.

### Zoll-, Steuer- und Rechnungssemantik ist nicht fachlich abgenommen

- UID-Pflicht, Incoterm, Rechnungsnummer, Waren-/Verpackungs-/Frachtwert und Ursprungsangaben sind technisch validiert, aber nicht steuer-/zollrechtlich freigegeben.
- Der Prototyp nutzt die geprüfte Empfängeradresse zugleich als Rechnungs-/Zolladresse.
- Risiko: falsche Rechnung, Zollverzögerung oder fehlerhafte Einfuhrabwicklung.
- Pflicht: fachliche Abnahme und getrennte Billing-Adresse, wenn erforderlich.

### Datenschutz und Retention offen

- Exportjobs enthalten Kundenadresse, Kontakt, UID/USt-ID, Warenwerte und Dokumente.
- `[historischer Prototyp]` Kein automatischer Löschlauf wurde eingebaut, weil Aufbewahrungsfrist und Rechtsgrundlage ungeklärt waren.
- Pflicht: Zugriff, Aufbewahrung, Löschung, Export und Verantwortlichkeit vor Produktionsdaten festlegen.

### Historischer Rollback ist datenlöschend

- Die SQL-Rollbackdatei droppt Exporttabellen und damit Job-/Auditbezüge.
- Der Storage-Bucket wird nur bei Leere gelöscht; vorhandene PDFs können ohne DB-Metadaten zurückbleiben.
- Pflicht: Backup/Export und Restore-Plan vor jeder produktiven Migration.

## Mittel

### Arrival-EasyDPD-Worker ist nicht wiederverwendbar

- Shop, Route, Produkte, A6, 500 g und 15-EUR-Grenze sind für den Arrival-Scope eng festgelegt.
- `CH` ist dort ein harter manueller Stopper.
- Risiko: eine vermeintlich kleine Erweiterung umgeht Export-, Zoll- und Shopify-Gates.

### Ein Paket und alle offenen Positionen

- Teilfulfillment, mehrere Pakete, verschiedene Versandorte und Mehrpaketsendungen fehlen.
- Eine Änderung benötigt neues Idempotenz-, Dokument- und Fulfillmentmodell.

### Maße werden nicht an den historischen DPD-Cloud-Request übertragen

- Der Prototyp speichert Länge/Breite/Höhe im Snapshot und druckt sie auf die Rechnung; sein SOAP-Request überträgt nur Gewicht und Inhalt.
- Die offizielle Dokumentation beschreibt „Paketgröße- und Gewicht“, der im Prototyp verwendete Vertragsausschnitt enthält jedoch keine Dimensionsfelder.
- Pflicht: aktuellen Vertrag und Tarifregeln vor Implementierung erneut klären.

### DPD-Vertrag nur strukturell gemockt

- Der Test prüft ausgewählte XML-Felder und eine synthetische SOAP-Antwort.
- Keine Schema-/WSDL-Validierung und kein Sandbox-Contract-Test wurden in diesem Handoff durchgeführt.

### PDF-Test beweist keine visuelle oder rechtliche Tauglichkeit

- Der fokussierte Test prüft PDF-Magic und ZIP-Struktur.
- Ein früherer Thread berichtete einen erfolgreichen Build/UI-Smoke, aber keinen dokumentierten Render-/Zollformular-Abnahmelauf.
- Pflicht: rendern, mehrseitige Rechnung, Umlaute, lange Texte, Seitenumbrüche, Druck und fachliche Felder prüfen.

### Kunden-UID-Regel ist zu absolut

- Der Prototyp fordert bei `b2b` immer Firma und UID/USt-ID.
- `[offen]` Umgang mit Schweizer Firmen ohne UID beziehungsweise unbekannter Nummer.

### Storno und Provider-Reconcile fehlen

- `cancelled` ist ein Schemawert, aber kein sicherer Provider-Stornoablauf ist implementiert.
- Nach `dpd_outcome_unknown` bleibt die Prüfung manuell.

### Monitor ist nur ein Draft

- Der historische Workflow ist `active:false` und nicht in `origin/main`.
- Er ist kein Recovery-Mechanismus und darf keine Carrier-/Shopify-Aktion auslösen.

## Niedrig / Baseline

### Historische Prototypreferenz ist nicht dauerhaft

- Uncommittierte Worktrees sind kein belastbares Archiv.
- Dieses Handoff bewahrt Anforderungen, Architektur und Risiken, nicht den Quellcode selbst.
- Vor dem Löschen des alten Worktrees muss bewusst entschieden werden, ob er verworfen oder in einem neuen aktuellen Feature-Worktree selektiv neu umgesetzt wird.
