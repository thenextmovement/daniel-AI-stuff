# Design Studio Decisions

Stand: 2026-07-21. Diese Datei trennt geltende Entscheidungen von historischen oder noch offenen Vorstellungen.

## Geltende Entscheidungen

| Entscheidung | Begründung und Konsequenz | Evidenz |
| --- | --- | --- |
| Supabase ist Source of Truth; Trello ist Projektion | Jobs, Batches, Assets, Offer-Links und Varianten brauchen transaktionale Zustände und Idempotenz. | `[verifiziert]` |
| Direkte Design-Edits verwenden einen eigenen Bearbeitungsprompt | Trello-Beschreibungen und Quote-Ready-Erzeugungsprompts sind nicht zuverlässig der richtige Edit-Prompt. | `[verifiziert]` Commit `7994780` |
| Genau ein Referenzbild pro Generierungsjob | Die Bildbearbeitung muss eindeutig auf das ausgewählte Mockup zurückführbar sein. Bulk wird durch isolierte Items abgebildet. | `[verifiziert]` |
| Allgemeine Generierung darf originale Mockup-JPEGs nutzen | Mitarbeiter müssen aus `Mockup01.jpg` oder `Mockup04.jpeg` neue KI-Mockups erzeugen können. | `[verifiziert]` Commit `214541f` |
| Strukturierte Farb-/Produktvarianten verlangen `Mockup` plus `AI` im JPEG-Namen | Kunden- und Bulk-Varianten sollen auf einem bereits erzeugten KI-Mockup aufbauen. | `[verifiziert]` |
| Bulk ist persistent und item-isoliert | Browser-Unterbrechungen, Retries und mehrere Quellen dürfen weder Ergebnisse vermischen noch nur das erste Bild verarbeiten. | `[verifiziert]` Commits `a30d2ba`, `0003999`, `a6f214b` |
| Bulk ist auf 50 Quellen und eine Trello-Karte begrenzt | Begrenzte Last, klare Zuordnung und kontrollierbare Side Effects. | `[verifiziert]` |
| Ersetzen archiviert statt still zu überschreiben | Das alte Asset bleibt als `alte_Vorschaubilder...` nachvollziehbar, wird aber nicht mehr als aktives Mockup erkannt. | `[verifiziert]` |
| Vollständiges Löschen braucht Backup und exakte Bestätigung | Destruktive Trello-Aktionen müssen vorbereitet und bewusst bestätigt werden. | `[verifiziert]` |
| Benennung wird aus Quelle und Aktion abgeleitet | Neue Uploads dürfen nicht pauschal den Kartentitel als Dateinamen verwenden. | `[verifiziert]` Commit `2355b9d` |
| Produktwechsel benötigt Preisprüfung | Eine visuelle Änderung von Backlit zu Frontlit verändert die Angebotslogik und darf nicht ohne geprüften Preis versendet werden. | `[verifiziert]` |
| Offene Preisprüfung blockiert den Versand serverseitig | Die UI allein ist kein ausreichender Guard für Kundenkommunikation. | `[verifiziert]` |
| Quote-Varianten werden per stabilem Cache-Key gespeichert | Wiederholtes Umschalten auf dieselbe Farbe darf keine erneute kostenpflichtige Generierung auslösen. | `[verifiziert]` Commit `4ec63b9` |
| Öffentliche Quote-Varianten lösen die Quelle serverseitig auf | Ein Client darf keine beliebige externe Bild-URL zur Bearbeitung einschleusen. | `[verifiziert]` |
| Video ist außerhalb des aktuellen Funktionsumfangs | Parserreste sind keine Implementierung; ohne Endpoint, Modellpfad und Assetvertrag darf die UI keine Fähigkeit suggerieren. | `[verifiziert]` |

## Historische, überholte Entscheidungen

