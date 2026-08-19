# Request Segmentation

Stand: 2026-08-19 (Phase-1-Sicherheitsvertrag; den tatsaechlichen Live-Stand immer ueber Migration-Health und aktive n8n-Version verifizieren)

Diese Doku beschreibt, wie neue Kundenanfragen bei NEONTRIP segmentiert werden, wo das Ergebnis sichtbar ist und wie ein Segment manuell bestaetigt oder korrigiert wird.

## Kurzfassung

- Die Segmentierung passiert auf Ebene der Anfrage, nicht erst spaeter in Trello.
- Postgres ist die Quelle der Wahrheit. Trello ist nur Projektion und wird fuer diese Entscheidung nicht als Wahrheit genutzt.
- Kanonischer n8n-Workflow: `ELpwCfdWOCRZ22gy` (`NEONTRIP Request Segmenter`); Name, aktive Version und Aktivierungszustand vor operativer Nutzung live verifizieren.
- Der KI-Agent darf ein Segment vorschlagen. Die Annahme passiert erst nach deterministischen Regeln.
- Im Policy-Modus `shadow` werden Klassifizierung und Job-Ergebnis gespeichert, aber niemals nach `master_requests` projiziert.
- Ein `needs_review`-Kandidat bleibt nur in `request_segment_classifications.segment`; er ist kein autoritatives Request-Segment.
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
7. Der Record-RPC speichert den Vorschlag in `request_segment_classifications`, schliesst den Job deterministisch ab und liefert `effective_status`, `effective_segment` sowie `projection` zurueck.
8. Nur ein akzeptiertes, aktuelles Ergebnis ausserhalb von `shadow` darf nach `master_requests` projiziert werden. `manual_*`-Segmente bleiben immer autoritativ.

Wichtig: Die Segmentierung findet also am Anfrage-Eingang statt. Sie ist nicht davon abhaengig, dass jemand spaeter eine Trello-Karte bearbeitet.

## Beteiligte Systeme

| System | Rolle |
| --- | --- |
| `master_requests` | Speichert Segment, Status, Confidence und Quelle |
| `request_segment_classifications` | Speichert KI-Kandidat, Evidenz, effektiven Validierungsstatus und Policy-Snapshot |
| `request_segmentation_jobs` | Speichert Queue-, Claim- und Abschlusszustand |
| n8n Workflow `ELpwCfdWOCRZ22gy` | Claimt Jobs, ruft KI auf, validiert und schreibt Ergebnis |
| OpenAI mit Web Search | Recherchiert Firmenkontext und schlaegt Segment als JSON vor |
| Customer Records Ops Portal | Zeigt Segment lesbar an und erlaubt manuelle Bestaetigung |
| `workflow_audit_log` | Protokolliert manuelle Overrides |
| Trello | Projektion/Arbeitskontext, nicht Quelle der Segment-Wahrheit |

## Datenfelder in `master_requests`

| Feld | Bedeutung |
| --- | --- |
| `segment` | Autoritativer Segment-Code, z. B. `NT-14`; kein Ablageort fuer ungepruefte Kandidaten |
| `s_kategorie` | operative Kategorie, z. B. `S2` |
| `segment_status` | Status der Klassifizierung |
| `segment_confidence` | Sicherheit der KI zwischen `0` und `1`; bei manueller Autoritaet `NULL` |
| `segment_source` | Quelle, z. B. `request_segmenter` oder `manual_ops_portal` |
| `segment_classified_at` | Zeitpunkt der Klassifizierung |
| `segment_policy_version` | Policy-/Prompt-Version |

## Segment-Status

| Status | Bedeutung |
| --- | --- |
| `accepted` | Segment wurde automatisch angenommen oder manuell bestaetigt |
| `needs_review` | Segment ist ein Vorschlag, muss geprueft werden |
| `rejected` | Ergebnis wurde verworfen |
| `error` | Klassifizierung ist technisch fehlgeschlagen; der zugehoerige Job hat Status `failed` |

Das Portal fordert zur Bestaetigung auf, wenn:

- kein Segment vorhanden ist,
- `segment_status` nicht `accepted` ist,
- oder die Quelle weder der kanonische `request_segmenter` noch `manual_*` ist.

Ein akzeptiertes `manual_*`-Segment gilt auch mit `segment_confidence = NULL` als bestaetigt. Die UI stellt menschliche Gewissheit nicht als Modell-Confidence dar.

## Phase-1-Authority-Vertrag

Der kanonische Record-RPC ist:

```text
neontrip_record_request_segment_classification(...)
```

