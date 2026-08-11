# TICKET-106: Exakte Kopie-Markierung fuer Quentin-Routing

## Pflichtangaben

| Feld | Wert |
|---|---|
| Projekt-ID | PROJ-001 |
| Ticket | TICKET-106 |
| Verantwortliche Person | Rahim |
| Zugewiesener Agent | Codex |
| Repository | thenextmovement/daniel-AI-stuff |
| Produktionsbranch | `main` |
| Aufgabenbranch | `codex/ticket-106-quentin-copy-marker` |
| Worktree | `/home/rahim/worktrees/neontrip-ops/ticket-106-quentin-copy-marker` |
| Ausgangscommit | `9a46bfc62cb0f458ecb68ef5f589fe2373f5cf40` |
| Betroffene Komponenten/Dateien | `workflows/quentin-vector-routing/*` |
| Status | in Arbeit |

## Ziel und Abgrenzung

- Automatische Kopien zaehlen nur mit exaktem selbstreferenziellem TICKET-106-Marker auf Quell- und Zielkarte.
- Manuelle Kopien und kopierte alte Kommentare blockieren nicht.
- Unterbrochene Zielmarkierungen werden repariert; Fehler nutzen weiter den bestehenden Error-Workflow.
- Nicht Bestandteil: Routing-, Backboard-, Preis-, Produkt- oder andere Regeln.

## Freigabe

Rahim hat am 2026-08-11 die Umsetzung und Live-Schaltung ausdruecklich freigegeben.
