# Request Segmentation

Stand: 2026-08-20 (Phase-2-CX8 live im Shadow-Modus; Phase-3-Validator repariert; Phase 4 stellt einen strikt blinden Vier-Fall-Prozesspilot bereit; Phase 6 bleibt historische Research-Evaluation; die vorbereitete Treatment-Focus-Evaluation vereinfacht das fachliche Ziel auf Standardbehandlung versus besondere Behandlung und bleibt vollstaendig evaluation-only; menschliches Gold darf einen gespeicherten Kundentyp mit Begruendung korrigieren, ohne den Kundendatensatz zu mutieren; den tatsaechlichen Gold-, Policy- und n8n-Live-Stand immer neu verifizieren)

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

Live-Stand vom 20.08.2026: `nt_policy_v2_20260819_cx8_shadow` ist mit dem exakten CX8-Taxonomie-/Classifier-/Prompt-Vertrag aktiv. Der kanonische n8n-v3-Workflow pollt diese Lane. Die Policy bleibt `shadow`; alle acht Regeln haben weiterhin `automation_enabled=false`, ohne Preisfaktor, Follow-up oder sonstige Kundenaktion. Weder Follow-up, WhatsApp, Angebotspreis, Mahnung noch ein anderes operatives Verhalten darf aus CX8 abgeleitet werden. Dieser Absatz ist eine datierte Betriebsnotiz, kein Ersatz fuer die Live-Pruefung vor einem weiteren Rollout.

Die Hauptmigration legte v2 bewusst `active=false` an und liess v1 aktiv. Erst das getrennte Held-Artefakt `supabase/rollouts/held/20260819193419_activate_request_segmentation_phase2_cx8_shadow.sql` durfte nach App- und n8n-v3-Rollout atomar v1 deaktivieren und v2 aktivieren; dieser kontrollierte Flip wurde in Phase 2 ausgefuehrt. Das Artefakt prueft davor das exakte Taxonomie-/Evidence-/Gate-Triple und blockiert, solange noch ein unversionierter Legacy-Job in `pending`, `processing` oder als erneut claimbarer `failed`-Retry (`attempts < max_attempts`) steht; terminal ausgeschoepfte Fehler bleiben Audit-Historie. Release Ops muss die claimbaren Faelle vorher bewusst drainen oder aufloesen. Transaktionsgebundene Locks auf Policy und Jobtabelle schliessen die Enqueue-/Claim-Luecke zwischen Drain-Check und Flip. Auch danach bleibt die Policy im Modus `shadow`; alle acht Rules haben `automation_enabled=false`, keinen Preisfaktor und keine Follow-ups.

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

Ein Manual-Override erzeugt nie Gold. Gold entsteht ausschliesslich ueber `neontrip_adjudicate_request_segmentation_gold` fuer den aktuell gelockten Request-/Customer-Input-Hash. Es ist insert-once: identischer Retry ist idempotent, abweichender Retry ist ein Konflikt; UPDATE und DELETE sind gesperrt. Non-`NT-8` braucht mindestens eine gueltige externe Evidence-URL. Fuer gate-faehiges Gold gelten zusaetzlich: `NT-8` hat Scale `NULL`, `NT-5` Scale non-null und `NT-6` Scale exakt `enterprise`. Der gespeicherte `customer_type` bleibt sichtbare Evidence, ist aber kein Vetorecht gegen eine abweichende menschliche Gold-Adjudikation. Eine solche Abweichung muss fachlich begruendet werden und aendert weder `customer_type` noch das operative Segment. Die strengeren First-Party-Regeln fuer KI-Akzeptanz und Automation bleiben davon unberuehrt. Kanonische Limits: Actor 3..320, Reason 20..4000, hoechstens zehn Context-Tags und zwoelf Evidence-URLs mit je maximal 2048 Zeichen.

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

## Phase 3: blinder Ein-Fall-Gold-Pilot

Phase 3 begann absichtlich mit genau einem historischen NEONTRIP-Request. Der erste eval-only Job wurde vom normalen Scheduler genau einmal natuerlich geclaimt. Dieser eine Versuch endete am 20.08.2026 im alten n8n-Validator vor einer Klassifikation. Danach wurde derselbe Job ueber den kanonischen Cancel-RPC beendet. Sein belegter Endstand lautet exakt: `status=cancelled`, `attempts=1`, `classifications=0`, Master-Input-Hash unveraendert, CX8-Research-Cache `0`, Kundenaktionen `0` und verbleibende pending Historienjobs `0`. Der Fehler wurde nicht durch einen zweiten Versuch auf demselben Job reproduziert.

Der Validator wurde anschliessend als exakter Ein-Feld-n8n-Patch repariert. Draft und aktive Version stimmen auf `80101742-c095-4a69-827f-aeaab6bc71ca` bei Counter `114` ueberein. Danach lief genau ein neuer eval-only Job mit dem dokumentierten ID-Praefix `be96c936…` natuerlich in Execution `5210710` in `3.491s` mit `status=success` durch. Sein Endstand lautet: Job `needs_review`, `attempts=1`, `error=null`, unlocked; Klassifikation `needs_review` mit `segment=null`. Der Master-Input-Hash entspricht weiter der Baseline, CX8-Research-Cache bleibt `0`, Follow-up und Pricing bleiben `false`, und es gab keine Kundenaktion. Dieses Ergebnis belegt den reparierten Validator und die sichere Abstention-Lane, aber noch keinen akzeptierten Segmentvorschlag und kein Gold.

