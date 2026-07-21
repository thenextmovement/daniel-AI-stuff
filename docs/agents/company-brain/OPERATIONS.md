# Company Brain Operations

## Sicherer Start

```bash
codex-new-worktree ops <topic>
cd <ausgegebener-worktree>
git status --short --branch
git fetch origin
git rebase origin/main
```

- `[verifiziert]` Nie im alten Checkout `/Users/danielklesse/Desktop/neontrip-ops-coolify` arbeiten.
- `[verifiziert]` Vor Arbeit dieses Handoff-Paket und das repo-nahe `AGENTS.md` lesen.
- `[verifiziert]` Secrets nur ueber die vorhandenen Secret-Stores verwenden; Werte nie anzeigen oder dokumentieren.

## Standard-Runbook: Trello-Karte kam mit Fehler zurueck

1. `[verifiziert]` Trello-Link in `/ops/company-brain` eingeben und die konkrete Frage stellen, etwa "Warum wurden Video und Angebot nicht erstellt oder versendet?"
2. `[verifiziert]` Oben `Ursache`, Confidence, Execution/Schritt, `Naechster Schritt` und `Nicht tun` lesen. Details erst fuer die Belegpruefung oeffnen.
3. `[verifiziert]` Identitaet pruefen: genau eine Request-ID, ein passendes Offer und eine erklaerbare Trello-Aliasgruppe. Bei Konflikt keine Recovery.
4. `[verifiziert]` Versandzustand pruefen: spaeterer Workflow-Erfolg, `quote_email_log`, Outlook-Ausgang, Bounce und Trello-Projektion unterscheiden.
5. `[verifiziert]` Nur die primaere freigegebene Aktion nutzen. Ein disabled Button ist ein Guard, kein UI-Fehler, wenn der konkrete Blocker angezeigt wird.
6. `[verifiziert]` Bei kritischer Aktion Action-Run anlegen und durch eine zweite Person mit `approver`/`company_admin` genehmigen lassen.
7. `[verifiziert]` Nach Ausfuehrung Fall neu laden. Nur ein neuer belastbarer Terminal-/Versandbeleg schliesst den Fall fachlich.

## Ursachen-Runbooks

### Ungueltige oder fehlende Kunden-E-Mail

- Ursache muss aus Kundenakte, Offer oder strukturiertem Audit belegt sein.
- `prepare_email_correction` legt nur eine interne Aufgabe an.
- `correct_customer_email` aendert kanonische Kontaktdaten und braucht vier Augen.
- Danach Fall neu laden; ein Resend ist eine separate Entscheidung mit erneutem Duplicate-/Bounce-Check.
- Niemals eine Domain-Endung raten oder aus einem Firmennamen ableiten.

### Copied Card / Alias-Konflikt

- Request-/Nerdy-Forms-ID aus Card, Master Request und Offer gegeneinander halten.
- Keine automatische Zusammenfuehrung ueber Name oder E-Mail.
- Eindeutige Projektion kann mit `repair_trello_alias` nach vier Augen korrigiert werden.
- Mehrere Kandidaten bleiben in `company_identity_review_queue`, bis ein Mensch den Frozen Before-State geprueft hat.

### Video-QC fehlgeschlagen

- Versuch und Limit lesen. Bei noch geplantem automatischem Zweitversuch nicht parallel starten.
- Bei erschoepftem Limit muss nach dem Fehler ein neues/korrigiertes Trello-Asset belegt sein.
- `collect_design_assets`/Mockup-Pruefung ist read-only beziehungsweise manuelle Vorarbeit, kein Versand.
- `retry_media_pipeline` erst nach neuem Asset und allen serverseitigen Guards freigeben.

### Preview-Medium ungueltig

- Ungueltige Video-/Poster-URL oder Offer-Payload als konkreten Issue-Code belegen.
- Nach dem Fehler muss Trello-Asset oder Offer nachweislich aktualisiert worden sein.
- Unveraenderten Retry blockieren; keine URL aus Freitext improvisieren.

### Offer-Service temporaer nicht verfuegbar

- Aktuellen Fehlerbeleg, Stage und Execution pruefen.
- Spaeteren Erfolg, aktiven Queue-Job und Duplicate-Beleg ausschliessen.
- Kontrollierter Medien-Pipeline-Retry ist nur bei eindeutigem aktuellen Fall zulassbar.

