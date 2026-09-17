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
Routing/Klingeln externer Anrufe, optionaler mobiler
Rückruf sowie gemeinsame Audio-/Transkriptfortsetzung mit T293. Vor einer
Produktionsfreigabe muss der kombinierte Stand nach Integration von T293 erneut
geprüft werden. Neue Anrufschalter bleiben bis zum kontrollierten Gesamtpilot aus.

Primärquellen für den Anrufvertrag:
- https://www.twilio.com/docs/voice/api/conference-participant-resource
- https://www.twilio.com/docs/voice/twiml/conference
- https://www.twilio.com/docs/voice/api/call-resource
- https://postgrest.org/en/latest/references/api/resource_representation.html

## T295: Weitergabe mit persönlicher Einladung und Rücksprache

Der interne Browser-Pilot unterstützt jetzt eine Einladung an das frisch
registrierte, verfügbare Gerät eines Kollegen. Ops ermittelt Person und Gerät
aus den geprüften Telefonprofilen. Der Kunde wird zuerst bestätigt in Hold
gesetzt; erst danach erscheint die Einladung. Der Empfänger nimmt im CRM an
und baut seine eigene SDK-Verbindung auf. Der signierte Client-Webhook bindet
genau dessen Geräteidentität und Provider-Leg an die noch gültige Einladung.
Es wird kein spekulativer Anbieteranruf an den Kollegen erzeugt.

Nach dem bestätigten Konferenzbeitritt sprechen die Mitarbeiter untereinander.
Der bisherige Mitarbeiter kann zurück zum Kunden oder die Übergabe abschließen.
Dazu schützt zuerst der neue Mitarbeiter das Ende der Konferenz, der bisherige
gibt diese Rolle frei; dann wechselt der Besitzer im bestehenden Gespräch.
Erst nach bestätigtem Entfernen der bisherigen Telefonseite kehrt der Kunde
aus Hold zurück. Call-ID und Kunden-/Vorgangsbindung bleiben erhalten.
Die Oberfläche lädt einen gebundenen Vorgang für den Empfänger und entfernt
eine zuvor ausgewählte andere Kundenübersicht.

Die Migration 20260916233000 speichert Phasen und Ereignisse mit atomaren
Prüfungen, replay-sicheren Schlüsseln und RLS. Die Annahme, ein weiterer Anruf
und ein Abschluss sind während einer zurückgezogenen Einladung gesperrt.
Quelle und Ziel bleiben bis zum Abschluss bzw. zur Bereinigung reserviert.
Verspätete Abgänge des ehemaligen Mitarbeiters und veraltete
Auflege-/Recovery-Beobachtungen dürfen den übernommenen Anruf nicht beenden.
Die neue Telefonseite darf anschließend erneut weitergeben.

Abbruchabsicht wird vor der HTTP-Bestätigung gespeichert. Der Runtime-Worker
setzt angefangene Schritte fort und bestätigt Provideränderungen einzeln.
Gleichzeitiges Hold und Abbrechen werden innerhalb einer Runtime serialisiert.
Die Bereinigung bleibt auch nach Abschalten neuer Anrufe verfügbar.
Mehrere gleichzeitig aktive Runtime-Instanzen sind für diesen Pilot noch nicht
freigegeben; verteilte Ausführung und echtes Verhalten bei Provider-/Runtime-
Ausfall müssen vor Aktivierung geprüft werden.

Die helle Oberfläche bietet Weitergeben, Annehmen/Ablehnen, Rücksprache,
Übergabe abschließen und optionalen Klingelton für Einladungen. Teambelegung
kommt zusätzlich aus laufenden Gesprächen/Übergaben. Die Audioverbindung des
bisherigen Mitarbeiters wird nach Adoption lokal getrennt, ohne einen globalen
Auflegeauftrag auszulösen. Ein Empfänger kann vor Adoption nur seine Teilnahme
beenden. Gemeinsame Ops-Anmeldung und Cookie bleiben unverändert.

Prüfung: echte isolierte PostgreSQL-Funktionen für Einladung, falsches Gerät,
doppelte Legs, gesperrte Profile, Reihenfolge, Zurückziehen, Besitzerwechsel,
unveränderten Kundenbezug sowie alte Auflege-/Recovery-Meldungen. Runtime-
Vertragstests prüfen Providerbestätigung, Wiederaufnahme, Hold/Cancel-Rennen
und Callback-Zuordnung auch nach einer weiteren Übergabe. Zwei isolierte
HTTPS-Browserprofile prüfen Ablehnen, Annehmen, Rücksprache, Weitergabe,
verbotenes Auflegen durch die frühere Person, normalen Abschluss durch die
neue Person, mobilen Umbruch und unveränderte Ops-Cookie. Provider-Audio und
Provider-Ereignisse sind in dieser Vorschau synthetisch. Kein echter Anruf
oder produktiver Mitarbeiterdatensatz wurde angelegt.

