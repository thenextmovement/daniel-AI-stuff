# NEONTRIP Operations MCP

Sicherer Streamable-HTTP-MCP-Gateway für die NEONTRIP Rechnungs-OPS und Angebotssoftware. Der Gateway enthält bewusst keinen freien HTTP-Proxy, keinen Datenbankzugang, keine Shell und keinen Dateisystemzugriff. Spezialtools und ein fester Ops-Katalog begrenzen Ziele und Methoden; Scopes trennen die Identitäten. Die generischen Ops-Eingaben werden zusätzlich durch die kanonische Businessroute validiert.

## Identitäten und Rechte

- `billing_automation`: nur Systemstatus, Rechnungen lesen und risikoarme Rechnungsänderungen annehmen. Identitäts-, Länder-, Steuer-, Umsatzsteuer-ID- und Betragsänderungen werden serverseitig blockiert. Ablehnen, Entwürfe bearbeiten, Finanzaktionen, Angebote ändern und E-Mails senden sind für diese Identität technisch nicht vorhanden.
- `operator`: breite fachliche Rechte für Rechnungs-OPS und Angebote. Auch hier gibt es keinen Rohzugriff auf Datenbank, Server oder beliebige URLs.

Der Zugang verwendet vorkonfigurierte Bearer-API-Tokens, keinen OAuth-Login und keinen OAuth-Authorization-Server. Tokens werden nur als SHA-256-Hash konfiguriert, zeitlich befristet und in konstanter Zeit verglichen; abgelaufene Identitäten werden bei jedem Aufruf abgewiesen. Ein abgelaufener Altaccount verhindert den Start anderer gültiger Accounts nicht. Für Produktion gehört der nur auf Loopback gebundene Dienst hinter HTTPS beziehungsweise einen privaten Tunnel. Die Upstream-Zugänge sind getrennte Dienstidentitäten; Logs enthalten weder Tokens noch Nutzdaten.

## Sichere Schreibvorgänge

- Rechnungsentscheidungen lesen den Vorgang unmittelbar vor dem Schreiben erneut.
- Die aufgerufene Änderung muss offen sein und ihr SHA-256-Prüffingerprint muss exakt dem zuvor gelesenen Wert entsprechen.
- Idempotenzschlüssel verhindern Doppelaktionen; anschließend wird der Zustand erneut gelesen und geprüft.
- Angebotsänderungen werden zuerst per Dry-run validiert, verwenden `expectedUpdatedAt` und werden danach erneut gelesen.
- Rechnungsentscheidungen unterdrücken standardmäßig die Kundenbenachrichtigung atomar in derselben Datenbanktransaktion. Nur eine ausdrücklich gesetzte Produktionsoption aktiviert den bisherigen Mail-Nebeneffekt.

## Lokale Prüfung

1. `npm ci --ignore-scripts`
2. Eine lokale Testkonfiguration aus `.env.example` bereitstellen; keine Secrets einchecken.
3. `npm run verify`

`/health/live` meldet den Prozessstatus und den 40-stelligen `SOURCE_COMMIT`; ohne Build-Metadatum lautet der Commit `unknown`. Beim Release muss dieser Wert mit dem freigegebenen/deployten Commit verglichen werden. `/health/ready` bestätigt nur, dass alle in `MCP_REQUIRED_SERVICES` genannten Systeme konfiguriert sind. Das authentifizierte MCP-Tool `neontrip_health` prüft zusätzliche Leseverbindungen entsprechend den Identitätsscopes. Keiner dieser Checks testet sämtliche Schreibaktionen oder beweist die produktiven Company-Brain-/Telefon-Unterrollen.

`MCP_ALLOWED_HOSTS` und `MCP_ALLOWED_ORIGINS` enthalten kommagetrennte Hostnamen, zum Beispiel `mcp.example.invalid`, keine vollständigen URLs. Bei leerem `MCP_ALLOWED_ORIGINS` gilt der Hostname aus `MCP_PUBLIC_URL`. Die Origin-Prüfung bleibt auch beim Container-Bind auf `0.0.0.0` aktiv. Serverclients ohne Origin benötigen weiterhin gültige Authentifizierung.