Der kanonische Portalvertrag fuer Gold ist die isolierte Ops-Seite `/ops/customer-records/gold-review`. Der Reviewer erhaelt die exakte Request-ID oder den vollstaendigen Deep-Link unabhaengig ueber das Pilot-Runbook. Ohne Query bietet die Seite ausschliesslich einen exakten Request-ID-Einstieg, keine Kunden- oder Freitextsuche. Die normalen Kundenfall-Ansichten verlinken bewusst nicht kontextuell dorthin und betten das Gold-Steuerelement oder dessen Daten nicht ein, weil der Operator dort unmittelbar zuvor ein operatives oder historisches Segment sehen koennte. Vor dem ersten unveraenderlichen Gold-Write gilt folgende Checkliste:

1. Der Operator prueft ausschliesslich das serverseitig kuratierte Whitelist-Paket aus aktuellen Anfrage-, Kontakt-, Firmen- und First-Party-Feldern sowie eigene externe Evidence ohne Modellhilfe. Die isolierte Seite ruft die allgemeine Kundenakten-API nicht auf; das Ops-Layout mountet dort weder Task-Notifier noch Copilot.
2. Die GET-Route entfernt `latestClassification` serverseitig, solange fuer den exakten aktuellen Input noch kein Gold existiert. Sie liefert ausserdem keine operativen oder historischen Segment-/S-/Status-/Confidence-/Source-/Taxonomie-Felder. Die fuer die Auswahl zwingend benoetigten aktiven Codes und Labels werden serverseitig aus der kanonischen Registry auf `{code,label}` reduziert; der Blind-Client importiert die breite Registry nicht. GET und POST antworten wegen der autorisierten PII mit `Cache-Control: private, no-store`. Browser-UI oder DevTools duerfen daher weder den v3-Vorschlag noch benachbarte Legacy- oder Operations-Segmentdaten verraten.
3. Segment, Context-Tags, Organisationsgroesse und Evidence-URLs starten leer; es gibt keine Modell-Vorbefuellung.
4. Der gespeicherte DB-Kundentyp bleibt im Blindpaket sichtbar. Passt er nicht zur menschlichen `NT-8`-/`NT-9`-Auswahl, zeigt das Portal eine deutliche Warnung und die Begruendung muss die fachliche Abweichung erklaeren; die Auswahl bleibt zulaessig. Organisationsgroessenregeln, URL-Limits, Reason-Laenge und Stale-Hash-Sperre bleiben unveraendert wirksam. Evidence-URLs muessen externe HTTP(S)-Ziele ohne URL-Zugangsdaten sein; localhost, private/link-local IPv4-Ziele und IP-literal IPv6-Ziele werden nicht gespeichert oder klickbar gemacht.
5. Der gespeicherte Actor bindet die serverseitig aufgeloeste Ops-Identitaet aus `resolveOpsRequestActor` an den im Portal eingegebenen Operatornamen. Ist die kombinierte Identitaet laenger als 320 Zeichen, wird der Write abgelehnt; keine der beiden Identitaeten wird abgeschnitten. Der rohe Clientname allein ist keine Audit-Identitaet.
6. Erst nachdem unveraenderliches Gold fuer denselben Input existiert und die v3-Klassifikation `inputHashCurrent=true` hat, darf der Vergleich erscheinen: Modellsegment, Status, Confidence, Reason-Codes, Risk-Flags, Evidence-Provenance, Mapping-Integritaet, Context/Scale und ausschliesslich sichere klickbare HTTP(S)-Evidence-Links. Ein stale Modellergebnis bleibt auch nach Gold ausgeblendet.

`attribution_raw.manual_segment_taxonomy_version = "nt_taxonomy_v2_20260819_cx8"` ist ausschliesslich der beim manuellen Import eingefrorene Retry-Vertragsmarker. Er beweist weder ein CX8-Segment noch Gold oder Modellqualitaet und ist kein Marker fuer den historischen Pilot. Ein Pilotfall darf nicht allein anhand dieses Feldes als korrekt gelabelt oder gate-faehig behandelt werden.

## Phase 4: blinder Vier-Fall-Prozesspilot

Phase 4 prueft ausschliesslich, ob ein einzelner menschlicher Reviewer vier
unabhaengige Gold-Adjudikationen ohne Modellfeedback sauber durchfuehren kann.
Vier Faelle sind keine Qualitaetsstichprobe, decken nicht alle acht Segmente ab
und duerfen weder Precision-/Recall-Aussagen noch eine Automation-Aktivierung
begründen.

Der Einstieg ist:

```text
/ops/customer-records/gold-review?pilot=1
```

Der Server friert die Kohorte auf die ersten vier eindeutigen Requests ein, die
vor `2026-08-20T08:15:00.000Z` einen Job unter dem exakten CX8-v3-Vertrag
erzeugt haben. Die Auswahl liest aus der Jobtabelle ausschliesslich
`request_id` und `created_at`; sie
filtert oder sortiert nie nach Status, Segment, Confidence, Evidence,
Risk-Flags oder einem historischen Segment. Dass der Pilot aus bereits
angelegten v3-Jobs besteht, macht ihn zu einem Prozessnachweis, nicht zu einem
repraesentativen Trainings- oder Gate-Datensatz. Der kanonische Gold-Enqueue
aktualisiert bei einer Re-Evaluation nur `updated_at`, nicht das unveraenderte
Job-`created_at`; die Zeitgrenze bleibt deshalb auch nach Fall eins stabil.

