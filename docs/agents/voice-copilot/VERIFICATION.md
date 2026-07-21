# Voice Copilot Verification

## Verifikationsbasis

- `[verifiziert]` Repository: `https://github.com/thenextmovement/daniel-AI-stuff.git`.
- `[verifiziert]` Dedizierter Worktree: `codex/handoff-voice-copilot-20260721-201631`.
- `[verifiziert]` Der Worktree wurde vor Abschluss auf `c76e7e526bf0933b47b1b68936601137f7721309` (`Convert ActiveCampaign auto reply to draft loop`) rebased; lokales HEAD und `origin/main` waren danach identisch.
- `[verifiziert]` `origin/main` lief waehrend der Inventur zweimal weiter. Der Worktree wurde sauber von `07c02d2` ueber `a063f216` auf `c76e7e5` aktualisiert; der letzte Commit aenderte keine Voice-Pfade.
- `[verifiziert]` Verifiziert am 2026-07-21 in Europe/Berlin.
- `[verifiziert]` Kein produktiver Read/Write, kein Deploy, kein Push, keine Migration, keine Workflow-Aktivierung, kein OpenAI-Live-Eval, kein Telefonat und keine kostenpflichtige Aktion.

## Lokale Ergebnisse

| Pruefung | Ergebnis | Status |
| --- | --- | --- |
| `npm ci` | 390 Pakete, Audit 0 Vulnerabilities | `[verifiziert]` |
| fokussierte Voice-/Offer-Kontext-Suite | 55/55 bestanden | `[verifiziert]` |
| `npm run eval:voice` | 56 eindeutige Szenarien, 12 Pflichtkategorien, `valid:true` | `[verifiziert]` |
| `npm run build:voice-runtime` | Exit 0 | `[verifiziert]` |
| `npx tsc --noEmit` | Exit 0 | `[verifiziert]` |
| `git diff --cached --check` | Exit 0 | `[verifiziert]` vor Commit |

- `[verifiziert]` Zwei Warnlogs in `voice-knowledge.test.ts` gehoeren zu expliziten Fallback-/Failure-Path-Tests; der Testprozess endete ohne Fehler.
- `[verifiziert]` Kein voller Next.js-Build wurde ausgefuehrt: Es wurde ausschliesslich Dokumentation geaendert, der Repository-Typecheck und der gezielte Runtime-Build sind gruen.
- `[offen]` `tests/sql/voice-platform.integration.sql` wurde nicht ausgefuehrt, weil in dieser Wissensmigration keine isolierte PostgreSQL-17-Testinstanz provisioniert wurde.

## Gepruefte Repository-Pfade

- UI/Navigation: `src/app/ops/voice-copilot/**`, `src/app/ops/ops-app-switcher.tsx`, `src/app/ops/ops-page-header.tsx`.
- Browser-/Live-APIs: `src/app/api/ops/voice-copilot/**`, `src/lib/ops/voice-copilot.ts`, `voice-openai-config.ts`, `voice-copilot-api.ts`.
- Kontext/Wissen: `src/lib/ops/voice-knowledge.ts`, `customer-records.ts`, `company-brain.ts`, `offers.ts` und relevante Voice-/Knowledge-Migrationen.
- Plattform: `src/app/api/ops/voice-platform/route.ts`, `src/app/api/internal/voice-platform/**`, `src/lib/ops/voice-platform-*.ts`, `voice-runtime-*.ts`.
- Runtime: `services/voice-runtime/**`, `Dockerfile.voice-runtime`, `tsconfig.voice-runtime.json`.
- n8n: drei `n8n/workflows/voice-*.json`, `n8n/voice-platform-workflow-manifest.json`, `n8n/backups/2026-07-13-voice-platform-prechange.json`.
- Tests/Evals: `tests/quotes/voice-*.test.ts`, `offer-call-context.test.ts`, `tests/sql/voice-platform.integration.sql`, `src/lib/ops/voice-platform-evals.ts`, `scripts/run_voice_platform_*`, `artifacts/voice-evals/**`.
- Doku: `docs/operations/voice-call-platform.md`, `voice-live-copilot.md`, `docs/voice-copilot-knowledge.md`, `docs/legal/voice-consent-and-disclosure.md`, `docs/runbooks/voice-model-switch.md`.

## Assertionsmatrix