Die nachfolgenden Abschnitte ergänzen Mitschrift und eingehende Anrufe. Offen
bleiben mobile Teilnahme, KI-Übergabe und der freigegebene kontrollierte
Telefon-Ende-zu-Ende-Test. Dieser Abschnitt beschreibt einen Entwicklungsstand,
keine bereits aktivierte Telefonanlage.

## Menschliche Mitschrift im Browser-Pilot (T295)

Die optionale Mitschrift braucht `VOICE_PHONE_TRANSCRIPTION_ENABLED=true` in Ops und Runtime sowie die Mitarbeiter-, Browsercall-, Transfer- und Capture-Migrationen. Die Capture-Migration setzt die bereits vorhandene `voice_transcript_history` voraus. Es werden keine produktiven Profile, Codes, Providerressourcen oder Anrufe durch die Migration angelegt. Alle Telefonie-Freigaben bleiben standardmäßig aus.

Der aktuelle Besitzer des verbundenen Gesprächs bestätigt die Absprache zur Transkription und Speicherung, bevor Ops eine dauerhafte Capture-Reservierung anlegt. Ein atomarer Startanspruch verhindert doppelte Streams; ein unklarer Anbieter-Start wird nicht wiederholt. Die Runtime startet einen unidirektionalen Twilio-Stream mit beiden Tracks der gespeicherten Kunden-Call-Leg. Signierter WebSocket, Account, HMAC, Capture-ID, Call-SID und einmalige Stream-Bindung werden vor Modellstart geprüft. Die KI-Stimme bleibt GPT-Live 1. Menschliche Mitschriften verwenden GPT-Live-Transcribe mit zwei getrennten Transkriptionsverbindungen.

Inbound ist der Kunde, outbound ist die beim Kunden hörbare Gegenseite (auch Ansagen/Haltemedien können darin vorkommen). Es werden keine individuellen Mitarbeiternamen aus dem Ton erraten. Private Rücksprache ist nicht Teil des Kunden-Audiotracks. Zeitangaben stammen aus Audioabschnitten, nicht aus Wortzeitstempeln des Modells. Teiltexte werden als vorläufig gespeichert; endgültige Fassungen bleiben unveränderlich. Kundenzuordnung, Datum und Gesprächs-ID bleiben bei Weitergaben erhalten. Der neue Gesprächsbesitzer kann die Mitschrift sehen/stoppen; der ehemalige Besitzer verliert die persönliche Live-Steuerung.

Mitschriftfehler beenden keine Telefonverbindung. Unvollständige Modellantworten, Speicherausfälle und verwaiste Captures werden als unterbrochen gekennzeichnet. Ein Neustart der Mitschrift verdeckt vorherige Lücken nicht. Anbieter-Cleanup wird erst nach bestätigtem Streamstopp quittiert; ein nicht auffindbarer Stream bei weiterhin lebendem Anruf bleibt zur Prüfung offen. Über den internen Runtime-Pfad gespeicherte Herzschläge verhindern, dass veraltete Recovery-Beobachtungen eine aktive Mitschrift beenden.

Die Oberfläche zeigt gespeicherte Beiträge, Status und Start/Stop mit Absprachebestätigung. Die Live-Ansicht enthält die letzten 100 Beiträge. Pilotgespräche bleiben als `internal_test` von der regulären Kundenhistorie getrennt. Diese Umsetzung ist noch kein Nachweis für produktive Placetel-Audioerfassung, Mobiltelefonie oder einen echten OpenAI-/Twilio-Anruf: Anbieterfreischaltung, echte Audioqualität, Ein-/Ausfalltests und Rahims kontrollierter Pilot stehen aus. Der neue Transkriptions-API-Vertrag wurde anhand offizieller Dokumentation umgesetzt und lokal simuliert, noch nicht mit dem produktiven OpenAI-Projekt bestätigt.


## Eingehende Browser-Anrufe im Pilot (T295)

Mit der Migration 20260917010000 und VOICE_PHONE_INBOUND_ENABLED=true in Ops und Runtime kann ein freigegebener Anrufer an einer freigegebenen Pilotnummer angenommen werden. VOICE_PHONE_INBOUND_NUMBERS enthält die gerufenen Nummern; VOICE_PHONE_ALLOWED_NUMBERS bleibt die Liste erlaubter Anrufer. Alle bisherigen Browser-Telefon-Voraussetzungen gelten weiter. Neue Schalter sind standardmäßig aus. Es werden keine Placetel- oder Twilio-Rufnummern automatisch umkonfiguriert.

