# Telefonzentrale – TICKET-290 / PROJ-001

Verantwortlich: Rahim. Ticket: https://github.com/thenextmovement/daniel-AI-stuff/issues/143
Arbeitsort: persönlicher Worktree auf neontrip-dev-01. Keine Produktionsfreigabe in diesem Stand.

## Enthalten
- Neue helle Telefonzentrale nach dem freigegebenen Entwurf; breite Kundensuche, Kundenkontext, Nachrichten, Angebots-/Trello-Links, Gesprächshistorie. Die alten Arbeitsflächen sind aus der Hauptansicht entfernt; Betriebsverwaltung und Wissen bleiben unter Einstellungen.
- GPT-Live 1 über die tatsächlichen Live-WebRTC- und SIP-Protokolle, inklusive verschachtelter Responses-Toolereignisse. Realtime 1.5/2.1 werden weder als aktive Optionen angeboten noch für neue Aufrufe zugelassen. Historische Datensätze bleiben erhalten.
- Menschliche Browser-Gesprächsbegleitung und KI-Gespräche speichern datierte, sprechergebundene Transkriptpassagen in Supabase. Schreibzugriff ist an die Session gebunden. Die Oberfläche meldet ausstehende Speicherung und verhindert das Überschreiben einer offenen Sitzung.
- Letzte Telefonate fließen als Kundenevidenz in den Copilot ein; sie sind keine Unternehmensregeln. Historie und Transkripte sind paginiert. Interne Tests sind immer aus Kundenhistorie und MCP-Lesezugriff ausgeschlossen.
- Drei separat berechtigte MCP-Lesewerkzeuge: customers_search, customers_get_history, customers_get_transcript. Keine vorhandene Identität erhält automatisch zusätzliche Rechte.
- Auftragsfeld und eingefrorener Kunden-Testkontext für ausgehende Versuche. Kontext und Zielnummer sind getrennt. Echte Kundendaten im internen Telefon-Test sind nur mit VOICE_INTERNAL_TEST_PHONE als exakt passendem, zusätzlich freigegebenem Empfänger zulässig. Rückrufe, DNC-Änderungen und echte Übergaben werden aus Tests nicht ausgelöst.
- Eine bestätigte SIP-REFER-Anfrage ist nur ein Übergabewunsch. Sie wird niemals als nachgewiesene Verbindung zum Mitarbeiter gespeichert.

## Verifikation
Root: npm run test:quotes, npx tsc --noEmit, npm run build:voice-runtime, npm run build.
MCP: npm run verify in services/neontrip-mcp.
SQL: tests/sql/voice-history.integration.sql und voice-live-contract.integration.sql in isoliertem PostgreSQL 17, einschließlich Migration/Rollback.
Browser: synthetische, ausdrücklich gekennzeichnete Fixtures per Playwright; Kundenauswahl, Telefonnummern-Bindung, Einwilligung, Auftragsfeld, menschliche Begleitung, 390-px-Ansicht ohne Überlauf.

## Vor einem genehmigten Rollout
1. Den exakten PR-Commit freigeben lassen, auf aktuellen origin/main beziehen und isolierte Prüfungen bestätigen. Keine direkt ungeprüfte Veröffentlichung.
2. Aktive Anrufe prüfen und Dispatch während der Umstellung anhalten; laufende Legacy-Realtime-Anrufe vorher beenden lassen. Keine bestehende Placetel-Rufumleitung ändern.
3. Die beiden Migrationen 20260916140000 und 20260916150000 genehmigt anwenden, bevor neue Ops-/Runtime-Versionen sie verwenden. Die gespeicherten Transkripte sind produktive Daten: ein Tabellen-Rollback darf sie nicht ungesichert löschen.
4. Ops, Runtime und gegebenenfalls MCP aus demselben freigegebenen Code ausrollen. Kundencall-Freigabe bleibt aus.
5. VOICE_LIVE_SIP_ENABLED erst setzen, nachdem der OpenAI-Projektanschluss tatsächlich GPT-Live-SIP unterstützt. Vorhandene Realtime-Zugangsdaten belegen das nicht. Der neu registrierte Modellstand ist absichtlich disabled/pending; keine unbelegte Eval-Freigabe.
6. Für Rahims freigegebenen Test die feste Testnummer serverseitig setzen, separat auf die Allowlist nehmen und eine dokumentierte Test-/Transkriptionseinwilligung binden. Erst danach einen einzelnen Testversuch ausführen.
7. MCP nur der vorgesehenen interaktiven Identität customers:read geben und die Verbindung in ChatGPT ausdrücklich einrichten. Supabase-Speicherung allein verbindet andere Chats nicht automatisch.

