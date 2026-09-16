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

## Persönliche Telefonprofile – TICKET-295 (Entwicklungsstand)

Die Telefonidentität ist vom vorhandenen Ops-Zugang getrennt. Eine allgemeine
Ops-Sitzung und ein frei eingegebener Name berechtigen nicht zu einem persönlichen
Browser-Telefon. Bei bekannter, verifizierter Cloudflare-Access-E-Mail kann ein
zugeordnetes aktives Profil verbunden werden. Alternativ wird ein unabhängig
ausgestellter, einmaliger persönlicher Einrichtungscode eingelöst. Der
Einrichtungscode wählt seinen Besitzer serverseitig; der Browser übermittelt
keine maßgebliche Mitarbeiter-ID.

Die additive Migration 20260916220000 legt voice_staff, voice_staff_invites und
voice_staff_devices an. Sie legt keine echten Mitarbeiter, Codes, Zugangswerte
oder aktiven Anschlüsse an. Alle Tabellen haben RLS und keinen direkten Zugriff
für anon/authenticated. Nur der bestehende serverseitige Service-Zugang darf
sie bearbeiten. Codes und Gerätesitzungen werden nur als getrennt abgeleitete
Hashes gespeichert. Die Geräte-Cookie ist HttpOnly, Secure in Produktion,
SameSite Strict und auf /api/ops/voice-phone beschränkt. Die Ops-Cookie bleibt
unverändert. Codes sind einmalig und maximal 24 Stunden gültig, Geräte maximal
30 Tage; pro Mitarbeiter sind höchstens acht aktive Geräte möglich.

Die Code-Ausstellung und erste produktive Profilzuordnung sind noch einzurichten.
Sie dürfen nicht als frei zugängliche Selbstzuweisung unter einem gemeinsamen
Ops-Token implementiert werden. Neue Codes werden einer bereits bestätigten
Person zugeordnet und außerhalb von Logs und Chat ausgegeben. Keine Personen-
oder E-Mail-Zuordnung aus Anzeigenamen erraten. Die verifizierten Placetel-Ziel-
IDs können am Profil hinterlegt werden; dies verändert das Placetel-Routing nicht.

VOICE_PHONE_ENABLED schaltet diesen zusätzlichen Ops-Pfad ausdrücklich ein.
Ohne diesen Schalter bleibt die vorhandene Gesprächsbegleitung erhalten.
Die Teamanzeige verwendet nur frische Gerätemeldungen (45 Sekunden) mit
registriertem Telefon; dies ist eine Präsenzanzeige und noch kein Beweis für
eine freie Leitung. Der Anrufstatus muss aus den Telefonereignissen ergänzt werden.

Für Browser-Telefonberechtigungen fragt Ops die Runtime mit der bestehenden
internen Authentifizierung an. Die Runtime prüft dasselbe aktive Gerät erneut in
Ops. Das offizielle Twilio-SDK signiert einen höchstens zehn Minuten gültigen
Token mit genau dessen stabiler Client-Identität. Die Gerätesitzung darf dadurch
nicht verlängert werden. Ein frei mitgeschickter Name oder eine fremde Identität
ändert die Signaturzuordnung nicht. Runtime-Voraussetzungen:
VOICE_TEAM_PHONE_ENABLED, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET und
TWILIO_PHONE_APP_SID; bestehende Twilio-Account-ID und Ops-Verbindung werden genutzt.
Diese Werte werden durch den Codestand weder erstellt noch gesetzt.

Neu benötigte Bibliotheken: @twilio/voice-sdk 2.18.5 und twilio 6.1.1. Deren
Abhängigkeiten erfordern die angehobenen Patchstände von hasown, side-channel
und side-channel-list. Weitere bestehende Paketversionen sind unverändert.
Die Audit-Prüfung ergab keine Advisories für neu hinzugefügte Pakete.

Geprüft: Vertragstests für getrennte Credentials, Identität, Ablauf, Präsenz,
Origin-Schutz und signierte Telefontokens; isolierte PostgreSQL-17-Prüfung
einschließlich Doppelverwendung, Sperren, Ablauf, Transaktionsrollback, Geräte-
Limit und RLS. Zwei parallele echte SQL-Transaktionen ergaben genau ein Gerät.
Die isolierte HTTPS-Next-Vorschau prüft den bestehenden Ops-Login, persönliche
Anmeldung, abgewiesene falsche Access-Identität und Code-Replay, Cookie-Eigenschaften,
Abmeldung ohne Ops-Logout sowie Desktop und 390-px-Ansicht. Keine reale Datenbank,
keine Providerverbindung und keine produktiven Kundendaten in diesen Tests.

Noch offen in T295: Browser-SDK mit Anrufsteuerung verbinden, bestätigter
Anrufaufbau und Eingangsanzeige, Konferenz-/Rückfrage-/Weitergabeablauf, optionaler
Rückruf auf ein verifiziertes Mitarbeitertelefon, personen- und kundengebundene
Transkriptfortsetzung sowie administrative Ersteinrichtung. Dieser Zwischenstand
ist keine betriebsbereite Telefonie und kein freigegebener Rollout.

Quellen:
- https://www.twilio.com/docs/iam/access-tokens
- https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice
- https://www.twilio.com/docs/voice/conference


## T295: ausgehender Browser-Pilot und gemeinsame Gesprächskennung

