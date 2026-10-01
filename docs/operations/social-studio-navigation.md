# Native NEONTRIP Social Studio in Ops

## Vertrag

- Ziel: Fotoauswahl, Entwürfe, Plattformtexte, Freigabe, Termine und bestätigte Veröffentlichungen direkt unter `/ops/social-studio` im gemeinsamen Ops-Menü.
- Nachbar: 17 vorhandene Menüpunkte, Ops-Anmeldung, Gemini-/Buffer-Verträge und Drei-Kalendertage-Rhythmus bleiben bestehen. Keine Änderungen für RIESENOBJEKTE.
- Wirkung: Nur eine ausdrücklich bestätigte Freigabe reserviert einen Termin und plant fünf Plattformbeiträge. Unbekannte Provider-Ergebnisse bleiben `manual_review`; keine blinden Wiederholungen.
- Grenzen: eigener Seitenbereich, `/api/ops/social-studio`, `src/lib/ops/social-studio`, geschützte Assets unter `/ops/social-studio/originals` und `/thumbs`, zwei neue NEONTRIP-Tabellen, bestehender Secret-Sync für genau zwei neue Runtime-Schlüssel.

## Aktive Architektur nach Veröffentlichung

Die React-Oberfläche läuft als Bestandteil von Ops. Keine Einbettung, kein externer Dashboard-Aufruf und kein zweiter Login. `resolveOpsRequestActor` prüft die bestehende Ops-Sitzung; bestätigte Cloudflare-Identität wird als Freigebender gespeichert, bei gemeinsamem Portalzugang `ops-session`. Das Menü bleibt sichtbar. Die Login-Seite markiert den neuen Bereich korrekt.

Die Speicherung nutzt den vorhandenen serverseitigen Supabase-REST-Zugang zum Projekt `klibiejfisijpagzkxls`. `neontrip_social_drafts` und `neontrip_social_deliveries` übernehmen das bestehende D1-Modell; ausschließlich `service_role` erhält Tabellenzugriff, RLS ist aktiv. Zeitfelder behalten die bisherigen ISO-Strings für exakte Provider-Vergleiche. Die bestehende `social_post_schedule`-Reservierung und deren Berlin-/DST-Logik bleiben maßgeblich.

Revision und Status werden gemeinsam per bedingtem Update beansprucht, bevor Provider-Aktionen beginnen. Schreiben werden nicht automatisch wiederholt. Plattformstatus bleibt getrennt; Zurückziehen und erneute Freigabe verwenden bestätigte bestehende Buffer-IDs. Die Listenabfrage teilt Plattformzeilen in Gruppen bis 250 auf, damit das PostgREST-Zeilenlimit keine Plattformen abschneidet.

Die serverseitigen Runtime-Schlüssel `STUDIO_GATEWAY_URL` und `STUDIO_GATEWAY_KEY` verbinden Ops mit dem bestehenden Workflow `i3LxcumS6UeW2pPh`. Der neue interne Header-Zugang ersetzt ausschließlich die Credential-Referenz des Gateway-Webhooks. Gemini, Buffer, Knoten, Verbindungen und Scheduler bleiben unverändert. Die bisherige Credential bleibt für Rollback erhalten. Keine Schlüssel in Client, URL oder Repo.

## Übernahme und Reihenfolge

