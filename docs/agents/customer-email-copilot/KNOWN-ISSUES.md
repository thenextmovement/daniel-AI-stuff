# Customer Email Copilot Known Issues

## Priorität Hoch

### Aktuelles Draft-Quality-Gate ist deutlich nicht bestanden

- `[Live-Metadaten]` Facts-v2-Vergleiche: 5/30.
- `[Live-Metadaten]` Median Edit Ratio: 0,849315 bei maximal 0,35.
- `[Live-Metadaten]` Manual Rewrite Share: 1,0 bei maximal 0,25.
- `[Live-Metadaten]` Safety Correction Share: 0,6 bei maximal 0,02.
- `[Live-Metadaten]` Kategorieabdeckung: general 2, product 2, shipping 1, invoice 0, complaint 0; erforderlich sind mindestens drei je Kategorie.
- `[Konsequenz]` `review_only` beibehalten. Keine Promotion und insbesondere niemals Auto-Send ableiten.

### Finale Retry-Fehler bleiben vorhanden

- `[Live-Metadaten]` 11 `failed_final`-Fälle.
- `[Live-Metadaten]` 47 Retry-Fehler in 24 Stunden und 21 Recoveries.
- `[Live-Metadaten]` Zum Prüfzeitpunkt: 0 fällige, 0 geplante und 0 stale-processing Retries.
- `[offen]` Die Fehlerklassen und fachlichen Auswirkungen der finalen Fälle wurden in diesem Handoff bewusst nicht anhand von Kundeninhalten untersucht.
- `[erforderlich]` Inhaltsarme Fehlerklassifikation, Provider-/Knotenverteilung und manuelle Queue der finalen Fälle getrennt prüfen; keinen Blind-Retry starten.

### Entwurfsqualität ist trotz grünem Strukturtest nicht fachlich bewiesen

- `[verifiziert]` 35 fokussierte Repository-Tests und strikte n8n-Validierung sind grün.
- `[offen]` Kein aktueller echter Fall wurde in dieser Wissensmigration samt Thread, Anhängen, Shopify und signiertem Snapshot fachlich durchgeprüft.
- `[erforderlich]` Stichprobe mit sicheren Test-/bereits abgeschlossenen Fällen, ohne Versand, und Ergebnismatrix pro Kategorie.

## Priorität Mittel

### Haupt- und Retry-Workflow liegen exakt an der 30-Knoten-Grenze

- `[Live-Metadaten]` Beide Graphen: 30 Knoten, ein Trigger, strikt valide.
- `[Live-Metadaten]` Je 20 strikte Warnungen; unter anderem lange lineare Kette, Code-Nodes mit potenziellen Throws und veraltete Execute-Workflow-TypeVersions.
- `[aus Code abgeleitet]` Erweiterungen erhöhen Wartungs- und Fehlerpfadrisiko. Vor neuer Funktionalität nach Verantwortung splitten statt Knoten anzuhängen.

### Provenienzmanifest basiert auf älterer Hauptworkflow-Quelle

- `[verifiziert]` `source-core-manifest.json` nennt Hauptworkflow-Version `6091f279-3941-4755-bae4-f401264a3b6b` vom 2026-07-17.
- `[Live-Metadaten]` Aktive Hauptversion ist `30d617ab-5c37-4590-a24b-955007fc5036`; aktive Retry-Version ist `b9606e9f-78f8-4877-a709-722b3f42e939`.
- `[offen]` Der gemeinsame Kern ist über Tests abgedeckt, aber das Manifest ist keine aktuelle bitgenaue Live-Provenienz.
- `[erforderlich]` Vor dem nächsten Workflow-Refactor aktive Graphen sanitisiert erfassen, Generatorquelle aktualisieren und Hashvergleich neu erzeugen.

### Dokumentationsdrift in älteren README-Dateien

- `[verifiziert]` `docs/email-support-knowledge.md` enthält noch die alte Empfehlung, bei fehlenden Fakten eine interne Prüfung anzukündigen. Der aktuelle Resolve-first-Vertrag verbietet genau diese vage Zusage.
- `[verifiziert]` `workflows/email-passive-safe-learning/README.md` beschreibt im historischen Baseline-Abschnitt noch drei Beispiele als Aktivierungsschwelle; v5 verlangt zehn und ist live mit 3/10 nicht eligible.
- `[Konsequenz]` Für aktuellen Betrieb gelten Generated-Graph, v5-Migration, Tests und dieses Handoff. Alte Texte vor Änderungen nicht ungeprüft übernehmen.

