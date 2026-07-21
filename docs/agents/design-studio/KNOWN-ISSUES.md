# Design Studio Known Issues

Stand: 2026-07-21. Priorität berücksichtigt Datenverlust, Kundenwirkung, Kosten und Wiederherstellbarkeit.

## Hoch

### 1. Keine belegte visuelle Fidelity-Garantie

- `[verifiziert]` Der Prompt fordert Erhalt von Logo, Text, Perspektive und Szene, aber es existiert keine automatische Similarity-, OCR- oder Logo-Prüfung.
- `[nur aus Thread erinnert]` Mehrere frühere manuelle Versuche erzeugten falsche beziehungsweise wiederholte Ausgangsbilder oder nur ein Ergebnis aus einer Bulk-Auswahl.
- `[offen]` Die aktuelle Durable-Batch-Version wurde in dieser Übergabe nicht mit einer kostenpflichtigen Mehrbild-Generierung gegen Produktion geprüft.
- Risiko: fachlich falsche Mockups können in Trello oder ein Angebot gelangen.
- Nächster Schritt: kontrollierte Ein-Bild- und danach Mehrbild-Abnahme mit visueller Checkliste und festem Kostenlimit.

### 2. Trello-Removal ist bei Teilfehler nicht vollständig reversibel

- `[verifiziert]` Ein partieller Delete setzt den Backup-Plan auf `failed`; erneut anwendbar sind nur Pläne im Status `prepared`.
- `[verifiziert]` Es gibt keinen automatischen Restore und keinen Codepfad, der `rolled_back` setzt.
- `[aus Git/Code abgeleitet]` Gespeicherte externe Attachment-URLs können später ablaufen oder unbrauchbar werden.
- Risiko: einzelne Anhänge bleiben gelöscht, während der Plan weder fortgesetzt noch automatisch rückgängig gemacht werden kann.
- Nächster Schritt: echten Dateiinhalt dauerhaft sichern, resumierbaren Delete/Restore-Vertrag ergänzen und Teilfehler testen.

### 3. Design-Assets liegen standardmäßig in einem öffentlichen Storage-Bucket

- `[verifiziert]` Die Migration legt `design-assets` öffentlich an; generierte Assets werden über öffentliche URLs verwendet.
- `[verifiziert]` Datenbankzeilen sind durch RLS geschützt, die Objekt-URL selbst ist bei Kenntnis abrufbar.
- `[offen]` Aufbewahrung, Löschfristen und aktuelle produktive Bucket-Policies wurden nicht geprüft.
- Risiko: Kundenmotive können unbeabsichtigt dauerhaft öffentlich erreichbar sein.
- Nächster Schritt: Datenschutzanforderung entscheiden, private/signed URLs und Retention entwerfen, Migration reversibel planen.

### 4. Offer-Produktänderung braucht stärkere Backend-Verhaltensbelege

- `[verifiziert]` Die UI verlangt Preisprüfung und der Send-Pfad blockiert `needs_price_review`.
- `[verifiziert]` Die vorhandenen Design-Tests prüfen Teile dieses Pfads statisch, nicht als vollständigen API-/Domänentest.
- `[aus Git/Code abgeleitet]` Ein direkt konstruierter authentifizierter Request könnte die UI-Bestätigung umgehen; deshalb muss der Server vor jeder Offer-Mutation hart auf bestätigte Preisparameter prüfen.
- Risiko: ein Offer kann vor der endgültigen Preisprüfung teilweise aktualisiert werden, auch wenn der Versand später blockiert wird.
- Nächster Schritt: verhaltensbasierte Tests für Dry-Run, Preisblock, atomare Mutation und Send-Guard ergänzen.

## Mittel

### 5. Größenlimit zwischen Code und Storage ist widersprüchlich

- `[verifiziert]` Der Code akzeptiert generierte JPEGs bis 12 MB.
- `[verifiziert]` Der Bucket wird mit einem Limit von 10 MB angelegt.
- Risiko: ein im Code akzeptiertes Bild kann erst beim Storage-Upload fehlschlagen.
- Nächster Schritt: ein gemeinsames Limit als Konstante definieren und Grenzfälle testen.

### 6. Kundenfähige Farbvarianten sind nur Backend-Grundlage

- `[verifiziert]` `quote_image_variants` und eine durch den Ops-Portal-Guard geschützte Route existieren.
- `[verifiziert]` Öffentliche `/quote`- und `/v`-Oberflächen verwenden sie nicht.
- Fehlend: sichere öffentliche Autorisierung, Rate Limit, Kostenlimit, Progress-UX, Farbwechsel, Cache-Anzeige und Fehlerbehandlung.

### 7. Kein ausführbarer Design-Worker und keine Live-n8n-Evidenz