- `[verifiziert]` Frühere Implementierungen bevorzugten Trello-Promptblöcke beziehungsweise rekonstruierten einen Quote-Ready-Prompt. Diese Richtung wurde mit `7994780` bewusst durch einen dedizierten Edit-Prompt ersetzt.
- `[verifiziert]` Ein vorhandener `#startprompt/#endprompt`-Block bedeutet daher nicht, dass der aktuelle Design-Job ihn verwendet.
- `[verifiziert]` Frühere Bulk-Implementierungen waren nicht ausreichend item-isoliert. Die Durable-Batch-Härtung ersetzt das browserzentrierte Verhalten.
- `[verifiziert]` Die anfänglich strikte AI-JPEG-Auswahl wurde nur für normale Einzelgenerierung gelockert. Für strukturierte Farb-, Produkt- und Quote-Varianten gilt sie weiterhin.
- `[nur aus Thread erinnert]` Frühere Antworten bezeichneten das Design Studio zeitweise als vollständig produktionsbereit. Der aktuelle Code- und Teststand rechtfertigt diese Aussage wegen offener Live-, Fidelity-, Removal- und Kunden-UI-Evidenz nicht.

## Relevante Git-Historie

| Gruppe | Commits | Aussage |
| --- | --- | --- |
| Fundament | `cfa4324`, `30900c0` | App-Switcher und Design-Arbeitsbereich |
| Prompt und Modi | `4da0cd9`, `ca034e5`, `7994780` | Tischgerät-Modus, historischer Quote-Ready-Ansatz, heutiger Edit-Prompt |
| Referenzbearbeitung und Farbe | `730116d`, `42c8ddd`, `8a93183`, `3f79bc1`, `03f59ab` | Referenz-Edits, erzeugte Quellen, Bulk-Farbe und Fortschrittsfixes |
| Trello und Offer | `8fe1e57`, `77f40c1`, `2355b9d` | Ersetzen, Offer-Aktionen und aktionsbasierte Namen |
| Produkt und Cache | `37ce7a6`, `4ec63b9`, `fb26d17`, `476fd01` | Produktwechsel, Varianten-Cache und strikte AI-JPEG-Quellen |
| Durable Engine | `a30d2ba`, `0003999`, `a6f214b` | Persistente Batches, atomare Claims und Item-Isolation |
| Aktuelle Quellbild-UX | `fa79ec7`, `214541f` | Klarere Aktionen und originale Mockup-JPEGs für Einzelgenerierung |

Alle genannten Commits sind Vorfahren des verifizierten Repository-Stands.

## Noch nicht getroffene Produktentscheidungen

- `[offen]` Öffentlicher API-Vertrag für Kundenvarianten: Quote-Token, Autorisierung, Rate Limits, Kostenlimit und Abuse-Schutz.
- `[offen]` UX der Kundenvariante: Dropdown, echter versus approximierter Fortschritt, Fehlerzustand, Zurücksetzen und Kennzeichnung KI-generierter Bilder.
- `[offen]` Freigabeprozess für visuelle Qualität: automatische Similarity-/OCR-Prüfung, Mitarbeiterreview oder beides.
- `[offen]` Umgang mit öffentlichen Storage-URLs, Aufbewahrungsdauer und Löschkonzept.
- `[offen]` Soll der echte n8n-Quote-Ready-Prompt überhaupt in Design-Edits einfließen, und falls ja, nur als Kontext oder als unveränderte Vorlage?
- `[offen]` Soll Videoerzeugung Teil des Design Studios werden? Dafür fehlen derzeit Modell-, Kosten-, Moderations-, Storage- und Offer-Verträge.
- `[offen]` Soll allgemeine Mockup-Erzeugung auch als Bulk-Aktion angeboten werden? Aktuell ist Bulk absichtlich auf Farb- und Produktänderungen begrenzt.

## Entscheidungsregel für neue Arbeit

Änderungen an Quellbildregeln, Promptverträgen, Benennung, Varianten-Cache oder Offer-Preislogik sind Geschäftslogik. Sie benötigen eine explizite Entscheidung, fokussierte Tests und bei externen Side Effects einen reversiblen Rollout. Eine UI-Umgehung der serverseitigen Regeln ist nicht zulässig.