## Noch nicht als betriebsbereit abgenommen
- Placetel-Live-Audioweg, eingehende Anrufe im CRM, Klingelton, Browser-Wählfunktion und durchgängige mobile Gesprächserfassung. Der aktuelle Anrufen-Link öffnet die Telefon-App; das ist keine automatisch mitgeschnittene Browser-Verbindung.
- Live-Teamübersicht und Übernahme eines KI-Anrufs mit danach fortlaufender Mitarbeitertranskription. SIP-REFER allein liefert weder Verbindungsnachweis noch das weitere Mitarbeiter-Audio.
- Ein durchgängiger echter GPT-Live-Telefontest einschließlich Latenz, gleichzeitiger Sprache, Unterbrechungen, Zuordnung, Supabase-Abschluss und Wiederauffinden.
- Automatische Zusammenfassung menschlicher Gespräche; der MCP kann gespeicherte Passagen für eine quellenbezogene Zusammenfassung lesen. Telefonhistorie ist derzeit vorgangsgebunden, keine unbelegte Behauptung einer lückenlosen historischen Kundenakte.
- Der bisherige textbasierte Realtime-Live-Evaluator kann GPT-Live nicht prüfen. Er bricht für Live ausdrücklich ab; Audio-Evaluierung ist für eine Modellfreigabe erforderlich.
- Dauerhafte Wiederherstellung unbestätigter, ausschließlich im Arbeitsspeicher gepufferter Passagen nach Browser-/Prozessabsturz. Abbrüche und Sideband-Recovery werden als unvollständig behandelt; eine verlustfreie Erfassung bei Absturz wird nicht zugesagt.

Die monatliche Modellprüfung wurde im Codex-Task bereits separat eingerichtet. Ein Wechsel muss neue Audioprüfungen bestehen und bleibt an die bestehende Produktionsfreigabe gebunden.

## Geprüfte Protokollquellen
- OpenAI: https://developers.openai.com/api/docs/guides/voice-sip?api=live
- OpenAI: https://developers.openai.com/api/docs/guides/live-delegation
- Twilio: https://www.twilio.com/docs/voice/api/secure-media — secure=true aktiviert SRTP zusätzlich zur verschlüsselten Signalisierung.

## Kundensuche und Wählbereich – TICKET-292

Die Telefonzentrale liest ihr paginiertes Kundenverzeichnis direkt aus Supabase
(master_customers mit dem neuesten über customer_id verknüpften master_requests-Vorgang).
Die Trefferliste lädt keine Trello-, Outlook- oder Angebotsakten. Erst eine bewusste
Kontaktauswahl lädt die bisherige ausführliche Vorgangsübersicht. Kontakte ohne Vorgang
bleiben sichtbar und über die Telefon-App anwählbar; Gesprächsbegleitung benötigt
weiterhin eine gültige Vorgangsbindung. Gleiche Telefonnummern führen nicht zum
Zusammenführen verschiedener Kunden.

Deutsche Rufnummern werden für die Suche unabhängig von 0, +49, 0049 und Formatierung
verglichen. Name, Firma und E-Mail werden als literale Suchwerte behandelt. Fehler,
einschließlich HTML-Antworten eines vorgeschalteten Gateways, erscheinen als Fehler
mit Wiederholen-Schaltfläche und niemals als erfolgreicher Leerbefund.

„Wählen“ öffnet ein lokales Nummernfeld und Tastenfeld. Der Anrufen-Link übergibt an
die Standard-Telefon-App. Er garantiert keine Placetel-Auswahl, keine CRM-Audioverbindung
und keine automatische Transkription. Die vorhandene Anmeldung, Session-Cookies,
Provider-Konfiguration und gemeinsamen Ops-Bereiche sind unverändert.

Placetel unterstützt im PROFI-Tarif REST POST /calls mit sipuid und target sowie
Notify-Abonnements. Im aktuellen Produktcode ist kein Placetel-Call-Adapter
angeschlossen. Zur Aktivierung sind die serverseitige Nutzung eines vorhandenen
passenden API-Zugangs, eine verifizierte Mitarbeiter-/SIP-Zuordnung und ein separater
Test des Anruf- und Audiowegs erforderlich. Ein REST-Anrufnachweis allein belegt
keine Live-Transkription oder Mitarbeiterübernahme.
Quellen: https://api.placetel.de/ und
https://www.placetel.de/hilfe/telefonanlage/smartphone-app
