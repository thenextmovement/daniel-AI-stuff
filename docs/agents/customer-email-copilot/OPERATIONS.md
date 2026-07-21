# Customer Email Copilot Operations

## Betriebsprinzip

Der Copilot produziert Outlook-Entwürfe. Der normale Betrieb endet am gespeicherten, menschlich zu prüfenden Entwurf. Es gibt keinen „Send“-Betriebsschritt des Agenten.

## Täglicher Read-only-Check

1. Ops-Seite `/ops/email-agent` öffnen.
2. Rollout-Stufe muss `review_only` bleiben, solange das Draft-Quality-Gate nicht bestanden ist.
3. Prüfen, ob `automatic_send_allowed` weiterhin `false` und `human_send_approval_required` weiterhin `true` ist.
4. Retry-Status prüfen: fällige, geplante, stale und final fehlgeschlagene Fälle.
5. n8n-Ausführungen des Haupt-, Retry- und Backfill-Workflows auf neue Fehler prüfen.
6. Bei konkreten Entwürfen zuerst Fakten-/Anhangsbeleg und erst danach Stil beurteilen.

## Relevante IDs

| Zweck | ID |
| --- | --- |
| Hauptagent | `aE1v0KxbgXbWjUm8` |
| Retry | `oyF3lAhAOLUgWbzg` |
| Open-Inbox-Backfill | `2FhaSbG9w8QeS70e` |
| Commerce Resolver v2 | `Hrd08cXctM1LO9T3` |
| Decision Shadow | `LvXVkIhWZH0w0Y1x` |
| Sent Delta | `7TxHQRyeUxVbpOrl` |
| Feedback Matcher | `bAXM54PasUD8IFNx` |

## Diagnose nach Symptom

### Kein Entwurf bei neuer Nachricht

1. Prüfen, ob die Nachricht als extern oder als exakt erlaubter Relay-Typ erkannt wurde.
2. Prüfen, ob sie reine Bestätigung, Automation/No-Reply oder nicht actionable ist.
3. Lock anhand stabiler Request-/Internet-Message-Identität prüfen.
4. Hauptworkflow-Ausführung und den ersten fehlgeschlagenen Knoten prüfen.
5. Falls retryable: DB-Zustand und nächsten Retry prüfen; keinen manuellen Blind-Retry auslösen.
6. Falls noch offen: Backfill berücksichtigt nur Inbox, 30 Tage, keinen späteren Sent/Draft und maximal zehn neue Kandidaten je Lauf.

### Backfill meldet Enqueue-Fehler

1. Prüfen, ob die Race-Hardening-Migrationen angewandt sind.
2. Prüfen, ob der Fehler vor oder nach dem aktiven Backfill-Versionwechsel lag.
3. Duplicate/Legacy-Identity als erfolgreichen No-op behandeln, nicht als Anlass für einen zweiten Entwurf.
4. Nachfolgende erfolgreiche Backfill-Läufe und Queue-/Retry-Zustand prüfen.

### Entwurf enthält „intern klären“

1. Entwurf nicht freigeben.
2. `validation_reasons` auf `unhelpful_internal_deferral` prüfen.
3. Feststellen, ob eine konkrete kundenseitige Information fehlt. Wenn ja, genau danach fragen.
4. Wenn nur interne Evidenz fehlt, Claim aus dem Kundenentwurf entfernen und Review-Metadaten präzisieren.
5. Nicht durch eine andere spätere Zusage ersetzen.

### Entwurf behauptet falschen/fehlenden Anhang

1. Graph-Anhangsmetadaten gegen die Kundenaussage prüfen.
2. Nur tatsächlich vorhandene Dateien als vorhanden behandeln.
3. Modellzusammenfassung als Beobachtung, nicht als Dokumentbeweis behandeln.
4. Fehlendes angekündigtes Dokument konkret mit Zweck anfragen.

### Preis-/Angebotsabweichung

1. Eindeutige Kunden-/Order-/Offer-Zuordnung verlangen.
2. Signierten Angebots-Snapshot, Shopify-Orderstatus und passende Rechnungs-/Zusatzorder-Evidenz vergleichen.
3. Mehrere korrigierte Preise oder unklare Cross-Contact-Zuordnung als Konflikt behandeln.
4. Keine Modellrechnung oder unbestätigte Differenz an den Kunden geben.
5. Entwurf bleibt menschlich zu prüfen.

### Doppelte Entwürfe

1. `request_id`, `internet_message_id` und Conversation prüfen.
2. Aktiven/abgelaufenen Lease-Zustand prüfen.
3. Vor jeder erneuten Entwurfserstellung die Draft-Reconciliation im Outlook-Thread prüfen.
4. Keine Lock- oder Eventzeile löschen, um einen Retry zu erzwingen.

## Retry-Vertrag