`GET /api/ops/customer-records/segment-gold?mode=pilot-next` liefert dem
Browser exakt einen opaken naechsten `requestId` sowie neutrale Position,
Gesamtzahl und Abschlussstatus. Es gibt keine Kandidatenliste. Die vier IDs
bleiben serverseitig in fester Zeit-/UUID-Reihenfolge; bereits vorhandenes
exaktes CX8-Gold wird nur als erledigt behandelt. Reicht die eingefrorene
Kohorte nicht exakt fuer vier Faelle oder ist eine ID-Aufloesung mehrdeutig,
bricht der Server fail-closed ab.

`mode=pilot-review` und jeder Pilot-POST tragen zusaetzlich den exakten
Pilotvertrag `gold_pilot_v1_20260820_cx8_four_case`. Der Server akzeptiert dabei
nur den aktuell naechsten Request der eingefrorenen Kohorte. Manipulierte,
bereits erledigte oder ausserhalb der vier IDs liegende Links brechen vor
Review-RPC beziehungsweise Gold-RPC mit `409` ab. Der separate exakte
Einzelfallpfad bleibt fuer bewusstes Support-Review erhalten, ist aber kein
Bestandteil dieses Piloten.

Verbindlicher Ablauf:

1. Genau ein benannter Reviewer arbeitet die Kohorte seriell ab. Kein zweiter
   Reviewer und keine parallele Browser-Session.
2. Vor und waehrend des Piloten werden die allgemeine Kundenakte, alte
   Labeling-Views und der exakte Einzelreview-Supportpfad fuer diese vier
   Faelle nicht geoeffnet.
3. Jeder Fall wird nur anhand des kuratierten Blindpakets und selbst gepruefter
   externer Evidence beurteilt. Segment, Context-Tags, Scale, Evidence-URLs und
   Begruendung starten bei jedem Fall leer.
4. Ist ein Fall fachlich nicht sicher adjudizierbar, wird nicht geraten und
   nicht ergebnisorientiert durch einen leichteren Fall ersetzt. Der Pilot wird
   an dieser Stelle pausiert und der Grund ausserhalb des unveraenderlichen
   Gold-Writes geklaert.
5. Nach erfolgreichem Gold-POST verwirft der Pilot die Fallansicht sofort und
   kehrt zur opaken Next-Auswahl zurueck. Er laedt den abgeschlossenen Fall
   nicht erneut; Modellsegment, Confidence, Reason-Codes und Evidence bleiben
   deshalb auch zwischen Fall eins bis vier verborgen.
6. Erst nach `complete=true` darf eine getrennte Batch-Auswertung die vier
   Gold-Labels mit den exakten current-hash-v3-Ergebnissen vergleichen. Der
   Reviewer sieht bis dahin keinen fallbezogenen Modellvergleich.

Bekannter Intake-Fund waehrend Fall zwei: Die produktive Landingpage erhob
keinen Kundentyp, waehrend ihr Intake-Workflow dennoch pauschal `B2B` schrieb.
Dieser Wert ist keine First-Party-Aussage. Er darf weder durch eine
Datenkorrektur am einzelnen Pilotfall in `privat` umgeschrieben noch durch ein
absichtlich falsches Gold-Segment umgangen werden. Kennt der Reviewer die
private Nutzung fachlich, darf er `NT-8` waehlen und die Abweichung begruenden;
das immutable Gold bleibt reine Evaluation. Fuer neue Landingpage-Anfragen muss
der synthetische B2B-Default entfallen; ohne tatsaechlich erhobene Auswahl wird
der Kundentyp neutral gespeichert und die KI bleibt bei fehlender positiver
Evidence fail-closed.

Phase 4 fuehrt keinen weiteren historischen Backfill aus. Jeder echte
Gold-Write bleibt insert-once, mutiert niemals `master_requests` und darf nur
den bereits kanonischen evaluation-only Enqueue ausloesen. Die aktive Policy
bleibt `shadow`; Follow-up, Pricing, WhatsApp, E-Mail, Mahnung und alle anderen
Kundenaktionen bleiben gesperrt. Vor einer Skalierung auf den Qualitaets-Gate-
Umfang von 300/25 je Segment braucht es einen eigenen versionierten
Sampling-/Assignment-Vertrag; der Vier-Fall-Pilot ist kein Ersatz dafuer.

## Phase 5: versionierter Forced-Research-Kandidat

Die PII-freie Batch-Auswertung nach Abschluss des Vier-Fall-Piloten ergab vier
aktuelle immutable Gold-Faelle: zweimal `NT-3`, einmal `NT-4` und einmal
`NT-8`. Der exakte classifier-v3/prompt-v4-Vertrag hatte alle vier
ausgewertet, aber viermal `needs_review`, ohne akzeptierte Vorhersage und ohne
fehlenden Ergebnis-Row. Bei den drei nicht privaten Faellen fehlte insbesondere
verifizierte externe Rollen-Evidence; der vorhandene Web-Search-Toolpfad wurde
nicht ausgefuehrt. Diese vier Faelle sind weiterhin nur ein Diagnose-Set und
kein Qualitaets- oder Aktivierungsnachweis.

Der additive Phase-5-Kandidat ist exakt:

- Taxonomie: `nt_taxonomy_v2_20260819_cx8` (unveraendert)
- Classifier: `segment_classifier_v4_20260820_cx8`
- Prompt: `segment_prompt_v4_20260819_cx8` (byte-identisch)
- Quality Gate: `nt_quality_gate_v3_20260820_cx8`
- Policy: `nt_policy_v3_20260820_cx8_shadow`
- Validator-Provenance: `n8n_cx8_validator_v1` (unveraendert)
- Worker-Identitaet: `n8n-request-segmenter-v4`

Classifier v4 bezeichnet hier die deterministisch erzwungene
Research-Ausfuehrung vor der unveraenderten Klassifikationsentscheidung. Es
wird weder ein Gold-Label in den Prompt gegeben noch eine Evidence-, Confidence-
oder First-Party-Regel gelockert. Insbesondere darf der historische private
Pilotfall auf seinem unveraenderten Input weiter abstainieren: Der damals
synthetisch gespeicherte B2B-Wert ist keine private First-Party-Evidence. Eine
Akzeptanz von `NT-8` durch die KI waere bei diesem Input ein Vertragsfehler,
nicht das Ziel des Experiments.

Die Base-Migration legt Gate, Policy und acht komplett inerte Rules
(`automation_enabled=false`, kein Preisfaktor, keine Calls oder Follow-ups)
zunaechst `active=false` an. Sie enqueued nichts. Bestehende v2-Views und
v3-Klassifikationen bleiben unveraendert. Die additiven
`request_segmentation_v3_*`-Views joinen das gleiche immutable Gold nur auf
den exakten neuen Taxonomie-/Classifier-/Prompt-/Input-Hash-Vertrag. Die
bestehenden Unique-Indizes auf diesen fuenf Feldern erzeugen fuer v4 neue Job-
und Classification-Zeilen; ein Ergebnis des alten v3-Vertrags kann dadurch
nicht ueberschrieben werden.

`neontrip_enqueue_request_segmentation_evaluation` unterstuetzt den neuen
Vertrag bereits, sobald das neue Gate konfiguriert ist. Die Funktion sperrt und
prueft den aktuellen Input-Hash und setzt unveraendert
`evaluation_only=true` sowie `master_projection_authorized=false`. Sie
schreibt weder Master noch Cache. Ein Retry desselben Versions-Tupels verwendet
allerdings absichtlich denselben Job und der Record-Pfad upsertet denselben
candidate Classification-Row. Deshalb erlaubt das Held-Artefakt nur eine
pristine Candidate-Lane und staged die vier Jobs genau einmal; ein weiterer
Versuch braucht eine neue Classifier- oder Prompt-Version.

Das Held-Artefakt wird erst nach verifiziertem Publish und Readback des exakten
n8n-v4-Graphs ausgefuehrt. Unter Tabellen-Locks prueft es global genau eine
aktive Policy und genau ein aktives Gate, keine claimbaren/laufenden v3-Jobs,
keine v4-Runtime-Zeile, exakt vier aktuelle Pilot-Gold-Zeilen sowie acht inerte
Candidate-Rules. Es staged dann atomar vier evaluation-only Jobs und flippt
Quality Gate und Policy gemeinsam auf den neuen Shadow-Vertrag. Follow-up,
Pricing, WhatsApp, E-Mail, Mahnung, Master-Projektion und Research-Cache bleiben
fuer diese vier Auswertungen blockiert. Eine spaetere Produktionsaktivierung
bleibt an 300/25-Gold, alle technischen Gates und eine getrennte manuelle
Freigabe gebunden.

Nach einem bereits ausgefuehrten nicht-destruktiven operativen Rollback darf
das urspruengliche Held-Artefakt nicht erneut laufen: Seine Pristine-Lane-
Vorbedingung ist absichtlich nicht mehr erfuellt. Fuer den belegten
Recovery-Zustand existiert deshalb das separate, weiterhin gehaltene Artefakt
`supabase/rollouts/held/20260820111828_resume_request_segmentation_phase5_forced_research_shadow.sql`.
Es akzeptiert ausschliesslich genau fuenf vorhandene `pending`-v4-Jobs ohne
Klassifikation oder v4-Cache: vier aktuelle Pilot-Gold-Jobs mit
`evaluation_only=true`/`master_projection_authorized=false` (dreimal
`attempts=1`, einmal `attempts=0`) und genau einen normalen Ingress mit
`evaluation_only=false`/`master_projection_authorized=true` und
`attempts=0`. Alle fuenf Jobs muessen unlocked und ohne verknuepfte
Klassifikation sein. Die drei bereits versuchten Gold-Jobs muessen exakt den
belegten Fehler `n8n_node_error`/`invalid syntax` tragen; beide noch nicht
versuchten Jobs duerfen keine Fehlerfelder haben. Der normale Source-Wert wird
aus `request_segmentation_jobs.source` geprueft; seine Metadaten muessen den
exakten Candidate-Policy-/Gate-Vertrag tragen. Das SQL staged keinen Job, setzt
weder Versuch noch Zeitstempel zurueck und hasht alle fuenf Jobzeilen vor/nach
dem ausschliesslichen Policy-/Gate-Flip.