| Aussage | Befund | Status |
| --- | --- | --- |
| Postgres entscheidet Calls, n8n nicht. | Claim-/Eligibility-RPC und Runtime-Flow vorhanden. | `[verifiziert]` |
| Doppelte Calls werden vermieden. | Atomare Reservation/Idempotenz; unsicherer Twilio-Create wird nicht wiederholt. | `[verifiziert]` im Code/Test, nicht live |
| Kundenuebergreifender Zugriff wird blockiert. | Request-Binding, Offer-Konfliktpruefung, begrenzte Tools und Tests vorhanden. | `[verifiziert]` |
| Consent/DNC wird vor Claim und erneut vor Dial/Accept geprueft. | SQL- und Runtime-Pfade vorhanden. | `[verifiziert]` im Code/Test, nicht live |
| Stop erzeugt DNC. | Outcome-Validierung und Finalize-RPC vorhanden. | `[verifiziert]` im Code/Test, nicht live |
| Modell/Prompt sind nachvollziehbar. | Registry und immutable Attempt-Snapshots vorhanden. | `[verifiziert]` |
| Rollback ist abgesichert. | Modell-RPC, DB-Rollbacks und n8n-Backup vorhanden. | `[verifiziert]` als Artefakt; nicht live getestet |
| Keine Rohtranskripte/Audios werden gespeichert. | Schemas, Session-Erzeugung, Browsercode und Tests setzen false/volatile. | `[verifiziert]` im Code |
| Live-Copilot kann nichts ausfuehren. | Suggestions-Route hat keine Tools/Side Effects. | `[verifiziert]` |
| Produktionsmodell ist freigegeben. | Beide gespeicherten Evals sind failed. | `[verifiziert]` als falsch/offen |
| Voice-Runtime und n8n laufen produktiv. | Keine Live-Evidenz in dieser Migration. | `[offen]` |
| Browser-Sprachagent erfuellt alle Plattformgates. | Hardcoded Modell und schwaechere Consent-/Eligibility-Gates. | `[verifiziert]` als falsch |

## Sicherheits-Scorecard

| Bereich | Score 1-5 | Begruendung |
| --- | ---: | --- |
| Correctness | 3 | Starke Outbound-Gates, aber aelterer Browserpfad weicht ab und kein Live-E2E ist belegt. |
| Reliability | 3 | Recovery und Provider-Uncertainty sind modelliert; Runtime/n8n/Telefonie sind nicht aktuell live verifiziert. |
| Idempotency | 4 | Claims, Events, Outcomes und Side-Effect-Tools sind idempotent; externer Provider-Create bleibt bewusst manuell. |
| Observability | 3 | Strukturierte Events/Audits existieren, aber Browser-Session-Audit kann log-and-continue fehlschlagen und Live-Evidenz fehlt. |
| Security | 3 | RLS, serverseitige Keys, Request-Bindung und Signaturen sind vorhanden; Plattformadmin hat keine feingranulare Ops-Rolle. |
| Tracking impact | 5 | Der gepruefte Scope aendert kein Marketing-/Analytics-Tracking. |
| Cost risk | 3 | Call-Kapazitaet und Kill Switches existieren; Live-Evals, Browser-Realtime und echte Calls bleiben kostenpflichtige, separat freizugebende Aktionen. |

## Fehlende Live-Evidenz

- Aktueller produktiver Commit von Ops und Voice-Runtime.
- Aktive Feature-Flags und Datenbankmigrationen.
- Provider-Readiness sowie OpenAI-/Twilio-/Placetel-Konfiguration.
- Aktive n8n-Workflow-Versionen und letzte fehlerfreie Executions.
- Reale Consent-/DNC-/Allowlist-Datenqualitaet.
- Audio-Latenz, Unterbrechung, Stop, Handoff und Wiederanlauf ueber echte Telefonie.
- Aktuelle juristische/Datenschutzfreigabe.

## Datenschutz der Uebergabe

- `[verifiziert]` Es wurden keine Kundennamen, Telefonnummern, E-Mail-Adressen, Request-IDs, Offer-Tokens oder Secret-Werte in dieses Paket uebernommen.
- `[verifiziert]` Historische Thread-Evidenz wurde nur aggregiert und als nicht erneut live bestaetigt gekennzeichnet.
- `[verifiziert]` Externe Systeme wurden fuer diese Uebergabe nicht aufgerufen.

## Control-Tower-Integration

- `[verifiziert]` Das Manifest deklariert `parent_agent_id=customer-communication-agent` und `schedule_supported=false`.
- `[verifiziert]` Das Parent-Paket ist im verifizierten Basis-Commit nicht vorhanden.
- `[offen]` Vor Import in den Agent Control Tower Parent-ID und Merge-Reihenfolge gegen das kanonische Parent-Manifest pruefen.
