# Design Studio System Map

Stand: 2026-07-21. Alle Aussagen beziehen sich auf Commit `a063f216692e97639da36492d9e025f7615665fe`, sofern nicht anders markiert.

## Systemgrenzen und Source of Truth

| Bereich | Kanonische Quelle | Rolle anderer Systeme | Evidenz |
| --- | --- | --- | --- |
| Design-Jobs, Prompt-Versionen und Assets | Ops-Supabase | UI und Worker lesen beziehungsweise schreiben über serverseitige APIs | `[verifiziert]` |
| Bulk-Ausführung | `design_batches` und `design_batch_items` | Browser stößt Verarbeitung an und zeigt persistierten Stand | `[verifiziert]` |
| Ausgangskarte und Anhänge | Trello | Eingangsquelle und Projektion für neue/archivierte Anhänge | `[verifiziert]` |
| Angebotsinhalt | Offers-System | Design Studio aktualisiert nur über serverseitige Offer-Integration | `[verifiziert]` |
| Quote-Bildvarianten | `quote_image_variants` | Künftige Kunden-UI ist noch nicht angebunden | `[verifiziert]` |
| Bilddateien | Supabase Storage, standardmäßig Bucket `design-assets` | Datenbank hält Metadaten und öffentliche URL | `[verifiziert]` |
| Bildmodell | OpenAI Images API | Direkte Generierung im Ops-Backend; nicht der n8n-Worker | `[verifiziert]` |
| n8n | Nur Planungsartefakt für optionalen Worker | Kein kanonischer Zustand und kein ausführbares Design-Workflow-JSON vorhanden | `[verifiziert]` |

Trello darf nicht als Zustandsspeicher für Idempotenz, Batch-Fortschritt, Offer-Zuordnung oder Varianten verwendet werden.

## Einstiegspunkte

- UI-Route: `src/app/ops/design/page.tsx`
- Client-Oberfläche: `src/app/ops/design/page-client.tsx`
- Domänenlogik: `src/lib/ops/design.ts`
- Persistente Batch-Engine: `src/lib/ops/design-batches.ts`
- Aktionsvertrag: `src/lib/ops/design-contract.ts`
- Quellbildregeln: `src/lib/ops/design-source.ts`
- API-Verzeichnis: `src/app/api/ops/design/`
- Offer-Send-Guard: `src/app/api/ops/customer-records/offers/[offerId]/send/route.ts`
- Bestehendes Betriebsdokument: `docs/operations/design-ops.md`
- Worker-Plan: `workflows/plans/design-generation-worker-v0.1.md`

## Nutzerfluss

1. `[verifiziert]` Ein Mitarbeiter lädt eine Trello-Karte oder einen Suchbegriff über `GET /api/ops/design`.
2. `[verifiziert]` Das Backend liest Karte, Anhänge und zuordenbaren Offer-/Customer-Kontext und liefert die auswählbaren Assets.
3. `[verifiziert]` Der Mitarbeiter wählt ein Referenzbild, eine Mockup-Vorgabe oder eine strukturierte Aktion und speichert daraus einen Job samt Prompt-Version.
4. `[verifiziert]` Die direkte Generierung lädt genau ein Referenz-JPEG, validiert MIME und Magic Bytes, ruft die OpenAI-Edit-API auf und speichert ein echtes JPEG in Supabase Storage.
5. `[verifiziert]` Optional wird das erzeugte Asset idempotent an Trello angehängt oder ersetzt dort das Ausgangs-Mockup bei gleichzeitiger Archivierung des Originals.
6. `[verifiziert]` Optional wird das Asset mit einem bestehenden Offer-Bildslot verknüpft und die betroffene Angebotsposition aktualisiert.
7. `[verifiziert]` Bulk-Farb- und Produktänderungen laufen als persistente Batches mit einem isolierten Item pro Referenzbild.

## Quellbildregeln

