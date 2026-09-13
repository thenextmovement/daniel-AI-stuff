# NEONTRIP: ehemalige Privatkunden wie kleine Unternehmen nachfassen

Status: am 2026-09-13 auf den aktuellen Live-Stand abgeglichen und erneut lokal geprüft; noch nicht live freigegeben oder angewendet. Der frühere Kandidat 176a5229898037df288728983e4e7c0226794317 ist überholt.
Aufgabenworktree: /Users/danielklesse/codex-worktrees/neontrip-ops-followup-private-as-small-business-20260910-123155

## Begrenzter Auftrag

- Ziel: Kein privater Versand-Sonderpfad mehr. Bisher verlässlich als privat eingestufte Empfänger verwenden denselben häufigeren Werktagsrhythmus wie kleine Unternehmen: erste Nachfrage nach zwei Werktagen, weitere nach drei Werktagen, maximal sechs, Montag bis Freitag 09:00 bis vor 16:00 Uhr (Europe/Berlin).
- Nachbar: Große Unternehmen/Agenturen/Institutionen und ungeklärte Fälle behalten den bisherigen wöchentlichen Pfad. Verifizierungsregeln, manuelle Entscheidungen, Mailtexte, Du/Sie, Fabienne/NEONTRIP-Signatur, Antwortauswertung, Zähler und Kauf-/Absage-/Doppelsperren bleiben unverändert. Die Kundeneinstufung NT-8 wird nicht gelöscht oder in Geschäftskunde umgeschrieben.
- Wirkung: Ausschließlich die zentrale Cadence-Funktion liefert kein weekend_allowed=true mehr. Bereits offene Queue-Einträge erhalten beim regulären Claim und Offers-Versandcheck die neue Entscheidung. Keine Löschung, kein Backfill, kein Zurücksetzen der Serie und keine Testmail.

Der größere B2B-Segmentierungs-/Content-Plan wird mit dieser begrenzten Änderung nicht umgesetzt.

## Aktive Quelle und minimaler Diff

Am 2026-09-13 lesend bestätigt:
- n8n whey5GnTeSjiuZxD, aktive Version 5b3b546a-952c-42d7-a6b4-4f679b541813. Kein separater privater Mail-Builder: alle verwenden dieselben sechs bestehenden Texte.
- Supabase-Projekt klibiejfisijpagzkxls, public.neontrip_get_followup_queue_cadence_decision(uuid), Ausgangs-MD5 0e01a0bf2b507621985304cbfe8da46f; Rechte exakt {postgres=X/postgres,service_role=X/postgres}.
- Neuer Funktions-MD5: 363a2d172fb8934ddb9f190b8311c092.
- Seit dem ursprünglichen Kandidaten wurde ausschließlich die Request-Suche auf einen typisierten, formatgeprüften UUID-Vergleich optimiert. Der bytegenaue Vergleich bestätigt sonst identische Cadence-Logik. Migration und Rollback setzen jetzt diesen aktuellen Stand voraus und erhalten die Optimierung vollständig.
- Einziges geändertes Funktionsfragment: der private weekend_allowed-Ausdruck wird durch false ersetzt. Dadurch verwenden auch first_due_at, nächste Planung und der bestehende Offers-Kundenseriencheck die vorhandenen Business-Slots.
- Claim prüft die aktuelle Cadence und das Versandfenster. Complete berechnet die nächste Planung mit derselben zentralen Entscheidung. Offers prüft zusätzlich den Abstand zum neuesten versendeten Angebot und zu früheren Erinnerungen. Ein alter kalenderbasierter Queue-Termin umgeht daher nicht die neuen Werktagsabstände.
- Bestehende Kalender-Hilfsfunktionen und JSON-Felder bleiben aus Kompatibilitätsgründen vorhanden, aber die aktuelle Entscheidung aktiviert keinen privaten Wochenendpfad.
- Ausführung der Migration setzt den exakten Ausgangsstand, unveränderte Zugriffsrechte und keine processing-Delivery voraus.

## Prüfung und Belege