Ein signierter, kontogebundener POST an /phone/twilio/incoming legt den vorhandenen Anrufer in eine wartende Konferenz. Es wird kein zweiter Kundenanruf ausgelöst. Eingehende Konferenzereignisse einschließlich späterer Mitarbeiterübergaben laufen über /phone/twilio/incoming/conference; der Dial-Abschluss über /phone/twilio/incoming/end. Twilio verwendet die Callback-Einstellungen des ersten Konferenzteilnehmers, hier des Anrufers. Das ist bei einer späteren Provider-Einrichtung zu berücksichtigen.

Ops sucht die Rufnummer im zentralen Kundenverzeichnis. Nur ein eindeutiger exakter Treffer aus einer vollständigen Suchseite wird automatisch zugeordnet; bei Mehrdeutigkeit oder fehlender Suche bleibt der Anruf ohne Kundenbindung. Die angezeigte Rufnummer authentifiziert keinen Kunden. Vor der Annahme sehen frisch registrierte, verfügbare Mitarbeiter den Anrufer mit optionalem Klingelton. Ablehnen betrifft nur die jeweilige Person. Die erste gültige Annahme reserviert Gespräch und Mitarbeiter atomar; ein verlorener HTTP-Antworttext kann mit derselben Anruf-ID erneut angefordert werden.

Die bestehende Gesprächszeile entsteht erst bei der Annahme, mit unverändertem Session-/Kundenbezug und bereits vorhandenem Kunden-Leg. Der Browser verbindet ausschließlich sein geprüftes persönliches Gerät mit dieser Zeile. „Im Gespräch“ und der tatsächliche Gesprächsbeginn werden erst nach bestätigtem Mitarbeiterbeitritt gesetzt. Vorherige Kundenauswahl wird bei Annahme gelöscht und gegebenenfalls der fest gebundene Vorgang geladen. Mitschrift und Weitergabe verwenden anschließend die vorhandene Gesprächskette.

Nicht angenommene Anrufe haben eine Wartefrist von 60 Sekunden, angenommene ohne Mitarbeiterbeitritt eine Verbindungsfrist von 30 Sekunden. Der periodische Recoverylauf beendet solche Anrufe beim Anbieter und bestätigt die Bereinigung danach. Verspätete Ereignisse dürfen beendete Anrufe nicht wieder öffnen. Ein ungültiges, widerrufenes, belegtes oder nicht mehr verfügbares Telefonprofil kann keinen Anruf übernehmen. Die Datenbank bewahrt unangenommene Anrufe mit Datum als abgebrochenen Pilotversuch; Wartezeit wird nicht als geführtes Kundengespräch dargestellt.

Diese Entwicklung ersetzt noch keinen realen Provider-Test. Öffentliche Kundenannahme, mobile Teilnahme, KI-Übergabe, verteilte Runtime-Ausführung und die kontrollierte Prüfung mit Rahim sind weitere Schritte. Ohne aktivierte Konfiguration und Provider-Routing gehen weiterhin keine Anrufe über diesen neuen Pfad ein.


## Verwaltung persönlicher Telefonprofile (T295)

Die zusätzliche Migration 20260917020000 ergänzt eine ausdrücklich vergebene Verwaltungsberechtigung, Profilrevisionen und ein Änderungsprotokoll. Sie erstellt keine echten Mitarbeiter und gibt niemandem automatisch Verwaltungsrechte. Die normale Ops-Sitzung allein reicht weder für die Teamverwaltung noch zum Ausstellen persönlicher Einrichtungscodes aus.

Ein Verwalter muss selbst ein gültiges persönliches Telefongerät besitzen. Die Berechtigung wird serverseitig und erneut unter Datenbanksperren geprüft. Die Oberfläche bietet Profile mit Anzeigename, Nebenstelle, optionaler persönlicher Access-E-Mail und Aktivstatus, einmalige Einrichtungscodes sowie einzelne Geräteabmeldungen. Providerziele, Mobilrufnummern und Verwaltungsrechte sind über diese API nicht änderbar. Profiländerungen verwenden eine Revision, damit ein veraltetes Formular keine zwischenzeitliche Änderung überschreibt.