| Aktion | Dateiname | Dateityp | Anzahl Referenzen | Bemerkung |
| --- | --- | --- | --- | --- |
| Normale Einzelgenerierung | enthält `Mockup`, nicht `alte_` oder `Vorschaubilder` | `.jpg` oder `.jpeg`, technisch echtes JPEG | genau 1 | Originale wie `Mockup01.jpg` und `Mockup04.jpeg` sind zulässig |
| Leuchtfarbe ändern | enthält `Mockup` und `AI` | `.jpg` oder `.jpeg`, echtes JPEG | genau 1 je Job | Bulk erzeugt mehrere getrennte Jobs |
| Produktart ändern | enthält `Mockup` und `AI` | `.jpg` oder `.jpeg`, echtes JPEG | genau 1 je Job | Ziele aktuell nur `3D Frontlit` und `3D Backlit` |
| Kunden-Quote-Variante | enthält `Mockup` und `AI` | `.jpg` oder `.jpeg`, echtes JPEG | genau 1 | Quelle wird serverseitig aus dem Offer aufgelöst |

`[verifiziert]` Der spätere Fix `214541f` lockerte nur die normale Generierung auf originale Mockup-JPEGs. Er lockerte nicht die strengeren Regeln für strukturierte Varianten.

## Promptfluss

- `[verifiziert]` `buildPromptPreview` erzeugt für Design-Studio-Edits einen Prompt mit der Quelle `design_studio_edit_prompt`.
- `[verifiziert]` Der Prompt kombiniert Karten-/Request-Metadaten, Aktionsparameter und strikte Erhaltungsregeln für Text, Logo, Form, Größe, Perspektive, Szene und Bildausschnitt.
- `[verifiziert]` Farbänderungen sollen ausschließlich die Leuchtfarbe ändern; Produktänderungen sollen ausschließlich die Schildtechnik ändern.
- `[verifiziert]` Trello-Markierungen `#startprompt/#endprompt` und Video-Markierungen können geparst werden, werden aber für den aktiven Design-Studio-Bildprompt nicht genutzt.
- `[verifiziert]` Der UI-Hinweis benennt ausdrücklich, dass dies nicht der echte n8n-Quote-Ready-Produktionsprompt ist.
- `[verifiziert]` `videoPrompt` ist im aktiven Prompt-Preview `null`. Es existiert kein Video-Generierungsendpunkt.
- `[aus Git/Code abgeleitet]` Promptregeln reduzieren Halluzinationen, garantieren aber keine visuelle Identität. Es gibt keine automatische Similarity- oder Logo-/Text-QA.

## Unterstützte Aktionen

### Leuchtfarben

`Kaltweiß`, `Warmweiß`, `Grün`, `Blau`, `Eisblau`, `Rot`, `Orange`, `Zitronengelb`, `Goldgelb`, `Pink`, `Lila`, `Türkis`.

### Produktänderungen

- `3D Frontlit`
- `3D Backlit`

### Mockup-Modi

- `Original`
- `Wand`
- `Tischgerät`
- `Tresen`
- `Schaufenster`
- `Outdoor`

`[verifiziert]` Die Modi sind Prompt-Vorgaben für eine Einzelgenerierung. Eine allgemeine Bulk-Generierung aus mehreren originalen Mockups ist nicht implementiert.

## API-Fläche

Alle Routen außer den beiden Worker-Routen laufen durch den Ops-Portal-Guard. Dieser verlangt auf normalen konfigurierten Hosts eine gültige Ops-Session; ein ausdrücklich als Bypass konfigurierter Host überspringt die Session-Prüfung. Die Worker-Routen sind separat per Bearer-Key geschützt.