Er liefert ein einzelnes JSON-Objekt mit:

```text
classification_id, job_id, request_id,
submitted_status, proposed_segment,
effective_status, effective_segment,
policy_version, policy_mode, job_status,
input_hash_current, research_cache_written,
projection.applied, projection.reason,
projection.authoritative_segment,
projection.authoritative_s_kategorie,
projection.authoritative_status,
projection.authoritative_source,
projection.manual_authoritative_preserved
```

`effective_segment` ist nur bei `effective_status = accepted` gesetzt. Bei `needs_review` bleibt der Kandidat in `proposed_segment` und der Klassifikationszeile. Ein geaenderter Request-/Customer-Input-Hash sowie blockierende Risk Flags (`conflicting_evidence`, `missing_external_company_evidence`, `prompt_injection_seen`, `freemail_business_unclear`, `missing_company_identity`) erzwingen `needs_review` und verhindern Projektion.

Im aktiven `shadow`-Modus gilt stets:

```text
projection.applied = false
projection.reason = policy_mode_shadow
research_cache_written = false
```

Fuer nachgelagerte Follow-up-/Pricing-Consumer ist pro Request ausschliesslich `neontrip_get_request_segmentation_automation_decision(master_requests.id)` massgeblich. Manuelle Autoritaet ist ein `accepted`-Request mit exakt gueltiger `manual_*`-Quelle und einer zur aktiven Policy-Rule passenden Segment-/S-Kombination. KI-Autoritaet verlangt dagegen `segment_source=request_segmenter`, die neueste Klassifikation fuer den aktuellen Input-Hash, `accepted`, Segment-/S-Match, aktive Classification-/Request-Policy und weiterhin das gespeicherte Automation-Playbook. Die globale Ein-Zeilen-View `request_segmentation_production_readiness` ist nur ein Readiness-Diagnostiksignal und ersetzt die Request-/Segmententscheidung nicht. Unknown, `needs_review` und fehlende Daten bleiben fail-closed.

`claim_followup_delivery_candidate` claimt nur Kandidaten, fuer die `neontrip_get_followup_queue_segmentation_decision(followup_queue.id).send_allowed = true` ist. Gesperrte Kandidaten werden uebersprungen und dabei weder geleast noch mutiert. Payment-Reminder-Ausschluss und bestehende Idempotenz bleiben erhalten.

## Research-Cache-Vertrag

- Freemail-, Shared-Provider- und Privacy-Relay-Domains werden deterministisch als nicht domain-cache-faehig markiert; entsprechende Domain-Keys werden weder gelesen noch geschrieben.
- Company-Name-Cache darf bei Freemail bestehen bleiben, aber nur wenn der KI-Firmenname normalisiert exakt mit der gespeicherten Kundenfirma uebereinstimmt.
- Cache-Writes sind nur fuer `effective_status = accepted`, starke Evidenz, eine verifizierte Website-Domain und eine Evidence-URL derselben Domain/Subdomain erlaubt.
- Cache-Writes sind nur in `followup_live` oder `pricing_live` erlaubt. `shadow`, Canary-, unbekannte und `NULL`-Modi schreiben nie.
- Cache-Reads akzeptieren nur nicht abgelaufene `ok`-Eintraege mit den Markern `effective_status=accepted`, `verified_company_identity=true` und `evidence_website_domain_verified=true`.
- `related_history` enthaelt hoechstens zehn neueste Requests desselben `master_customers`-Datensatzes; es gibt kein Cross-Customer-Matching allein ueber eine Maildomain.

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

- Wenn der autoritative Request-Status `accepted` ist und die Quelle kanonisch ist, bleibt der Button deaktiviert, solange kein anderes Segment gewaehlt wurde. Die UI leitet Authority nicht aus einem eigenen Confidence-Schwellwert ab.
- Wenn der KI-Vorschlag unsicher ist, erscheint der Hinweis `Bitte Segment pruefen und bestaetigen.`
- Wenn ein anderes Segment gewaehlt wird, wird der Button zu `Speichern`.
- Nach Speichern wird das Segment in Postgres als manuell bestaetigt geschrieben.

## Manuelle Bestaetigung/Korrektur

Beim Speichern im Portal wird die API-Action `set_request_segment` aufgerufen.

Codepfade:

- UI-Komponente: `src/app/ops/customer-records/page-client.tsx`
- API-Route: `src/app/api/ops/customer-records/actions/route.ts`
- Schreiblogik: `src/lib/ops/customer-records.ts`
- gemeinsamer RPC-Aufruf/Response-Validator: `src/lib/ops/manual-request-segment-rpc.ts`
- Segmentliste: `src/lib/ops/customer-segments.ts`

