# Sales-Vergabe Verification

## Verifikationsbasis

- `[verifiziert]` Ops-Repository: `https://github.com/thenextmovement/daniel-AI-stuff.git`.
- `[verifiziert]` Branch-Basis: `origin/main` auf `d3e14db4e1da447cf18ec0d328c63827f81bd9f1` (`fix(ops): start scheduler through symlink runtime`).
- `[verifiziert]` Der dedizierte Handoff-Worktree wurde vor Abschluss auf das weitergelaufene `origin/main` rebased; lokales HEAD und `origin/main` waren vor den Dokumentänderungen identisch.
- `[verifiziert]` Der zugehörige Deploy-Workflow-Run `29849034207` endete erfolgreich. Dies ist kein fachlicher Live-Test der Sales-Vergabe.
- `[verifiziert]` Verifiziert am 2026-07-21 in Europe/Berlin.
- `[verifiziert]` Während der Prüfung wurden keine Produktion, n8n-Workflows, Supabase-Daten, Shopify-Orders/Tags, Trello-Karten, Coolify-Variablen oder E-Mails verändert.

## Lokale Ergebnisse

| Prüfung | Ergebnis | Status |
| --- | --- | --- |
| `node --import tsx --test tests/quotes/supplier-sales.test.ts` | 57/57 bestanden | `[verifiziert]` unabhängig im delegierenden Thread bestätigt |
| `node --import tsx --test tests/quotes/supplier-sales.test.ts tests/quotes/acceptance.test.ts` | 63/63 bestanden | `[verifiziert]` im Handoff-Worktree ausgeführt |
| `npm run test:quotes` | 645/645 bestanden | `[verifiziert]` im Handoff-Worktree ausgeführt |
| `npx tsc --noEmit` | Exit 0 | `[verifiziert]` im Handoff-Worktree ausgeführt |
| `npm run build` | Next.js 15.5.18, Compile/Typecheck/static generation erfolgreich | `[verifiziert]` im Handoff-Worktree ausgeführt |
| `npm run smoke:sales-vergabe-ui` gegen lokalen `next start` | fehlgeschlagen: Timeout auf `#QA-sale-unpaid` nach schneller kombinierter Filtersequenz | `[verifiziert]` echter negativer Befund |

- `[verifiziert]` Warn- und Fehlerlogs in den grünen Node-Tests gehören zu expliziten Failure-Path-Tests; der Testprozess endete mit null Fehlern.
- `[verifiziert]` `npm ci` installierte 390 Pakete und meldete drei bekannte Audit-Befunde (ein low, zwei high). Es wurde kein automatisches Audit-Fix ausgeführt.
- `[aus Git/Code abgeleitet]` Der UI-Smoke-Timeout ist mit konkurrierenden, nicht einzeln abgewarteten Filter-Fetches im Skript vereinbar. Er wurde nicht als Produktcode-Fix kaschiert und bleibt als offener QA-Punkt bestehen.

## Geprüfte Repository-Pfade

- `[verifiziert]` UI/API/Domain: `src/app/ops/sales-vergabe/page.tsx`, `src/app/ops/sales-vergabe/page-client.tsx`, `src/app/api/ops/supplier-sales/route.ts`, `src/lib/ops/supplier-sales.ts`.
- `[verifiziert]` Offer-Pfad: `src/lib/quotes/accept-quote.ts`, `src/lib/quotes/ops-sales-sync.ts`.
- `[verifiziert]` Datenbank: `supabase/migrations/20260609102438_create_supplier_sales_ops.sql`, `supabase/rollbacks/20260609102438_create_supplier_sales_ops_rollback.sql`.
- `[verifiziert]` Tests: `tests/quotes/supplier-sales.test.ts`, `tests/quotes/acceptance.test.ts`, `scripts/smoke_sales_vergabe_ui.mjs`.
- `[verifiziert]` Workflows: alle vier in [SYSTEM-MAP.md](./SYSTEM-MAP.md) aufgeführten JSON-Drafts.
- `[verifiziert]` Betriebsdoku: `docs/operations/supplier-sales-integrations.md`, `docs/operations/supplier-order-confirmation-email.md`.

## Externe Offers-Gegenprüfung

- `[verifiziert]` Offers `origin/main` wurde read-only auf Commit `6d9716bb62c1fa8d6d0a7ab0d11b76e8fa3b8a87` geprüft; der alte lokale Offers-Checkout wurde nicht verändert.
- `[verifiziert]` Offers-Route: `app/api/internal/offers/completed-sales/route.ts`; Implementierung: `lib/internal-offers.ts`; Payload-Erzeugung: `lib/shopify-sale-sync.ts`.
- `[verifiziert]` Der Feed schließt angenommene Dokumente mit Status `ACCEPTED`, `COMPLETED` oder `DOWNLOADED` ein und sortiert nach Annahme-/Update-Zeit.
- `[verifiziert]` Ein unauthentifizierter GET auf den produktiven Completed-Sales-Endpunkt antwortete mit 401. Damit sind Erreichbarkeit und Schutz, nicht die Feed-Daten, belegt.

## Read-only Live- und Git-Prüfungen

