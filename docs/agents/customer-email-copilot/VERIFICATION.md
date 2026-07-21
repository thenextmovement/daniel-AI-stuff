# Customer Email Copilot Verification

## Basis

- `[verifiziert]` Repository: `thenextmovement/daniel-AI-stuff`.
- `[verifiziert]` Dedizierter Worktree: `/Users/danielklesse/codex-worktrees/neontrip-ops-handoff-customer-email-copilot-20260721-201528`.
- `[verifiziert]` Branch-Basis und letzter verifizierter Code-Commit: `c76e7e526bf0933b47b1b68936601137f7721309`.
- `[verifiziert]` Verifiziert am 2026-07-21 in Europe/Berlin.
- `[verifiziert]` Es wurden keine Produktionsworkflows, Datenbankdaten, Outlook-Nachrichten, Shopify-Daten, Secrets oder externe Side Effects verändert.

## Lokale fokussierte Prüfungen

| Prüfung | Ergebnis | Status |
| --- | --- | --- |
| `node workflows/email-facts-package/test-workflows.mjs` | bestanden | `[verifiziert]` |
| `node workflows/email-resolve-first/test-workflows.mjs` | bestanden | `[verifiziert]` |
| `node workflows/email-retry-recovery/test-workflow.mjs` | bestanden | `[verifiziert]` |
| `node workflows/email-decision-shadow/test-workflows.mjs` | bestanden | `[verifiziert]` |
| acht fokussierte `tests/quotes/email-*.test.ts` mit `node --test` | 35/35 bestanden | `[verifiziert]` |
| `git status --short` nach Generator-/Testläufen | keine Produkt-/Generated-Drift; nur das Übergabepaket ist geändert | `[verifiziert]` |

Der erste Versuch mit `node --import tsx` scheiterte ausschließlich, weil im frischen Worktree keine Dependencies installiert waren. Der native Node-24-Lauf derselben acht Dateien bestand vollständig. Es wurde kein `npm ci` ausgeführt, weil für den exakten Basiscommit bereits ein frischer belegter CI-Lauf vorlag.

## Frische CI-Evidenz

- `[verifiziert]` GitHub Actions Run `29857274686` für exakt `c76e7e526bf0933b47b1b68936601137f7721309` endete erfolgreich.
- `[verifiziert]` Job `Test, typecheck and build`:
  - 654/654 Tests bestanden;
  - TypeScript-Prüfung bestanden;
  - Next.js Production Build erfolgreich kompiliert.
- `[verifiziert]` Der nachgelagerte Coolify-Triggerjob endete erfolgreich. Diese Aussage belegt nur den Workflow-/Deploy-Trigger, nicht die fachliche Qualität einzelner E-Mail-Entwürfe.
- Run: `https://github.com/thenextmovement/daniel-AI-stuff/actions/runs/29857274686`

## Read-only n8n-Verifikation

Erfasst ohne Input-/Output-Inhalte von Kundenfällen:

| Workflow | Aktiv | Aktive Version | Strict | Knoten / Trigger | Versandknoten |
| --- | --- | --- | --- | ---: | ---: |
| Hauptagent `aE1v0KxbgXbWjUm8` | ja | `30d617ab-5c37-4590-a24b-955007fc5036` | gültig, 0 Fehler, 20 Warnungen | 30 / 1 | 0 |
| Retry `oyF3lAhAOLUgWbzg` | ja | `b9606e9f-78f8-4877-a709-722b3f42e939` | gültig, 0 Fehler, 20 Warnungen | 30 / 1 | 0 |
| Backfill `2FhaSbG9w8QeS70e` | ja | `7006dfe1-9fd5-43f1-a664-a02a17335914` | gültig, 0 Fehler, 3 Warnungen | 5 / 1 | 0 |
| Decision Shadow `LvXVkIhWZH0w0Y1x` | ja | `98199aed-476a-43f8-8d6c-298ed3fa7cde` | gültig, 0 Fehler, 2 Warnungen | 6 / 1 | 0 |
| Sent Delta `7TxHQRyeUxVbpOrl` | ja | `3cae3777-6b06-40c3-b0d9-c486164c26db` | gültig, 0 Fehler, 5 Warnungen | 7 / 1 | 0 |
| Feedback Matcher `bAXM54PasUD8IFNx` | ja | `bfe12269-ff7d-4032-9f6a-af8faa474d24` | gültig, 0 Fehler, 2 Warnungen | 5 / 1 | 0 |
| Resolver v2 `Hrd08cXctM1LO9T3` | ja | `51a74935-483f-40d3-be4d-b07dac61a075` | gültig, 0 Fehler, 5 Warnungen | 9 / 1 | 0 |

Zusätzliche Graphassertions:

- `[verifiziert]` Haupt und Retry enthalten Facts Package v2, Draft Quality Gate v4 und Style Profile v5.
- `[verifiziert]` Beide enthalten Fabiennes Foto- und Logo-Assets und genau eine `Create Reply Draft`-Aktion.
- `[verifiziert]` Haupt ruft Resolver v2 und Decision Shadow auf; Retry ruft Resolver v2 auf.
- `[verifiziert]` Resolver v2 ist read-only und enthält keinen Versandknoten.

## Read-only Execution-Metadaten

Stichprobe am 2026-07-21:

- `[Live-Metadaten]` Hauptagent: vier neuere erfolgreiche Läufe nach einem Fehlerlauf `3363842`.
- `[Live-Metadaten]` Retry: fünf neueste Läufe erfolgreich.
- `[Live-Metadaten]` Backfill: drei neuere erfolgreiche Läufe nach den Enqueue-Fehlern `3364369` und `3364891`.
- `[Live-Metadaten]` Decision Shadow, Sent Delta und Feedback Matcher: jeweils fünf neueste Läufe erfolgreich.
- `[offen]` Execution-Erfolg bedeutet nicht automatisch einen fachlich korrekten Entwurf; keine Nachrichtentexte wurden für diese Übergabe gelesen.

## Read-only Datenbank-Metadaten

- `[Live-Metadaten]` 255 Migrationen sind registriert.
- `[Live-Metadaten]` Die relevanten Migrationen bis einschließlich `email_agent_resolve_first_quality_v5`, `harden_email_open_inbox_dedupe_20260721` und `harden_email_agent_claim_dedupe_20260721` sind angewandt.
- `[Live-Metadaten]` Rollout v2: `review_only`, nicht rollout-ready, kein action-driving `no_reply`, kein Auto-Send, Human Approval erforderlich.
- `[Live-Metadaten]` Decision Gate: 50 Fälle, Routing Accuracy 1,0, Actionable Recall 1,0, No-Reply Precision 1,0, null unsafe No-Reply, Exact Accuracy 0,9.
- `[Live-Metadaten]` Draft Gate: 5/30, nicht bestanden; Details in [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).
- `[Live-Metadaten]` Stilprofil: 3/10 sichere Samples, nicht eligible, keine Kundeninhalte/Fakten, keine automatische Prompt-Umschreibung.
- `[Live-Metadaten]` Retry Health: 21 Recoveries/24h, 47 Retry-Fehler/24h, 11 finale Fehler, keine aktuell fälligen/geplanten/stale Retries.

## Assertionsmatrix

| Aussage | Befund | Status |
| --- | --- | --- |
| Agent versendet niemals autonom. | Kein Send-Knoten; DB-/Workflowflags false/true; Tests. | `[verifiziert]` |
| Jeder erzeugte Kundeninhalt bleibt Entwurf. | Je ein `Create Reply Draft`; Review-Status und Human Gate. | `[verifiziert]` |
| WhatsApp-/Support-Relay kann trotz internem Absender verarbeitet werden. | Exakte Relay-Patterns in Haupt/Backfill/Shadow und Tests. | `[verifiziert]` |
| Organisationsdomain darf alle passenden Kontakte prüfen. | Organisationssuche vorhanden. | `[verifiziert]` |
| Domain-only wählt sicher die richtige Order. | Resolver verweigert diese Auswahl. | `[verifiziert]` als absichtlich nicht erlaubt |
| Anhänge werden auf tatsächliche Präsenz geprüft. | Graph-Metadaten plus Deterministik. | `[verifiziert]` |
| Beliebiger Anhangsinhalt ist vollständig verstanden. | Modellbeobachtung bleibt unverified. | `[offen]` |
| Signiertes Angebot/Shopify können Preisabweichungen belegen. | Resolver v2 und Tests vorhanden. | `[verifiziert]` für den Codepfad; fachlicher Live-Fall offen |
| „Intern klären“ wird blockiert. | Prompt, Validator, Fallback und Tests. | `[verifiziert]` |
| Mitarbeiter müssen jedes Stilbeispiel manuell klassifizieren. | Automatische Analyse vorhanden; manuelles Review optional. | `[verifiziert]` als nicht erforderlich |
| Stilprofil ist bereits aktiv. | 3/10, `eligible=false`. | `[verifiziert]` als derzeit falsch |
| Qualitäts-Gate ist bestanden. | 5/30 und Grenzwerte verfehlt. | `[verifiziert]` als derzeit falsch |
| Backfill und Retry sind fehlerfrei. | Neue Erfolge, aber aktuelle Fehler-/Finalstatistik vorhanden. | `[verifiziert]` als derzeit falsch |

## Sicherheits-Scorecard

| Dimension | Score | Begründung |
| --- | ---: | --- |
| correctness | 3/5 | Gute Fakten-/Schema-Gates, aber aktuelles Draft-Gate deutlich rot und keine neue fachliche E2E-Stichprobe. |
| reliability | 3/5 | Durable Retry und aktuelle erfolgreiche Läufe, aber 47 Retry-Fehler/24h und 11 finale Fälle. |
| idempotency | 4/5 | Race-sichere Claims, Internet-Message-Identität, Backfill-Dedupe und Draft-Reconciliation; aktueller Live-Replay wurde hier nicht ausgelöst. |
| observability | 4/5 | Aggregierte Quality-/Retry-Metriken und Execution-Pfade; ein älterer Hauptfehler blieb noch `Unknown workflow error`. |
| security | 4/5 | Draft-only, Human Gate, Service-Role-Grenzen, Allowlist und Prompt-Injection-Abwehr; untrusted Modell-/Anhangsinput bleibt Restrisiko. |
| tracking impact | 5/5 | Keine Marketing-, Analytics-, Attribution- oder Routingänderung in diesem Handoff. |
| cost risk | 4/5 | Bounded Backfill, Modelltokenlimit und ein Retry-Fall pro Lauf; aktuelle Kosten pro realem Fall wurden nicht gemessen. |

## Grenzen

- Kein Voll-Rebuild lokal, weil der exakte aktuelle Commit wenige Minuten zuvor in CI mit Tests, Typecheck und Build grün war.
- Kein produktiver Write oder Testdraft.
- Keine Kundeninhalte oder Secret-Werte gelesen.
- Keine Aussage, dass die fachliche Entwurfsqualität „perfekt“ sei; die aktuellen Qualitätsmetriken widersprechen dem.