### Backfill hatte kürzlich Enqueue-Fehler

- `[Live-Metadaten]` Ausführungen `3364369` und `3364891` scheiterten am Knoten `Enqueue Open Inbox Candidate` mit einer generischen Request-Fehlermeldung.
- `[Live-Metadaten]` Die drei späteren Backfill-Läufe in der Stichprobe waren erfolgreich.
- `[verifiziert]` Die Race-/Legacy-Identity-Hardening-Migrationen sind angewandt.
- `[offen]` Zeitliche Nähe belegt keine eindeutige Ursache oder vollständige Behebung; weiter beobachten.

### Älterer Hauptworkflow-Fehler verlor die eigentliche Ursache

- `[Live-Metadaten]` Ausführung `3363842` endete bei `Stop With Observable Error` mit `Unknown workflow error`, nachdem der Draft- und Validatorpfad gelaufen war.
- `[verifiziert]` Der aktuelle Code und die aktuellen Tests verlangen eine sanitisierte, actionable Failure-Envelope.
- `[Live-Metadaten]` Vier danach geprüfte Hauptworkflow-Ausführungen waren erfolgreich.
- `[offen]` Ein neuer realer Fehlerfall nach dem Versionswechsel wurde nicht provoziert; die verbesserte Live-Fehlerdarstellung ist daher noch nicht negativ end-to-end belegt.

### Organisations- und Attachment-Auflösung bleiben konservativ begrenzt

- `[verifiziert]` Domain-only wählt keine Cross-Contact-Order; Mehrdeutigkeit blockiert.
- `[verifiziert]` Backfill-/Organisationsabfragen sind zeitlich und mengenmäßig begrenzt.
- `[aus Code abgeleitet]` Sehr alte oder außerhalb des Suchfensters liegende Projektzusammenhänge können fehlen.
- `[aus Code abgeleitet]` Modellbasierte Anhangszusammenfassungen können semantische Details übersehen; nur Präsenz ist Graph-autoritativ.

## Priorität Niedrig

### Externe Signaturbilder

- `[verifiziert]` Foto und Logo werden von bestehenden Shopify-CDN-URLs geladen.
- `[aus Code abgeleitet]` CDN-/Asset-Änderungen können Bilder im Entwurf brechen, obwohl der Text weiter funktioniert.
- `[erforderlich]` Asset-URLs bei Signaturänderungen visuell testen; niemals ein Ersatzbild vom Modell erzeugen lassen.

### Native Node-24-Tests zeigen Module-Type-Warnungen

- `[verifiziert]` Die 35 fokussierten Tests bestanden mit `node --test`, melden aber `MODULE_TYPELESS_PACKAGE_JSON`.
- `[aus Code abgeleitet]` Kein Laufzeitfehler; lokale Testkonfiguration ist weniger sauber als der CI-Pfad mit installierter Toolchain.

### Globale Loop-Kandidatensuite ist außerhalb dieses Scopes rot

- `[verifiziert]` `workflows/loop-agent-hardening/test-candidates.mjs` stoppt an einem separaten 85-Knoten-Gemini-Containment-Workflow.
- `[verifiziert]` Der Fehler betrifft nicht die E-Mail-Copilot-Artefakte; diese bestanden ihre eigenen Tests und die exakte aktuelle CI-Suite.
- `[offen]` Die globale Suite sollte den dokumentierten Containment-Ausnahmepfad korrekt abbilden oder den 85-Knoten-Workflow nach Plan splitten.

## Fehlende Live-Evidenz

- Kein Lesen oder Speichern echter Nachrichtentexte, Anhänge oder Kundendatensätze in dieser Übergabe.
- Kein neuer Outlook-Testentwurf und keine Entwurfslöschung.
- Kein echter Kundenversand – ausdrücklich verboten.
- Kein authentifizierter visueller Check der Ops-Seite.
- Kein fachlicher E2E-Test über Outlook, Organisationskontext, Shopify, signierten Snapshot, Anhangsprüfung und menschliche Outlook-Freigabe.
- Keine Kostenmessung je Modell-/Resolverlauf aus aktueller Produktion.