1. Native Ops-Implementierung, gebaute Ablöseseite und vollständigen Export der vier vorhandenen Entwürfe prüfen. Export enthält ID, vollständige sechs Texte, Revision und Zeitfelder. Keine abgeschnittenen D1-Connector-Zellen übernehmen.
2. Ops-Kandidat nach Repo-Gate freigeben. Runtime-Konfiguration über `coolify-secret-sync.yml`, Modus `sync_ops_social_studio_credentials`, vorbereiten; feste Ops-UUID/Domain, unveränderte fremde Envs und exakter Readback werden geprüft, ohne Restart.
3. Bisherige Site durch vorbereitete Ablöseseite ersetzen. Ihr alter POST-Endpunkt antwortet 410; auch bereits offene alte Browseroberflächen können keine Freigaben schreiben. D1-Daten und Zugriffsliste bleiben erhalten.
4. D1-Metadaten und vollständige Entwürfe unmittelbar vor Import erneut abgleichen. Bei Abweichung stoppen und frisch exportieren. Neue Schema-Migration und vier Entwürfe in Ops übernehmen; sämtliche Felder und Hashes vergleichen. Keine Beiträge oder Termine erzeugen.
5. Gateway-Version erneut prüfen, exakt eine Credential-Referenz ändern und kompletten Diff vor Veröffentlichung vergleichen. Mit einer reinen `verify`-/`preview`-Abfrage Verbindung prüfen; keine Veröffentlichung testen.
6. Exakten genehmigten Ops-Commit über `codex-predeploy ops` und `codex-safe-push-main` veröffentlichen. Live Health-SHA, geschützte Route/Assets, authentifizierte Entwürfe und Terminanzeige prüfen.

Die zwei leeren Tabellen wurden am 01.10.2026 bereits angelegt und verifiziert: RLS aktiv, kein anon/authenticated-Schreibzugriff, service_role zugelassen. Der Datenimport folgt erst nach Sperrung des alten Schreibwegs.

Schritt 3–6 sind ein geordneter Umstieg: kein Parallelbetrieb zweier beschreibbarer Draft-Datenbanken. Während des Umstiegs ist Social Studio kurzzeitig gesperrt. Andere Ops-Bereiche bleiben unberührt.

## Prüfung, 01.10.2026

Lokal mit begrenztem Datenbank-/Provider-Doppel, ohne reale Posts: Fotoauswahl führt innerhalb von Ops zum vorhandenen Entwurf; Speichern bestätigt persistierte Revision; Pinterest-Titel und 1000×1500-Vorschau; Termin vor Freigabe; Freigabe bis zum Bestätigungs-Häkchen gesperrt. Gemeinsames Menü aktiv, Bilder geladen, Desktop und 390-Pixel-Ansicht ohne Seiten-Overflow. CSS vollständig auf `.ops-social-studio` begrenzt; bestehende Ops-Seiten erhalten keine globalen Stiländerungen.

Fokussierte API-Tests: fremder Ursprung, veraltete Revision, ausdrückliche Freigabe, gleichzeitige Freigaben, geänderter Slot, unbekanntes Buffer-Ergebnis, Rücknahme und erneute Freigabe mit denselben IDs. Alle 1.292 Tests der vollen Quote-Suite, TypeScript, Produktions-Build und acht Deployment-Gate-Tests bestanden. Drei zusätzliche Konfigurationstests bestätigen exakt zwei Runtime-Schlüssel, unveränderte andere Envs und fehlenden Restart. Alle CSS-Selektoren sind lokal begrenzt.

Fotos: 201 Originale und 201 Thumbnails aus der bestehenden Sammlung, Kopien per SHA-256 geprüft. Vier bestehende Entwürfe wurden vollständig aus den tatsächlichen Textfeldern gelesen und mit D1-Metadaten verknüpft. Diese Vorbereitung ist noch kein bestätigter Produktivumzug; dessen Belege werden nach Veröffentlichung ergänzt.

## Rollback

Kein automatischer Rückbau nach unklaren Posts. Bei neuen Ops-Freigaben zuerst kanonische Tabellen und Provider-IDs abgleichen. Die D1-Daten bleiben bestehen; nur bei nachgewiesen fehlenden neuen Ops-Aktionen darf die alte Site-Version 3 zusammen mit der bisherigen Gateway-Credential wiederhergestellt werden. Neue Ops-Tabellen und Daten dabei erhalten. Ops-Code nur über gezielten, exakt freigegebenen Revert mit regulärem Release-Gate zurücknehmen.
