# Company Brain Known Issues

## Prioritaet Hoch

### Produktiver Integrations- und Releasezustand ist in dieser Uebergabe nicht belegt

- `[verifiziert]` Repository und fokussierte Tests belegen Integrationslogik, nicht gesetzte Runtime-Werte oder aktive externe Versionen.
- `[nicht live verifiziert]` Supabase-Migrationsstand, n8n-Workflow-Aktivitaet/-Version, Microsoft-Graph-Zugriff, Coolify-App/Release und aktuelle Queue-Worker wurden nicht abgefragt.
- `[historisch aus Thread]` Diese Bausteine wurden in frueheren Sessions als teilweise oder vollstaendig eingerichtet beschrieben.
- `[offenes Risiko]` Ein Mitarbeiter kann eine korrekte lokale Diagnose sehen, obwohl ein externer Producer weiterhin keinen v2-Audit schreibt oder ein Worker nicht aktiv ist.
- Naechster Schritt: read-only Readiness und exakten Release-Commit vor produktiver Freigabe erneut belegen; keine Secret-Werte ausgeben.

### Alte Runs werden nicht allgemein in den kanonischen Attempt-Store zurueckgefuehrt

- `[verifiziert]` `20260720185649_company_brain_closed_loop_control.sql` installiert Trigger fuer neue Inserts/Updates, aber keinen allgemeinen Backfill aller historischen Audit-/Queue-Zeilen.
- `[verifiziert]` Legacy-Audits bleiben ueber `workflow_audit_log` lesbar und der Normalizer toleriert unvollstaendige Events.
- `[aus Code/Git abgeleitet]` Historische Faelle koennen daher eine gute Ursache aus Audit/Trello zeigen, aber keinen vollstaendigen `company_brain_workflow_attempts`-Lifecycle besitzen.
- `[offenes Risiko]` Stale-Erkennung und Attempt-zentrierte Cockpitlogik sind fuer solche alten Faelle unvollstaendig.
- Naechster Schritt: CB-O01 aus [DECISIONS.md](DECISIONS.md) als getrennte, reversible Migration mit Dry Run entscheiden.

### Kein aktueller echter Recovery-End-to-End-Beleg

- `[verifiziert]` Unit-/Route-Tests beweisen, dass genau ein Queue-Job angelegt und Direktversand vermieden wird.
- `[nicht live verifiziert]` Es wurde in dieser Uebergabe kein interner Testjob durch Queue, n8n, Offer-Erstellung, Video, Mailprovider und Terminal-Audit verfolgt.
- `[offenes Risiko]` Contract-Drift zwischen Ops, Supabase-Queue und aktuell publiziertem n8n kann nur live sichtbar werden.
- Naechster Schritt: CB-O02 mit freigegebenem internen Testfall, Kostenlimit und ohne Kundenadresse ausfuehren.

## Prioritaet Mittel

### Legacy-Audits koennen nur generische Contract-Felder liefern

- `[verifiziert]` Der Audit-Normalizer erzeugt Fallbacks fuer Attempt-Key, Stage und Safe-Action, markiert aber fehlende Pflichtangaben in `contract_missing_fields` und `contract_complete = false`.
- `[aus Code/Git abgeleitet]` Eine Ursache kann klassifizierbar sein, ohne dass Workflow-ID, expliziter Attempt-Key oder Terminal-Flag vom Producer stammt.
- `[offenes Risiko]` Automatische Incident-Zuordnung kann bei schwacher Case-Identitaet weniger praezise sein.
- Naechster Schritt: alle aktiven relevanten n8n-Produzenten auf Contract v2 pruefen und unvollstaendige Events als Datenqualitaetsmetrik sichtbar machen.

### Incident-Aufloesung arbeitet mit Identifier-Ueberschneidung

- `[verifiziert]` Reconcile-RPCs koennen einen Workflow-Incident schliessen, wenn Request, Trello-Card oder Offer mit einem spaeteren Versandbeleg uebereinstimmt.
- `[verifiziert]` Der eigentliche Recovery-Action-Pfad prueft die Identitaet strenger und blockiert Mismatches.
- `[aus Code/Git abgeleitet]` Bei bereits verschmutzten Legacy-Aliasdaten kann die Incident-Anzeige frueher als der Recovery-Pfad zu optimistisch sein.
- Naechster Schritt: Identity-Review-Queue und widersprechende harte IDs vor Incident-Abschluss als Golden Cases erweitern.

