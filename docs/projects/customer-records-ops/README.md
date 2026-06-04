# Customer Records Ops Projekt

Stand: 2026-05-28

Dieser Ordner bündelt die Dokumentation zum Customer-Records-Ops-Projekt: Ops-Portal, Call-Modul, Request-Segmentierung und die dazugehörigen Sicherheitsregeln.

## Einstieg

- [Customer Records Ops](./customer-records-ops.md): Hauptdoku für Portal, Arbeitsmodi, Call-Modul, Datenmodell und Handover.
- [Request Segmentation](./request-segmentation.md): Anfrage-Segmentierung, n8n-Workflow, Postgres-Felder und manuelle Korrektur im Portal.
- [Interne Aufgaben](./internal-tasks.md): Aufgabenboard fuer Team-To-dos, Problemfaelle, Nachbestellungen, Deadlines und Sichtbarkeit in der Call-Zentrale.
- [Internal Deployment](./internal-deployment.md): Interne Veroeffentlichung mit Cloudflare Access, Deployment-Env, Pfadvalidierung und Rollback.
- [Internal Launch Checklist](./internal-launch-checklist.md): Schrittfolge fuer Datenbank-, Hosting-, Access-, Build-, Smoke- und Rollback-Gates vor interner Nutzung.
- [Coolify Deployment](./coolify-deployment.md): Hosting-Ziel, Dockerfile, Env Vars, DNS, Zugriffsschutz und Validierung fuer Hetzner/Coolify.
- [Operations Runbook](./operations-runbook.md): Alltag nach Go-Live: Code aendern, testen, pushen, redeployen, Login/Secrets verwalten, Mailverlauf/Visual-Requests betreiben und Stoerungen eingrenzen.
- [Go-Live Status 2026-05-26](./go-live-status-2026-05-26.md): Heutiger Ist-Stand, Blocker und naechste Schritte fuer interne Nutzung.

## Projektgrenzen

- Postgres bleibt Quelle der Wahrheit.
- Trello bleibt Projektion und Arbeitskontext.
- KI darf Segmentierung und Arbeitsvorschläge liefern, aber deterministische Regeln validieren und speichern.
- Das Call-Modul darf keine laufenden Mail-Follow-ups oder n8n-Mail-Workflows ändern.
- Tracking- und Routing-Änderungen gehören nicht in dieses Projekt ohne eigene QA- und Rollback-Doku.

## Aktueller Arbeitsstand

- `customer-records-ops.md` enthält den laufenden Handover-Stand für `/ops/customer-records` und `/ops/customer-records/calls`.
- `request-segmentation.md` ist bewusst Teil dieses Projektordners, weil Segmentierung direkt im Ops-Portal sichtbar und korrigierbar ist.
- `operations-runbook.md` ist die operative Anleitung fuer Aenderungen nach dem Deployment auf `ops.neontrip.de`.
- Der alte Operations-Pfad bleibt als schlanker Hinweis erhalten, damit bestehende Links nicht brechen.

## Nächste sinnvolle Ordnungsschritte

1. Weitere projektnahe Dokus nur hier ergänzen, statt lose unter `docs/operations/`.
2. Große Code- oder Repo-Umzüge erst mit Pfad-Inventar, Testplan und Rollback durchführen.
3. Falls das gesamte lokale Projekt später physisch umziehen soll, vorher alle festen Pfade prüfen:
   - lokale Startskripte
   - Cloudflare-/Deploy-Skripte
   - n8n- und Supabase-Hilfsskripte
   - Dokumentationslinks
   - gespeicherte Browser-/Server-URLs