### Source nach Preflight geaendert

- Der alte Payload ist absichtlich verworfen.
- Karte, Offer und Assets neu laden; keine alte Execution fortsetzen.
- Erst mit dem aktuellen Source-Stand einen idempotenten Retry vorbereiten.

### Versand schon erfolgt, Trello noch rot

- Versandbeleg muss nach dem relevanten Fehler liegen und zum gleichen Fall gehoeren.
- `repair_trello_projection` darf dann FEHLER-Prefix/fehlendes Versandlabel korrigieren.
- Die Aktion sendet keine Mail. Schlaegt nur der nachgelagerte Audit fehl, nicht erneut klicken; den Warnhinweis sichern.

### Kein Terminal-Ereignis

- `company_brain_workflow_attempts.state = stale` und den zugehoerigen Incident pruefen.
- n8n Execution und Queue read-only untersuchen.
- Scanner hat keinen Retry gestartet. Ursache und Side-Effect-Ungewissheit zuerst klaeren.
- Bei unbekanntem Versandzustand niemals parallel senden.

## Recovery-Freigabecheck

Vor `retry_media_pipeline` muessen alle Punkte gruen sein:

- eindeutige Request-, Offer- und Trello-Identitaet,
- gueltige externe Empfaengeradresse,
- Offer gehoert zu Request, Karte und Empfaenger,
- aktueller Failure-Audit und unveraenderte Failure-ID/-Art/-Zeit,
- Issue-Code ist in der Recovery-Allowlist,
- kein spaeterer Workflow-Versandbeleg,
- kein `quote_email_log`-Versandbeleg,
- kein Outlook-Ausgang und kein aktueller Bounce,
- kein aktiver oder bereits gesendeter Queue-Job,
- Karte offen und ohne Versandlabel,
- bei permanentem Medienfehler: geaenderter Asset-/Offer-Stand nach dem Fehler,
- zweite berechtigte Person genehmigt den Frozen Action-Run.

Erwartetes Ergebnis: genau ein `preview_delivery_jobs`-Eintrag mit deterministischem Idempotency-Key und `max_attempts = 1`. Kein paralleler Fallback.

## Incident-Betrieb

- `open`: neu erkannt, noch nicht uebernommen.
- `acknowledged`: Mitarbeiter hat den Fall uebernommen; optionaler Assignee muss intern und gueltig sein.
- `resolved`: nur mit mindestens zehn Zeichen umfassender Beleg-/Loesungsnotiz.
- `ignored`: nur `automation_admin`/`company_admin`, ebenfalls mit Begruendung.
- `[verifiziert]` Neuer Fehlerbeleg darf einen geloesten Incident wieder oeffnen; ein neuer passender Erfolg kann ihn automatisch schliessen.
- `[verifiziert]` Incident-Events sind append-only und sollen fuer Ursachen- und Outcome-Reviews erhalten bleiben.

## Geplante Ausfuehrung

`schedule_supported` bedeutet fuer diesen Agenten:

- erlaubt: read-only Incident-Queue lesen, stale Attempts zusammenfassen, Source Health pruefen, faellige Decision Reviews melden, Verifikationsbericht erzeugen;
- nicht durch den Agent-Schedule ausloesen: Die implementierten Datenbank-Scanner pflegen Attempt-/Incident-Zustand und sind damit keine read-only Agent-Aktion; der Agent darf ihre Ergebnisse nur lesen;
- verboten: Action-Run genehmigen, Recovery starten, Kundenmail senden, Kundendaten korrigieren, Trello mutieren, n8n aktivieren oder deployen.

`[verifiziert]` Die Datenbank plant den allgemeinen Incident-Scan alle fuenf Minuten. `[verifiziert]` Attempt-Gaps werden ab 30 Minuten als stale erkannt. Scheduling ersetzt keine Event-Produzenten.

## Aktionsmatrix

