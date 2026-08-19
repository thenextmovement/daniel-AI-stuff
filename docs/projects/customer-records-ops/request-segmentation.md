# Request Segmentation

Stand: 2026-08-19 (Phase-2-CX8 als getrennten Shadow-Vertrag vorbereitet; den tatsaechlichen Live-Stand immer ueber aktive DB-Policy und aktive n8n-Version verifizieren)

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

## Phase 2: versionierter CX8-Shadow-Vertrag

Phase 2 ersetzt historische Segmentbedeutungen nicht. Die bisherigen 18 Definitionen, Klassifikationen, Gold-Labels und Master-Werte bleiben unveraendert. Ein wiederverwendeter `NT-*`-Code hat die neue Bedeutung nur zusammen mit:

```text
taxonomy_version = nt_taxonomy_v2_20260819_cx8
classifier_version = segment_classifier_v3_20260819_cx8
prompt_version = segment_prompt_v4_20260819_cx8
policy_version = nt_policy_v2_20260819_cx8_shadow
```

Die Hauptmigration legt v2 bewusst `active=false` an und laesst v1 aktiv. Erst das getrennte, nicht automatisch angewandte Held-Artefakt `supabase/rollouts/held/20260819193419_activate_request_segmentation_phase2_cx8_shadow.sql` darf nach App- und n8n-v3-Rollout atomar v1 deaktivieren und v2 aktivieren. Es prueft davor das exakte Taxonomie-/Evidence-/Gate-Triple und blockiert, solange noch ein unversionierter Legacy-Job in `pending`, `processing` oder als erneut claimbarer `failed`-Retry (`attempts < max_attempts`) steht; terminal ausgeschoepfte Fehler bleiben Audit-Historie. Release Ops muss die claimbaren Faelle vorher bewusst drainen oder aufloesen. Transaktionsgebundene Locks auf Policy und Jobtabelle schliessen die Enqueue-/Claim-Luecke zwischen Drain-Check und Flip. Auch danach bleibt die Policy im Modus `shadow`; alle acht Rules haben `automation_enabled=false`, keinen Preisfaktor und keine Follow-ups.

### Primaere CX8-Segmente

| Prioritaet | Code | Primaere Customer-Experience-Rolle | S | Pflicht-Evidence-Code |
| ---: | --- | --- | --- | --- |
| 100 | `NT-10` | Institution / oeffentliche Hand | `S4` | `verified_public_or_institutional_entity` |
| 90 | `NT-1` | Laden-/Messebau-Produktionspartner | `S2` | `verified_physical_project_supplier` |
| 80 | `NT-4` | Agentur / Planer / Reseller | `S2` | `verified_client_project_intermediary` |
| 70 | `NT-3` | Event-/Medienproduktion | `S1` | `verified_event_or_media_operator` |
| 60 | `NT-5` | Franchise / Multi-Site | `S2` | `verified_multisite_or_franchise` |
| 50 | `NT-6` | Enterprise | `S2` | `verified_enterprise` |
| 40 | `NT-8` | Privat | `S3` | `explicit_private_use` |
| 30 | `NT-9` | Direktes kleines/mittleres Unternehmen | `S3` | `verified_direct_business` |

Die Prioritaet bricht nur einen Gleichstand zwischen mehreren positiv belegten Kandidaten. Sie erzeugt nie einen Fallback. `NT-2`, `NT-7` und `NT-11` bis `NT-18` bleiben als historische Codes sichtbar, sind aber keine neuen CX8-Entscheidungen. Ihre vertikalen Informationen koennen als nicht-autoritative Context-Tags weiterleben: `gastronomy_hospitality`, `film_tv`, `architecture_interior`, `creator_influencer`, `healthcare`, `real_estate`, `fitness_wellness`, `recruiting_employer_branding`, `startup_tech`, `luxury_premium_retail`.

### Evidenz und Fail-Closed-Regeln

