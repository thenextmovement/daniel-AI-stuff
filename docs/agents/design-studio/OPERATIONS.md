# Design Studio Operations

Stand: 2026-07-21. Dieses Runbook beschreibt sichere Diagnose und freigabepflichtige Abläufe. Es autorisiert keine Produktionsaktion.

## Arbeitsbeginn

```bash
codex-new-worktree ops <topic>
cd <ausgegebener-worktree>
git status --short --branch
git fetch origin
git merge-base --is-ancestor origin/main HEAD
```

- Nicht im alten Checkout `/Users/danielklesse/Desktop/neontrip-ops-coolify` arbeiten.
- Vor Änderungen zuerst aktuellen Code, Migrationen, Tests und `git status` lesen.
- Fremde Änderungen nicht zurücksetzen oder mitcommitten.
- Keine Secret-Werte aus `.env`, Coolify, n8n oder Supabase auslesen.

## Relevante Variablennamen

Nur Namen, niemals Werte, dürfen in Diagnoseausgaben oder Dokumentation erscheinen:

- `NEXT_PUBLIC_SUPABASE_URL` oder `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DESIGN_ASSET_BUCKET`
- `DESIGN_SOURCE_IMAGE_HOSTS`
- `NEONTRIP_OFFERS_BASE_URL`
- `OPS_OPENAI_API_KEY` oder `OPENAI_API_KEY`
- `OPS_OPENAI_IMAGE_MODEL`
- `OPS_OPENAI_IMAGE_EDIT_MODEL`
- `DESIGN_WORKER_API_KEY`

## Kostenfreie lokale Verifikation

```bash
npm ci
node --import tsx --test \
  tests/quotes/design-ops.test.ts \
  tests/quotes/mockup-context.test.ts \
  tests/quotes/mockups.test.ts
```

Zusätzlich:

```bash
git diff --check
node -e "JSON.parse(require('fs').readFileSync('docs/agents/design-studio/agent.json','utf8'))"
```

Ein vollständiger Build ist erforderlich, wenn Abhängigkeiten, TypeScript, Next-Konfiguration oder ausführbarer Code geändert wurden und keine frische CI-Evidenz für den exakten Stand vorliegt. Für eine reine Dokumentänderung genügt die belegte aktuelle CI plus fokussierte Tests.

## Read-only-Diagnose

### Ausgangsbild ist nicht auswählbar

1. Dateiname auf `Mockup` prüfen.
2. Endung auf `.jpg` oder `.jpeg` prüfen.
3. Archivpräfixe `alte_` und `Vorschaubilder` ausschließen.
4. Für Farb-, Produkt- und Quote-Varianten zusätzlich `AI` im Namen verlangen.
5. Prüfen, ob das Backend beim Download tatsächlich `image/jpeg` und JPEG-Magic-Bytes erhält.
6. Prüfen, ob UI und API denselben aktuellen Commit ausliefern. Die Freischaltung originaler Mockup-Quellen stammt aus `214541f`.

### Bulk dreht dauerhaft oder liefert nur ein Bild

1. Batch-ID aus der UI beziehungsweise dem gespeicherten Client-Zustand ermitteln, ohne Daten zu verändern.
2. `GET /api/ops/design/batches/:batchId` in einer freigegebenen, authentifizierten Diagnose verwenden.
3. Prüfen, ob für jede Quelle ein eigenes `design_batch_items`-Element existiert.
4. Zustände, `attempt_count`, `claimed_at`, `job_id`, `generated_asset_id` und Fehler pro Item vergleichen.
5. Sicherstellen, dass alle Quellen zur selben Trello-Karte gehören und als AI-JPEG zulässig sind.
6. Prüfen, ob Claims älter als fünf Minuten erneut übernommen werden und die Retry-Grenze drei nicht überschritten ist.
7. Keinen zweiten manuellen Batch starten, bevor Idempotenzschlüssel und bestehender Zustand verstanden sind.

### Falsches oder wiederholtes Ausgangsbild

1. `source_attachment_id`, `source_asset_id` und `referenceAssetIds` pro Job prüfen.
2. Sicherstellen, dass genau eine Referenz gespeichert wurde.
3. Batch-Items auf versehentlich wiederverwendete Source-IDs prüfen.
4. Prompt-Version und Aktion pro Item vergleichen.
5. Erst danach einen kontrollierten, ausdrücklich freigegebenen Ein-Bild-Test erwägen.

### Trello-Upload hat falschen Namen

1. Aktionsvertrag und Zielwert prüfen.
2. Namen der Quelle und erzeugten Datei vergleichen.
3. Prüfen, ob ein vorhandener Farb-/Produktpräfix vor dem neuen Präfix entfernt wurde.
4. Bei normaler Generierung das `_AI_<n>`-Schema, bei strukturierter Änderung den Aktionspräfix erwarten.
5. Nicht nach Kartentitel umbenennen.

