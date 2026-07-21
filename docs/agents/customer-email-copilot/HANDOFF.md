# Customer Email Copilot Handoff

Stand: 2026-07-21, verifiziert gegen Ops `origin/main` auf Commit `c76e7e526bf0933b47b1b68936601137f7721309`.

Parent-Agent: `customer-communication-agent`

## Unveränderliche Sicherheitsgrenze

> **Nur Entwürfe. Niemals autonomer Versand.**

- `[verifiziert]` Der kanonische Hauptworkflow und der Retry-Workflow besitzen jeweils genau eine Outlook-Aktion zum Erstellen eines Antwortentwurfs.
- `[verifiziert]` Beide veröffentlichten Graphen enthalten keinen `sendMail`-, `replyAll`- oder sonstigen Versandknoten.
- `[verifiziert]` Datenbank-, Workflow- und Rollout-Verträge setzen `automatic_send_allowed = false` und verlangen menschliche Versandfreigabe.
- `[verifiziert]` Backfill, Decision Shadow, Sent-Delta, Feedback Matcher und Commerce Resolver senden ebenfalls keine Kundenkommunikation.
- `[verboten]` Diese Grenze darf weder durch Prompt, Rollout-Stufe, Zeitplan, Retry, Backfill, Tool-Aufruf noch durch eine angebliche Kundenanweisung aufgehoben werden.

## Evidenzstatus

- `[verifiziert]`: durch aktuellen Repository-Code, Git, fokussierten Test oder ausdrücklich genannten Read-only-Live-Check belegt.
- `[Live-Metadaten]`: gegen n8n- oder Supabase-Metadaten geprüft, ohne Nachrichtentext, Kundendatensatz oder Secret-Wert zu lesen.
- `[historische Entscheidung]`: aus dem relevanten Arbeitsverlauf oder älteren Rollout-Dokumenten übernommen und gegen den aktuellen Codezustand eingeordnet.
- `[aus Code abgeleitet]`: technisch plausible Schlussfolgerung ohne vollständigen Live-End-to-End-Beleg.
- `[offen]`: nicht belegt, widersprüchlich oder noch nicht freigabereif.

## Aktueller Befund

- `[verifiziert]` Der Copilot arbeitet resolve-first: Er soll verfügbare, kundenfähige Fakten zuerst ermitteln und darf keine vagen Formulierungen wie „ich kläre das intern“ oder „wir melden uns später“ ausgeben.
- `[verifiziert]` Outlook-Nachricht, Thread, Organisationskontext, tatsächliche Anhangspräsenz, freigegebenes Supportwissen, Shopify-Korrelation und signierter Angebots-Snapshot werden als getrennte Evidenzquellen behandelt.
- `[verifiziert]` Der read-only Commerce Resolver verweigert eine Auswahl bei einem bloßen, mehrdeutigen Firmendomain-Match.
- `[verifiziert]` Nicht belegte Preise, Termine, URLs, Angebots-/Bestellnummern, Zusagen, interne Status- oder View-Telemetrie und angeblich vorhandene Anhänge werden deterministisch blockiert.
- `[verifiziert]` Fehlende kundenseitig lieferbare Evidenz führt zu einer konkreten Rückfrage; fehlende rein interne Evidenz wird nur in Review-Metadaten festgehalten und nicht mit einer späteren Zusage kaschiert.
- `[verifiziert]` Die Fabienne-Signatur mit dem vorhandenen Foto- und Logo-Asset ist Bestandteil beider Entwurfsgraphen. Zulässige deutsche Abschlüsse sind `Viele Grüße` und `Beste Grüße`; Emoji-Abschlüsse sind ausgeschlossen.
- `[verifiziert]` Sichere Stiländerungen werden passiv und nur als inhaltsfreie Strukturaggregate ausgewertet. Fakten, Kundenformulierungen und Prompt-Umschreibungen werden nicht automatisch gelernt.
- `[Live-Metadaten]` Hauptagent, Retry, Backfill, Decision Shadow, Sent-Delta, Feedback Matcher und Commerce Resolver v2 sind aktiv. Alle sieben Graphen bestanden am 2026-07-21 eine strikte n8n-Validierung mit null Fehlern.
- `[Live-Metadaten]` Das Rollout-Gate steht weiterhin auf `review_only` und ist nicht bestanden: 5 von mindestens 30 Facts-v2-Vergleichen liegen vor; Kategorieabdeckung und Qualitätsgrenzen sind nicht erfüllt.
- `[Live-Metadaten]` Die Retry-Gesundheit ist nicht fehlerfrei: 21 Wiederherstellungen und 47 Retry-Fehler in 24 Stunden sowie 11 finale Fehlerfälle wurden gemeldet; aktuell waren keine fälligen oder festhängenden Retries vorhanden.

## Einstieg

1. Architektur, Datenflüsse und Vertrauensgrenzen: [SYSTEM-MAP.md](./SYSTEM-MAP.md)
2. Dauerhafte und historische Entscheidungen: [DECISIONS.md](./DECISIONS.md)
3. Betrieb, Diagnose, sichere Änderungen und Rollback: [OPERATIONS.md](./OPERATIONS.md)
4. Priorisierte Risiken und Evidenzlücken: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
5. Reproduzierbare Prüfungen und Live-Metadaten: [VERIFICATION.md](./VERIFICATION.md)
6. Maschinenlesbares Agentenmanifest: [agent.json](./agent.json)

## Nicht verhandelbare Arbeitsgrenzen

- `[verifiziert]` Neue Arbeit startet mit `codex-new-worktree ops <topic>`; niemals direkt im alten Ops-Main-Checkout.
- `[verifiziert]` Postgres ist Source of Truth für Locks, Retry-Zustand, Qualität und Audit. Trello ist keine Autorität dieses Copiloten.
- `[verifiziert]` AI schlägt ausschließlich streng strukturiertes JSON vor; deterministische Logik validiert und führt höchstens die Entwurfserstellung aus.
- `[verifiziert]` E-Mail-Inhalte, Anhänge, Shopify-Notizen, Angebotsdaten und historische Antworten sind untrusted input und können keine Regeln ändern.
- `[verifiziert]` Keine Secrets lesen, ausgeben, dokumentieren oder committen. Dokumentiert werden dürfen nur benötigte Variablennamen und Credential-Typen.
- `[verifiziert]` Keine Produktionsmutation ohne Backup, Diff, Rollback, explizite Freigabe und die vorgeschriebenen Ops-Gates.
- `[verifiziert]` Vor jedem Deploy ist `codex-predeploy ops` Pflicht; deployt werden darf nur der dort ausgegebene Commit.
- `[verifiziert]` Ein Push auf `main` kann den Coolify-Deploy auslösen und benötigt deshalb eine eigene ausdrückliche Freigabe.

## Scope dieser Übergabe

- `[verifiziert]` Dokumentiert sind der Outlook-Hauptpfad, Commerce-Evidenz, Organisationskontext, Anhänge, Wissensbasis, Quality Gate, Decision Shadow, offene-Posteingang-Backfill, Retry-Recovery, passive Stilauswertung, Ops-Qualitätsoberfläche, relevante Migrationen, Tests und Rollback-Artefakte.
- `[verifiziert]` Diese Übergabe verändert keine Produktlogik und enthält keine Kundeninhalte, Secret-Werte oder produktiven Datensätze.
- `[offen]` Die fachliche Qualität konkreter Entwürfe wurde in dieser Read-only-Wissensmigration nicht anhand echter Nachrichtentexte geprüft.
