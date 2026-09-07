# NEONTRIP Operations MCP

Sicherer Streamable-HTTP-MCP-Gateway für die NEONTRIP Rechnungs-OPS und Angebotssoftware. Der Gateway enthält bewusst keinen freien HTTP-Proxy, keinen Datenbankzugang, keine Shell und keinen Dateisystemzugriff. Jede Funktion ist als eigenes MCP-Tool mit festem Ziel, strengem Eingabeschema, Scope und dokumentierten Nebenwirkungen registriert.

## Identitäten und Rechte

- `billing_automation`: nur Systemstatus, Rechnungen lesen und risikoarme Rechnungsänderungen annehmen. Identitäts-, Länder-, Steuer-, Umsatzsteuer-ID- und Betragsänderungen werden serverseitig blockiert. Ablehnen, Entwürfe bearbeiten, Finanzaktionen, Angebote ändern und E-Mails senden sind für diese Identität technisch nicht vorhanden.
- `operator`: breite fachliche Rechte für Rechnungs-OPS und Angebote. Auch hier gibt es keinen Rohzugriff auf Datenbank, Server oder beliebige URLs.

Tokens werden nur als SHA-256-Hash konfiguriert, zeitlich befristet und in konstanter Zeit verglichen. Für Produktion gehört der nur auf Loopback gebundene Dienst hinter HTTPS beziehungsweise einen privaten Tunnel. Die Upstream-Zugänge sind getrennte Dienstidentitäten; Logs enthalten weder Tokens noch Nutzdaten.

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

Die Readiness-Route meldet erst Erfolg, wenn alle in `MCP_REQUIRED_SERVICES` genannten Systeme vollständig konfiguriert sind. Das authentifizierte MCP-Tool `neontrip_health` prüft zusätzlich die echten Leseverbindungen.

## Produktionsfreigabe

Vor dem Aktivieren sind eine eigene Cloudflare-Access-Service-Identität für OPS, ein eigener Offers-API-Schlüssel, getrennte und ablaufende MCP-Tokens sowie Alarmierung auf fehlgeschlagene Healthchecks einzurichten. Die ChatGPT-Work-Automation verwendet ausschließlich die `billing_automation`-Identität. Für manuelle Codex-Aufgaben wird separat die `operator`-Identität verbunden.