Ein Einrichtungscode gilt einmal und 15 Minuten für genau das ausgewählte Profil. Ein neuer Code widerruft zuvor ungenutzte Codes dieser Person. Nur der Hash wird gespeichert; den Klartext gibt es einmal in der erfolgreichen Antwort und vorübergehend maskiert in der Verwaltung. Schließen, Profilwechsel und Ablauf entfernen ihn aus dem UI-Zustand. Keine Speicherung in URL, Local Storage, Audit oder Logs. Ein verlorener Ausstellungsbescheid wird durch einen neuen Code ersetzt, nicht aus einem gespeicherten Klartext rekonstruiert. Für das Anlegen eines Profils bleibt die vom Formular erzeugte ID bei einem Wiederholungsversuch gleich.

Das Ändern der Zuordnungs-E-Mail oder Deaktivieren eines Profils widerruft vorhandene Geräte und ungenutzte Codes atomar. Die bereits vorhandene Anruf-Recovery beendet nicht mehr berechtigte Telefonseiten; eine solche Abmeldung kann ein laufendes Telefonat beenden. Ops-Cookies und der Zugang zu anderen Ops-Bereichen bleiben unverändert. Das eigene Verwaltungsprofil kann sich über dieses Formular nicht deaktivieren oder einer anderen E-Mail zuordnen. Für die eigene Geräteabmeldung bleibt die vorhandene persönliche Abmeldung zuständig.

Enrollment und Verwaltung sperren Mitarbeiter vor Einladung und Gerät. So kann das gleichzeitige Einlösen eines gerade widerrufenen Codes oder einer neu zugeordneten Access-E-Mail nicht durch eine veraltete Berechtigungsprüfung schlüpfen. Änderungen werden mit persönlicher Mitarbeiter-/Geräte-ID und betroffenem Profil bzw. Gerät protokolliert; Codes und Hashes sind nicht Teil des Änderungsprotokolls.

Erstzuordnung bei der später freigegebenen Aktivierung: Über den bestätigten privilegierten Datenbankzugang wird das erste bestätigte persönliche Verwalterprofil explizit mit can_manage_phone=true provisioniert. Bei verfügbarer persönlicher Access-Identität kann dessen geprüfte E-Mail zur Geräteanmeldung verwendet werden. Bei gemeinsamem Ops-Zugang stellt der autorisierte Betreiber einmalig einen persönlichen Einrichtungscode aus und übergibt ihn geschützt an diese Person; der normale Ops-Zugang erhält dadurch keine generelle Verwaltungsberechtigung. Weitere Mitarbeiter und Geräte werden anschließend über die Telefonverwaltung eingerichtet. Diese produktive Erstzuordnung wurde noch nicht vorgenommen.

Prüfungen: isolierte SQL-Rollen-/Profil-/Code-/Gerätefälle, bestehende Enrollment-/Telefonie-Regressionen und echte parallele Transaktionen für Codewiderruf sowie E-Mail-Neuzuordnung. Verwaltungszugriff durch normale oder widerrufene Geräte, Rollenfelder aus dem Browser, falsche Profil-/Gerätekombinationen und veraltete Profilrevisionen werden zurückgewiesen. Ein produktiver Rollout oder eine Anbieterfreischaltung ist damit nicht verbunden.


## Persoenliche Handy-Bestaetigung (T295, standardmaessig aus)

Die persoenliche Telefonanmeldung hat unter „Mein Handy“ eine gesonderte
Bestaetigung. Die angemeldete Person gibt ihre Nummer ein, erhaelt im Browser
einen sechsstelligen Einmalcode und tippt ihn am angerufenen Handy ein. Es gibt
genau einen Versuch pro Anruf, drei Minuten Ablaufzeit, keine Audioaufzeichnung
und keine Kundendaten in der Ansage. Der Code bleibt nur im UI-Speicher und
verschwindet beim Schliessen; Supabase speichert den an die Versuch-ID
gebundenen Hash. Wiederholung desselben Startauftrags erzeugt keinen zweiten
Anruf. Mehr als ein Versuch pro Minute bzw. drei Versuche pro Stunde und
Person/Nummer werden zurueckgewiesen.

Voraussetzung: neue Migration20260917030000 plus
VOICE_PHONE_MOBILE_ENABLED=true und ausdrueckliche
VOICE_PHONE_MOBILE_NUMBERS-Liste in Ops und Runtime; persoenliche Telefonie
muss ebenfalls aktiviert sein. Die Flags sind standardmaessig aus. Die
Runtime verwendet den bestehenden Twilio-Account mit freigegebener
Absenderrufnummer; Browser-SDK-Zugangswerte sind fuer diesen kurzen
Bestaetigungsanruf nicht erforderlich. Keine produktiven Werte wurden gesetzt.

