# Request Segmentation

Stand: 2026-05-21

Diese Doku beschreibt, wie neue Kundenanfragen bei NEONTRIP segmentiert werden, wo das Ergebnis sichtbar ist und wie ein Segment manuell bestaetigt oder korrigiert wird.

## Kurzfassung

- Die Segmentierung passiert auf Ebene der Anfrage, nicht erst spaeter in Trello.
- Postgres ist die Quelle der Wahrheit. Trello ist nur Projektion und wird fuer diese Entscheidung nicht als Wahrheit genutzt.
- Der n8n-Workflow `NEONTRIP Request Segmenter v1.0 (SHADOW - scheduled active)` ist aktiv.
- Workflow-ID: `ELpwCfdWOCRZ22gy`
- Der KI-Agent darf ein Segment vorschlagen. Die Annahme passiert erst nach deterministischen Regeln.
- Das Ops-Portal zeigt das Segment als Klartext, z. B. `Immobilien`, nicht nur als Code `NT-14`.
- Im Portal kann das Segment per Dropdown manuell bestaetigt oder korrigiert werden.
- Wenn die KI unsicher ist, fordert das Portal zur Pruefung auf.

## Warum das so gebaut ist

Die Segmentierung soll direkt bei neuen Anfragen nutzbar sein, damit spaetere Prozesse nicht auf unsegmentierten Leads aufbauen.

Gleichzeitig darf die KI nicht ungeprueft operative Wahrheit schreiben. Darum gilt:

- KI recherchiert und klassifiziert.
- Der Workflow validiert das Ergebnis.
- Postgres speichert Status, Confidence und Quelle.
- Menschen koennen im Portal bestaetigen oder korrigieren.
- Jede manuelle Aenderung wird auditiert.

Das folgt der internen Regel: AI proposes, deterministic logic executes.

## Wann Segmentierung passiert

1. Eine neue Anfrage landet in `master_requests`.
2. Ein DB-Trigger legt einen Segmentierungsjob an.
3. Der n8n-Workflow laeuft planmaessig jede Minute.
4. Der Workflow claimt genau einen offenen Job.
5. Der KI-Agent klassifiziert die Anfrage anhand der vorhandenen Anfrage- und Kontaktdaten.
6. Wenn die Anfrage B2B wirkt oder eine Firmen-Domain hat, muss externe Web-Evidenz vorhanden sein.
7. Der Workflow schreibt das Ergebnis in `master_requests`.

Wichtig: Die Segmentierung findet also am Anfrage-Eingang statt. Sie ist nicht davon abhaengig, dass jemand spaeter eine Trello-Karte bearbeitet.

## Beteiligte Systeme

| System | Rolle |
| --- | --- |
| `master_requests` | Speichert Segment, Status, Confidence und Quelle |
| n8n Workflow `ELpwCfdWOCRZ22gy` | Claimt Jobs, ruft KI auf, validiert und schreibt Ergebnis |
| OpenAI mit Web Search | Recherchiert Firmenkontext und schlaegt Segment als JSON vor |
| Customer Records Ops Portal | Zeigt Segment lesbar an und erlaubt manuelle Bestaetigung |
| `workflow_audit_log` | Protokolliert manuelle Overrides |
| Trello | Projektion/Arbeitskontext, nicht Quelle der Segment-Wahrheit |

## Datenfelder in `master_requests`

| Feld | Bedeutung |
| --- | --- |
| `segment` | Segment-Code, z. B. `NT-14` |
| `s_kategorie` | operative Kategorie, z. B. `S2` |
| `segment_status` | Status der Klassifizierung |
| `segment_confidence` | Sicherheit der KI, meist zwischen `0` und `1` |
| `segment_source` | Quelle, z. B. `request_segmenter` oder `manual_ops_portal` |
| `segment_classified_at` | Zeitpunkt der Klassifizierung |
| `segment_policy_version` | Policy-/Prompt-Version |