1. Isolierter lokaler PostgreSQL-17-Container ohne Netzwerk/Ports und ohne Produktionsdaten; bestehendes Queue-Fixture und bestehende SQL-Prüfung wiederverwendet. Die unveränderte Live-Funktionsdefinition bestand zuerst den alten Wochenendtest.
2. Nach Anwendung besteht die angepasste SQL-Prüfung: manuelles NT-8 und geprüftes AI-NT-8 verwenden frequent/business_days/6; NT-9 bleibt unverändert, Institution bleibt weekly/3, fehlende Daten und ungeklärte widersprüchliche Evidenz bleiben vorsichtig. Freitag plus zwei Werktage ergibt Dienstag; Samstag/Sonntag sowie vor 09:00 und ab 16:00 sind gesperrt.
3. Kein erneutes Klassifizieren; NT-8-Identität bleibt erhalten. Helfer-/Claim-/Completion-Quellen und deren Zugriffsrechte wurden nicht verändert. Claim oder Versand-RPCs wurden im Test nicht ausgeführt.
4. Migration mit laufender Delivery, abweichender Funktionsquelle oder geänderten Zugriffsrechten verweigert; erneute Anwendung verweigert. Transaktionen vollständig zurückgerollt.
5. Exakter Rollback stellt 0e01a0bf2b507621985304cbfe8da46f einschließlich typisierter UUID-Suche wieder her. Erneute Migration und SQL-Prüfung erfolgreich. Lokaler Funktions-Readback entspricht dem erwarteten Ein-Fragment-Diff; Zugriffsrechte unverändert.
6. Acht fokussierte Node-Tests einschließlich unveränderter Absage-/Aufschub-Regeln bestanden.
7. Rein lesender Vergleich am 2026-09-13: 461 offene Queue-Zeilen geprüft, davon 67 bisher mit Wochenendfreigabe. Kandidat: null Wochenendfreigaben, null unerwartete Änderungen, null Änderungen für nicht-private Fälle und null fehlerhafte Privat-Umstellungen. Nur weekend_allowed, delay_day_mode und gegebenenfalls first_due_at unterscheiden sich. Offers live unverändert auf 8ace170b90e5b352e0aa0dbffc5444b699ebbd50.
8. Gesamte Quote-Suite: 1.084 Tests bestanden; TypeScript-Prüfung und Produktions-Build bestanden. Für diese Prüfungen fehlten zunächst die lokalen Abhängigkeiten (tsx/next); npm ci anhand des unveränderten Lockfiles behob ausschließlich die Testumgebung. Keine Paket-/Lockfile-Änderung. Kein UI-Smoke ausgeführt, da weder UI noch Anwendungscode geändert wird; die fachliche Wirkung ist durch SQL-Prüfung und lesenden Produktionsvergleich abgedeckt.

Befehle im Aufgabenworktree:
- node --test tests/quotes/followup-small-business-only.test.ts tests/quotes/followup-decline-deal-status.test.ts
- npm run test:quotes; npm run build; ./node_modules/.bin/tsc --noEmit
- supabase/tests/followup_verified_private_weekends.sql ausschließlich in isoliertem Test-Postgres mit passenden Schema-Fixtures ausführen; niemals als lesenden Produktionscheck behandeln.

Die wiederverwendete lokale Schema-Vorbereitung liegt unter /tmp/neontrip-private-followup-check.D7d8dI/setup.sql. Für den aktuellen Test wurde danach die frisch gelesene Cadence aus /tmp/neontrip-private-followup-refresh.GsbFvl/cadence.live.sql geladen und ihr Hash vor Anwendung geprüft. Der PostgreSQL-17-Testcontainer hat Netzwerkmodus none, keine Ports und keine Mounts zu Produktivdaten; alle Daten sind synthetisch. Die Vorbereitung verwendet minimale Classification-Fixtures und einen lokalen Hash-Stub; sie ist kein vollständiger Klassifizierer-Test. Die unveränderte reale Hash-/Authority-Logik wurde ergänzend durch den lesenden Produktionsvergleich geprüft.

Kritische Gegenprüfung: Keine Kundenklassifikation umschreiben und keine offenen Serien neu anlegen oder nachholen. Die bestehenden Verbraucher der zentralen Cadence reichen aus; n8n benötigt keinen Patch. Die beiden separaten Dubletten-/Claim-Zeitlimit-Kandidaten gehören nicht zu dieser Änderung. Git-Basis auf aktuelles Ops origin/main abgeglichen; ausschließlich die fünf ursprünglichen Auftragsdateien unterscheiden sich davon.

## Veröffentlichung nach Freigabe

1. Exakten sauberen Commit des Aufgabenworktrees freigeben lassen; codex-predeploy ops muss zum Kandidaten passen. Keine Veröffentlichung vor dieser Freigabe.
2. Live-Cadence, aktive n8n-Version und processing-Status frisch lesen. Vollständige Funktionsdefinition/Zugriffsrechte als Rücknahmestand sichern. Bei Drift oder laufender Delivery stoppen.
3. Nur die benannte Migration 20260910103300_stop_private_followup_weekends.sql anwenden und deren Ein-Fragment-Diff/Zugriffsrechte zurücklesen. Keinen Sammel-Migrationslauf gegen sämtliche historischen Dateien starten. n8n bleibt unverändert.
4. Veröffentlichung der Repository-Änderung ausschließlich über codex-safe-push-main nach Predeploy aus diesem Aufgabenworktree.
5. Lesend bestätigen: keine aktive Cadence mit weekend_allowed=true; Kundendaten, Serienidentitäten und Zähler unverändert. Nächsten regulären Versand mit Queue/Attempt und Providerbeleg kontrollieren. Kein Kunden-Canary, Retry oder manuell erzeugter Claim.

Rollback nur nach ausdrücklichem Auftrag: die beigefügte exakt versionierte Rücknahme ausführen. Sie würde die frühere private Wochenend-Ausnahme wieder freigeben und ändert keine Queue-Zeilen.
