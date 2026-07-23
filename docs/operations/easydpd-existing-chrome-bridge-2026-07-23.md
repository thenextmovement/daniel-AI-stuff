# EasyDPD Existing-Chrome-Bridge – Safety Review und Betrieb

Stand: 2026-07-23

## Zweck und Systemgrenze

Die Bridge verarbeitet ausschließlich bereits deterministisch freigegebene Arrival-Label-Kaufaufträge aus Postgres. Sie übernimmt einen vom Benutzer bereits geöffneten, bei Shopify angemeldeten easyDPD-Auftragstab im normalen Google-Chrome-Profil. Sie öffnet weder ein neues Fenster noch ein separates Browserprofil. Fehlt dieser Tab, wird kein Auftrag reserviert.

Die Architektur besteht aus:

1. einer eng berechtigten Manifest-V3-Erweiterung im normalen Chrome-Profil;
2. einem auf genau diese Erweiterungs-ID gepinnten Native-Messaging-Host;
3. den vorhandenen internen Ops-Endpunkten und der Postgres-Kaufqueue;
4. der vorhandenen PDF-QA-, A6-Druck- und Outlook-Archivkette.

Ein direkter CDP-Anschluss an Chromes Default-Profil ist keine tragfähige Alternative: Chrome ignoriert seit Version 136 Remote-Debugging-Schalter für das Standard-Datenverzeichnis. Siehe [Chrome Remote Debugging changes](https://developer.chrome.com/blog/remote-debugging-port) und [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

## Datenfluss

1. Chrome weckt die Erweiterung einmal pro Minute.
2. Die Erweiterung verlangt zuerst den bereits offenen exakten NEONTRIP-easyDPD-Auftragstab.
3. Nur im lokal bestätigten Live-Modus fragt der Native Host über das Schlüsselbund-Token einen Postgres-Auftrag an.
4. Der easyDPD-Iframe validiert Bestell-ID/-name, Produkt, `Einzeln auf A6`, 500 g und den Kaufbutton.
5. Jede bestehende easyDPD-History/Trackingnummer wird vor dem Dispatch als `existing_label` in Postgres gesperrt.
6. Nach erneuter Validierung wird `dispatching` in Postgres gespeichert.
7. Genau ein `Create label`-Klick ist pro Job im Tab erlaubt.
8. Nur ein nach Dispatch gestarteter, demselben Tab zugeordneter easyDPD-PDF-Download wird vom Native Host aus `~/Downloads` gelesen.
9. Der Server prüft PDF, eindeutige DPD-Nummer, A6-Layout und Schutzflächen, ergänzt die letzten sechs DHL-Ziffern, speichert privat und legt den A6-Druckjob an.
10. Erst nach bestätigtem Druck archiviert die vorhandene Outlook-Kette die exakte DHL-Express-Mail.

EasyDPD selbst erfüllt die Shopify-Bestellung und löst die dort konfigurierte Versandbestätigung aus. Die Bridge sendet weder ein zweites Fulfillment noch eine eigene Kundennachricht.

## Sicherheitsgrenzen

- Postgres ist Source of Truth und Exactly-once-Grenze; Trello bleibt Projektion.
- Live braucht gleichzeitig Server-Gates, lokale Live-Konfiguration und `--acknowledge-production-write`.
- Die Erweiterung hat keine `<all_urls>`-Berechtigung. Erlaubt sind nur der feste NEONTRIP-Shopify-App-Pfad und `easydpd.247apps.de`.
- Der Native Host akzeptiert ausschließlich die feste Erweiterungs-ID `bgfphlbhdameagnafljlgpbpjdajmdhk`.
- Native Host und Erweiterungsruntime liegen unter `~/Library/Application Support/NEONTRIP/` und damit außerhalb TCC-geschützter Schreibtisch-/Dokumente-Symlinks.
- API- und Cloudflare-Secrets bleiben im macOS-Schlüsselbund und stehen weder in der Erweiterung noch im Native-Host-Manifest.
- Der Native Host akzeptiert nur vier Nachrichtentypen und nur API-Pfade, die exakt zur reservierten Job-ID gehören.
- Der PDF-Pfad muss nach `realpath` unter `~/Downloads` liegen, dem lokalen Benutzer gehören, `.pdf` heißen, innerhalb der Größenbegrenzung liegen und mit `%PDF-` beginnen.
- Jede Unsicherheit nach `dispatching` wird `manual_review`. Ein automatischer Wiederholungskauf ist ausgeschlossen.
- Der alte Playwright-/separate-Profil-Worker muss vor Live deaktiviert sein.

## Safety Scorecard

| Dimension | Dry-Run | Live nach Canary | Begründung |
| --- | ---: | ---: | --- |
| Correctness | 5 | 4 | Exakte Route/Felder/History werden geprüft; easyDPD bleibt eine fremde UI. |
| Reliability | 5 | 4 | Chrome-Alarm und Native Host sind klein; Betrieb setzt geöffneten Chrome und gültige Shopify-Sitzung voraus. |
| Idempotency | 5 | 5 | DB-Lease, Job-ID, `dispatching` vor Klick, Job-spezifische Klicksperre und kein Post-Dispatch-Retry. |
| Observability | 5 | 5 | Queue, Events, Hashes, Tracking, Druck, Archiv und lokaler Heartbeat sind nachvollziehbar. |
| Security | 5 | 4 | Enge Origins, feste Extension-ID, Schlüsselbund und private Artefakte; Entwicklermodus bleibt lokales Restrisiko. |
| Tracking impact | 5 | 5 | Keine Änderung an GA/GTM/Ads; Versandmail bleibt easyDPD/Shopify. |
| Cost risk | 5 | 4 | Produktcap maximal 15 EUR; easyDPD zeigt weiterhin keinen maschinenlesbaren Ist-Preis vor Kauf. |

## Aktivierungs-Gates

Vor Live müssen alle Punkte erfüllt sein:

1. Ops-Tests, TypeScript und Produktionsbuild sind grün.
2. Migration `20260723091205_add_arrival_label_existing_label_stop.sql` ist angewendet.
3. Bridge ist aus dem exakten, sauberen `origin/main`-Commit im Dry-Run installiert.
4. Erweiterung ist einmalig aus dem ausgegebenen stabilen Ordner geladen; die angezeigte ID stimmt exakt.
5. Native-Host-Selbsttest ist grün und enthält `purchaseClicked=false`, `claimAttempted=false`.
6. Der bereits offene angemeldete easyDPD-Tab wird erkannt.
7. Der geschützte bestehende-Label-Canary `#NEONT4532` erkennt DPD `01476817855492` und erzeugt keinen Kauf.
8. Alter separater Worker ist deaktiviert.
9. Ein einzelner ausdrücklicher Live-Canary bestätigt DPD-Tracking, Shopify-Fulfillment/Kundenmail, annotiertes A6, Brother-Druck und Outlook-Archiv.
10. Erst danach bleiben Server- und lokale Live-Gates dauerhaft an.

## Betrieb und Recovery

- Chrome darf offen bleiben. Nach Mac-/Chrome-Neustart startet die Erweiterung mit Chrome erneut.
- Ohne offenen exakten easyDPD-Auftragstab protokolliert sie `browser_tab_required` und reserviert nichts.
- Bei abgelaufener Shopify-Anmeldung bleibt der Auftrag vor Dispatch retrybar beziehungsweise nach erschöpften sicheren Versuchen manuell.
- `manual_review_after_dispatch` bedeutet: easyDPD-Archiv, Shopify-Fulfillment, Downloads, CUPS und Postgres prüfen; niemals automatisch erneut kaufen.
- Ein Download- oder Native-Host-Fehler nach Dispatch ist kein Grund für einen zweiten Klick.

## Installation und Rollback

```bash
npm run arrival-labels:existing-chrome:manage -- install --mode dry_run
npm run arrival-labels:existing-chrome:manage -- status
npm run arrival-labels:existing-chrome:manage -- self-test
```

Live-Wechsel:

```bash
npm run arrival-labels:existing-chrome:manage -- install --mode live --acknowledge-production-write
```

Rollback:

```bash
npm run arrival-labels:existing-chrome:manage -- rollback
```

Harter Stopp:

1. `worker_enabled=false` und `live_purchase_enabled=false`;
2. `npm run arrival-labels:existing-chrome:manage -- uninstall`;
3. unsichere Jobs und Drucke manuell prüfen;
4. gezielten Revert über Worktree, `codex-safe-push-main`, `codex-predeploy ops` und exakten Deploy-Commit ausrollen.

Auditdaten und private Artefakte werden beim Rollback bewahrt.
