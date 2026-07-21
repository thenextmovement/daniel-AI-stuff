# Exportversand/Schweiz Verification

## Verifikationsbasis

- `[verifiziert]` Repository: `https://github.com/thenextmovement/daniel-AI-stuff.git`.
- `[verifiziert]` Handoff-Worktree: `/Users/danielklesse/codex-worktrees/neontrip-ops-handoff-export-shipping-20260721-201640`.
- `[verifiziert]` Branch: `codex/handoff-export-shipping-20260721-201640`.
- `[verifiziert]` Nach Fetch und Rebase bestätigte die Abschlussprüfung am 2026-07-21, dass der Parent des Handoff-Commits und `origin/main` beide auf `a063f216692e97639da36492d9e025f7615665fe` stehen.
- `[verifiziert]` Vor Erstellung des Pakets war der Handoff-Worktree sauber.
- `[verifiziert]` Der historische Prototyp-Worktree basiert auf `cc2e19944b8142c68f8e27ec7b857181e3efa409`, ist 48 Commits hinter `origin/main` und enthält alle Exportdateien nur als uncommittierte Änderungen.
- `[verifiziert]` `git ls-tree` auf aktuellem HEAD findet keine Exportversand-UI/API/Domain-/Migration-/Testdateien.
- `[verifiziert]` Während der Wissensmigration wurden keine externen Systeme verändert und keine Secretwerte gelesen.

## Aktuell ausgeführte Prüfungen

| Prüfung | Ergebnis | Status |
| --- | --- | --- |
| Fetch, Rebase und Parent-Abgleich | Handoff-Parent und `origin/main` beide `a063f216692e97639da36492d9e025f7615665fe` | `[verifiziert]` |
| `git rev-list --count cc2e199..origin/main` | `48` | `[verifiziert]` |
| `node --import tsx --test tests/quotes/export-shipping.test.ts` im historischen Worktree | 13/13 bestanden | `[verifiziert]` |
| `jq` auf historischem Monitor-Draft | `active:false`, Nodes vorhanden | `[verifiziert]` |
| `git diff --check` im historischen Worktree | Exit 0 | `[verifiziert]` |
| `npm ci --ignore-scripts` nach Rebase im Handoff-Worktree | 390 Pakete; 0 Audit-Befunde | `[verifiziert]` |
| `node --import tsx --test tests/quotes/arrival-label-browser-worker.test.ts tests/quotes/shipping.test.ts` | 35/35 bestanden | `[verifiziert]` |

Die Warnlogs im aktuellen Shipping-Test stammen aus bewusst simulierten optionalen Trello-/Supabase-Ausfällen; der Testprozess endete mit 35 bestandenen Tests und null Fehlern.

Der erste Versuch der aktuellen fokussierten Tests scheiterte vor Testausführung an fehlendem lokalem `tsx`. Nach Installation exakt aus `package-lock.json` liefen dieselben zwei Dateien grün. Dies war kein Produktfehler.

## Externe Read-only-Evidenz

- `[verifiziert]` Die offizielle DPD-Entwicklerseite war am 2026-07-21 erreichbar und nennt DPD Cloud als Anbindung für myDPD Business: `https://esolutions.dpd.com/entwickler.aspx`.
- `[verifiziert]` Die offizielle DPD-Cloud-Dokumentation war am 2026-07-21 erreichbar: `https://esolutions.dpd.com/dokumente/DPD_Cloud_Service_Webservice_Dokumentation_DE.pdf`.
- `[verifiziert]` Die Dokumentation nennt Sandbox-URLs/-Credentials, `setOrder`, Partner- plus User-Credentials sowie getrennte Live-Credentials/Live-URLs nach Freischaltung.
- `[verifiziert]` Sie beschreibt internationalen Express ausdrücklich „ohne Zoll Angaben“.
- `[offen]` Keine Credentials wurden gelesen und kein SOAP-/REST-Aufruf an Sandbox oder Live ausgeführt.

## Historische Thread-Evidenz

Die folgenden Ergebnisse wurden im ursprünglichen Arbeitschat am 2026-07-17 berichtet, aber in diesem Handoff nicht vollständig erneut ausgeführt:

- `[historisch aus Thread]` vollständige Quote-Suite: 532/532 bestanden;
- `[historisch aus Thread]` `npx tsc --noEmit`: Exit 0;
- `[historisch aus Thread]` Next.js-Produktionsbuild erfolgreich;
- `[historisch aus Thread]` Migration/Rollback und RPC-Idempotenz in temporären PostgreSQL-17-Containern erfolgreich;
- `[historisch aus Thread]` Shopify-GraphQL-Queries/-Mutation gegen damaliges Admin-Schema validiert;
- `[historisch aus Thread]` gemockter UI-Smoke auf Desktop, Tablet und Mobile erfolgreich.

Keines dieser Ergebnisse beweist einen DPD-Sandbox-/Live-Aufruf, eine produktive Migration oder einen realen Shopify-Side-Effect. Ein vollständiger Rebuild wurde für die reine Wissensmigration bewusst nicht wiederholt.

## Assertionsmatrix