| Methode und Route | Zweck |
| --- | --- |
| `GET /api/ops/design?query=...` | Designfall aus Trello/Offer-Kontext laden |
| `GET /api/ops/design/jobs` | Jobs lesen |
| `POST /api/ops/design/jobs` | Job und Prompt-Version anlegen |
| `POST /api/ops/design/jobs/:jobId/queue` | Job für externen Worker vormerken |
| `POST /api/ops/design/jobs/:jobId/generate` | Bild direkt serverseitig generieren |
| `POST /api/ops/design/jobs/:jobId/trello` | Erzeugtes Asset idempotent an Trello projizieren |
| `POST /api/ops/design/batches` | Farb-/Produkt-Batch mit bis zu 50 Items anlegen |
| `GET /api/ops/design/batches/:batchId` | Persistierten Batch-Stand lesen |
| `DELETE /api/ops/design/batches/:batchId` | Batch abbrechen |
| `POST /api/ops/design/batches/:batchId/process` | Nächstes Batch-Item beanspruchen und verarbeiten |
| `POST /api/ops/design/removal-plans` | Backup für geplante Trello-Löschung vorbereiten |
| `POST /api/ops/design/removal-plans/:planId/apply` | Vorbereitete Löschung nach Bestätigung anwenden |
| `GET /api/ops/design/offers/:offerId` | Offer-Kontext für Design-Verknüpfung laden |
| `POST /api/ops/design/offer-links` | Asset mit Offer-Bildslot und Position verknüpfen |
| `POST /api/ops/design/quote-image-variants` | Serverseitige Quote-Variante laden oder erzeugen |
| `GET/POST /api/ops/design/worker/jobs` | Bearer-geschützte Worker-Job-Schnittstelle |
| `POST /api/ops/design/worker/callback` | Bearer-geschützter Worker-Callback |

## Persistenz

### Basis

- `design_jobs`: Jobstatus, Trello-/Offer-Kontext, Fehler und Ausführung.
- `design_prompt_versions`: unveränderliche Prompt-Snapshots pro Job.
- `design_assets`: Referenz-, Generierungs- und Storage-Metadaten.
- `design_trello_removal_backups`: vorbereitete Entfernung und Sicherungsinformationen.
- `design_offer_asset_links`: Zuordnung zu Offer, Bildslot, Item und Preisprüfstatus.

### Batch-Härtung

- `design_batches`: Aktion, Zielwert, Trello-Karte, Replace-Modus und aggregierter Status.
- `design_batch_items`: genau eine Quelle, ein Job und ein Ergebnis pro Item.
- RPC `claim_next_design_batch_item`: konkurrierendes Claiming mit `FOR UPDATE SKIP LOCKED`.
- RPC `refresh_design_batch_status`: aggregiert Item-Zustände auf Batch-Ebene.

### Kundenvarianten

- `quote_image_variants`: stabile Cache-Identität aus Quote, Bildslot, Item, Variantentyp, Zielwert und Quellfingerprint.
- `[verifiziert]` Die Tabellen sind durch RLS serverseitig begrenzt; es bestehen keine Policies für `anon` oder `authenticated`.
- `[offen]` Ob alle Migrationen in der aktuellen Produktionsdatenbank angewandt sind, wurde nicht live geprüft.

## Batch-Lebenszyklus

1. `[verifiziert]` Der Server validiert gleiche Trello-Karte, eindeutige Quellen, Aktionsvertrag und maximal 50 Items.
2. `[verifiziert]` Jedes Item erhält einen stabilen Idempotenzschlüssel.
3. `[verifiziert]` Ein Processor claimed atomar ein offenes oder veraltetes Item.
4. `[verifiziert]` Pro Item entstehen eigener Job, eigener Prompt und eigenes Asset.
5. `[verifiziert]` Fehlgeschlagene Items werden bis zu dreimal versucht; Claims älter als fünf Minuten können erneut übernommen werden.
6. `[verifiziert]` Der Browser hält die Batch-ID in `localStorage`, zeigt Fortschritt und kann einen offenen Batch wieder aufnehmen.
7. `[verifiziert]` Ohne Replace-Modus wird kein Trello-Anhang verändert.

## Benennung und Trello-Ersetzung

- `[verifiziert]` Originalquelle `Mockup01.jpg` wird bei normaler Generierung zu `Mockup01_AI_1.jpg`.
- `[verifiziert]` Eine Farbänderung verwendet einen Präfix wie `Orange_Mockup4600_AI_1.jpg`.
- `[verifiziert]` Eine Produktänderung verwendet einen Präfix wie `3D_Frontlit_Mockup4600_AI_1.jpg`.
- `[verifiziert]` Bereits vorhandene Aktionspräfixe werden entfernt, damit Namen bei Wiederholung nicht anwachsen.
- `[verifiziert]` Beim Ersetzen wird das alte Mockup in einen Namen mit `alte_Vorschaubilder` überführt. Dadurch wird es von der normalen Mockup-Erkennung ausgeschlossen.
- `[verifiziert]` Ein wiederholter Upload-Versuch sucht einen schon vorhandenen Trello-Anhang anhand von Name und URL und persistiert dessen ID.