- `[verifiziert]` Die produktive Ops-Seite/API leitete unauthentifizierte Anfragen zu Cloudflare Access um. Es wurden keine Redirect-Token oder PII dokumentiert.
- `[verifiziert]` Git-Historie und GitHub-Actions-Läufe der in [DECISIONS.md](./DECISIONS.md) aufgeführten Commits wurden read-only geprüft.
- `[offen]` Keine authentifizierte Live-Board-Abfrage, keine Supabase-Row-Prüfung und keine n8n-Execution wurden durchgeführt.
- `[offen]` Damit sind Vollständigkeit der heutigen Sales, aktuelle Tag-Rückkopplung und reale Payment-Link-Abdeckung nicht live bestätigt.

## Assertionsmatrix

| Aussage | Befund | Status |
| --- | --- | --- |
| Neueste aktive Sales werden nach Prioritätsgruppe und dann Aktualität sortiert. | Implementierung plus Unit-Test vorhanden. | `[verifiziert]` |
| Aktuell bezahlt steht vor früher bezahlt. | Implementierung plus Unit-Test vorhanden. | `[verifiziert]` |
| Frühere Zahlung wird über exakte E-Mail, erlaubte Firmendomain oder Namen belegt und verlinkt. | Implementierung plus mehrere Unit-Tests vorhanden. | `[verifiziert]` |
| Ein offenes 24h-Fenster erlaubt Vergabe. | Backend- und UI-Smoke-Assertion vorhanden. | `[verifiziert]` |
| Unquittierte Kundenänderung blockiert Vergabe. | Backend vorhanden; UI-Disabled-Gating fehlt. | `[verifiziert]` mit offenem UI-Fehler |
| Vergabe setzt exakte Default-Tags. | Konstanten/Tests vorhanden. | `[verifiziert]` |
| Externe Supplier-Tags entfernen Rows aus `active`. | Reconcile und Tests vorhanden. | `[verifiziert]` |
| Regelmäßige produktive Tag-Prüfung läuft. | Statischer 5-Minuten-Draft vorhanden; Laufzeit nicht belegt. | `[offen]` |
| Completed Offers erscheinen automatisch. | Direkter Push und Pull/Fallback existieren; produktiver E2E-Beleg fehlt. | `[aus Git/Code abgeleitet]` |
| Bilder sind immer vorhanden. | Fallback-Kette existiert; ohne Quelldaten bleibt leer. | `[verifiziert]` als nicht garantiert |
| Snapshot-Link zeigt ein separates Accepted-Snapshot-PDF. | Aktuell derselbe Generator wie AB; Behauptung falsch. | `[verifiziert]` |
| Zahlungserinnerung sendet automatisch nach fünf Minuten. | Keine solche Automation im Code. | `[verifiziert]` als nicht implementiert |
| AB wird per Outlook versendet. | Ops-Webhook und n8n-Draft vorhanden; produktiver Versand nicht belegt. | `[offen]` |

## Sicherheits-Scorecard

| Bereich | Score 1-5 | Status | Begründung |
| --- | --- | --- | --- |
| Correctness | 3 | `[aus Git/Code abgeleitet]` | Breite Unit-Abdeckung, aber Event-Constraint-, UI-Gating- und Snapshot-Semantikfehler. |
| Reliability | 3 | `[aus Git/Code abgeleitet]` | Direkter Push plus Fallbacks, aber produktive Zeitpläne nicht belegt und Paging begrenzt. |
| Idempotency | 4 | `[verifiziert]` | Vergabe, Reminder und AB haben stabile Reservierungs-/Attempt-Schlüssel; Item-Replacement bleibt nicht atomar. |
| Observability | 3 | `[aus Git/Code abgeleitet]` | Diagnose und Statusfelder existieren, aber Event-Constraint kann Audits verlieren und Live-Sortcheck ist zu schwach. |
| Security | 3 | `[aus Git/Code abgeleitet]` | Sitzungs-/Bearer-/HMAC-Schutz vorhanden, aber Key-Aliase, Service-Role-Fallback und optionaler Timestamp sind breit. |
| Tracking impact | 5 | `[verifiziert]` | Der geprüfte Scope ändert kein Marketing-/Analytics-Tracking. |
| Cost risk | 4 | `[aus Git/Code abgeleitet]` | Limits und manuelle Kundenaktionen begrenzen Kosten; unkontrollierte Poller-/Mail-Aktivierung bleibt genehmigungspflichtig. |

## Grenzen der Verifikation

- `[nur aus Thread erinnert]` Konkrete Coolify-Env-Konfigurationen, grüne Diagnosekarten und Outlook-Credential-Zuordnung wurden berichtet, aber nicht erneut eingeloggt geprüft.
- `[nur aus Thread erinnert]` Ein früherer 401 zwischen n8n und Ops wurde mit Token-/Deploy-Arbeit bearbeitet; ein danach erfolgreicher Workflow-Lauf ist nicht belegt.
- `[offen]` Es gibt keinen nachweisbaren fachlichen Live-Test mit einem sicheren Deal, der gleichzeitig Offer-Annahme, Ops-Upsert, Shopify-Verknüpfung, Tag-Reconcile, Vergabe und genau einen kontrollierten Side Effect abdeckt.
- `[offen]` Vor einem produktiven Release müssen die hohen Punkte aus [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) bewertet und der UI-Smoke stabilisiert werden.