Die fertige Bestaetigung gehoert zur aktuellen Profilrevision, nicht zur
Lebensdauer der urspruenglichen Browseranmeldung. Browser-Abmeldung laesst
die fertige Handyzuordnung bestehen. Aenderung des Profils macht die bisherige
Bestaetigung ungueltig; ein laufender Versuch darf nach Geraetewiderruf oder
Profilwechsel nicht mehr abgeschlossen werden. Ein bereits bestaetigtes Handy
bleibt bei einem fehlgeschlagenen Austausch erhalten. Entfernen nennt die
exakte Link-ID, damit ein veraltetes Formular keine neuere Zuordnung loescht.

Signierte Providercallbacks pruefen Account, URL, Absender, Ziel und feste
Call-SID. Der Datenbankanspruch vor der Anbieteranfrage erlaubt hoechstens
einen Start; unklare Antworten werden nicht erneut gewaehlt. Abbruch ist vor
dem Runtime-Aufruf gespeichert; spaete Legs werden geschlossen. Bereinigung
wird erst nach bestaetigtem Providerende bzw. abgelaufener unbekannter
Startphase quittiert. Ein danach noch eintreffender Callback darf den Versuch
nicht oeffnen und wird erneut bereinigt.

Dieser Schritt bestaetigt eine mobile Rufnummer. Kundengespraeche und
Weiterleitungen auf dieses Handy sind der folgende Implementierungsschritt;
eine Bestaetigung aktiviert sie noch nicht. Reine Anrufe ausserhalb des
gemeinsamen Audiowegs liefern dadurch noch keine Mitschrift. Placetel-
Anschluesse und Rufnummernrouting bleiben unveraendert.

Primaerquellen fuer den Verifikationsweg:
https://www.twilio.com/docs/voice/api/call-resource
https://www.twilio.com/docs/voice/twiml/gather
https://www.placetel.de/hilfe/sip-trunking/anbindung-mit-sip


## Ausgehende Gespräche über das bestätigte Handy (T295)

Die Migration 20260917040000 ergänzt einen eigenen Handy-Verbindungsdatensatz
am bestehenden Gespräch. Mit VOICE_PHONE_MOBILE_CALLS_ENABLED=true in Ops und
Runtime lässt sich beim Anrufen „Mein Handy“ wählen. Persönliche Telefonie,
bestätigte Handyzuordnung, beide freigegebenen Nummernlisten und der bestehende
Twilio-Anschluss sind erforderlich. Browser-SDK-Schlüssel und eine verbundene
Browser-Audioverbindung braucht dieser Weg nicht. Alle neuen Freigaben bleiben
standardmäßig aus.

Zuerst klingelt nur das eigene bestätigte Handy. Die Ansage enthält keine
Kundendaten. Erst „1“ und der danach bestätigte Konferenzbeitritt erlauben den
einmaligen Kundenanruf. Mailbox, falsche Eingabe, fehlende Bestätigung oder eine
inzwischen widerrufene persönliche Zuordnung verbinden keinen Kunden. Ein
unklares Anbieterergebnis wird nicht durch einen weiteren Wählversuch ersetzt.
Reservierung, Call-SID und Gerät bleiben serverseitig gebunden; mobile Zielnummern
aus dem Browser sind keine Autorität.

Handy und Browser verwenden anschließend dieselbe Gesprächs-ID, Kundenbindung,
Mitschrift nach Absprache, Auflege- und Übergabesteuerung. Das Handy übernimmt
Mikrofon, Lautsprecher und Wahltasten. Nach Neuladen der Telefonzentrale wird
das eigene laufende Handygespräch wieder angezeigt, ohne neu zu wählen.
Eine Weitergabe vom Handy an einen persönlich angemeldeten Browserkollegen
erhält den Kundenanruf und die gespeicherte Mitschrift. Der bisherige Mitarbeiter
verliert die Steuerung; spätere Rückmeldungen seines Handys beenden das
übernommene Gespräch nicht.

Frühere Handyseiten behalten einen eigenen Bereinigungszustand, auch nach
Besitzerwechsel. Ein Gespräch wird erst als bereinigt quittiert, wenn seine
Handyseiten bestätigt beendet sind. Spät eintreffende Anbieterkennungen können
nur die Bereinigung erneut anfordern, kein beendetes Gespräch öffnen.

Geprüft mit isoliertem PostgreSQL einschließlich acht Telefonie-Integrationen,
zwei gleichzeitig ausgeführten Startansprüchen und spätem Callback nach Abbruch;
Runtime-Vertragstests; vier getrennten HTTPS-Browserprofilen mit echten
Ops-Endpunkten und synthetischen Anbieter-/Datenbankgegenstellen. Verlorene
Startantwort, Neuladen, Mitschrift, Handy-zu-Browser-Rücksprache/Übergabe,
Zugriffsgrenzen, bestehende Ops-Cookies und 390-px-Umbruch wurden geprüft.
Diese Vorschau telefoniert nicht über einen echten Anbieter.