- Jeder angenommene non-private Vorschlag braucht den exakten Segment-Evidence-Code auf demselben `p_evidence_json`-Objekt und derselben URL wie eine validierte `evidence_provenance.verified_sources`-Quelle.
- `NT-10` akzeptiert den positiven Code nur mit `used_for=institution_status`; `NT-1/3/4/5/6/9` nur mit `used_for=segment_role`.
- `NT-5` und `NT-6` brauchen zusaetzlich separate verifizierte `organization_scale`-Evidence. `NT-6` ist nur bei `organization_scale=enterprise` zulaessig.
- `NT-8` verlangt die exakte First-Party-Formularwahl `customer_type=privat`; Freemail, Design, Preis oder fehlende Firma beweisen niemals Privatnutzung.
- `NT-9` verlangt die exakte First-Party-Auswahl `gewerblich|b2b` plus externe Rollen-Evidence; es ist kein Business-Fallback.
- Unbekannte, widerspruechliche, semantisch falsch verwendete oder nicht quellgebundene Evidenz endet in `needs_review`.

### Queue- und Cutover-Vertrag

Der Claim-RPC hat einen einzigen erweiterten Vertrag:

```text
neontrip_claim_request_segmentation_jobs(
  p_limit,
  p_lock_owner,
  p_stale_minutes,
  p_taxonomy_version default NULL,
  p_classifier_version default NULL,
  p_prompt_version default NULL
)
```

Alle drei Versionsfilter sind entweder `NULL` (v1-Lane) oder exakt gesetzt (v3-Lane). Partielle Filter schlagen deterministisch fehl. Vor Aktivierung bekommt v3 mit dem exakten CX8-Triple keine Jobs. Ein ueber einen Policy-Flip hinweg laufender Job wird im Record-RPC als `segmentation_job_active_contract_mismatch` technisch beendet, ohne Klassifikation, Master- oder Cache-Write.

Normale und Gold-Evaluation-Enqueues teilen denselben versionierten Job-Key. `evaluation_only=true` ist sticky und kann durch einen normalen Enqueue weder waehrend `processing` noch nach Abschluss still in Projektionsautoritaet umgewandelt werden. Evaluation-Jobs duerfen Klassifikation/Job abschliessen, aber niemals `master_requests` oder Research-Cache schreiben.

Ein CX8-Research-Cache-Write persistiert ausschliesslich externe Evidence-Objekte, deren `evidence_code`, `used_for`, URL und Source-Bindung denselben deterministischen Record-Guard bestanden haben. `summary_json` traegt das exakte Taxonomie-/Classifier-/Prompt-Triple, `evidence_contract_valid=true` und den erforderlichen Evidence-Code. Der Payload liest unter v2 nur Cachezeilen mit exakt diesem aktiven Triple und nichtleerem validiertem Evidence-Array; der unversionierte v1-Read bleibt bis zum Flip unveraendert.

### Manuelle Authority und Gold

Waehren des gestuften Rollouts bleibt die Manual-RPC-Signatur unveraendert. Der neue Client setzt in `p_actor` exakt:

```json
{"segmentTaxonomyVersion":"nt_taxonomy_v2_20260819_cx8"}
```

Nur dann validiert der RPC gegen die acht CX8-Definitionen und setzt `master_requests.segment_taxonomy_version` atomar. Markerlose alte Clients duerfen nur solange v1 aktiv ist den bisherigen 18-Code-Vertrag nutzen. Nach dem Flip schlagen markerlose Writes fail-closed fehl. Historische manuelle Rows ohne CX8-Taxonomie bleiben Anzeige, aber autorisieren keine v2-Automation, bis ein Mensch sie explizit erneut bestaetigt.

Ein Manual-Override erzeugt nie Gold. Gold entsteht ausschliesslich ueber `neontrip_adjudicate_request_segmentation_gold` fuer den aktuell gelockten Request-/Customer-Input-Hash. Es ist insert-once: identischer Retry ist idempotent, abweichender Retry ist ein Konflikt; UPDATE und DELETE sind gesperrt. Non-`NT-8` braucht mindestens eine gueltige externe Evidence-URL. Fuer gate-faehiges Gold gelten zusaetzlich: `NT-8` immer `privat` und Scale `NULL`, `NT-9` immer `gewerblich|b2b`, `NT-5` Scale non-null, `NT-6` Scale exakt `enterprise`. Kanonische Limits: Actor 3..320, Reason 20..4000, hoechstens zehn Context-Tags und zwoelf Evidence-URLs mit je maximal 2048 Zeichen.

Der service-role-only Review-Vertrag `neontrip_get_request_segmentation_review_context` liefert den gelockten aktuellen Hash, nur den exakten CX8-v3-Vorschlag, das aktuelle immutable Gold und `gold_eligibility`; er mischt keine globale latest-v1-Klassifikation hinein.

