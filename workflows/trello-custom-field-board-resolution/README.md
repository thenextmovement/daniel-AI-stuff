# TICKET-084: Trello custom-field board resolution

## Plan

Der Outlook-Intake erstellt die Trello-Karte weiterhin über dieselbe List-ID. Die Custom-Field-Definitionen werden danach nicht mehr von einem fest verdrahteten Board geladen, sondern über `idBoard` aus der Antwort der gerade erstellten Karte. Vor den beiden bestehenden PUTs werden Karten-ID, Board-ID, Feldzugehörigkeit, Feldtyp, eindeutiger Feldname und die eindeutige Dropdownoption validiert.

Es werden keine Nodes oder Connections ergänzt, entfernt oder verschoben. Alle anderen Trigger-, ActiveCampaign-, Supabase-, Trello-, Anhangs-, Routing- und Fehlerpfade bleiben unverändert.

## Node Structure

1. Bestehender Outlook-Trigger und bestehende Eingangsvalidierung
2. Bestehende CRM- und Supabase-Schritte
3. `Create Trello Card` – unverändert; liefert `id` und tatsächliche `idBoard`
4. `Get Board Custom Fields` – lädt Felder dynamisch von genau dieser `idBoard`
5. `Prepare Field Data` – validiert Board, Feldtypen und `LED Neon`-Option und erzeugt zwei idempotente Projektionen
6. `Set Trello Custom Field` – unveränderter, begrenzt wiederholender PUT
7. Bestehende Logging- und Error-Workflow-Pfade

## Risks

- Der Bestandsworkflow besitzt bereits 38 Nodes und liegt damit über der empfohlenen Grenze von 30. Dieser eng begrenzte Hotfix verändert die Node-Anzahl nicht; eine spätere Aufteilung ist eine eigene Aufgabe.
- Das Schreiben bleibt absichtlich fehlersichtbar. Fehlt ein Pflichtfeld auf dem tatsächlichen Board, stoppt der Workflow mit einer eindeutigen Validierungsmeldung, statt eine andere gleichnamige Ressource zu verwenden.
- Das bestehende n8n-Retry wiederholt auch dauerhafte API-Fehler begrenzt. Die neue Vorvalidierung verhindert den hier beobachteten boardfremden 404 vor dem PUT; eine statusabhängige zentrale Retry-Architektur ist nicht Teil dieses minimalen Hotfixes.

## Test Plan

- Karten auf Board A und Board B müssen jeweils die IDs ihres eigenen Boards verwenden.
- Boardfremde, fehlende, doppelte oder falsch typisierte Felder müssen vor dem PUT abgelehnt werden.
- Der Patch muss beim zweiten Anwenden identisch bleiben.
- Node-Anzahl, Connections, Settings, Credentials, Retry und alle anderen Nodes müssen unverändert bleiben.
- Produktivworkflow vor und nach dem Rollout validieren und den vollständigen Struktur-Diff prüfen.
- Live-Verifikation ausschließlich anhand der nächsten natürlichen Ausführung oder durch rücklesende Prüfung; keine echte Karte für den Test erzeugen oder verschieben und keine Kundenmail auslösen.

## Rollback

Vor der Mutation die aktive n8n-Version festhalten und eine unveränderte Vollsicherung erzeugen. Bei Regression die gesicherte Version wiederherstellen. Der Code-Rollback erfolgt über den Revert des einzelnen Pull Requests. Der Hotfix migriert keine Trello-Felder oder Karten und benötigt deshalb keinen Datenrollback.

## Lokale Prüfung

```bash
node --test workflows/trello-custom-field-board-resolution/test-board-field-resolution.mjs
```