Recovery-Runbook: Zuerst bleibt v2 aktiv, waehrend der reparierte exakte
n8n-v4-Graph publiziert und vollstaendig zurueckgelesen wird. Danach muessen
alle claimbaren/laufenden v3-Jobs drainiert und die oben beschriebene
Fuenf-Job-Komposition erneut read-only belegt sein. Erst dann darf das
Resume-Artefakt atomar Policy v2 und Quality Gate v2 deaktivieren sowie Policy
v3 und Quality Gate v3 aktivieren. Die
fuenf Jobs werden anschliessend ausschliesslich durch den natuerlichen
Scheduler verarbeitet; kein manueller Run und kein Retry/Reset ist Teil dieses
Cutovers. Policy/Gate, Jobzustand, Klassifikationen, Cache, Master-Projektion
und Kundenaktionen werden danach erneut aus ihren autoritativen Quellen
verifiziert.

## Phase 6: privacy-sichere Research-Evaluation

Phase 6 ist eine additive, strikt evaluation-only Pilot-Lane. Sie ersetzt und
aktiviert nichts: `nt_policy_v2_20260819_cx8_shadow` und
`nt_quality_gate_v2_20260819_cx8` bleiben global die jeweils einzige aktive
Policy beziehungsweise das einzige aktive Gate. Der vorbereitete Kandidat
`nt_policy_v4_20260820_cx8_shadow` mit Gate
`nt_quality_gate_v4_20260820_cx8` bleibt `active=false`; seine acht Rules sind
vollstaendig inert. Die Taxonomie bleibt `nt_taxonomy_v2_20260819_cx8`.

Der eingefrorene Modellvertrag lautet:

- Classifier `segment_classifier_v5_20260820_cx8`, Prompt
  `segment_prompt_v5_20260820_cx8`, Worker `n8n-request-segmenter-v5`
- Research `segment_research_v1_20260820_cx8`, Validator
  `n8n_cx8_validator_v2`, Job-Source `gold_re_evaluation_phase6`
- Research-Modell `gpt-4o-mini-2024-07-18`; Classifier-Modell
  `gpt-5.5-2026-04-23` mit Reasoning `medium`

Der Claim ist service-role-only, akzeptiert nur current-hash immutable Gold,
den exakten inaktiven Kandidaten, den exakten weiterhin aktiven v2-Vertrag und
`attempts < max_attempts`. Der Payload-RPC gibt weder Job-/Request-/Customer-
IDs noch Namen, volle E-Mail, Telefon, Adresse, Attribution, alte Segmente,
Preise, History, Cache oder Gold-Label/-Grund/-Evidence aus. Sein Top-Level hat
exakt `contract`, `input`, `taxonomy`, `context_definitions` und
`organization_scale_values`. `input` hat exakt diese zehn Keys:
`title`, `description`, `declared_customer_type`,
`declared_customer_type_first_party_verified`, `application`, `country`,
`company`, `company_lookup_allowed`, `email_domain`, `domain_facts`.
Freitext wird redigiert und hart begrenzt. Mangels belastbarer Rohprovenienz
ist der deklarierte Kundentyp in allen vier Pilotfaellen `unknown` und
`declared_customer_type_first_party_verified=false`; insbesondere die drei
synthetischen Landingpage-B2B-Defaults sind keine Evidence.

Eine gueltige, Cache-zulaessige Corporate Domain hat beim Research-Plan Vorrang.
Der Company-Fallback gibt eine Firma nur frei, wenn die normalisierte
Bezeichnung maximal 120 Zeichen und 2..10 Tokens mit maximal 40 Zeichen hat,
keine E-Mail/URL/Telefon/UUID/Tracking-/Steuer-/ID- oder Person-Muster enthaelt
und einen explizit gepinnten Rechtsform-/Business-Marker besitzt. Ein reines
langes Alphabetwort bleibt zulaessig; ein mindestens 24 Zeichen langer Token
mit Ziffer, Unterstrich oder Bindestrich wird als ID-artig gesperrt. Bei jedem
Zweifel ist `company=null` und `company_lookup_allowed=false`. Der DB-Planer
erzeugt die einzige erlaubte Query deterministisch; Record und Diagnose-View
vergleichen `research_query` exakt dagegen. Durchgefuehrte Recherche braucht
mindestens eine tatsaechliche, deduplizierte HTTP(S)-Quelle. Response-ID,
Search-Call-ID sowie die beiden zugehoerigen Source-Refs sind jeweils auf
1..320 Zeichen begrenzt und exakt miteinander gebunden. Der v5-Cache-Writer
bleibt geschlossen.

Die technische Research-Integritaet ist absichtlich von fachlicher positiver
Evidence getrennt. Eine sauber gebundene Stage-1-Recherche mit anschliessender
`needs_review`-Abstention darf daher
`research_contract_integrity=true`, aber
`evidence_provenance_valid=false` haben. Eine ausgefuehrte Recherche ohne
Quelle, eine umgeschriebene Query, falsche Call-/Response-Refs oder ein
abweichender Modell-/Research-Vertrag ist dagegen ein technischer
Contract-Verstoss. `request_segmentation_v4_quality_summary` zaehlt Modell- und
Research-Verstoesse ueber alle evaluierten Rows, nicht nur ueber akzeptierte
Rows; Readiness verlangt beide Gesamtwerte `0`.

`NT-8` bleibt fuer diese Lane ohne explizite First-Party-Privat-Evidence
unerreichbar. `NT-9` darf dagegen bei `unknown/false` akzeptiert werden, wenn
eine exakt an denselben Research-Call gebundene externe
`verified_direct_business`-Evidence am `segment_role`-Item vorliegt und keine
hoehere positive Segmentrolle gleichzeitig behauptet wird.