## Segment-Status

| Status | Bedeutung |
| --- | --- |
| `accepted` | Segment wurde automatisch angenommen oder manuell bestaetigt |
| `needs_review` | Segment ist ein Vorschlag, muss geprueft werden |
| `rejected` | Ergebnis wurde verworfen |
| `failed` | Klassifizierung ist technisch fehlgeschlagen |

Das Portal fordert zur Bestaetigung auf, wenn:

- kein Segment vorhanden ist,
- `segment_status` nicht `accepted` ist,
- oder `segment_confidence < 0.75` ist.

## Aktive Segmente

| Code | Label | Standard-`s_kategorie` |
| --- | --- | --- |
| `NT-1` | Ladenbauer | `S2` |
| `NT-2` | Gastronomie | `S3` |
| `NT-3` | Event/Messe | `S1` |
| `NT-4` | Werbeagentur | `S2` |
| `NT-5` | Franchise | `S2` |
| `NT-6` | Konzern | `S2` |
| `NT-7` | Film/TV | `S1` |
| `NT-8` | Privat | `S3` |
| `NT-9` | Kleine Firma | `S3` |
| `NT-10` | Behoerde/oeffentliche Hand | `S4` |
| `NT-11` | Architekt/Innenarchitektur | `S2` |
| `NT-12` | Creator/Influencer | `S3` |
| `NT-13` | Praxen/Medical | `S4` |
| `NT-14` | Immobilien | `S2` |
| `NT-15` | Fitness | `S3` |
| `NT-16` | Recruiting/Employer Branding | `S2` |
| `NT-17` | Startup | `S3` |
| `NT-18` | Luxus/Premium Retail | `S4` |

Die UI-Optionen liegen in:

- `src/lib/ops/customer-segments.ts`

## Wie die KI entscheiden soll

Der Agent nutzt Anfrage, E-Mail-Domain, Firma und bei nicht-privaten Domains Web-Recherche.

Beispiele:

- `gmail.com`, `web.de`, `gmx.de` ohne Firmenhinweis: eher `Privat`.
- Restaurant, Bar, Cafe, Hotel, Club: eher `Gastronomie`.
- Messebau, Eventagentur, Ausstellung, Standbau: eher `Event/Messe`.
- Immobilienmakler, Anlagekonzepte, Property, Real Estate: eher `Immobilien`.
- Werbeagentur, Designagentur, Brandingagentur: eher `Werbeagentur`.

Wenn eine Firma oder Firmen-Domain vorhanden ist, soll externe Evidenz genutzt werden. Wenn diese Evidenz fehlt oder nicht eindeutig ist, muss das Ergebnis `needs_review` bleiben.

## Customer Records Portal

URL lokal:

```text
http://127.0.0.1:3103/ops/customer-records
```

Im Fallkopf sieht man:

- `Segment: Immobilien`
- darunter Details wie `NT-14 - S2 - bestaetigt - 85% sicher`
- ein Dropdown `Segment waehlen`
- einen Button `Bestaetigen` oder `Speichern`

Verhalten:

- Wenn der KI-Vorschlag sicher genug ist, ist der Button deaktiviert, solange kein anderes Segment gewaehlt wurde.
- Wenn der KI-Vorschlag unsicher ist, erscheint der Hinweis `Bitte Segment pruefen und bestaetigen.`
- Wenn ein anderes Segment gewaehlt wird, wird der Button zu `Speichern`.
- Nach Speichern wird das Segment in Postgres als manuell bestaetigt geschrieben.

## Manuelle Bestaetigung/Korrektur

Beim Speichern im Portal wird die API-Action `set_request_segment` aufgerufen.

Codepfade:

- UI-Komponente: `src/app/ops/customer-records/page-client.tsx`
- API-Route: `src/app/api/ops/customer-records/actions/route.ts`
- Schreiblogik: `src/lib/ops/customer-records.ts`
- Segmentliste: `src/lib/ops/customer-segments.ts`

