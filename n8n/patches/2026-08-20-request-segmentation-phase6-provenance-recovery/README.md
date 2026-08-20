# NEONTRIP Request Segmenter – Phase 6 provenance recovery

Status: lokal vorbereitet. Der Recovery-Kandidat wurde nur offline und mit n8n `validateOnly` geprüft. Es wurde kein n8n-Write, Publish, Aktivierungswechsel, Workflow-Run, Job-Retry, DB-Write, OpenAI-Request oder Kunden-/Trello-Effekt ausgeführt.

## Ursache und begrenzte Änderung

Beim ersten Vier-Gold-Pilot enthielten drei abgeschlossene Stage-1-Responses genau einen erfolgreichen, bytegleich an die freigegebene Query gebundenen `web_search_call`, aber weder `action.sources` noch `output_text.annotations[type=url_citation]`. Der frühere Prepare-Node behandelte diesen dokumentierten Provider-Kompatibilitätsfall als technischen Fehler. Alle Datenschutz- und Query-Grenzen funktionierten; die aktive n8n-Version wurde anschließend exakt auf v3 zurückgesetzt.

Dieser Recovery-Patch ändert nur die Phase-6-n8n-Laufzeitkompatibilität:

- Stage 1 behält Modell, bytegleiche Einzeilenquery, `input`, `store:false`, `tool_choice:"required"`, Tool und 700 Output-Tokens unverändert.
- Ein separates statisches `instructions`-Feld verlangt eine kurze, quellengebundene Antwort mit Inline-URL-Zitaten.
- `include` fordert sowohl `web_search_call.action.sources` als auch `web_search_call.results` an.
- `results` ist ausschließlich Observability und wird nie als Evidence gelesen.
- Evidence-URLs werden ausschließlich aus `action.sources[]` mit `type:"url"` oder aus dokumentierten `output_text.annotations[]` mit `type:"url_citation"` übernommen.
- Ein abgeschlossener, exakter Einzel-Call ohne attributable URL wird intern als `phase6_research_provenance_missing` markiert und läuft durch Stage 2 zum bestehenden Record-RPC.
- Der Validator erzwingt für diesen Fall terminal `needs_review`, `p_segment:null`, `evidence_provenance.valid:false`, leere `verified_sources` und leere validierte positive Evidence-Codes. Ein Stage-2-Accept-Vorschlag kann das nicht überstimmen.

Falsches Modell, unvollständiger Response, falsche Query, zusätzliche Search-Calls, fehlerhafte IDs, unbekannte Output-Items, malformed Source-/Annotation-Strukturen, ungültige URLs und Domain-Scope-Verletzungen bleiben technische Hard Errors.

## Unveränderter Vertrag

- Taxonomie: `nt_taxonomy_v2_20260819_cx8`
- Classifier: `segment_classifier_v5_20260820_cx8`
- Prompt: `segment_prompt_v5_20260820_cx8`
- Policy: `nt_policy_v4_20260820_cx8_shadow` (inaktiv)
- Quality Gate: `nt_quality_gate_v4_20260820_cx8` (inaktiv)
- Research: `segment_research_v1_20260820_cx8`
- Validator: `n8n_cx8_validator_v2`
- Research-Modell: `gpt-4o-mini-2024-07-18`
- Classifier-Modell: `gpt-5.5-2026-04-23`, Reasoning `medium`
- Evaluation-Quelle: `gold_re_evaluation_phase6`
- Claim-Limit: exakt ein Job, kein Node-Retry
- Master-Projektion: nicht autorisiert

Es gibt keine DB-, Schema-, Policy-, Gate-, Cache-, Master- oder Trello-Änderung. Der allgemeine v2-Vertrag bleibt autoritativ.

## Datenschutz- und Provenienzgrenze

Die deterministische Domainquery bleibt:

`site:<domain> Unternehmen Leistungen Kundenprojekte Standorte Impressum`

Der streng freigegebene Firmenfallback bleibt:

`<company> offizielle Website Unternehmen Leistungen Kundenprojekte Standorte`

Stage 1 erhält weiterhin ausschließlich diese Query plus statische Instructions; interne Job-/Request-IDs, Input-Hash, Name, E-Mail, Telefon, Adress-, Tracking-, Gold-, Cache- und Historiedaten bleiben ausgeschlossen. Die Parser-Allowlist normalisiert HTTP(S)-URLs, blockiert Credentials, localhost/private Netze, begrenzt URLs auf 2.048 Zeichen, dedupliziert kanalübergreifend und speichert deterministisch höchstens die ersten 20 eindeutigen Quellen mit Search-Call- und Response-Bindung. Auch alle späteren Provider-Items werden noch vollständig typ-, URL- und Domain-validiert; nur weitere gültige eindeutige URLs werden nach dem Cap nicht materialisiert. Bei Domainrecherche muss jede Evidence-URL exakt zur erlaubten Domain oder deren Subdomain gehören.