### Qualitaets-Gate

Die `request_segmentation_v2_*`-Views verwenden je Request nur die neueste explizite immutable Adjudikation und joinen sie mit der Vorhersage ausschliesslich auf Request, Input-Hash, Taxonomie, Klassifikator und Prompt. Mehrere historische Input-Versionen desselben Requests koennen das Gate daher nicht aufblasen. Precision wird pro vorhergesagter angenommener Klasse, Recall pro tatsaechlicher Gold-Klasse berechnet; Abstentions senken Recall und Coverage, aber werden nicht als falsche Mapping-Zeilen gezaehlt.

Der versionierte Gate-Default lautet:

- mindestens 300 eindeutige adjudizierte Requests insgesamt und 25 je aktivem CX8-Code;
- Precision je vorhergesagter Klasse mindestens `0.90`, fuer `NT-8`/`NT-10` mindestens `0.95`;
- Recall je tatsaechlicher Klasse mindestens `0.85`;
- angenommene Coverage mindestens `0.80`;
- Mapping-Integritaet angenommener Predictions exakt `1.0`;
- null angenommene Evidence-Provenance-Verstoesse;
- selbst nach bestandenem technischen Gate weiterhin explizite, zeitlich begrenzte manuelle Aktivierungsfreigabe.

### Rollback

- Vor jeglicher v2-Runtime darf ein exakter Schema-Restore ueber `supabase/rollbacks/20260819183219_request_segmentation_phase2_full_pre_runtime_rollback.sql` nur erfolgen, wenn versionierte Jobs, Klassifikationen, Gold, Master-Authority und Approvals jeweils `0` Rows haben, v1 allein aktiv und v2 inaktiv ist. Das Artefakt enthaelt die exakt am 2026-08-19 live erfassten Phase-1-Funktionsdefinitionen/ACLs und stellt die beiden alten Unique-Constraints wieder her. Der PII-freie Prestate liegt in `supabase/security-backups/request-segmentation-phase2-prechange-20260819.sql`.
- Nach der ersten v2-Runtime ist nur der nicht-destruktive operative Rollback `supabase/rollbacks/20260819193419_request_segmentation_phase2_operational_rollback.sql` zulaessig. Exakte Reihenfolge: bereits laufende `processing`-v2-Jobs drainen (das SQL bricht sonst fail-closed ab), dann mit diesem SQL atomar v2 inaktiv/v1 aktiv schalten, danach einen Claim mit dem exakten v3-Taxonomie-/Classifier-/Prompt-Triple ausfuehren und das leere Ergebnis `[]` verifizieren; erst danach den n8n-Reverse auf v1 publishen. Pending/failed CX8-Jobs bleiben auditierbar suspendiert; additive Spalten sowie alle v3-/Gold-Auditdaten bleiben erhalten und werden nie geloescht, um alte Unique-Constraints zu erzwingen.
- Hauptmigration, Held-Aktivierung und beide Rollback-Artefakte werden in diesem Arbeitsschritt nicht live angewendet.

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
| `segment_policy_version` | Version der operativen Segment-Policy |
| `segment_taxonomy_version` | Semantische Taxonomieversion; unter CX8 zwingender Teil der Authority |
| `segment_context_tags` | Nicht-autoritative vertikale Kontext-Tags der aktiven Taxonomie |
| `segment_organization_scale` | Normalisierte Organisationsgroesse; fuer CX8-Regeln nullable und deterministisch validiert |

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

## Historische Phase-1-Segmente (18-Code-Vertrag)

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

## Wie CX8 entscheiden soll

Der Agent nutzt Anfrage, die enge First-Party-Auswahl `customer_type`, Firma,
E-Mail-Domain und verifizierte externe Evidenz. Die Domain steuert nur die
Recherche; sie ist nie selbst ein Segmentbeweis.

- Exakt `customer_type=privat` kann zusammen mit widerspruchsfreier
  Request-Evidence `NT-8` belegen. `gmail.com`, `web.de`, `gmx.de`, ein
  fehlender Firmenname oder ein schwaches Design duerfen das nicht ableiten.
- Exakt `customer_type=gewerblich|b2b` kann `NT-9` nur zusammen mit
  verifizierter direkter Betriebsrollen-Evidence belegen und nur wenn keine
  spezifischere CX8-Rolle positiv belegt ist.