Die vier immutable Gold-Faelle bleiben unveraendert und werden weder
automatisch korrigiert noch ausgefiltert. Goldfall 2 (`NT-8`) ist fachlich
konfliktaer: Er enthaelt ein explizites Business-Signal, waehrend Freemail
allein gemaess Taxonomie kein Privatbeleg ist. Deshalb ist ein Pilotresultat
niemals als einfaches 4/4-Gate zu interpretieren. Die NT-8-Abweichung wird
separat als Re-Adjudikationsbedarf ausgewiesen; jede spaetere Gold-Aenderung
braucht einen eigenen menschlichen Prozess.

### Gehaltener Ablauf und Beweise

1. PII-freien Prestate mit
   `supabase/security-backups/request-segmentation-phase6-prechange-20260820.sql`
   sichern und die Base-Migration anwenden. Sie legt keine Tabelle, Queue,
   Spalte oder Index an und staged keinen Job.
2. Nach dem enthaltenen `NOTIFY pgrst, 'reload schema'` im PostgREST-Schema-
   Cache beweisen, dass die neue 19-Argument-Overload von
   `neontrip_record_request_segment_classification` mit dem zusaetzlichen
   Named-Argument `p_research_contract` aufloesbar ist und die bestehende
   18-Argument-Funktion weiterhin unveraendert existiert. Ohne diesen
   Overload-/Reload-Beweis kein Pilot.
3. Vor dem n8n-v5-Publish muessen laufende v2-Jobs `processing=0` erreicht
   haben. Dann den exakten n8n-v5-Graph publizieren, vollstaendig zuruecklesen
   und vor jedem Staging einen natuerlichen v5-Claim mit Ergebnis `[]`
   beweisen. Der Runtime-Claim bleibt auf `p_limit=1`. `job_id`, `request_id`
   und `input_hash` werden ausserhalb des ID-freien Modellpayloads per
   Item-Lineage vom normalisierten Claim bis Record getragen. Zusaetzlich muss
   ein Vier-Item-Fixture beweisen, dass Payloads und Claim-Identitaeten nicht
   vertauscht werden.
4. Erst nach Readback und leerem v5-Claim das weiterhin gehaltene
   `supabase/rollouts/held/20260820123000_stage_request_segmentation_phase6_privacy_safe_gold.sql`
   freigeben. Unter Locks verlangt es eine pristine v5-Lane und exakt vier
   current Gold-Faelle; es fuegt genau vier neue `pending`-Jobs mit
   `attempts=0`, `max_attempts=3` und Prioritaet 900 ein. Es aktualisiert keinen
   bestehenden Job und flippt weder Policy noch Gate.
5. Ausschliesslich den natuerlichen Scheduler arbeiten lassen. Kein manueller
   Run, kein absichtlich erzeugter normaler Ingress und kein echter Kunde als
   Canary. Natuerlich neu eintreffende v2-Jobs koennen nicht ausgeschlossen
   werden; sie bleiben in diesem kurzen v5-Fenster unclaimed. Nach exakt vier
   terminalen v5-Rows und `processing=0` sofort den separat geprueften
   n8n-v3-Reverse publizieren, vollstaendig zuruecklesen und die natuerliche
   v2-Wiederaufnahme beweisen. Ausserdem null Gesamt-Contract-Verstoesse sowie
   unveraenderten Master-Authority-Hash, v5-Cache, Gold und
   Kundenaktionszustand aus den autoritativen Tabellen belegen.
   Transport-/Vertragsfehler werden getrennt von fachlicher Abstention
   berichtet; insbesondere Goldfall 2 separat.

Vor jeder v5-Runtime entfernt
`supabase/rollbacks/20260820121334_prepare_request_segmentation_phase6_privacy_safe_research_rollback.sql`
den unbenutzten Kandidaten vollstaendig und fail-closed. Nach erster Runtime
bleibt die Historie bestehen: zuerst n8n-v5 stoppen beziehungsweise den separat
geprueften Reverse publizieren, laufende `processing`-Jobs bis `0` drainen und
dann
`supabase/rollbacks/20260820123000_request_segmentation_phase6_operational_rollback.sql`
anwenden. Dieser operative Rollback loescht oder resettet keine Jobs,
Klassifikationen oder Goldzeilen, sondern entzieht nur die drei v5-RPC-
Ausfuehrungsrechte und verifiziert History-Hashes. Eine Wiederfreigabe braucht
einen neuen, explizit geprueften Grant-/Graph-Schritt; das Rollback-Artefakt
aktiviert nichts automatisch.

## Treatment-Focus-Evaluation: Standard versus besondere Behandlung

Der neue Kandidat bildet den tatsaechlichen Betriebszweck direkt ab. Die acht
CX8-Codes bleiben fuer Auswertung und Kontext erhalten; die primaere
Entscheidung ist aber nur:

- `standard`: Privatkunden, Gruender, kleine Unternehmen, Restaurants und
  andere normale gewerbliche Anfragen. Sie duerfen spaeter den normalen
  Angebots- und Follow-up-Prozess verwenden.
- `special`: oeffentliche beziehungsweise institutionelle Kunden (`NT-10`),
  Franchise/Multi-Site (`NT-5`), Enterprise (`NT-6`) oder ein anderweitig
  belastbar als `large|enterprise` belegter Fall. Dieser Marker ist fuer einen
  spaeteren zurueckhaltenderen Follow-up- und formelleren Angebotsprozess
  gedacht.

