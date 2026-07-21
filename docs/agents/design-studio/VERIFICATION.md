# Design Studio Verification

Verifikationsdatum: 2026-07-21

Repository-Stand: `a063f216692e97639da36492d9e025f7615665fe` (`origin/main` zum Beginn der Dokumenterstellung)

## Verifikationsgrenzen

- Durch diese Übergabearbeit keine Produktionsmutation.
- Durch diese Übergabearbeit kein Deploy und kein Push.
- Keine n8n-Aktivierung oder Workflow-Änderung.
- Keine Trello-, Supabase-, Offers-, Storage- oder E-Mail-Schreibaktion.
- Keine kostenpflichtige OpenAI-Anfrage.
- Keine Secret-Werte gelesen oder ausgegeben.
- Keine personenbezogenen Live-Datensätze in die Dokumentation übernommen.

## Git- und Codebefund

- `[verifiziert]` Der dedizierte Worktree wurde mit `codex-new-worktree ops handoff-design-studio` erstellt.
- `[verifiziert]` Der Arbeitsbranch basiert vor der Dokumentänderung auf `a063f216692e97639da36492d9e025f7615665fe`.
- `[verifiziert]` Der letzte Commit an den zentralen Design-Pfaden ist `214541fed945180da06044bb58ba934b6e33d2f8` (`fix(design): allow original mockup generation sources`).
- `[verifiziert]` Alle in [DECISIONS.md](./DECISIONS.md) genannten Design-Commits sind Vorfahren des Verifikationsstands.
- `[verifiziert]` Der exakte Basiscommit besitzt einen erfolgreichen vollständigen GitHub-Actions-Lauf.

## Automatisierte Checks

```bash
npm ci
node --import tsx --test \
  tests/quotes/design-ops.test.ts \
  tests/quotes/mockup-context.test.ts \
  tests/quotes/mockups.test.ts
git diff --check
```

Ergebnis:

- `[verifiziert]` `npm ci`: erfolgreich, 390 Pakete installiert, Audit meldet 0 Schwachstellen.
- `[verifiziert]` Fokussierte Node-Test-Suite: 32 Tests, 32 bestanden, 0 fehlgeschlagen, 0 übersprungen.
- `[verifiziert]` Die Tests führten keine OpenAI-, Trello-, Supabase-, Offers- oder E-Mail-Side-Effects aus.

Erwarteter Umfang:

- `tests/quotes/design-ops.test.ts`: Design-Modul, Aktionen, Benennung, Quellbildregeln, Batches, Trello-Retry, Removal-Schema und RLS.
- `tests/quotes/mockup-context.test.ts`: vorgelagerte Mockup-/Quote-Kontextbildung.
- `tests/quotes/mockups.test.ts`: grundlegende Mockup-Erkennung.

## Build-Evidenz

- `[verifiziert]` GitHub Actions Run `29856777646` für den exakten Basiscommit `a063f216692e97639da36492d9e025f7615665fe` wurde erfolgreich abgeschlossen.
- `[verifiziert]` Der Workflow `Deploy Ops App to Coolify` enthält Installation, vollständige Quote-Tests, TypeScript-Prüfung, Produktions-Build, Deploy-Trigger und geschützten Smoke.
- `[verifiziert]` Dieser bereits zu `origin/main` gehörende CI-Lauf wurde nur read-only als Evidenz gelesen; das Übergabepaket hat ihn nicht ausgelöst.
- `[verifiziert]` Ein zusätzlicher lokaler Vollbuild wird für dieses reine Dokumentpaket deshalb nicht unnötig wiederholt. Ausführbarer Code wurde nicht verändert.

## Verifizierte Funktionsaussagen

| Aussage | Beleg | Ergebnis |
| --- | --- | --- |
| Originale `Mockup*.jpg/.jpeg` sind für normale Generierung zulässig | `src/lib/ops/design-source.ts`, Design-Test, Commit `214541f` | bestätigt |
| Strukturierte Varianten verlangen AI-JPEG | Source-Regeln, API-/Domänencode, Design-Test | bestätigt |
| Genau eine Referenz pro Job | Job-/Generate-Code und Tests | bestätigt |
| Bulk besitzt getrennte Items und Quellen | Batch-Engine, Migration/RPC und Tests | bestätigt |
| Es gibt zwölf kanonische Farben | Aktionsvertrag und Test | bestätigt |
| Produktziele sind Frontlit/Backlit | Aktionsvertrag und UI | bestätigt |
| Aktiver Prompt ist nicht der Trello-/n8n-Quote-Ready-Prompt | `buildPromptPreview`, UI-Hinweis, Commit `7994780` | bestätigt |
| Video ist nicht implementiert | Prompt-Preview und fehlende API-/Modellpfade | bestätigt |
| Replace-Namen leiten sich aus Quelle und Aktion ab | Benennungslogik und Tests | bestätigt |
| Removal verlangt Backup und `ENTFERNEN` | API-/Domänencode und statischer Test | bestätigt |
| `needs_price_review` blockiert Offer-Send | Offer-Link-Code und Send-Route | bestätigt |
| Quote-Varianten-Cache existiert nur server-/opsseitig | Migration, Route und Suche in öffentlichen Quote-Pfaden | bestätigt |

## Testlücken

- Kein authentifizierter Design-Studio-Browser-Smoke.
- Kein verhaltensbasierter End-to-End-Test für Offer-Link und Offer-Send-Guard.
- Kein kontrollierter Live-Test visueller Bildtreue.
- Kein kostenpflichtiger Mehrbild-Batch-Test.
- Kein Test gegen aktuelle produktive Supabase-Migrationen oder Storage-Policies.
- Kein ausführbarer n8n-Design-Worker im Repository.

## Live-Aussagen aus dem früheren Thread

- `[nur aus Thread erinnert]` Eine eingeloggte Oberfläche habe nach früherem Deploy `Mockup01.jpg` und `Mockup04.jpg` als aktive Vorlage gezeigt.
- `[nur aus Thread erinnert]` Einzelne Farbänderungen hätten zeitweise funktioniert, Bulk dagegen mehrfach nur ein oder das falsche Bild erzeugt.
- `[nur aus Thread erinnert]` Das UI habe bei längeren Vorgängen unzureichendes Fortschrittsfeedback gezeigt.
- Diese Aussagen sind historische Diagnosehinweise, keine aktuelle Produktionsabnahme.

## Reproduzierbarkeit

Ein Folge-Agent soll zuerst `agent.json`, [SYSTEM-MAP.md](./SYSTEM-MAP.md) und [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) lesen. Vor jeder neuen Behauptung zum Live-Zustand muss er den aktuellen Commit, die betroffenen Migrationen und den konkreten authentifizierten Pfad erneut read-only prüfen.
