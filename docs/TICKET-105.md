# TICKET-105: Quentin-Routing ausfallsicher ueberwachen

## Pflichtangaben

| Feld | Wert |
|---|---|
| Projekt-ID | PROJ-001 |
| Ticket | TICKET-105 |
| Verantwortliche Person | Rahim |
| Zugewiesener Agent | Codex |
| Repository | thenextmovement/daniel-AI-stuff |
| Produktionsbranch | `main` |
| Aufgabenbranch | `codex/ticket-105-quentin-routing-guard` |
| Worktree | `/home/rahim/worktrees/neontrip-ops/ticket-105-quentin-routing-guard` |
| Ausgangscommit | `3c0c9085dc97ff5272b06058839ab09f32288944` |
| Betroffene Komponenten/Dateien | `workflows/quentin-vector-routing/*` |
| Pull Request | noch nicht erstellt |
| Preview | generierte n8n-Artefakte und lokale Tests |
| Status | in Arbeit |

## Ziel und Abgrenzung

- Ziel: Fehler des Quentin-Vector-Routings sofort intern melden und fehlende
  Zielkarten unabhaengig erkennen sowie ohne Dubletten nachholen.
- Akzeptanzkriterien: Mail an `support@neontrip.de` mit Betreff
  `Quentin Board Vector file uploaded fehlgeschlagen` und Kartenlink;
  Hauptworkflow bleibt fuer spaetere Karten aktiv; Watchdog erkennt fehlende
  Kopien nach fuenf Minuten und erstellt eine sichere Fallback-Kopie.
- Nicht Bestandteil: andere Trello-/n8n-Regeln, Produktklassifizierung,
  Preis-/Backboard-Fachlogik, Kundenkommunikation und sonstige Systeme.

## Abschluss-Checkliste

- [x] Projekt, Ticket, Account und Verantwortlicher stimmen mit dem aktiven Kontext ueberein.
- [x] Es wird ausschliesslich im eigenen Aufgabenbranch und Worktree gearbeitet.
- [ ] Die beauftragten Aenderungen wurden committet.
- [ ] `origin` wurde neu geladen und der Aufgabenbranch auf `origin/main` rebased.
- [ ] Eventuelle Konflikte wurden sichtbar und bewusst geloest.
- [ ] Projektspezifische Tests und Artefaktvalidierung sind erfolgreich.
- [ ] Pull Request und isolierte Preview sind aktuell.
- [ ] Diff, Testergebnisse und Preview wurden geprueft.
- [ ] Die erforderliche Freigabe ist dokumentiert.
- [ ] Nur der freigegebene Pull Request wird in `main` gemergt.
- [ ] Das produktive n8n-Update wurde kontrolliert.
- [ ] Aufgabenbranch und Worktree wurden nach erfolgreichem Merge geschlossen.

## Konflikt- und Freigabeprotokoll

| Feld | Wert |
|---|---|
| Integrierter Produktionscommit | ausstehend |
| Konflikte | ausstehend |
| Konfliktloesung geprueft durch | ausstehend |
| Testergebnis | ausstehend |