- Ein Worker-Lauf beansprucht höchstens einen fälligen Fall.
- `FOR UPDATE SKIP LOCKED` und Lease schützen vor Parallelverarbeitung.
- Nach ambiger Outlook-Entwurfserstellung wird zuerst nach einem vorhandenen Draft reconciled.
- Transiente Fehler sind auf fünf Gesamtversuche begrenzt.
- Fehlende Quelle nach Graph-ID und Internet-Message-ID führt zu finalem Fehler.
- Retry-Ereignisse speichern keine Nachrichtentexte.
- Alle Recovery-Ergebnisse behalten `automatic_send_allowed=false` und `human_approval_required=true`.

## Backfill-Vertrag

- Alle 30 Minuten.
- Höchstens 30 Tage Rückblick.
- Höchstens 1.000 Inbox-, Draft- und Sent-Zeilen je Quelle.
- Höchstens zehn älteste offene Kandidaten je Lauf.
- Pure Bestätigung, Automation, bereits beantwortete oder bereits gedraftete Conversation wird ausgeschlossen.
- Backfill enqueued nur; der kanonische Retry-Worker recherchiert und erstellt gegebenenfalls den Entwurf.

## Lernen und Qualität

- Sent-Delta verknüpft einen menschlich gesendeten Text mit dem vorherigen AI-Draft.
- Analyzer v5 klassifiziert `style_safe`, `resolver_gap`, `policy_gap`, `knowledge_gap` oder `unsafe_or_ambiguous`.
- Wiederverwendbar sind nur inhaltsfreie Aggregate wie Wort-/Absatzzahl und ein erlaubter Abschluss.
- Zehn semantisch sichere Beispiele sind für ein v5-Stilprofil erforderlich.
- Faktenlernen und automatische Prompt-Umschreibung sind deaktiviert.
- Manuelle Review-Gründe bleiben als Ausnahmepfad verfügbar und auditiert.

## Sichere lokale Verifikation

```bash
node workflows/email-facts-package/test-workflows.mjs
node workflows/email-resolve-first/test-workflows.mjs
node workflows/email-retry-recovery/test-workflow.mjs
node workflows/email-decision-shadow/test-workflows.mjs
node --test tests/quotes/email-gold-evaluation.test.ts \
  tests/quotes/email-learning-gate.test.ts \
  tests/quotes/email-learning-loop-v3.test.ts \
  tests/quotes/email-passive-safe-learning-v4.test.ts \
  tests/quotes/email-resolve-first-backfill.test.ts \
  tests/quotes/email-resolve-first-quality-v5.test.ts \
  tests/quotes/email-retry-recovery.test.ts \
  tests/quotes/email-support-knowledge.test.ts
```

Die Generator-Tests schreiben kanonische Generated-Artefakte neu; danach muss `git status --short` leer bleiben.

## Änderungsvorgehen

1. `codex-new-worktree ops <topic>`.
2. Aktuelles `origin/main` holen und Worktree sauber aufsetzen.
3. Aktive n8n-Graphen read-only erfassen; keine Kundeninhalte exportieren.
4. Vor jeder Produktionsänderung exakte Workflow-/Schema-Backups, Diff und Rollback festlegen.
5. Änderungen nur an Generator/Source-of-Truth vornehmen, Generated-Artefakte neu erzeugen und Drift prüfen.
6. Fokussierte Tests, DB-Apply/Rollback auf isoliertem Postgres und strikte n8n-Validierung ausführen.
7. Prüfen: ein Trigger, maximal 30 Knoten, kein Send-Knoten, stabile Idempotenz, beobachtbarer Fehlerpfad.
8. Commit nur im dedizierten Worktree.
9. Vor Push/Deploy `codex-predeploy ops`; nur exakten Preflight-Commit verwenden.
10. Produktion nur mit expliziter Freigabe ändern. Danach aktive Graphversion, Execution-Metadaten und Draft-only-Grenze erneut prüfen.

## Rollback

### Workflow

- Vorherige veröffentlichte Graphen liegen unter `workflows/loop-agent-hardening/backups/2026-07-21/`.
- Relevante Dateien:
  - `aE1v0KxbgXbWjUm8.published-active.json`
  - `oyF3lAhAOLUgWbzg.published-active.json`
  - `2FhaSbG9w8QeS70e.published-active.json`
- Aktive Versionshistorie in n8n zusätzlich prüfen; lokale Backups vor Restore erneut auf Secret-Freiheit und Ziel-ID kontrollieren.
- Erst neuen Trigger deaktivieren, dann vorherigen Graphen wiederherstellen, anschließend sicherstellen: kein Send-Knoten und vorhandene Outlook-Drafts bleiben unberührt.

### Datenbank

Relevante Rollbacks liegen unter `supabase/rollbacks/`, insbesondere:

- `20260720185658_email_agent_resolve_first_quality_v5_rollback.sql`
- `20260720131125_enqueue_email_agent_open_inbox_backfill_rollback.sql`
- `20260721170404_harden_email_open_inbox_dedupe_rollback.sql`
- `20260721171625_harden_email_agent_claim_dedupe_rollback.sql`
- `20260717113500_email_agent_retry_recovery_rollback.sql`

Rollback-Reihenfolge muss der umgekehrten Apply-Reihenfolge entsprechen. Keine externen Side Effects oder bereits vorhandenen Entwürfe blind replayen oder löschen.
