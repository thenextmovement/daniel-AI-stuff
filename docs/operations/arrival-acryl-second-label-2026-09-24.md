# Acryl LED-Tischgerät: zusätzlicher Versandauftrag

Status: lokal implementierter und geprüfter Release-Kandidat. Der Nutzer hat ein zusätzliches kostenpflichtiges DPD-Label ausdrücklich bestätigt. Keine produktive Migration, Installation, Veröffentlichung, Bestellung oder Druckausgabe ausgeführt; die genaue Commit-Freigabe für den Live-Release steht aus.

## Vertrag

- Ziel: Bei einem neu geplanten Schildversand mit dem Shopify-Artikel `Acryl LED-Tischgerät` genau ein zusätzliches kostenpflichtiges DPD-Paket pro Bestellung; eigener Trackingcode, gleicher Standard-/Express-Service, Aufdruck `Acryl LED-Tischgerät` statt DHL-Endziffern.
- Nachbar: Sign-SHIPPED-Gate, normaler Sechs-Ziffern-Aufdruck, Ein-Paket-Aufträge, Preisgrenze von 15 EUR je Label, A4-Lieferschein, manuelle Prüffälle und unklare Käufe bleiben geschützt.
- Wirkung: Getrennte persistierte Kauf-, Artefakt- und CUPS-Nachweise; bereits bearbeitete Bestellungen nicht rückwirkend nachbuchen. Das Zusatzpaket darf nur das nachweislich zugehörige Hauptlabel als bekannte History akzeptieren, kein fremdes Label.
- Umfang: bestehende Arrival-Label-Tabellen/Funktionen, Ops-API, Existing-Chrome-Bridge, PDF-Aufdruck, zugehörige Tests und Betriebsdokumentation. Keine neue Queue, kein neuer Dienst, keine n8n-Änderung.

## Umsetzung und Nachweis

1. Bestehende Kauf-/Artefakttabellen um Paketrolle ergänzen; einmalige Zusatzrolle zusätzlich je Shopify-Bestellung absichern. Nur neue Hauptaufträge erzeugen einen Zusatzauftrag.
2. Zusatzauftrag erst nach bestätigtem Hauptdruck und nur an dafür geeignete Bridge-Version ausgeben. Vorhandene Haupt-Sendungsnummer genau abgleichen; jede weitere/unklare Sendung sperrt den Kauf.
3. Zusatztracking, PDF und Druck separat speichern; Aufdruck im geschützten A6-Bereich rendern und prüfen. Nachgelagerter Abschluss wartet auf beide Drucke.
4. Tests für Normalfall, Zusatzpaket, Wiederholung, Preis/History-Schutz, alte Bridge und PDF-Grenzen. Lokale Datenbankmigration und Rollback gesondert prüfen.

Die Selbstprüfung des Plans hat zwei notwendige Grenzen ergänzt: keine Nachbuchung alter Aufträge und keine Ausgabe des Zusatzauftrags an eine alte Bridge.

## Prüfbelege (24.09.2026)

- Die acht betroffenen produktiven SQL-Funktionskörper wurden lesend per MD5 mit der aktuellen Repository-Quelle verglichen: identisch. Kein Ersatz aus einem alten Handoff-Checkout.
- Vollständige Ops/Quotes-Tests: 1282/1282 grün; davon sieben neue ausführbare Tests für Artikelerkennung, Paketbindung, Capability/API, tatsächlich ausgeführten Content-Script-Klickschutz und A6-Aufdruck.
- Typecheck, `npm run build:voice-runtime`, `npm run build` und `git diff --check`: grün.
- Getrennte lokale PostgreSQL-16-Testdatenbank: Migration → Rollback → erneute Migration erfolgreich. `supabase/tests/arrival_acrylic_second_parcel.sql` prüft zwei getrennte simulierte Käufe/Drucke, Express-Vererbung, 15-EUR-Grenze, Reihenfolge, Legacy-Bridge-Sperre, Rollenbindung, Idempotenz je Bestellung, kein Backfill, abgebrochenen Dispatch und verzögerten Outlook-/Trello-Abschluss.
- Bestehende SQL-Nachbarprüfungen `arrival_label_existing_label_stop.sql`, `arrival_label_live_rollout.sql` und `arrival_label_trello_arrival.sql`: grün.
- A6-Sichtprüfung mit synthetischem, ausdrücklich als Test gekennzeichnetem PDF: `Acryl LED-` / `Tischgerät` zweizeilig, vollständig lesbar und außerhalb aller Schutzflächen. Live-Layout ausschließlich lesend aus der aktiven Konfiguration übernommen (`easydpd-a6-2026-07-22-v1`, Aufdruckfläche x=18/y=190/b=130/h=38 pt). Keine echte Kundenadresse, kein Versandlabel oder CUPS-Auftrag für den Test verwendet.

## Release und Rückweg

Erst nach Freigabe des vollständigen sauberen Commit-SHA:

1. Aus genau diesem Aufgabenworktree Predeploy wiederholen; aktuellen Produktionsstand, aktivierte Scheduler/Worker, Bridge-`CURRENT`, vollständige Konfiguration, aktiven Job, DB-Funktionsdefinitionen und CUPS-Zustand sichern. Gibt es einen aktiven oder unklaren Dispatch, nicht installieren oder fortsetzen.
2. Produktionspfad kontrolliert ruhen lassen und Server/Migration/Bridge aufeinander abstimmen. Die Artefakt-Konfliktkennung wechselt von `(case_id, artifact_kind)` auf `(case_id, artifact_kind, parcel_kind)`; die alte API darf daher während der Umstellung keine Artefakte schreiben. Keine alten Jobs zurücksetzen oder nachbuchen.
3. Migration und freigegebenen Server-Commit über die bestehenden Release-Helfer veröffentlichen. Existing-Chrome-Bridge aus demselben Commit installieren; Build-Abgleich und frischen Heartbeat verifizieren. Die neue API gibt Zusatzpakete nur bei `acrylic-parcel-v1` aus; der Native Host prüft zuvor den exakten Extension-Build. Ein alter Worker bekommt weiterhin nur Hauptpakete.
4. Beim ersten natürlichen passenden Auftrag: Hauptdruck bestätigt → genau ein Zusatzkauf → andere DPD-Nummer → QA-Aufdruck `Acryl LED-Tischgerät` → eigener bestätigter CUPS-Job. Erst diese Produktionsbeobachtung ist Live-Nachweis, nicht der lokale Test.
5. In Berichten/QA die neue `parcel_kind` und den jeweiligen `qa_result.overlayText` beachten: Der Acryl-Aufdruck ist die freigegebene Ausnahme, kein fehlender DHL-Suffix. Bestehende persönliche Supervisor-Skills und Automationen wurden nicht mitgeändert.

Schema-Rollback: `supabase/rollbacks/20260924111338_arrival_acrylic_second_parcel_rollback.sql` stellt die bisherigen Funktionen und Constraints nur wieder her, wenn noch keinerlei Zusatzpaketdaten bestehen. Sonst bricht er bewusst ab. Nach ersten Zusatzaufträgen Daten und Beweise erhalten, betroffenen Pfad kontrolliert stoppen und vorwärts korrigieren; kein alter Server gegen die neue Artefakt-Idempotenz, keine Löschung und kein Wiederholungskauf.

Offen: genaue Commit-Freigabe, abgestimmter Live-Release und erster natürlicher Zusatzpaket-Nachweis. Vor Veröffentlichung ist die Funktion noch nicht aktiv.