Noch offen: Placetel-Audioweg,
KI-Übernahme, produktive Erstzuordnung/Freischaltung, echte Audio- und
Ausfallprüfung und Rahims kontrollierter Ende-zu-Ende-Anruf. Dieser Stand
aktiviert keine produktiven Gespräche.


## Übergaben auf ein bestätigtes Handy (T295)

Die Migration 20260917050000 und der zusätzliche Schalter
VOICE_PHONE_MOBILE_TRANSFERS_ENABLED in Ops und Runtime ergänzen mobile
Übergabeziele. Die Voraussetzungen für Handygespräche und die expliziten
Nummernlisten gelten weiter. Die Funktion ist standardmäßig aus.

Jeder Mitarbeiter schaltet „Übergaben am Handy annehmen“ in seinem eigenen
Telefonprofil ein. Gespeichert werden das aktuell autorisierte Gerät und die
genau bestätigte Handyzuordnung. Browser-Präsenz ist für dieses mobile Ziel
nicht erforderlich; Schließen der Seite beendet die Erreichbarkeit nicht.
Gerätewiderruf, Ablauf, Profilneuzuordnung oder eine entfernte/ersetzte
Handybestätigung machen das Ziel unzulässig. Eine bestätigte Nummer allein
schaltet diese Erreichbarkeit nicht ein. Ausschalten betrifft künftige
Übergaben und lässt ein bereits übernommenes Gespräch bestehen.

Der bisherige Mitarbeiter wählt weiterhin die Person aus der Teamliste.
Der Server bestimmt deren gültigen Telefonweg. Erst nach bestätigtem Hold des
Kunden darf genau ein Anruf auf das Mobilziel starten. Die neutrale Ansage
enthält keine Kundendaten. Mit „1“ bestätigt der Empfänger die interne
Rücksprache; die Browser-Annahme kann eine mobile Einladung nicht verbrauchen.
Erst der tatsächliche Konferenzbeitritt erlaubt den Abschluss der Übergabe.
Mitschrift, Kunden-Leg und Gesprächs-ID bleiben erhalten, auch bei einer
weiteren Übergabe zurück in einen Browser.

Abgelehnte, abgelaufene oder zurückgezogene Einladungen kehren zum bisherigen
Mitarbeiter zurück. Eine noch unbestätigte Handybereinigung hält den
Bereinigungsstatus der Übergabe offen. Späte Providerkennungen können den
alten Versuch nicht wieder öffnen. Die Runtime setzt gespeicherte
Übergabeschritte und Handybereinigung fort; ein unklarer Wählstart wird nicht
wiederholt.

Die Oberfläche des Empfängers zeigt die mobile Rücksprache auch ohne
registriertes Browser-SDK. Nach Übernahme und Neuladen wird das zu diesem
persönlichen Gerät gehörende Gespräch wieder angezeigt. Bei der Rücksprache
bleibt die Mitschriftsteuerung beim bisherigen Gesprächsbesitzer.

Prüfung: neun isolierte PostgreSQL-Integrationen und 184 Voice-Vertragstests.
Die neuen Fälle prüfen Opt-in, persönliche Bindung, Hold vor Handyruf,
Bestätigung vor Beitritt/Adoption, Browser-Ausschluss, Abbruch/Bereinigung,
Ausschalten zukünftiger Erreichbarkeit während eines aktiven Gesprächs sowie
Browser → Handy → Browser mit unverändertem Kunden-Leg und geschütztem
ehemaligen Besitzer. Typecheck und beide Builds sind ebenfalls erforderlich.

Direkte eingehende Kundenanrufe auf mobile Teamziele sind im nachfolgenden
Abschnitt beschrieben. Ohne deren separaten Schalter beschreibt die Checkbox
weiter ausschließlich Übergaben.
Produktive Aktivierung, Placetel-Anschluss, KI-Übernahme, Mehrinstanz-/Ausfalltest
und der echte kontrollierte Telefonpilot bleiben weitere Schritte.