Diese Evaluation aktiviert noch keinen dieser spaeteren Prozesse. Policy und
Gate des Kandidaten bleiben inaktiv, alle acht Regeln bleiben inert und die
vier Pilotjobs sind `evaluation_only=true` sowie
`master_projection_authorized=false`. Record darf weder `master_requests` noch
Research-Cache, Trello, E-Mail, WhatsApp, Angebot, Preis oder Follow-up aendern.

### Einfache Entscheidungsregeln

- Freemail beziehungsweise Shared Provider loest keine Websuche aus.
- Eindeutig private Nutzung im minimierten Anfrageinhalt darf `NT-8` mit
  `treatment_tier=standard` belegen. Freemail allein ist kein Beweis.
- Eindeutig gewerbliche Nutzung trotz Freemail darf mit dem passenden
  Business-Segment und `treatment_tier=standard` bewertet werden. Der Beleg
  kommt aus Titel, Beschreibung oder Anwendungszweck, nicht aus der Maildomain.
- Ist die Nutzung im Text unklar, bleibt der Fall `needs_review`; es gibt
  keinen Privat- oder Business-Fallback.
- Bei einer gueltigen Nicht-Freemail-Firmendomain ist nur eine exakt auf diese
  Domain beziehungsweise deren Subdomains beschraenkte Recherche erlaubt.
  Firmenname, Personenname oder voller Anfragekontext werden nie als
  Suchanfrage verwendet.
- Ein Standardfall darf ohne Webquelle akzeptiert werden, wenn der minimierte
  First-Party-Anfragetext den exakten Segmentbeleg traegt.
- Jede `special`-Entscheidung braucht eine passende, an denselben Search-Call
  gebundene externe URL. Fehlt sie, endet der Fall fail-closed in
  `needs_review`.

### Versionierter Pilotvertrag

```text
taxonomy_version  = nt_taxonomy_v2_20260819_cx8
classifier        = segment_classifier_v6_20260820_treatment_focus
prompt            = segment_prompt_v6_20260820_treatment_focus
policy            = nt_policy_v5_20260820_treatment_focus_shadow (inactive)
quality_gate       = nt_quality_gate_v5_20260820_treatment_focus (inactive)
research          = segment_research_v2_20260820_domain_filter
treatment          = treatment_focus_v1_20260820_standard_vs_special
validator          = n8n_cx8_validator_v3
worker             = n8n-request-segmenter-v6
source             = gold_re_evaluation_phase7_treatment
```

Die Base-Migration
`supabase/migrations/20260820190414_prepare_request_segmentation_treatment_focus_evaluation.sql`
legt nur diesen inaktiven Vertrag, service-role-only Claim/Payload/Record und
diagnostische `request_segmentation_v5_*`-Views an. Sie staged keinen Job und
flippt keine Policy. Die neue 20-Argument-Record-Overload ergaenzt
`p_treatment_contract`; die bestehenden 18- und 19-Argument-Funktionen muessen
weiterhin aufloesbar bleiben.

Erst nach DB-Compile, PostgREST-Readback, vollstaendigem n8n-v6-Readback und
einem natuerlichen leeren v6-Claim darf
`supabase/rollouts/held/20260820193000_stage_request_segmentation_treatment_focus_gold.sql`
genau vier aktuelle immutable-Gold-Jobs anlegen. Ausschliesslich der
natuerliche Scheduler verarbeitet sie mit `p_limit=1`. Beim ersten technischen
oder Vertragsfehler wird der v6-Graph sofort auf den vollstaendig gesicherten
v3-Graph zurueckgedreht; es gibt keinen manuellen Run, Retry oder Reset.
Spaetestens nach vier terminalen Jobs wird ebenfalls auf v3 zurueckgedreht und
ein natuerlicher v2-Claim sowie unveraenderte Master-/Cache-/Kundenaktionswerte
werden belegt.

## Dauerhafter Treatment-Shadow-Betrieb

Der nachfolgende v7-Vertrag ersetzt den zeitlich begrenzten Treatment-Pilot
fuer neue natuerliche Anfragen. Er setzt die einfache Betriebsentscheidung um:

- Eine gueltige Firmen-Maildomain wird mit einer kurzen, ausschliesslich an die
  Domain gebundenen Websuche geprueft.
- Freemail und Shared Provider werden nie gesucht. Zeigt Titel, Beschreibung
  oder Anwendung eine gewerbliche Nutzung, wird der passende normale
  Business-Fall verwendet. Ohne ein solches Business-Signal wird der Fall als
  privater Standardfall behandelt.
- Nur positiv belegte oeffentliche/institutionelle, Multi-Site-, Enterprise-
  oder grosse Organisationen erhalten `treatment_tier=special`. Alle anderen
  erhalten `standard`.

```text
taxonomy_version  = nt_taxonomy_v2_20260819_cx8
classifier        = segment_classifier_v7_20260821_treatment_shadow
prompt            = segment_prompt_v7_20260821_treatment_shadow
policy            = nt_policy_v6_20260821_treatment_shadow
quality_gate       = nt_quality_gate_v6_20260821_treatment_shadow
research          = segment_research_v2_20260820_domain_filter
treatment          = treatment_focus_v2_20260821_always_on
validator          = n8n_cx8_validator_v4
worker             = n8n-request-segmenter-v7-treatment-shadow
```