Die Schreiblogik ruft service-role-only atomar auf:

```text
neontrip_set_manual_request_segment(
  p_request_id, p_segment, p_source, p_actor, p_reason
)
```

`p_request_id` ist `master_requests.id` (UUID), nicht die sichtbare Request-/Trello-ID. `p_source` muss `manual_*` entsprechen; Portal und Import verwenden `manual_ops_portal` bzw. `manual_ops_import`. Der RPC setzt:

```text
segment = ausgewaehltes NT-Segment
s_kategorie = Standardwert des Segments
segment_status = accepted
segment_confidence = NULL
segment_source = manual_ops_portal
segment_policy_version = manual_override_v1_20260819
segment_classified_at = aktueller Zeitpunkt
commercial_playbook = {}
```

Im selben DB-Statement wird ein Audit-Eintrag geschrieben:

```text
workflow_audit_log.action = customer_request_segment_override
```

Wenn Update oder Audit fehlschlaegt, rollt die gesamte RPC-Transaktion zurueck.
Die App behandelt auch einen HTTP-200-Response als Fehler, wenn der RPC nicht den angeforderten Request/Segment/Source sowie `authoritative=true`, `accepted`, `segment_confidence=NULL`, gueltigen Audit-Identifier und die manuelle Policy-Version bestaetigt.

Der manuelle Import schreibt Requests zuerst immer neutral (`segment = NULL`, `s_kategorie = NULL`, `segment_status = pending`, keine Confidence/Quelle/Policy). Mockup-Kontext darf nur der Darstellung dienen. Nur ein explizit vom Operator gewaehltes `NT-*`-Segment wird anschliessend ueber denselben manuellen RPC autoritativ gesetzt; es gibt keinen heuristischen `accepted`-Fallback mehr. Der Insert friert Idempotenzschluessel, Payload-Hash und den nicht-autoritativen Segmentkandidaten in `attribution_raw` ein. Ein Retry mit geaendertem Payload oder Segment wird abgewiesen. Unter seinem Request-Row-Lock verweigert der RPC fuer `p_source=manual_ops_import` jedes Ueberschreiben einer bereits vorhandenen `manual_*`-Autoritaet; ein Race darf deshalb fehlschlagen, aber nie eine zwischenzeitliche Portal-Korrektur zurueckdrehen. `manual_ops_portal` bleibt der explizite Korrekturpfad und darf bestehende manuelle Autoritaet ersetzen. Fehlt noch der abschliessende Import-Audit, werden Contact-History, Call-Task und Audit idempotent nachgeholt, bevor die normale Trello-Projektion beginnt. Existiert der Core-Audit bereits, aber eine angeforderte Trello-Karte ist nicht nachweisbar, erfolgt wegen des unbekannten externen Ausgangs kein blinder Trello-Retry; der Import meldet stattdessen eine explizite manuelle Pruefung. Das Portal behaelt den Idempotenzschluessel fuer Fehler-Retries desselben unveraenderten Entwurfs bei. Jede Entwurfsaenderung, `Leeren` und ein bestaetigter Erfolg verwerfen den bisherigen Schluessel.

Gleichzeitige Imports mit demselben nichtleeren Schluessel werden atomar durch den partiellen Expression-Index `master_requests_manual_ops_import_idempotency_key_uidx` auf `master_requests` serialisiert. Er gilt nur fuer `form_id=manual_ops_import`; `NULL` und Leerwerte sind bewusst nicht reserviert, weil der kanonische App-Pfad immer einen nichtleeren Schluessel erzeugt. Die DB begrenzt diesen Schluessel fuer den Importpfad auf 512 Bytes, waehrend die App UUID-grosse Werte erzeugt. Verliert ein paralleler Insert die Unique-Race, darf er keine zweite Anfrage oder Trello-Projektion erzeugen; ein anschliessender unveraenderter Retry liest den bereits angelegten Request.

## Preapply-Check fuer Manual-Import-Idempotenz

Vor Anwendung der Migration diese PII-freie Aggregatabfrage ausfuehren:

```sql
with import_keys as (
  select nullif(btrim(attribution_raw->>'idempotency_key'), '') as idempotency_key
  from public.master_requests
  where form_id = 'manual_ops_import'
),
nonempty_keys as (
  select idempotency_key
  from import_keys
  where idempotency_key is not null
),
duplicate_keys as (
  select idempotency_key, count(*) as row_count
  from nonempty_keys
  group by idempotency_key
  having count(*) > 1
)
select
  (select count(*) from nonempty_keys) as nonempty_key_rows,
  (select count(*) from duplicate_keys) as duplicate_groups,
  coalesce((select sum(row_count - 1) from duplicate_keys), 0) as duplicate_extra_rows,
  coalesce((select max(octet_length(idempotency_key)) from nonempty_keys), 0) as max_key_bytes,
  to_regclass('public.master_requests_manual_ops_import_idempotency_key_uidx') is not null as target_index_exists;
```

Precondition: `duplicate_groups=0`, `duplicate_extra_rows=0`, `max_key_bytes<=512`; vor dem ersten Rollout ist `target_index_exists=false`, danach `true`. Die Migration prueft Duplikate und Laenge nochmals innerhalb ihrer aeusseren Transaktion und bricht ohne Teilanwendung ab.

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
node --import tsx --test \
  tests/quotes/manual-request-import.test.ts \
  tests/quotes/manual-request-segment-rpc.test.ts \
  tests/quotes/customer-records.test.ts \
  tests/quotes/request-segmentation-phase1-schema.test.ts
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
- Die deterministische Shared-Provider-Liste muss bei Provider-Drift nachgezogen werden. Cross-Customer-History ist davon unabhaengig immer gesperrt; Cache-Reuse verlangt zusaetzlich die verifizierten Company-/Evidence-Marker.
- Das Portal nutzt eine statische Segmentliste aus dem Code. Wenn `segment_definitions` in der Datenbank geaendert wird, muss die UI-Liste nachgezogen werden.
- Die manuelle Bestaetigung veraendert echte Produktionsdaten in `master_requests`.
- Phase 1 fuehrt bewusst kein Bulk-Cleanup und kein Backfill aus. Historische pending `NT-8`/`NT-9`-Fallbacks und alte Shared-Provider-Cachezeilen werden nicht geloescht; neue Enqueues/Reads/Writes behandeln sie fail-closed.

## Rollback

Der vollstaendige lokale Prechange-Snapshot liegt unter `supabase/security-backups/request-segmentation-phase1-prechange-20260819.sql`. Er stellt Funktionsdefinitionen und ACLs in einer Transaktion wieder her, entfernt den Phase-1-Idempotenzindex samt Laengen-Constraint und enthaelt nur sichere Aggregatzustaende, keine Kundenzeilen oder PII.

App-Rollback:

- Den exakten freigegebenen Phase-1-App-Commit commitbasiert zuruecknehmen; bestehende API-Action und Segmentliste bleiben erhalten.
- Danach dieselben fokussierten Tests und den normalen Deploy-Preflight ausfuehren. Ein Git-Revert allein ist noch kein Runtime-Nachweis.

Daten-Rollback fuer einzelne Anfrage:

- Keine direkten oder partiellen Updates an `master_requests` ausfuehren. Nur `segment` zurueckzusetzen wuerde `s_kategorie`, Status, Confidence, Quelle, Policy, Zeitpunkt und Playbook in einem widerspruechlichen Autoritaetszustand lassen und den neuen Eingriff nicht auditieren.
- Wenn fachlich lediglich das vorherige Segment erneut gesetzt werden soll, den Fall im Portal oeffnen und den kanonischen auditierten Manual-RPC ueber die normale Segment-Aktion ausloesen. Der RPC leitet die vollstaendige autoritative Feldkombination erneut deterministisch ab.
- Eine historische Vollwiederherstellung aller vorherigen Felder ist eine separate Produktionsaenderung. Sie braucht eine ausdrueckliche Freigabe, den belegten vollstaendigen Vorzustand, eine atomare Transaktion und einen neuen Audit-Eintrag; `previous_segment` allein reicht dafuer nicht aus.

Workflow-Rollback:

- Den vor dem n8n-Write exportierten vollstaendigen Workflow-Backup als Quelle nehmen und nur den geprueften Reverse-Diff auf die zuvor aktive Version anwenden.
- Aktivierungszustand, Credentials-Referenzen, Nodes und Connections vor/nach dem Write vollstaendig diffen; danach mit einem internen, nicht kundenwirksamen Nachweis pruefen.

Rollout-Nachweis:

- DB-Migration vorhanden und die erwarteten Funktionsdefinitionen/ACLs aktiv.
- `request_segmentation_production_readiness` weiterhin fail-closed, solange keine getrennte Aktivierungsfreigabe vorliegt.
- Aktive n8n-Version und Record-RPC-Response-Format gegen diesen Vertrag pruefen.
- Kein echter Kunde dient als Canary.