`web_search_call.results` kann zu Diagnosezwecken im Provider-Response vorhanden sein, erzeugt aber weder eine Allowlist-Quelle noch validierte Evidence.

## Gepinnter Live-v3-Prestate

Der vollständige aktuelle Draft- und Published-Active-Stand wurde read-only am `2026-08-20T14:49:28Z` gesichert:

- Workflow: `ELpwCfdWOCRZ22gy`
- Draft/Active-Version: `1e0d0ac1-4035-4ad2-8dbb-a191a4bd5e88`
- Version Counter: `120`
- Nodes/Connection-Quellen: `20/17`
- Draft-Datei SHA-256: `923524c2e64585b481c1a950652ea99afcac005187a3693b0f1435e1ad8a1512`
- Active-Datei SHA-256: `12429e3a173db3f5579023a02539ef16f3fef69a54e0561e9bbce1cc5598ee6d`
- Draft/Active-Graph SHA-256: `4b5a7c2187a05f5c39f62968efeed983e1011ac670b924a15bf7ae9d8f852485`

Der Graph ist bytegleich zum ursprünglichen v3-Graph. Die unterschiedlichen vollständigen Datei-Hashes entstehen ausschließlich aus aktueller Versions-/Zeitmetadaten.

## Forward, Reverse und erlaubter Delta-Raum

`forward-patch.json` enthält neun atomare Operationen: fünf bestehende Phase-6-relevante Nodes werden auf den unveränderten v5-Vertrag gesetzt, drei Phase-6-Nodes werden ergänzt und die dafür nötigen Connections ersetzt. Der Kandidat hat `23` Nodes und `20` Connection-Quellen.

`reverse-patch.json` enthält neun exakte Gegenoperationen. Der Offline-Roundtrip stellt den vollständigen gepinnten v3-Prestate bytegleich wieder her. `full-diff.json` und `expected-diff.json` pinnen den vollständigen erlaubten Delta-Raum; Settings und Aktivierung bleiben unverändert.

## Fokussierte Prüfungen

Die Recovery-Suite deckt unter anderem ab:

- die drei beobachteten Missing-Sources-Responseformen,
- positive `url_citation`-Fallback-Provenienz,
- `results`-only als nicht vertrauenswürdige Observability,
- malicious/cross-domain Annotationen,
- falsche Source-Typen, ungültige URLs, mehrfache Calls und Query-Rewrite,
- semantischen Terminalpfad ohne Failure-RPC,
- `accepted` nur mit gebundener attributable Source,
- leere Provenienz-Codes/Quellen bei `phase6_research_provenance_missing`,
- exakten Forward/Reverse-Roundtrip gegen Live-v3.

Lokaler Test:

`node --test n8n/patches/2026-08-20-request-segmentation-phase6-provenance-recovery/provenance-recovery.test.mjs`

n8n wird ausschließlich mit `validateOnly:true` für Forward und Forward+Reverse geprüft. Ein erfolgreicher `validateOnly`-Call ist kein Runtime-Beweis und verändert Draft oder Published Active nicht.

## Recovery-Runbook für einen später freigegebenen Pilot

Wegen der drei bereits fälligen v5-Pending-Jobs darf ein späteres Publishfenster genau einen Job zulassen:

1. Unmittelbar vor dem Fenster v2/v5-`processing=0`, Locks, Jobstände sowie den vollständigen v3-Draft/Active-Stand erneut prüfen.
2. Direkt nach einem natürlichen v3-Scheduler-Tick den Forward gegen die exakt gepinnte Live-Version anwenden und vollständig zurücklesen.
3. Nur den nächsten natürlichen Tick zulassen. Der dedizierte Claim bleibt auf `p_limit:1`, ohne Node-Retry.
4. Sobald genau ein v5-Job geclaimt bzw. dessen Execution sichtbar ist, den exakten v3-Reverse noch vor dem folgenden Scheduler-Tick anwenden und vollständig zurücklesen.
5. Die bereits gestartete v5-Execution bis zum terminalen DB-Record beobachten; danach `processing=0`, `locked=0`, genau einen neuen terminalen Job, unveränderte restliche Pending-Jobs sowie keine Cache-/Master-/Trello-Wirkung beweisen.
6. Erst nach separater Auswertung ein neues Ein-Job-Fenster erwägen. Keine manuelle Ausführung, kein manueller Claim, Retry oder Job-Mutation.

Wenn der Reverse nicht sicher vor dem folgenden Tick bestätigt werden kann, wird kein Publishfenster geöffnet.
