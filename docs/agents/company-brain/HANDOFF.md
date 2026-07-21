# Company Brain Handoff

Stand: 2026-07-21

Parent-Agent: `ops-software-agent`

Verifizierter Code-Stand: `a063f216692e97639da36492d9e025f7615665fe`

## Zweck

Dieses Paket ist die kanonische Arbeitsgrundlage fuer Company Brain, Fallaufloesung sowie die abgesicherte Recovery-/Incident-Funktion im Agent Control Tower. Es beschreibt den aktuellen Repository-Stand. Es aktiviert keine Automation und ist kein Nachweis fuer den momentanen Zustand externer Produktionssysteme.

## Evidenzklassen

- `[verifiziert]`: am genannten Commit direkt in Git, Code, Migrationen oder lokalen Tests belegt.
- `[aus Code/Git abgeleitet]`: technisch belastbare Folgerung aus mehreren verifizierten Stellen, aber kein produktiver Laufzeitbeleg.
- `[historisch aus Thread]`: im uebergebenen Chatverlauf berichtet, in dieser Uebergabe nicht erneut live bestaetigt.
- `[nicht live verifiziert]`: kann nur mit einer aktuellen read-only Pruefung des externen Systems bestaetigt werden.
- `[offenes Risiko]`: bekannte Luecke oder noch nicht belegte Eigenschaft.

## Kanonischer Stand

- `[verifiziert]` Company Brain nimmt Trello-Link, Request-ID, Angebotsnummer, Offer-ID, E-Mail und weitere Identifikatoren entgegen und verdichtet Kundenakte, Offers, Trello, Mailbelege und Automation-Audits zu einer deterministischen Diagnose.
- `[verifiziert]` Die erste Ergebnisansicht zeigt Ursache, Status, naechsten Schritt, primaere Aktion und eine klare Nicht-tun-Regel. Dossier, Matrizen, Timeline und Quellen liegen hinter aufklappbaren Details.
- `[verifiziert]` Trello ist Projektion. Kanonische Fallidentitaet ist `request:<request_id>`; kopierte Karten werden ueber harte Aliase und insbesondere Request-/Nerdy-Forms-ID korreliert.
- `[verifiziert]` Automationsfehler werden strukturiert in `workflow_audit_log` normalisiert. Neue Audit- und Queue-Ereignisse reconciliieren in `company_brain_workflow_attempts` und koennen Incidents erzeugen oder aufloesen.
- `[verifiziert]` `retry_media_pipeline` ist kein Direktversand. Die Aktion braucht einen aktuellen zugelassenen Fehler, eindeutige Identitaet, frische Quellen, Duplicate-/Bounce-Pruefung, eine freie Queue und bei dauerhaften Medienfehlern geaenderte Eingaben. Sie legt maximal einen idempotenten Queue-Job mit `max_attempts = 1` an.
- `[verifiziert]` Der Retry ist als `critical`, mit Vier-Augen-Prinzip und potenziellem Customer Side Effect klassifiziert. Vorschlag und Freigabe muessen von verschiedenen berechtigten Personen kommen.
- `[verifiziert]` Ein 30-Minuten-Scanner erkennt fehlende Terminal-Ereignisse, markiert den Attempt als `stale` und erzeugt einen Incident. Er startet absichtlich keine Wiederholung.
- `[verifiziert]` Ein belegter spaeterer Versand blockiert weitere Retries und kann passende offene Workflow-Incidents schliessen. Ein aktueller Bounce blockiert Kundenkontakt.
- `[verifiziert]` KI darf eine beleggebundene Kurzfassung liefern. Aktionswahl, Guardrails und Side Effects bleiben deterministisch; bei Modellfehler bleibt die regelbasierte Diagnose erhalten.

## Mitarbeiterzielbild