Die Schreiblogik setzt:

```text
segment = ausgewaehltes NT-Segment
s_kategorie = Standardwert des Segments
segment_status = accepted
segment_confidence = 1
segment_source = manual_ops_portal
segment_policy_version = manual_override_v1_20260521
segment_classified_at = aktueller Zeitpunkt
```

Zusatzlich wird ein Audit-Eintrag geschrieben:

```text
workflow_audit_log.action = customer_request_segment_override
```

Wenn der Audit-Eintrag fehlschlaegt, wird die Datenbank-Aenderung am Request wieder zurueckgesetzt.

## Wie man es benutzt

1. Customer Records Portal oeffnen.
2. Anfrage per Request-ID, E-Mail, Name, Telefon, Deal-ID oder Trello-Link suchen.
3. Im Fallkopf das Segment lesen.
4. Wenn der Hinweis zur Pruefung erscheint, Dropdown kontrollieren.
5. Falls richtig: `Bestaetigen`.
6. Falls falsch: richtiges Segment im Dropdown waehlen und `Speichern`.

Beispiel:

```text
Request-ID: a78f4f09-eef8-4f4e-b241-8b7d357140ef
Anzeige: Segment: Immobilien
Detail: NT-14 - S2 - bestaetigt - 85% sicher
```

## Tests nach Aenderungen

Nach Code-Aenderungen:

```bash
npm run build
```

Lokale App starten:

```bash
/Users/danielklesse/Desktop/NEONTRIP\ Customer\ Records.command
```

API-Smoke-Test:

```bash
curl -sS "http://127.0.0.1:3103/api/ops/customer-records?query=<request_id>"
```

Browser-Checks:

- Desktop: Fall laden, Segment sichtbar, Dropdown sichtbar, Button sichtbar.
- Mobile: Fall laden, Segment sichtbar, Dropdown sichtbar, Button sichtbar.
- Kein Speichern auf echten Kunden nur fuer Testzwecke, ausser der Override ist fachlich gewollt.

Zuletzt verifizierter Smoke-Test:

```text
Desktop: Segment: Immobilien, 1 Dropdown, 1 Button, keine Browserfehler
Mobile: Segment: Immobilien, 1 Dropdown, 1 Button, keine Browserfehler
```

## Bekannte Grenzen

- Der n8n-Workflow claimt aktuell einen Job pro Lauf. Das ist bewusst vorsichtig, kann aber bei Rueckstau langsam sein.
- Web-Recherche kann falsch oder unvollstaendig sein. Darum bleiben unsichere Faelle auf `needs_review`.
- Das Portal nutzt eine statische Segmentliste aus dem Code. Wenn `segment_definitions` in der Datenbank geaendert wird, muss die UI-Liste nachgezogen werden.
- Die manuelle Bestaetigung veraendert echte Produktionsdaten in `master_requests`.

## Rollback

Code-Rollback:

- Portal-UI-Aenderungen in `page-client.tsx` zuruecknehmen.
- API-Action `set_request_segment` aus `actions/route.ts` entfernen.
- Funktion `setCustomerRequestSegment` aus `customer-records.ts` entfernen.
- `customer-segments.ts` nur entfernen, wenn keine andere Stelle sie nutzt.

Daten-Rollback fuer einzelne Anfrage:

- Im `workflow_audit_log` den letzten Eintrag mit `action = customer_request_segment_override` suchen.
- Dort stehen `previous_segment` und `next_segment` in den Metadaten.
- `master_requests` fuer diese `request_id` wieder auf `previous_segment` setzen.

Workflow-Rollback:

- Keine Portal-Aenderung direkt im n8n-Workflow rueckgaengig machen.
- Vor Workflow-Aenderungen immer Backup exportieren.
- Workflow `ELpwCfdWOCRZ22gy` nur mit Backup, Diff und klarer Rueckfalloption aendern.
