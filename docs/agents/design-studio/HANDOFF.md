# Design Studio Agent Handoff

Stand: 2026-07-21, verifiziert gegen Ops `origin/main` auf Commit `a063f216692e97639da36492d9e025f7615665fe`.

Parent-Agent: `ops-software-agent`

## Evidenzstatus

- `[verifiziert]`: durch Datei, fokussierten Test, Git-Historie oder ausdrücklich genannten Read-only-Check belegt.
- `[aus Git/Code abgeleitet]`: Schlussfolgerung aus vorhandenem Code; kein Beleg für den aktuellen Produktionszustand.
- `[nur aus Thread erinnert]`: im bisherigen Arbeitschat berichtet, aber in dieser Übergabe nicht unabhängig bestätigt.
- `[offen]`: ungeklärt, widersprüchlich oder nur in externen Live-Systemen prüfbar.

## Aktueller Befund

- `[verifiziert]` Das Design Studio ist ein Ops-Modul für Trello-basierte Designfälle, KI-Bildbearbeitung, persistente Bulk-Batches, kontrollierte Trello-Ersetzung und die Verknüpfung erzeugter Assets mit bestehenden Angeboten.
- `[verifiziert]` Die kanonischen Zustände liegen in Ops-Supabase-Tabellen. Trello ist Quelle für Karten und Anhänge sowie Ziel einer Projektion, aber nicht Source of Truth für Jobs, Batches, Offer-Links oder Varianten.
- `[verifiziert]` Eine normale Einzelgenerierung akzeptiert originale JPEG-Anhänge wie `Mockup01.jpg` oder `Mockup04.jpeg`. Strukturierte Farb- und Produktänderungen sowie Quote-Varianten verlangen dagegen einen aktiven JPEG-Anhang, dessen Name sowohl `Mockup` als auch `AI` enthält.
- `[verifiziert]` Jede aktuelle Generierung bearbeitet genau ein Referenzbild. Bulk-Farb- und Produktänderungen erzeugen pro ausgewähltem Ausgangsbild ein eigenes persistiertes Batch-Item und einen eigenen Job.
- `[verifiziert]` Das Design Studio nutzt einen eigenen, im Code aufgebauten Bearbeitungsprompt. Trello-Blöcke zwischen `#startprompt` und `#endprompt` werden erkannt, für Design-Studio-Edits aber bewusst nicht verwendet. Der echte n8n-Quote-Ready-Prompt ist nicht integriert.
- `[verifiziert]` Unterstützt sind zwölf kanonische Leuchtfarben sowie Produktänderungen zwischen `3D Frontlit` und `3D Backlit`. Eine Videoerzeugung ist nicht implementiert.
- `[verifiziert]` Ersetzen archiviert den alten Trello-Anhang unter einem `alte_Vorschaubilder...`-Namen und lädt das neue JPEG unter dem vorgesehenen Mockup-Namen hoch. Ein separater Löschpfad verlangt eine vorbereitete Sicherung und die exakte Bestätigung `ENTFERNEN`.
- `[verifiziert]` Die Offer-Verknüpfung prüft Karten-, Bildslot- und Item-Kontext. Produktänderungen erfordern in der UI einen geprüften Nettopreis; offene `needs_price_review`-Links blockieren den Versand serverseitig.
- `[verifiziert]` Ein serverseitiger Cache für Quote-Bildvarianten existiert. Er ist nur über den Ops-Portal-Guard erreichbar; die öffentliche Kundenoberfläche mit Farb-Dropdown, Wartefortschritt und wiederverwendbaren Varianten ist noch nicht implementiert.
- `[verifiziert]` Die fokussierten Design-Tests bestehen mit 32 von 32 Tests. Ein erfolgreicher Repository-CI-Lauf für den exakten Basiscommit belegt außerdem Quote-Suite, TypeScript und Produktions-Build, ersetzt aber keinen authentifizierten Design-Studio-Browsertest.
- `[offen]` Aktuelle Produktionsdaten, angewandte Migrationen, Storage-Policy, n8n-Aktivierungszustand und echte Bildtreue wurden in dieser kostenfreien Read-only-Übergabe nicht live geprüft.

## Einstieg

1. Architektur, Datenflüsse, Quellbildregeln und API-Fläche: [SYSTEM-MAP.md](./SYSTEM-MAP.md)
2. Festgelegte und überholte Entscheidungen: [DECISIONS.md](./DECISIONS.md)
3. Diagnose, sichere Tests, Freigaben und Rollback: [OPERATIONS.md](./OPERATIONS.md)
4. Priorisierte Fehler, Risiken und Funktionslücken: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
5. Reproduzierbare Belege und Testergebnisse: [VERIFICATION.md](./VERIFICATION.md)
6. Maschinenlesbares Agentenmanifest: [agent.json](./agent.json)

## Nicht verhandelbare Grenzen

- `[verifiziert]` Neue Ops-Arbeit beginnt mit `codex-new-worktree ops <topic>`, nicht im alten Main-Checkout `/Users/danielklesse/Desktop/neontrip-ops-coolify`.
- `[verifiziert]` Vor jedem Ops-Deploy ist `codex-predeploy ops` Pflicht; deployt werden darf nur der dort ausgegebene Commit.
- `[verifiziert]` Diese Übergabe autorisiert weder Push noch Deploy noch irgendeine externe Mutation.
- `[verifiziert]` Keine kostenpflichtige Bildgenerierung ohne ausdrückliche Freigabe, klar begrenzte Testmenge und dokumentierte Kostenwirkung.
- `[verifiziert]` Keine produktiven Supabase-, Trello-, Offers-, n8n-, Storage-, E-Mail- oder Kundenmutationen ohne Backup, Diff, Rollback und explizite Zustimmung.
- `[verifiziert]` Keine Secrets lesen, protokollieren, dokumentieren oder committen. In Runbooks stehen ausschließlich Variablennamen.
- `[verifiziert]` Keine ungeprüfte Kundenkommunikation und kein Umgehen von Preisprüfung, Idempotenz oder serverseitigen Guards.
- `[verifiziert]` Trello ist niemals Source of Truth.

## Scope dieser Übergabe

- `[verifiziert]` Dokumentiert sind Design-Studio-UI, APIs, Prompt- und Quellbildregeln, direkte OpenAI-Bildbearbeitung, persistente Batches, Trello-Anhänge und Removal-Pläne, Offer-Integration, Quote-Varianten-Cache, Migrationen, Rollbacks, Testabdeckung und relevante Git-Historie.
- `[verifiziert]` Es wurden ausschließlich Dokumente ergänzt. Produktlogik, Migrationen, Workflows, Konfiguration und Produktionssysteme wurden nicht verändert.
- `[verifiziert]` Es wurden keine Secret-Werte, personenbezogenen Live-Daten, Trello-Karten-URLs oder Kundennamen in das Paket übernommen.
- `[offen]` Historische Aussagen, die nur über eingeloggte Produktionsoberflächen oder kostenpflichtige Generierung prüfbar sind, bleiben ausdrücklich unbestätigt.