1. Fall ueber Trello-Link oder harte ID suchen.
2. Oben nur `Ursache`, `Naechster Schritt`, `Jetzt tun` und `Nicht tun` lesen.
3. Bei unklarer Identitaet zuerst Alias-/Identity-Review bearbeiten.
4. Nur die vom Server freigegebene Aktion vorbereiten.
5. Kritische Aktionen durch eine zweite berechtigte Person freigeben lassen.
6. Fall nach Ausfuehrung neu laden und nur anhand eines neuen Terminal- oder Versandbelegs als geloest behandeln.

## Historischer Problemkontext

Folgende Faelle haben den Funktionsumfang im uebergebenen Verlauf gepraegt. Sie sind keine aktuelle Produktionsbestaetigung:

| Referenz | Historisches Anliegen | Aktuelle Abdeckung im Code |
| --- | --- | --- |
| `BiP93WuG`, A/N 14427 | Angebot nicht versendet; konkrete Ursache statt Daten-Dossier benoetigt | `[verifiziert]` ungueltige Empfaengeradresse, Execution-Fehler, Duplicate-/Bounce-Beleg und guarded Korrektur/Retry werden klassifiziert. `[historisch aus Thread]` Der konkrete damalige Lauf wurde als E-Mail-Fehler beschrieben. |
| `G6Clgcsz` | kopierte Trello-Karte war mit anderem Kartenbezug verknuepft | `[verifiziert]` Alias-Aufloesung, Konflikt-Queue und manuelle, freigabepflichtige Alias-Reparatur existieren. |
| `K2fPefEC`, `O5RKGnGk` | mehrere Karten ohne Video und Versand | `[verifiziert]` Video-/Asset-/Offer-Service-/Source-Changed-Ursachen und Attempt-Lifecycle sind abgedeckt. `[nicht live verifiziert]` Die damaligen Karten wurden hier nicht erneut gelesen. |
| `O4CNCCZW` | wiederholter Mockup-/Video-Fehler | `[verifiziert]` Video-QC, ungueltige Preview-Medien, erschoepfte Versuche und geaenderte Asset-Pflicht werden getrennt behandelt. `[nicht live verifiziert]` Aktueller Kartenstatus unbekannt. |

## Einstiegspunkte

- Architektur und Datenfluss: [SYSTEM-MAP.md](SYSTEM-MAP.md)
- Bindende Entscheidungen und Historie: [DECISIONS.md](DECISIONS.md)
- Diagnose-, Recovery- und Incident-Runbooks: [OPERATIONS.md](OPERATIONS.md)
- Bekannte Luecken und Risiken: [KNOWN-ISSUES.md](KNOWN-ISSUES.md)
- Reproduzierbarer Pruefstand: [VERIFICATION.md](VERIFICATION.md)
- Maschinenlesbares Manifest: [agent.json](agent.json)

## Harte Grenzen

- Keine Produktionsmutation, kein Deploy, keine Workflow-Aktivierung und keine echte Kundenkommunikation aus einer Diagnose heraus.
- Keine Aktion nur auf Basis von Trello, Titel, Label oder Freitext.
- Keine automatische Identitaetszusammenfuehrung ueber E-Mail oder Namen.
- Kein Retry ohne Idempotenz, frische Revalidierung und Versand-/Bounce-/Queue-Guards.
- Kein n8n-Change ohne Backup, Diff, Test und Rollback.
- Keine Secret-Werte in Chat, Repo, Logs, Screenshots oder Dokumentation.
- Neue Ops-Arbeit nur in einem `codex-new-worktree ops <topic>`; Push nur ueber den vorgeschriebenen sicheren Main-Prozess. Vor jedem spaeter freigegebenen Deploy `codex-predeploy ops` ausfuehren und nur den ausgegebenen Commit deployen.

## Scope dieses Pakets

- `[verifiziert]` Es wurden nur Dateien unter `docs/agents/company-brain/` erstellt.
- `[verifiziert]` Es wurden keine Produktlogik, Daten, Runtime-Variablen, n8n-Workflows oder Deployments veraendert.
- `[nicht live verifiziert]` Supabase-Migrationsstand, aktive n8n-Version, Outlook-/Graph-Zugriff, Coolify-Konfiguration und konkrete Produktionsfaelle muessen pro Einsatz read-only neu bestaetigt werden.
