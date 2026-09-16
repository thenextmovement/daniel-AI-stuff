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

## Interne Audiobrücke – TICKET-293

Der zusätzliche Modus verbindet die vorhandene Twilio-Sprachrufnummer mit dem
primären GPT-Live-1-WebSocket. Er ist ausschließlich für vorhandene, freigegebene
Allowlist-Testversuche implementiert. Reguläre Kundenversuche werden vor dem
Wählen und erneut vor der Modellverbindung abgewiesen. Dieser Codestand aktiviert
keine Telefonie, ändert keine Placetel-Ziele und setzt keine Umgebungsvariablen.

VOICE_LIVE_MEDIA_ENABLED=true wählt diesen Modus ausdrücklich aus. Ohne diesen
Schalter bleibt der vorhandene SIP-Modus unverändert. Die vorhandenen serverseitigen
OpenAI-Projekt-/API- und Twilio-Zugänge sowie VOICE_SIP_BINDING_SECRET werden
weiterverwendet; ein OpenAI-SIP-Webhook ist im Medienmodus nicht erforderlich.
VOICE_RUNTIME_PUBLIC_URL muss eine öffentliche HTTPS-Origin ohne Pfad sein.
Neue Secrets, DB-Migrationen oder Änderungen am Ops-Login sind nicht Bestandteil.

Der WSS-Endpunkt /media/twilio prüft Twilios Signatur anhand der fest konfigurierten
Origin. Anschließend werden Account, Attempt-HMAC, gespeicherte Provider-Anruf-ID,
GPT-Live-1-Modell und Testbindung geprüft. Ein dauerhafter Ereignisschlüssel lässt
pro Attempt nur einen Stream zu. Der Ops-Attempt-Endpunkt liefert dafür zusätzlich
die vorhandene providerCallId; Ops muss diesen Stand vor Aktivierung der Runtime
bereitstellen.

Twilio spricht vor dem Stream eine feste KI-/Testankündigung. Erst der nachfolgende
signierte und gebundene Streamstart bestätigt diese Ansage. Die gespeicherten
Live-Transkripte beginnen mit der anschließenden Live-Sitzung; die vorgeschaltete
Telefonansage ist als Offenlegungsereignis dokumentiert, kein Modelltranskript.
Transkriptpassagen behalten Sprecher und Live-Zeitangaben. Ein vollständiger Abschluss
erfordert sowohl session.closed als auch die Wiedergabebestätigung aus Twilios
Mark-Ereignissen und eine positive Speicherbestätigung.

Beide Audiorichtungen übertragen rohes G.711 µ-law bei 8 kHz unabhängig von
Datenbank- und Werkzeugabfragen. Start- und Wiedergabepuffer sind begrenzt.
Paketlücken, falsche Zuordnung, Abbruch, Neustart oder unbestätigte Wiedergabe
führen zu einem als unterbrochen markierten Verlauf. Eine nach Neustart verlorene
primäre Audioverbindung wird beendet, nicht als SIP-Sitzung wiederhergestellt.
Nur im Speicher verbliebene Daten sind bei einem Prozessabsturz weiterhin nicht
verlustfrei wiederherstellbar.

Isolierte Vorschau: node --import tsx --test tests/quotes/voice-media-*.test.ts.
Der Integrationstest startet den tatsächlichen lokalen WebSocket-Upgrade-/Audiohandler
und Live-Adapter mit simulierten OpenAI- und Ops-Gegenstellen. Er prüft die komplette
Kette einschließlich gleichzeitigem Sprechen, Wiedergabebestätigung und gespeicherten
Passagen. Nur Loopback, synthetische Daten und Testsignaturen; keine Provideranrufe,
keine produktive Datenbank. Das ist kein Nachweis echter Telefonlatenz oder
Verfügbarkeit des externen Audioanschlusses.

Vor dem einzelnen genehmigten Telefonpilot bleiben erforderlich: exakter Release,
kontrollierte Aktivierung des Medienmodus, passende Test-/Modell-/Speichergates,
öffentlicher WSS-Erreichbarkeitstest und anschließend reale Audioprüfung an Rahims
freigegebener Nummer. Automatische Kundenanrufe bleiben aus. Für einen Rückgang zum
SIP-Modus wird der neue Schalter nach Ende aktiver Tests entfernt; seine vorhandene
separate SIP-Freigabe wird dabei nicht automatisch gesetzt. Browser-/Handygespräche
von Mitarbeitern und echte Weiterleitung sind weiterhin eigene, offene Integrationen.

Quellen:
- https://developers.openai.com/api/docs/guides/voice-websockets?api=live
- https://www.twilio.com/docs/voice/media-streams/websocket-messages
- https://www.twilio.com/docs/usage/security