## Produktionsfreigabe

Vor dem Aktivieren sind eine eigene Cloudflare-Access-Service-Identität für OPS, ein eigener Offers-API-Schlüssel, getrennte und ablaufende MCP-Tokens sowie Alarmierung auf fehlgeschlagene Healthchecks einzurichten. Die ChatGPT-Work-Automation verwendet ausschließlich die `billing_automation`-Identität. Für manuelle Codex-Aufgaben wird separat die `operator`-Identität verbunden.

## Fester Betreiberkatalog und Grenzen

Die zusätzlichen Scopes `ops:read`/`ops:write` öffnen `ops_describe_operation`,
`ops_read` und `ops_write` für die feste Routenliste. Der geprüfte Stand umfasst
99 generische Operationen; alle 91 Ops-Routen mit 127 HTTP-Methoden sind als
Katalogfunktion, Billing-Spezialtool oder ausdrückliche Ausnahme erfasst. Vor jeder Aktion ist ihr
Vertrag zu lesen; query/path/body entsprechen der kanonischen Ops-Route.
GET company-brain/resolve ist wegen Persistenz und KI-Kosten eine Schreibaktion.
Der Katalog dokumentiert die Ausnahmen einschließlich Browser-/Worker-Protokollen.
POST `voice-copilot/transcript` und `voice-copilot/session` gehören zum
consent-gebundenen Browser-Livecall mit `x-voice-session-token`; sie sind keine
generischen MCP-Schreibaktionen. Gespeicherte Transkripte bleiben per GET lesbar.
Telefonteamverwaltung bleibt separat erreichbar, sofern ihre Unterrollen vorliegen.
Bei EU-Supplier-Quotes ist `select_organization` die Operatoraktion; neun signierte
Workeraktionen sind ausdrücklich als nicht verfügbar ausgewiesen. Quellhash-Tests erzwingen eine neue Prüfung
bei Routen- oder Vertragsänderungen. Zur Aktualisierung nach npm ci im Repo:
python3 services/neontrip-mcp/scripts/generate-ops-catalog.py und danach
node services/neontrip-mcp/scripts/resolve-ops-contracts.cjs ausführen.

Mit offers:full wird der native Offers-Katalog unter editor_ dynamisch eingebunden.
Dafür muss derselbe persönliche Bearer-Digest in Offers einer bestehenden
Mitarbeiteridentität zugeordnet sein; ADMIN-Aktionen benötigen dort ADMIN.
Ein fehlender oder leerer nativer Katalog meldet fehlende Einsatzbereitschaft.
Ops-Unterrollen (Company Brain, Telefonverwaltung) werden zusätzlich im Zielsystem
geprüft. Ein Scope allein beweist keine vollständige produktive Berechtigung.
Automationsidentitäten erhalten keine dieser zusätzlichen Betreiberrechte.

## Datenumfang und Schreibbestätigung

Die Listen für Sales, Aufgaben, Decisions/Outcomes, Wissenskandidaten/-versionen,
EU-Supplier-Anfragen und Designjobs haben `limit`/`offset` und deterministische
ID-Tiebreaker. Defaults und bestehende UI-Ansichten bleiben erhalten. Bei einfachen
Arrays `offset` um die tatsächlich gelesene Anzahl erhöhen und bis zur leeren Seite
fortsetzen. Gleichzeitige Änderungen erfordern einen neuen Durchlauf; eine Folge
von HTTP-Aufrufen ist kein Datenbank-Snapshot. Statuswerte und Seitenmaxima stehen
in `ops_describe_operation.resultLimits`.

Sales filtert und sortiert vollständig vor dem Seitenschnitt. `board.pagination`
nennt die Trefferzahl/Weiterseite des gewählten Scopes; `board.counts` bezieht sich
weiter auf nicht abgeschlossene Vorgänge mit den gewählten Filtern, unabhängig vom
Scope. Historische Prior-paid-Signale sind ausdrücklich `best_effort`. Sales- und
EU-Childdaten werden für die geladenen Eltern seitenweise gelesen; die Scans haben
25 Sekunden/100.000 Zeilen Budget und liefern bei Abbruch keine Teilvollständigkeit.
Design-Listen enthalten als `assetsPreview` markierte Vorschauen. Im Jobdetail sind
alle Assets über `assetOffset`/`assetLimit` und `assetsPagination.nextOffset` erreichbar.
Größere Seiten können weiter am Gateway-Zeit-/Antwortgrößenlimit scheitern.