Die isolierte HTTPS-Vorschau mit vier persönlichen Browserkontexten bestätigt zusätzlich die explizite Handy-Erreichbarkeit, Ablehnung fremder Akteursfelder/Origins, keine fremden Handynummern in der Teamansicht, mobile Rücksprache ohne SDK/Tokenanfrage, Übernahme mit gleicher Mitschrift, Neuladen und Ausschalten der Erreichbarkeit. Bestehende Browser-/Handyanrufe, Eingang, Verwaltung und Ops-Cookies bleiben erhalten. Keine Browserfehler und kein Überlauf bei 390 px; Desktop und Mobilansicht visuell geprüft. Zwei echte parallele SQL-Transaktionen erzeugen dieselbe Einladung und genau einen Startanspruch. Anbieter und Audio sind in diesen Prüfungen simuliert; es fand kein echter Anruf statt.


## Eingehende Anrufe am bestätigten Handy (T295)

Die Migration 20260917060000 und VOICE_PHONE_MOBILE_INCOMING_ENABLED in Ops und
Runtime ergänzen die direkte mobile Annahme. Voraussetzung sind die
Handygesprächsfunktion, VOICE_PHONE_INBOUND_ENABLED, freigegebene Eingangs-,
Anrufer- und Handynummern sowie die persönliche Handybestätigung. Der Schalter
bleibt standardmäßig aus. Die Runtime braucht für diesen Weg keine
Browser-SDK-Zugangswerte.

Die persönliche Erreichbarkeit gilt bei aktiviertem mobilen Eingang für
Anrufe und Übergaben. Die Oberfläche benennt diese Auswahl entsprechend.
Die Gültigkeit bleibt an das persönliche Gerät und die bestätigte
Handyverknüpfung gebunden; Schließen des Browsers ist keine Abmeldung.
Im Pilot werden ausschließlich ausdrücklich erlaubte Nummern verwendet.

Der vorhandene Anrufer wartet zuerst in seiner Konferenz. Erst sein
bestätigter Beitritt erzeugt mobile Einladungen an zulässige Teammitglieder.
Das Klingeln reserviert den Kunden noch für niemanden. Die neutrale
Handyansage nennt keine Kundendaten; „1“ nimmt an, Auflegen oder eine andere
Eingabe lässt den Kunden für andere Mitarbeiter verfügbar.

Die Annahme konkurriert atomar mit anderen Handy- und Browserantworten auf
demselben Eingang. Genau eine Person gewinnt. Der Gewinner übernimmt die
vorhandene Anrufer-SID, Kundenbindung und Session; sein bereits angerufenes
Handy wird ohne erneute Wahl in den normalen Gesprächspfad übernommen.
Erst der tatsächliche Beitritt gilt als verbunden. Verlierende Einladungen
werden separat beendet. Späte Antworten nach Kundenauflegen, anderem
Gewinner oder widerrufener Erreichbarkeit eröffnen keine neue Verbindung.

Nach Übernahme gehören Handycallbacks zum bestehenden mobilen Call, auch
nach weiteren Übergaben. Dadurch bleiben die vorhandene Mitschrift,
Besitzerprüfung, Wiederherstellung nach Neuladen und Bereinigung früherer
Telefonseiten zuständig. Offene Klingelversuche werden bei der Bereinigung
eines beendeten Eingangs bzw. Gesprächs mitgezählt. Ein unklarer Wählstart
wird nicht automatisch wiederholt. Gespeicherte Einladungen und spät
bestätigte Providerkennungen bleiben durch Recovery bereinigbar.

Neue signierte Providerpfade: /phone/twilio/mobile-incoming/prompt,
/confirm und /status mit exakt gebundener offer-ID, Call-SID und From/To.
Das interne Ops-Protokoll verwendet den bestehenden Runtime-Bearer und
gibt diese Einladungsdaten nicht über die öffentliche Teamansicht aus.
Anbieteraufzeichnungen bleiben aus.

Geprüft: 191 Voice-Vertragstests, zehn isolierte SQL-Integrationen und
Typecheck/beide Builds. Zwei tatsächlich gleichzeitig ausgeführte
Datenbanktransaktionen wurden sowohl Handy gegen Handy als auch Browser
gegen Handy geprüft: genau ein Call, unveränderte Kunden-SID und ein
Gewinner; beide eigenen Race-Datenbanken wurden danach entfernt.
Die SQL-Fälle prüfen außerdem explizite Erreichbarkeit, Nummernfreigaben,
Kundenbeitritt vor Klingeln, DTMF vor Adoption, Replay, Browser-Ausschluss,
Widerruf, späte Rückmeldungen und verfolgte Bereinigung.

Produktive Erstzuordnung und Aktivierung, Placetel-Audioweg, KI-Übernahme,
Mehrinstanz-/Ausfallnachweis sowie der echte kontrollierte Anruf mit
geprüftem OpenAI-Transkriptionszugriff bleiben ausstehend. Die isolierten
Nachweise ersetzen keinen Test mit tatsächlichem Telefon- und Audioweg.