### Prompt scheint falsch

1. Gespeicherte `design_prompt_versions`-Version des Jobs lesen.
2. `source` muss für aktuelle Edits `design_studio_edit_prompt` sein.
3. Trello-`#startprompt/#endprompt`-Blöcke sind nur Diagnosekontext und werden nicht als aktiver Edit-Prompt verwendet.
4. Ein angeblicher n8n-Quote-Ready-Prompt ist ohne externen n8n-Read-only-Beleg nicht bestätigt.

### Offer kann nicht versendet werden

1. `design_offer_asset_links` für das Offer auf `needs_price_review` prüfen.
2. Asset, Offer-Bildslot, Item und Trello-Karte abgleichen.
3. Bei Produktänderung den Nettopreis fachlich prüfen und über den vorgesehenen bestätigten Ablauf setzen.
4. Send-Guard nicht umgehen und keine Kundenmail als Diagnose versenden.

## Freigabepflichtige Mutation

Vor jeder externen Mutation müssen Ticket/Freigabe, betroffene IDs, Backup, erwarteter Diff, Idempotenzschlüssel und Rollback dokumentiert sein.

### Kontrollierte Bildgenerierung

- Kostenwirkung und maximale Bildanzahl vorab nennen.
- Mit genau einem nicht-kundensensitiven oder ausdrücklich freigegebenen Testbild beginnen.
- Quelle, Prompt-Version, Modellname und Ergebnis-ID dokumentieren, aber keine Secret-Werte.
- Ergebnis visuell auf Logo, Text, Perspektive, Szene und ausschließlich gewünschte Änderung prüfen.
- Erst nach dieser Prüfung Bulk freigeben.

### Trello-Ersetzung

- Bestehende Attachment-ID, Dateiname und URL sichern.
- Replace-Modus und erwartete neue/archivierte Namen als Dry-Run prüfen.
- Sicherstellen, dass das generierte Asset gespeichert und technisch ein JPEG ist.
- Nach Mutation Karte neu lesen und exakt ein aktives sowie ein archiviertes Ergebnis je Quelle bestätigen.
- Bei Teilfehler keine weiteren Deletes auslösen; zuerst manuellen Recovery-Plan erstellen.

### Offer-Aktualisierung

- Offer, Trello-Karte, Bildslot und Item vorab abgleichen.
- Zuerst Dry-Run ausführen.
- Bei Produktänderung neuen Nettopreis fachlich prüfen und bestätigen.
- Nach Update Angebot intern prüfen.
- Versand ist eine separate, ausdrücklich freizugebende Kundenaktion.

## Rollback

### Code

- Änderungen in einem dedizierten Worktree als eigenen Commit halten.
- Bei Regression einen neuen Revert-Commit erstellen; keinen produktiven Branch hart zurücksetzen.

### Datenbankschema

Rollback-Dateien existieren für alle drei Design-Migrationen. Wegen Fremdschlüsseln ist bei vollständigem Rückbau diese Reihenfolge zu prüfen:

1. `supabase/rollbacks/20260708103749_create_quote_image_variants_rollback.sql`
2. `supabase/rollbacks/20260715211543_harden_design_engine_batches_rollback.sql`
3. `supabase/rollbacks/20260706102534_create_design_ops_tables_rollback.sql`

Vor Anwendung: vollständiges Datenbankbackup, Migration-Diff, Abhängigkeitsprüfung und ausdrückliche Freigabe. Diese Übergabe hat keinen Rollback ausgeführt.

### Trello

- Automatischer Restore ist nicht implementiert.
- Bei Teilfehler Attachment-Metadaten aus `design_trello_removal_backups` sichern und Erreichbarkeit der URLs prüfen.
- Wiederherstellung nur nach manuellem Plan und Freigabe; danach Zustand in DB und Trello abgleichen.

### Offer

- Vorherigen Offer-Snapshot und Bildslot-Zuordnung sichern.
- Offer-Inhalt und Bildslot über den autorisierten Offers-Pfad zurücksetzen.
- `design_offer_asset_links` nicht ohne Auditspur löschen; Status und Recovery-Bezug dokumentieren.

## Deploy-Gate

Nur nach ausdrücklicher Deploy-Freigabe:

```bash
codex-predeploy ops
```

- Worktree muss sauber und auf aktuellem `origin/main` basieren.
- Nur den exakt vom Preflight ausgegebenen Commit deployen.
- Push auf `main` erfolgt ausschließlich über den vorgesehenen sicheren Workflow.
- Nach Deploy authentifizierte, nicht destruktive Smoke-Checks durchführen.
- Für kostenpflichtige Generierung, Trello-Mutation oder Kundenmail ist eine zusätzliche ausdrückliche Freigabe nötig.

Für die Erstellung dieses Übergabepakets wurden weder `codex-predeploy ops` noch Push oder Deploy ausgeführt.