## Removal-Flow

- `[verifiziert]` Löschung ist zweistufig: Backup vorbereiten, danach mit exakt `ENTFERNEN` anwenden.
- `[verifiziert]` Das Backup speichert die bekannten Attachment-Metadaten und URLs vor dem Löschen.
- `[verifiziert]` Ein teilweiser Fehler setzt den Plan auf `failed`; ein erneutes Anwenden akzeptiert nur `prepared`.
- `[verifiziert]` Es gibt keinen automatischen Codepfad, der den Status `rolled_back` setzt oder gelöschte Anhänge wieder hochlädt.

## Offer-Integration

- `[verifiziert]` Der Server lädt den aktuellen Offer-Stand und blockiert harte Locks sowie unpassende Trello-Karten.
- `[verifiziert]` Das Asset muss ein gespeichertes JPEG sein.
- `[verifiziert]` Dry-Run ist möglich.
- `[verifiziert]` Source-Bildslot und Angebotsposition werden gegen die Referenzzuordnung geprüft, sofern diese vorhanden ist.
- `[verifiziert]` Farbänderungen aktualisieren die Farbangabe der betroffenen Position.
- `[verifiziert]` Produktänderungen aktualisieren Titel und Beschreibung; die UI verlangt einen geprüften Nettopreis und eine Bestätigung.
- `[verifiziert]` Das Bild im bestehenden Offer-Slot wird auf das erzeugte Asset gesetzt und der CRM-Quote-Image-Kontext ergänzt.
- `[verifiziert]` Jeder Link wird in `design_offer_asset_links` protokolliert. Ein Eintrag mit `needs_price_review` blockiert den Offer-Versand serverseitig.
- `[aus Git/Code abgeleitet]` Der API-Pfad sollte zusätzlich verhaltensgetestet werden, da die UI-Preisprüfung allein kein vollständiger Schutz gegen direkt konstruierte Requests ist.

## Quote-Varianten und künftige Kundenoberfläche

- `[verifiziert]` Der Backend-Cache normalisiert Variantentyp und Zielwert und vermeidet erneute Generierung derselben Variante für denselben Quellfingerprint.
- `[verifiziert]` Die Quell-URL kann nicht frei vom Client vorgegeben werden; sie wird serverseitig aus dem Offer-Bildslot ermittelt.
- `[verifiziert]` Statuswerte bilden unter anderem `pending`, `generating`, `ready` und `failed` ab.
- `[verifiziert]` Es gibt nur eine durch den Ops-Portal-Guard geschützte Route. In den öffentlichen Quote-Routen `/quote` und `/v` besteht keine Anbindung.
- `[offen]` Dropdown, Fortschrittsanzeige, 12-Farben-Auswahl, Cache-Umschaltung und öffentliche Token-/Rate-Limit-Regeln müssen vor Kundennutzung entworfen und implementiert werden.

## n8n und Worker

- `[verifiziert]` `workflows/plans/design-generation-worker-v0.1.md` beschreibt nur einen inaktiven Plan.
- `[verifiziert]` Es gibt kein ausführbares Design-Worker-Workflow-JSON im Repository.
- `[verifiziert]` Worker-Routen verwenden den Variablennamen `DESIGN_WORKER_API_KEY`; kein Wert wurde geprüft oder dokumentiert.
- `[offen]` Ob extern ein n8n-Workflow mit dem sogenannten Quote-Ready-Prompt existiert oder aktiv ist, wurde nicht live geprüft.
- `[verifiziert]` Die direkte In-App-Generierung ist davon unabhängig und nutzt die OpenAI Images API serverseitig.