| Aussage | Befund | Status |
| --- | --- | --- |
| Exportversand ist in `origin/main`. | keine relevanten Pfade im Git-Tree | `[verifiziert]` als falsch |
| Exportversand wurde deployt/aktiviert. | kein Git-Artefakt und ausdrücklich nie deployt | `[verifiziert]` als nicht belegt/nicht erfolgt |
| Der Prototyp kann Order, Zollfelder, UID, Maße und Werte erfassen. | UI/Domaincode und Tests im alten Worktree | `[historischer Prototyp]` |
| DPD Cloud erzeugt Label/Paketnummer. | offizieller Vertrag plus gemockter Adaptertest | `[aus Code abgeleitet]`; kein realer Call |
| Handelsrechnung wird in myDPD gespeichert. | Prototyp erzeugt lokales PDF | `[verifiziert]` als falsch |
| Wiederholung ist idempotent. | DB-Unique/RPC/Status-CAS und fokussierte statische Tests | `[historischer Prototyp]`; keine Live-DB |
| DPD-Timeout führt nicht zu blindem Retry. | Errorstatus und Test vorhanden | `[historischer Prototyp]` |
| Shopify-Kundenmail ist standardmäßig aus. | Flaglogik im Prototyp; Code nicht in Main | `[historischer Prototyp]` |
| Aktueller EasyDPD-Worker kann Schweiz übernehmen. | CH-Stopper und eng begrenzter Arrival-Vertrag | `[verifiziert]` als falsch |
| Ein produktives Exportlabel wurde geprüft. | keine Live-Evidenz | `[offen]` |

## Safety Findings

### Hoch

1. Die Fähigkeit ist nicht in `main`; der alte Prototyp darf nicht ungeprüft auf einen 48 Commits neueren Stand übertragen werden.
2. Provider- und Shopify-Side-Effect-Verantwortung sind nicht entschieden; DPD Cloud und EasyDPD dürfen nicht doppelt arbeiten.
3. myDPD-interne Handelsrechnung, Zoll-/Steuerabnahme und Retention fehlen.
4. Es gibt keine reale Carrier-/Shopify-E2E-Evidenz.

### Mittel

1. Phase 1 ist auf ein Paket/alle offenen Positionen begrenzt.
2. Paketmaße werden im historischen Cloud-Request nicht übertragen.
3. PDF-, WSDL- und UI-Tests sind überwiegend strukturell/gemockt.
4. Historischer Schema-Rollback verliert DB-Metadaten.

## Safety Scorecard

| Dimension | Score | Begründung |
| --- | ---: | --- |
| correctness | 3 | Anforderungen und Validierung sind breit modelliert; Providervertrag, Rechnung und Live-E2E fehlen. |
| reliability | 3 | Zustandsmaschine ist fail-closed entworfen; kein aktueller Merge, keine Sandbox und keine Produktionsbeobachtung. |
| idempotency | 4 | Jobkey, Snapshotkonflikt, Status-CAS und No-Retry-Grenzen sind vorhanden; nur im Prototyp/Mock belegt. |
| observability | 4 | Jobs, Audits, Dokumenthashes und Monitorentwurf sind vorgesehen; nicht in `main` oder live. |
| security | 4 | Host-Allowlisten, private Ablage, RLS und verifizierter Actor sind entworfen; keine Live-Auth-/Storage-Prüfung. |
| tracking impact | 5 | Kein Marketing-/Analytics-Tracking im Scope; dieses Handoff änderte nichts. |
| cost risk | 4 | Aktuell keine Fähigkeit und keine Kosten; reale Labelerzeugung bleibt eigenes Gate. Vor Live-Canary wäre die Bewertung ohne Tarifprüfung niedriger. |

## Required Fixes vor Implementierung/Live

1. Provider und Handelsrechnungsweg entscheiden.
2. Prototyp selektiv auf aktuellem `origin/main` neu umsetzen oder rebasen und Konflikte mit Arrival/EasyDPD lösen.
3. DPD-Produkt, Tarif, Gewicht/Größe und Schweizer Vertragsfähigkeit bestätigen.
4. Legal-/Zoll-/Retention-Abnahme dokumentieren.
5. Migration/Rollback, RLS, private Storage-Ablage und Restore erneut testen.
6. PDF visuell/fachlich prüfen; WSDL/Sandbox vertragstesten.
7. getrennte Gates für Deploy, echtes Label, Shopify und Kundenmail einhalten.

## QA-Plan

Der verbindliche gestufte Plan steht in [OPERATIONS.md](./OPERATIONS.md). Mindestumfang:

- statische/fokussierte Unit- und Route-Tests;
- aktuelle TypeScript- und Buildprüfung nach Produktcodeänderung;
- disponibler DB-Migrations-/Rollback-/RLS-Test;
- responsive UI- und Dokument-Render-QA;
- DPD-Sandbox-Contract-Test ohne Shopify Write;
- ein explizit freigegebener Produktions-Canary ohne Kundenmail;
- separater Shopify-Canary und erst danach separater Notify-Canary;
- Replay-/Timeout-/unklarer-Ausgang-Tests ohne zweite Mutation.

## Rollback

- Für dieses Paket: nur den Dokumentationscommit revertieren.
- Für spätere Runtime: zuerst alle Write-/Notify-Gates ausschalten; keine unklaren Provideraktionen wiederholen.
- Für spätere Migration: DB-/Storage-Inventar sichern; historischen Tabellen-Drop niemals ohne Restore-Plan ausführen.
- Für spätere Deploys: `codex-predeploy ops` und nur den exakten freigegebenen Commit verwenden.

## Verifikationsgrenzen

- keine Secret-, Coolify-, Supabase-, Shopify-, myDPD-, EasyDPD-, n8n-, Outlook- oder CUPS-Live-Sitzung geöffnet;
- keine Produktionsdaten gelesen;
- kein Netzwerkaufruf mit Provider-/Shopify-Credentials;
- kein Label, Download, Fulfillment, Mail, Druck, Push oder Deploy;
- kein vollständiger Rebuild, weil das Handoff ausschließlich Dokumentation enthält und fokussierte Tests den aktuellen angrenzenden Code sowie den unveränderten Prototyp abdecken.