Der Browser verwendet jetzt das offizielle Voice-SDK für Anmeldung, ausgehende
Audioverbindung, Token-Erneuerung, Stummschalten, DTMF und Auflegen. Er reserviert
zuerst einen Anruf im eigenen persönlichen Profil. An das SDK geht nur die
Gesprächskennung. Die Zielnummer eines ausgewählten Kunden wird in Ops erneut
aus dessen Datensatz gelesen; eine vom Browser mitgeschickte andere Telefonnummer
oder Mitarbeiter-ID ersetzt diese Zuordnung nicht. Ohne Kundenwahl bleibt ein
freier Anruf ausdrücklich ohne Kundenbindung.

Die additive Migration 20260916230000 ergänzt voice_phone_calls und
voice_phone_events. Reservierung, Bindung an die echte Provider-Anruf-ID und
Ereignisfortschreibung laufen unter Datenbanksperren. Pro Mitarbeiter darf nur
ein offener oder noch nicht vollständig beendeter Anruf bestehen. Wiederholte
Reservierungen mit demselben Schlüssel ergeben denselben Anruf; abweichende
Parameter werden abgewiesen. Abgelaufene Geräte und andere Geräte können einen
reservierten Anruf nicht übernehmen.

Der erste Mitarbeiter tritt einer festen Twilio-Konferenz bei. Erst dessen
signiertes participant-join löst nach erneuter Berechtigungsprüfung genau einen
Kundenanruf aus. Ein Kunde gilt erst nach seinem eigenen Konferenzbeitritt als
verbunden. Rückmeldungen werden mit Account, Signatur, Konferenzname, Kennung und
Anrufseite abgeglichen. Doppelte Ereignisse und verspätetes Klingeln öffnen keinen
beendeten Anruf erneut. Unklare Provider-Antworten lösen keinen zweiten
Wählversuch aus. Der Hintergrundabgleich beendet verwaisten Aufbau, gesperrte
Geräte und bekannte beendete Verbindungen. Beide Telefonseiten werden unabhängig
von der Konferenz aufgeräumt; eine neue Verbindung bleibt bis zur bestätigten
Bereinigung gesperrt. Änderungen während der Bereinigung werden nicht mit einem
veralteten Stand bestätigt.

Dieser Stand bleibt ein begrenzter interner Pilot. In Ops und Runtime müssen
VOICE_BROWSER_CALLS_ENABLED und dieselbe ausdrücklich bestätigte Liste
VOICE_PHONE_ALLOWED_NUMBERS gesetzt sein; ohne passende Ziele wird nicht gewählt.
VOICE_PHONE_ENABLED bzw. VOICE_TEAM_PHONE_ENABLED und die bestehenden persönlichen
Telefon-/Provider-Voraussetzungen gelten zusätzlich. Das Abschalten neuer
Browser-Anrufe erhält bei weiter vorhandenem Team-Anschluss die Verarbeitung
laufender Rückmeldungen und das Beenden. Die TwiML-App benötigt später den
POST-Endpunkt /phone/twilio/client; Konferenz-/Kundencallbacks werden automatisch
mit der festen Runtime-Adresse erzeugt. Der maximale Pilotanruf dauert 15 Minuten,
ein unbeantworteter Kundenanruf höchstens 30 Sekunden.

Pilotgespräche werden als internal_test in voice_call_sessions mit festem
Mitarbeiter, Kunden-/Vorgangsbindung und bestätigtem Beginn/Ende gespeichert.
Sie erscheinen nicht als reale Kundenhistorie. Die Audiotranskription ist in
diesem Entwicklungsschritt noch nicht verbunden; die Oberfläche sagt das
ausdrücklich. Eingehende, noch nicht serverseitig zugeordnete SDK-Anrufe werden
abgewiesen. Es wurden keine produktiven Profile, Tokens, Rufnummern, Anrufe oder
Provider-Einstellungen erstellt bzw. geändert.

Prüfungen: 105 gezielte Voice-Tests, Typecheck, Runtime- und App-Build; isolierte
PostgreSQL-Integration prüft Identität, fremde Geräte, Sperren, ein Gespräch pro
Mitarbeiter, genau einen Dispatch, späte/doppelte Rückmeldungen und
Bereinigungszustand. Zwei parallele echte Datenbanktransaktionen ergeben
dieselbe Reservierungs-ID und genau einen Dispatch-Anspruch. Die HTTPS-Next-
Vorschau prüft die echten Ops-Endpunkte mit synthetischen REST-Daten und einem
ersetzten Provider-SDK: Anmeldung, serverseitige Zielwahl, gesperrte Nummern,
Verbindungszustände, Stummschalten, DTMF, Auflegen und Erhalt derselben Ops-Cookie.
Dies ist kein Nachweis eines echten Telefonanrufs oder der Audioqualität.

Weiter offen: freigegebene Ersteinrichtung der drei Personen, eingehendes
Routing/Klingeln, gegenseitige Weitergabe mit Rücksprache, optionaler mobiler
Rückruf sowie gemeinsame Audio-/Transkriptfortsetzung mit T293. Vor einer
Produktionsfreigabe muss der kombinierte Stand nach Integration von T293 erneut
geprüft werden. Neue Anrufschalter bleiben bis zum kontrollierten Gesamtpilot aus.

Primärquellen für den Anrufvertrag:
- https://www.twilio.com/docs/voice/api/conference-participant-resource
- https://www.twilio.com/docs/voice/twiml/conference
- https://www.twilio.com/docs/voice/api/call-resource
- https://postgrest.org/en/latest/references/api/resource_representation.html