Die abschließende HTTPS-Vorschau verwendet zusätzlich die echte neue
Runtimeklasse und reale interne Ops-Endpunkte mit synthetischer Datenbank
und Telefonanbieter. Sie bestätigt einmaliges Klingeln ohne vorzeitige
Kundenreservierung, DTMF-Annahme ohne Kundenneuwahl, persönliche Mitschrift
und Wiederherstellung nach Neuladen ohne Browser-SDK. Bestehende Ops-Cookies,
Browser-/Handy-/Übergabe- und Verwaltungsabläufe bleiben erhalten.

Bei eingehenden oder übernommenen Gesprächen mit bekanntem Kunden, aber ohne
gebundenen Vorgang, lädt die Oberfläche die Kontaktdaten direkt über die
gespeicherte Kunden-ID aus der SSOT. Sie zeigt den Namen und erfindet keine
Vorgangszuordnung. Der bestehende authentifizierte Verzeichnisendpunkt prüft
die ID und liest genau diesen Kontakt; Namens- oder Rufnummernähnlichkeit
reicht für die Übernahme nicht.

## T295: Gemeinsamer Verlauf bei KI-Übernahme – Speichergrundlage

Die Migration 20260917070000 trennt `ai_capture_status` und `ai_ended_at`
vom Status und Ende des gesamten Gesprächs. Die Runtime schreibt über
`persist_voice_runtime_transcript`, gebunden an die vorhandene Attempt-ID.
KI-Abschluss und verspätete Passagen bleiben auf den KI-Teil begrenzt,
sobald ein menschlicher `voice_phone_calls`-Datensatz dieselbe Session
fortführt. Beginn, Kunden-/Testbindung, Mitarbeiterstatus und Mitarbeiter-
zusammenfassung bleiben erhalten. Späte KI-Schreibvorgänge sind auf fünf
Minuten nach dem KI-Ende begrenzt; Wiederholungen verlängern diese Frist nicht.

Der bestehende Finalisierungs-RPC aktualisiert das KI-Ergebnis und den
Gesprächsverlauf in einer Transaktion. Es folgen keine separaten Session-
PATCHes aus Ops mehr. Doppelte Abschlussmeldungen verwenden das gespeicherte
Ergebnis. Der menschliche Mitschrift-RPC berücksichtigt zusätzlich den
KI-Teil: Eine ausdrücklich unterbrochene Erfassung wird durch einen späteren
erfolgreichen Abschluss des anderen Teils nicht als vollständig dargestellt.
Reine Mitarbeitergespräche behalten ihren bisherigen Ablauf.

Die SQL-Funktionen sind nur serverseitig aufrufbar. Der KI-Schreibpfad
akzeptiert Kunden-/Assistentenpassagen und kann weder Mitarbeitersprache
noch die ID-Namensräume menschlicher Audioströme übernehmen. Die Runtime
liest dafür keinen Transkript-Schreibhash mehr aus Supabase zurück.
Einwilligung, Revisionen, Ablauf und vorhandene Schreibgrenzen gelten weiter.

Dies implementiert die Speicherung, noch nicht die Anrufübernahme.
Der spätere Übergabeablauf muss die bestehende Session atomar sperren,
ihren offenen Zustand und die konkrete Provider-/Personenbindung prüfen,
bevor er sie als menschlichen Anruf übernimmt. Das bloße Vorhandensein
eines menschlichen Datensatzes ist kein Nachweis einer tatsächlichen
Verbindung. Mitarbeiterbereitschaft, Ankündigung, Umleitung derselben
Kundenleitung und bestätigter Beitritt bleiben im Runtime-Ablauf umzusetzen.
Die Migration muss vor dem zugehörigen Ops-Code ausgerollt werden; bestehende
Anrufe sind vor einem freigegebenen Rollout wie bisher auslaufen zu lassen.

Prüfungen: neue API-Vertragstests einschließlich Authentifizierung und
fehlgeschlagener Speicherung; isolierter PostgreSQL-Test mit dem tatsächlichen
AI- und Mitarbeiter-Schema, gemeinsamen Passagen, verspäteten/mehrfachen
Abschlüssen, Vollständigkeit, Ablauf und Rechten. Drei echte konkurrierende
SQL-Transaktionen bestätigen die Serialisierung in beiden Reihenfolgen und
erhalten eine nachträglich erkannte KI-Lücke. Keine produktiven Daten,
Anrufe, Provideränderungen oder Änderungen an der Ops-Anmeldung.