Die Einordnung wird ausschliesslich als versionierte
`segment_classifications`-Shadow-Historie gespeichert. Der Status
`shadow` autorisiert keine Master-Projektion. Policy und Gate bleiben im
Modus `shadow`; alle acht Regeln bleiben mit
`automation_enabled=false`, `price_factor=null`, `max_followups=0` und
leeren Call-/E-Mail-Sequenzen inert. Der Vertrag darf daher weder
`master_requests`, Research-Cache, Trello, Angebot, Preis, Reminder, E-Mail,
WhatsApp noch eine andere Kundenaktion aendern.

Die Base-Migration
`supabase/migrations/20260821063055_prepare_request_segmentation_treatment_shadow_always_on.sql`
legt den Kandidaten zunaechst inaktiv an. Erst nach vollstaendigem
n8n-v7-Readback und einem natuerlichen leeren v7-Claim darf
`supabase/rollouts/held/20260821070000_activate_request_segmentation_treatment_shadow_always_on.sql`
v2 atomar deaktivieren und v6 aktivieren. Anders als die alten Gold-Piloten
bleibt der v7-Workflow danach dauerhaft aktiv und verarbeitet ausschliesslich
natuerlich eingehende Jobs; es gibt keinen Backfill oder manuellen Run.

Nach erster v7-Runtime ist nur der nicht-destruktive operative Rollback
`supabase/rollbacks/20260821070000_request_segmentation_treatment_shadow_operational_rollback.sql`
zulaessig: v7-`processing` und Locks muessen zuerst null sein, dann wird auf
v2 zurueckgeschaltet, ein leerer exakter v7-Claim belegt, der vollstaendige
n8n-Reverse publiziert und abschliessend ein natuerlicher leerer v3-Claim
geprueft. Runtime-Historie wird nicht geloescht.

## Rollback

- Vor erster v4-Runtime entfernt
  `supabase/rollbacks/20260820103040_prepare_request_segmentation_phase5_forced_research_rollback.sql`
  ausschliesslich den inaktiven Candidate-Vertrag und stellt die aktuellen
  pre-Phase-5-Funktionskoerper wieder her. Es bricht ab, sobald ein v4-Job, eine
  v4-Klassifikation, ein v4-Cache-Row oder eine Candidate-Freigabe existiert.
  Der aktuelle Gold-Vertrag ohne customer_type-Veto bleibt dabei erhalten.
- Nach erster v4-Runtime ist nur der nicht-destruktive
  `supabase/rollbacks/20260820104500_request_segmentation_phase5_operational_rollback.sql`
  zulaessig: laufende v4-Jobs zuerst drainen, dann Candidate inaktiv und v2
  wieder aktiv schalten. Jobs, Klassifikationen, Views und immutable Gold
  bleiben Audit-Historie. Anschliessend muss der noch gepinnte v4-Claim leer
  sein, bevor der separat gepruefte n8n-Reverse publiziert wird.
- Nach diesem operativen Rollback darf nur der oben dokumentierte, eng auf den
  belegten Fuenf-Job-Zustand begrenzte Resume-Cutover verwendet werden. Weicht
  Jobanzahl, Status, Attempts-Verteilung, Gold-Bindung, normaler Ingress,
  Klassifikations-/Cache-Zustand oder globale Aktivitaet ab, bricht er
  fail-closed ab. Fuer einen erneuten Abbruch bleibt derselbe
  nicht-destruktive operative Rollback kanonisch; Runtime-Historie wird nicht
  geloescht oder zurueckgesetzt.
- Die Gold-only-Kundentyp-Reparatur wird mit `supabase/rollbacks/20260820093126_allow_human_gold_customer_type_disagreement_rollback.sql` zurueckgenommen. Sie stellt ausschliesslich den vorherigen First-Party-Veto-Body und dieselben Function-ACLs wieder her; bestehendes immutable Gold wird weder geloescht noch geaendert.
- Vor jeglicher v2-Runtime darf ein exakter Schema-Restore ueber `supabase/rollbacks/20260819183219_request_segmentation_phase2_full_pre_runtime_rollback.sql` nur erfolgen, wenn versionierte Jobs, Klassifikationen, Gold, Master-Authority und Approvals jeweils `0` Rows haben, v1 allein aktiv und v2 inaktiv ist. Das Artefakt enthaelt die exakt am 2026-08-19 live erfassten Phase-1-Funktionsdefinitionen/ACLs und stellt die beiden alten Unique-Constraints wieder her. Der PII-freie Prestate liegt in `supabase/security-backups/request-segmentation-phase2-prechange-20260819.sql`.
- Nach der ersten v2-Runtime ist nur der nicht-destruktive operative Rollback `supabase/rollbacks/20260819193419_request_segmentation_phase2_operational_rollback.sql` zulaessig. Exakte Reihenfolge: bereits laufende `processing`-v2-Jobs drainen (das SQL bricht sonst fail-closed ab), dann mit diesem SQL atomar v2 inaktiv/v1 aktiv schalten, danach einen Claim mit dem exakten v3-Taxonomie-/Classifier-/Prompt-Triple ausfuehren und das leere Ergebnis `[]` verifizieren; erst danach den n8n-Reverse auf v1 publishen. Pending/failed CX8-Jobs bleiben auditierbar suspendiert; additive Spalten sowie alle v3-/Gold-Auditdaten bleiben erhalten und werden nie geloescht, um alte Unique-Constraints zu erzwingen.
- Hauptmigration und Held-Aktivierung wurden im Phase-2-Rollout angewendet. Keines der beiden Rollback-Artefakte wurde angewendet; seit der ersten v2-Runtime ist ausschliesslich der nicht-destruktive operative Rollback zulaessig.

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