| Aktion | Wirkung | Risiko/Freigabe |
| --- | --- | --- |
| `open_problem_case`, `create_internal_task`, `save_case_note`, `prepare_email_correction`, `prepare_offer_retry` | interne Dokumentation/Aufgabe | niedrig; explizite Bestaetigung, kein Kundenkontakt |
| `post_trello_status_comment`, `repair_trello_projection` | Trello-Projektion | mittel; Source-of-Truth-Beleg erneut pruefen |
| `correct_customer_email` | kanonische Kundendaten | hoch; Vier-Augen-Prinzip |
| `repair_trello_alias` | systemuebergreifende Identitaet | hoch; Vier-Augen-Prinzip |
| `guarded_offer_resend` | Kundenmail | kritisch; Vier-Augen-Prinzip plus Duplicate-/Bounce-/Ownership-Guards |
| `retry_media_pipeline` | Queue-Job, der spaeter Kundenkontakt erreichen kann | kritisch; Vier-Augen-Prinzip, frische Guards, ein Versuch |
| `sync_n8n_workflows` | read-only n8n-Inventar in Governance speichern | mittel; `automation_admin`, ausdrueckliche Bestaetigung |
| `approve_company_decision` | Policy/Entscheidung aktivieren | hoch; getrennte Freigabe |

## Konfigurationsnamen

Nur Namen, niemals Werte dokumentieren:

- n8n read-only: `N8N_API_URL` oder `N8N_BASE_URL`, `N8N_API_KEY`
- Outlook Graph read-only: `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_CLIENT_SECRET`, `MICROSOFT_GRAPH_MAILBOX`; historische Aliase sind im Code abgebildet
- Coolify read-only: `COOLIFY_API_URL` oder `COOLIFY_URL`, `COOLIFY_API_TOKEN`, optional `COOLIFY_APPLICATION_UUID`
- KI-Kurzfassung: `COMPANY_BRAIN_OPENAI_API_KEY`, `COMPANY_BRAIN_OPENAI_MODEL` mit vorhandenen Ops/OpenAI-Fallbacknamen
- Rollen: `COMPANY_BRAIN_DEFAULT_VERIFIED_ROLE`
- Workflow-Audit-Auth: dedizierte vorhandene interne Bearer-Namen; keinen Wert in Befehle, Logs oder Doku schreiben

## Lokale Verifikation

```bash
npm ci --ignore-scripts
node --import tsx --test \
  tests/quotes/company-brain.test.ts \
  tests/quotes/company-brain-routes.test.ts \
  tests/quotes/company-brain-governance.test.ts \
  tests/quotes/company-brain-operational-intelligence.test.ts \
  tests/quotes/company-brain-foundation.test.ts \
  tests/quotes/workflow-audit.test.ts \
  tests/quotes/workflow-audit-route.test.ts
npx tsc --noEmit
```

Bei Produkt-/Schemaaenderungen zusaetzlich:

```bash
npm run test:quotes
npm run build:voice-runtime
npm run build
npm run smoke:company-brain-ui
npm run smoke:company-brain-governance-ui
```

UI-Smokes nutzen Mockdaten und beweisen keine Live-Integration. Datenbankmigrationen muessen in einer isolierten PostgreSQL-Transaktion inklusive Rollback-Assertions getestet werden.

## Release- und Rollback-Gate

1. Eigener sauberer Worktree, auf aktuellem `origin/main`.
2. Backup, Diff, Test und expliziter Rollback fuer jede n8n-/Schemaaenderung.
3. Fokussierte Tests, Full Suite, Typecheck, Build und relevante UI-Smokes gruen.
4. Keine Secrets oder fremden Aenderungen im Diff.
5. Push nur ueber `codex-safe-push-main` und nur bei expliziter Freigabe.
6. Vor jedem Deploy `codex-predeploy ops`; nur exakt den ausgegebenen Commit deployen.
7. Nach Deploy Health, Auth, read-only Integrationen, Incident-Scan und einen internen Testfall pruefen. Keine echte Kundenkommunikation fuer QA.

Rollback-Reihenfolge:

1. Side Effects stoppen; aktive Action-/Queue-Zustaende sichern.
2. App mit gezieltem Revert-Commit zurueckrollen.
3. n8n nur aus dem vor der Aenderung gesicherten Export/Versionstand wiederherstellen.
4. Schema-Rollback nur nach Impact-Analyse; Rollback-Dateien liegen unter `supabase/rollbacks/`.
5. Bereits versandte Mails oder externe Mutationen sind nicht durch Code-Rollback rueckgaengig und brauchen protokollierte Fachkorrektur.