- Branchen wie Gastronomie, Immobilien, Healthcare oder Luxury werden als
  Context-Tags erfasst. Sie ersetzen kein primaeres CX8-Segment.
- Laden-/Messebau, Agentur/Planer, Event-/Medienproduktion, Multi-Site,
  Enterprise und Institution brauchen jeweils ihren exakten positiven
  Evidence-Code mit der dokumentierten semantischen Verwendung.
- Fehlt der positive Beleg, sind mehrere Rollen widerspruechlich oder ist eine
  Quelle nicht exakt gebunden, bleibt das Ergebnis `needs_review`.

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

`p_request_id` ist `master_requests.id` (UUID), nicht die sichtbare Request-/Trello-ID. `p_source` muss `manual_*` entsprechen; Portal und Import verwenden `manual_ops_portal` bzw. `manual_ops_import`.

Der JSON-Return ist waehrend des gestuften Rollouts absichtlich dual-lane. Ein
markerloser Legacy-Aufruf unter der aktiven v1-Policy behaelt exakt den
bisherigen Keyset:

```text
request_id, public_request_id, segment, s_kategorie,
segment_status, segment_confidence, segment_source,
segment_classified_at, segment_policy_version,
authoritative, audit_id
```

Ein mit
`p_actor.segmentTaxonomyVersion=nt_taxonomy_v2_20260819_cx8` markierter
CX8-Aufruf liefert exakt:

```text
request_id, public_request_id, segment, s_kategorie,
segment_status, segment_confidence, segment_source,
segment_classified_at, segment_policy_version,
segment_taxonomy_version, context_tags, organization_scale,
authoritative, gold_label_created, audit_id
```

Im CX8-Return gilt dabei
`segment_taxonomy_version=nt_taxonomy_v2_20260819_cx8`,
`context_tags=[]`, `organization_scale=null`, `authoritative=true` und
`gold_label_created=false`. `request_id` und `audit_id` sind UUID-Strings,
`public_request_id` ist nicht leer, `segment_status=accepted`,
`segment_confidence=null`, `segment_policy_version=manual_override_v1_20260819`
und `segment_classified_at` ist ein parsebarer Zeitstempel. Die vier
CX8-Zusatzfelder werden nicht in den Legacy-Return hineingemischt.

Der RPC setzt:

```text
segment = ausgewaehltes NT-Segment
s_kategorie = Standardwert des Segments
segment_status = accepted
segment_confidence = NULL
segment_source = p_source
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
  tests/quotes/request-segmentation-phase1-schema.test.ts \
  tests/quotes/request-segmentation-phase2-schema.test.ts \
  tests/quotes/request-segmentation-gold.test.ts
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
- Das Portal nutzt eine taxonomieversionsabhaengige Segmentliste aus dem Code.
  Aenderungen an den versionierten CX8-Definitionen muessen mit UI-Validatoren
  und dem exakten Manual-RPC-Marker gemeinsam ausgerollt werden; historische
  18-Code-Werte bleiben davon getrennte Anzeige.
- Die manuelle Bestaetigung veraendert echte Produktionsdaten in `master_requests`.
- Weder Phase 1 noch Phase 2 fuehren in diesem Schritt Bulk-Cleanup oder Backfill aus. Historische pending `NT-8`/`NT-9`-Fallbacks und alte Shared-Provider-Cachezeilen werden nicht geloescht; neue Enqueues/Reads/Writes behandeln sie fail-closed.

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

- Erst nach dem atomaren DB-Policy-Rollback und dem nachgewiesenen leeren exact-v3-Claim den vor dem n8n-Write exportierten vollstaendigen Workflow-Backup als Quelle nehmen und nur den geprueften Reverse-Diff auf die zuvor aktive v1-Version publishen.
- Aktivierungszustand, Credentials-Referenzen, Nodes und Connections vor/nach dem Write vollstaendig diffen; danach mit einem internen, nicht kundenwirksamen Nachweis pruefen.

Rollout-Nachweis:

- DB-Migration vorhanden und die erwarteten Funktionsdefinitionen/ACLs aktiv.
- `request_segmentation_production_readiness` weiterhin fail-closed, solange keine getrennte Aktivierungsfreigabe vorliegt.
- Aktive n8n-Version und Record-RPC-Response-Format gegen diesen Vertrag pruefen.
- Kein echter Kunde dient als Canary.