Customer-Records-Suche/Inbox/Workboard und das Voice-Platform-Dashboard bleiben
begrenzte UI-Vorschauen. Vollständige Lesealternativen sind jetzt vorhanden:

- `customer_records_get`, `mode=requests`: Vorgänge mit `customerId`, `requestId`,
  `query`, `status`, `limit` (Standard 50, max. 100), `offset`; Kundenfilter greifen
  über den kanonischen Fremdschlüssel vor der Seite. `query` unterstützt auch
  `request:<externe ID>`, `deal:`, `ac:` und `trello:`.
- `customer_records_get`, `mode=history`, `requestId=<externe ID>` und `source`:
  `offers`, `orders`, `email_orders`, `sales`, `quotes`, `email_quotes`, `calls`,
  `voice_calls`, `followups`, `plans`, `documents`, `communications`, `quote_emails`,
  `outlook`, `outlook_organization`, `inbound_emails`, `audits`, `quote_versions`,
  `quote_version_images`, `related_customers`. Feste Feldprojektionen und
  kanonische Vorgangs-/Kontaktbindungen; die ausdrücklich benannte Firmen-Domain-
  Quelle ist weiter gefasst. `pagination.nextOffset=null` markiert das Ende;
  `available=false` bedeutet eine fehlende Quelle, keine leere Historie. Ein
  gemeinsames 25-Sekunden-Budget verhindert still abgebrochene Seiten.
- `voice_platform_get`, `collection=models|evaluations|prompts|campaigns|targets|attempts|outcomes|allowlist|consents`:
  `limit`/`offset`, max. 200, `pagination.nextOffset` und feste Filter je Sammlung
  (siehe `ops_describe`). Ohne `collection` bleibt das Dashboard unverändert.
- Billing-Spezialtools: Listen mit `limit`/`offset`; Detail-Events mit
  `eventLimit`/`eventOffset`; vollständige Fallhistorien mit
  `billing_list_case_records` über `collection=documents|changes|events|incidents|payments`, `limit`/`offset`.
  Das Seitenmaximum ist 200. Zustände und Kundennachrichten ändern diese Reads nicht.

Die Vorschauen sind keine Gesamtzählungen. Bei Änderungen während einer Enumeration
muss der Durchlauf neu gestartet werden; Offsets sind kein transaktionaler Snapshot.
Die KPI-Route aggregiert ihre definierten Quellen und bricht bei Unvollständigkeit ab.
Sie ersetzt keine der fachlichen Historien. Telefonteam ist weiter eine begrenzte
Verwaltungsübersicht (max. 50 Staff), kein universeller Identitäts-Export.

`ops_write` ist nicht pauschal idempotent. Einzelne kanonische Aktionen haben
Schlüssel, Versionsprüfungen oder atomare Claims; andere – etwa Notizen,
Outcome-Anlage, Visual-Webhook oder Aufgaben ohne `sourceRef` – nicht. Es gibt kein
generisches dauerhaftes Idempotenz-Ledger. Nach Timeout oder unklarem Ergebnis
zuerst den echten Zustand abgleichen; nicht blind mit einem neuen Schlüssel
wiederholen. Preview, angenommen, queued, teilweise ausgeführt und abgeschlossen
sind unterschiedliche Ergebnisse. Die Tests belegen die geprüften Gateway- und
Katalogverträge, keinen vollständigen Live-Schreibtest aller Geschäftsaktionen.

Das Audit protokolliert Identität, Tool, Objekt-/Pfadreferenzen, Ergebnis und einen
SHA-256-Fingerprint der Begründung. Es schreibt weder den vollständigen `reason`
noch Tokens oder Nutzdaten in den Auditdatensatz. Die Begründung ersetzt keine
fachliche Freigabe, Konfliktprüfung oder Transaktion.