### UI-Smoke deckt den echten Closed Loop nicht ab

- `[verifiziert]` `scripts/smoke_company_brain_ui.mjs` mockt Resolve-Payload und Actions.
- `[verifiziert]` Der aktuelle Mock enthaelt keinen vollstaendigen realen Queue-/Attempt-Lifecycle fuer `retry_media_pipeline`.
- `[aus Code/Git abgeleitet]` Der Smoke beweist Bedienbarkeit und Guard-Texte, aber weder Live-Datenkorrelation noch zweite Freigabe noch Terminal-Reconcile.
- Naechster Schritt: separaten, weiterhin side-effect-freien UI-Smoke fuer Proposal -> Awaiting Approval -> Approved/Queued -> Terminalstatus aufbauen.

### Company Brain kann nur Belege erklaeren, die Produzenten strukturiert liefern

- `[verifiziert]` Mehrere konkrete Root Causes werden aus Audit-Metadaten und bekannten Fehlermustern klassifiziert.
- `[aus Code/Git abgeleitet]` Ein n8n-Pfad, der silent endet, keinen Queue-Status aktualisiert und kein Audit schreibt, wird erst ueber den 30-Minuten-Gap erkennbar, sofern zuvor ein Attempt erzeugt wurde.
- `[offenes Risiko]` Fehlt bereits das Start-/Queue-Ereignis, gibt es keinen Attempt fuer den Gap-Scanner.
- Naechster Schritt: Start- und Terminal-Event-Coverage je aktivem Producer messen; fehlende Start-Events als separaten Source-Health-Incident modellieren.

### Mailbeweis kann je Fall nur teilweise verfuegbar sein

- `[verifiziert]` Resolver und Action-Guards koennen Outlook-Spiegel und optional Live Graph lesen.
- `[aus Code/Git abgeleitet]` Ohne passenden Spiegel-/Graph-Treffer bleibt der Versandbeleg trotz Offer-Status `SENT` unklar.
- `[offenes Risiko]` Graph-Rechte, Mailbox-Scope oder Spiegel-Freshness koennen unbemerkt abweichen, wenn Readiness nur Konfiguration statt Testtreffer sieht.
- Naechster Schritt: read-only Freshness-/Probe-Metrik pro Mailquelle und klare Trennung `configured`, `reachable`, `evidence_found`.

## Prioritaet Niedrig

### Detailansicht bleibt absichtlich umfangreich

- `[verifiziert]` Die erste Ansicht ist auf Ursache, naechsten Schritt, primaere Aktion und Nicht-tun-Regel reduziert.
- `[verifiziert]` Dossier, Evidence Timeline, Matrizen, Assets, Source Health und technische Details bleiben unter aufklappbaren Bereichen vorhanden.
- `[aus Code/Git abgeleitet]` Fuer Mitarbeiter ist die erste Ebene deutlich fokussierter; fuer Debugging bleibt die zweite Ebene datenreich.
- `[offenes Risiko]` Ohne aktuelle visuelle Desktop-/Mobile-Pruefung ist nicht belegt, dass alle realen langen Inhalte ergonomisch bleiben.

## Nicht als aktueller Beleg verwenden

- `[historisch aus Thread]` konkrete aktive n8n-Version, Node-/Warning-Zahlen, Coolify-Health und produktiver Supabase-Smoke;
- `[historisch aus Thread]` fruehere Aussagen wie "deployed", "configured" oder "alles funktioniert" ohne aktuellen Commit- und E2E-Nachweis;
- `[historisch aus Thread]` Ursachen einzelner Trello-Faelle, solange sie nicht erneut anhand heutiger Audit-/Mail-/Offer-Belege gelesen wurden.

Diese Aussagen sind wertvolle Suchhinweise, aber keine Freigabegrundlage.