- `[verifiziert]` Es gibt nur `workflows/plans/design-generation-worker-v0.1.md`.
- `[offen]` Ein externer aktiver n8n-Workflow oder dort hinterlegter Quote-Ready-Prompt wurde nicht geprüft.
- Risiko: Queue-/Callback-Code kann als betriebsbereit missverstanden werden, obwohl kein versionierter Worker ausgeliefert wird.

### 8. Der echte Quote-Ready-Prompt wird nicht verwendet

- `[verifiziert]` Trello-`#startprompt/#endprompt`-Blöcke werden für aktive Design-Edits ignoriert.
- `[verifiziert]` Der aktuelle Prompt ist ein dedizierter `design_studio_edit_prompt`.
- `[nur aus Thread erinnert]` Der fachlich gemeinte Erzeugungsprompt soll möglicherweise in n8n liegen.
- Nächster Schritt: erst Prompt-Quelle und Vertrag read-only belegen, dann entscheiden, ob und wie Kontext übernommen wird.

### 9. Videoerzeugung fehlt

- `[verifiziert]` Es existieren weder Videoendpoint noch Asset-, Status-, Kosten- oder Offer-Vertrag.
- `[verifiziert]` Der aktive Preview setzt `videoPrompt` auf `null`.

### 10. Keine Design-Studio-Browser-/Komponententests

- `[verifiziert]` Die fokussierten Tests decken Domänenregeln und mehrere Source-Code-Verträge ab, aber keinen echten UI-Klickpfad.
- Risiko: Auswahlzustand, deaktivierte Buttons, Fortschritt und Resume können regressieren, obwohl Unit-/Static-Tests grün sind.
- Nächster Schritt: authentifizierten Mock-Smoke für originale Mockups, AI-Bulk, Fortschritt, Replace-Dry-Run und Offer-Dry-Run bauen.

### 11. Allgemeine Bulk-Mockup-Generierung fehlt

- `[verifiziert]` Normale Generierung verarbeitet genau ein ausgewähltes Referenzbild.
- `[verifiziert]` Persistentes Bulk unterstützt nur `light_color` und `product_change`.
- Auswirkung: mehrere originale `Mockup*.jpg` müssen nacheinander generiert werden.

### 12. Direkte Generierungsroute hat ein Laufzeitrisiko

- `[verifiziert]` Der interne OpenAI-Aufruf kann bis zu 150 Sekunden warten.
- `[aus Git/Code abgeleitet]` Die direkte Generate-Route deklariert im Gegensatz zur Batch-Process-Route keine passende `maxDuration`.
- Risiko: Plattform-Timeout, obwohl der Upstream-Aufruf noch läuft.
- Nächster Schritt: Hosting-Limit prüfen und Jobausführung gegebenenfalls vollständig asynchron machen.

## Niedrig

### 13. Rollback-Reihenfolge ist nicht in den bestehenden Migrationen erklärt

- `[verifiziert]` Rollback-Dateien existieren.
- `[aus Git/Code abgeleitet]` Wegen Fremdschlüsseln sollte Quote-Varianten vor Batch- und Basistabellen zurückgebaut werden.
- Diese Übergabe dokumentiert die Reihenfolge in [OPERATIONS.md](./OPERATIONS.md), hat sie aber nicht gegen eine Live-Datenbank ausgeführt.

### 14. Fehlerdetails authentifizierter APIs sollten überprüft werden

- `[aus Git/Code abgeleitet]` Einzelne Fehlerantworten können technische Supabase-Details enthalten.
- Risiko ist wegen Ops-Authentifizierung begrenzt, aber unnötige Schema-/Backend-Details sollten nicht an Browserclients gelangen.

## Fehlende Live-Evidenz

- `[offen]` Aktueller produktiver Commit und authentifizierter UI-Zustand.
- `[offen]` Angewandte Supabase-Migrationen, RLS und Storage-Policies in Produktion.
- `[offen]` Aktive Coolify-Variablennamen und Modellkonfiguration, ohne Secret-Werte zu lesen.
- `[offen]` Existenz/Aktivierung eines externen n8n-Design-Workers.
- `[offen]` Erfolgreicher aktueller Mehrbild-Batch mit verschiedenen Quellen und korrekter Trello-Ersetzung.
- `[offen]` Vollständiger Offer-Dry-Run plus fachliche Preisprüfung für Produktwechsel.

## Kein aktueller Fehler

- `[verifiziert]` `Orange` ist eine kanonische Farbe und wird nicht als `Amber` gespeichert.
- `[verifiziert]` Originale `Mockup01.jpg` und `Mockup04.jpeg` sind für normale Einzelgenerierung laut aktuellem Code zulässig.
- `[verifiziert]` Dass dieselben Dateien für Farb-/Produktänderungen ohne `AI` im Namen nicht zulässig sind, ist derzeit beabsichtigte Geschäftslogik und muss bei gewünschter Änderung explizit neu entschieden werden.
