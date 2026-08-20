# NEONTRIP Request Segmenter – Phase 6 private research

Status: lokal vorbereitet und vollständig read-only validiert. Es wurde kein n8n-Write, Publish, Aktivierungswechsel, Workflow-Run, OpenAI-Request oder Kunden-/Trello-Effekt ausgeführt.

## Ziel und unveränderter Nachbar

Der Phase-6-Kandidat ersetzt im bestehenden Workflow `ELpwCfdWOCRZ22gy` ausschließlich den kontrollierten Evaluationspfad. Er verarbeitet nur dediziert geclaimte Jobs mit `source=gold_re_evaluation_phase6`; der allgemeine Claim-/Payload-RPC wird nicht als Phase-6-Ingress verwendet.

Die aktiven Phase-2-Verträge, vorhandenen v2-Jobs und sonstigen Daten bleiben unverändert. Während eines später ausdrücklich freigegebenen Phase-6-Pilotfensters würde der einzige Worker jedoch den dedizierten Phase-6-Claim statt normaler v2-Jobs bedienen. Die normale v2-Verarbeitung ist in diesem Fenster deshalb pausiert, nicht gelöscht oder migriert. Nach dem exakt begrenzten Pilotfenster muss der exakte Reverse-Patch wiederhergestellt werden.

## Gepinnter Vertrag

- Taxonomie: `nt_taxonomy_v2_20260819_cx8`
- Classifier: `segment_classifier_v5_20260820_cx8`
- Prompt: `segment_prompt_v5_20260820_cx8`
- Policy: `nt_policy_v4_20260820_cx8_shadow` (inaktiv)
- Quality Gate: `nt_quality_gate_v4_20260820_cx8` (inaktiv)
- Research: `segment_research_v1_20260820_cx8`
- Validator: `n8n_cx8_validator_v2`
- Worker/Accepted by: `n8n-request-segmenter-v5`
- Evaluation source: `gold_re_evaluation_phase6`
- Claim RPC: `neontrip_claim_request_segmentation_phase6_evaluation`
- Payload RPC: `neontrip_get_request_segmentation_phase6_evaluation_payload`
- Record RPC: 19-Argument-Overload von `neontrip_record_request_segment_classification` mit verpflichtendem `p_research_contract`

Der Claim ist absichtlich auf `p_limit:1`, `retryOnFail:false` und `maxTries:1` begrenzt. Damit kann ein verlorener HTTP-Response nicht unbemerkt weitere Gold-Jobs claimen. IDs bleiben nur in der internen Item-Lineage; sie erscheinen in keinem OpenAI-Body.

## Zwei getrennte Modellstufen

Stage 1 verwendet `gpt-4o-mini-2024-07-18` über einen direkten Responses-HTTP-Request mit der vorhandenen `openAiApi`-Credential. Der Body enthält als `input` ausschließlich die deterministisch erzeugte Einzeilenquery (maximal 240 Zeichen), genau ein angebotenes `web_search`-Tool, `tool_choice:"required"`, deutschen Standortkontext, `include:["web_search_call.action.sources"]` und `store:false`. Der Node hat keinen Retry.

Erlaubte Queryformen:

- Domain: `site:<domain> Unternehmen Leistungen Kundenprojekte Standorte Impressum`
- Firmenfallback: `<company> offizielle Website Unternehmen Leistungen Kundenprojekte Standorte`

Der Domainpfad verlangt eine gültige, cache-erlaubte, nicht freie und nicht geteilte Domain sowie `domain_lookup_allowed=true`. Der Firmenfallback verlangt zusätzlich das explizite DB-Flag `company_lookup_allowed=true`, keinen erlaubten Domainpfad und den bytegleich validierten Firmenwert. Single-Token-, personenähnliche, PII-, URL-, Telefon-, UUID-, Tracking-, lange ID-artige und überlange Werte werden nicht gesucht. Reine lange Firmenwörter bleiben zulässig. `max_tool_calls` und `parallel_tool_calls` wurden bewusst nicht ergänzt, weil ihre Kompatibilität mit diesem gepinnten Modell-/Web-Search-Vertrag nicht live bewiesen ist. Stattdessen erzwingt die Prepare-Stufe exakt einen abgeschlossenen `web_search_call` mit `action.query === generatedQuery`.

Stage 2 verwendet `gpt-5.5-2026-04-23` mit `reasoning:{effort:"medium"}`, `max_output_tokens:8000`, 300 Sekunden HTTP-Timeout, strict JSON Schema, `tools:[]`, `tool_choice:"none"` und `store:false`. Es gibt kein `temperature` oder `top_p`. Der Body enthält nur den minimierten DB-Kontext und ein begrenztes, ausdrücklich untrusted Research-Paket. Unvollständige, verweigerte, modellfalsche oder Tool-enthaltende Responses werden vor dem Record-RPC abgelehnt.

Für NT-9 genügt exakt gebundene externe `verified_direct_business`-Evidence am `segment_role`-Item, nachdem die Taxonomiepriorität angewendet und höher priorisierte Rollen ausgeschlossen wurden. Jede zusätzlich gebundene positive Evidence für eine höher priorisierte Rolle (`institution_status`, `segment_role` oder `organization_scale`) setzt deterministisch `conflicting_evidence` und erzwingt `needs_review`; eine bloße `context_tag`- oder `conflict`-Verwendung zählt nicht als positiver Rollenkonflikt. Das unverifizierte Pilotfeld `unknown/false` wird dabei nicht als Evidence verwendet. NT-8 bleibt ausschließlich mit verifiziertem explizitem Privatbeleg zulässig.

## Datenschutz und Provenienz

Der Payload ist auf die exakten Top-Level-Keys `contract,input,taxonomy,context_definitions,organization_scale_values` begrenzt. `input` hat exakt zehn freigegebene Keys; für diesen Vier-Gold-Pilot sind `declared_customer_type="unknown"` und `declared_customer_type_first_party_verified=false` zwingend. Gold, Cache, Historie, Namen, volle E-Mail, Telefon, UUIDs, Attribution, Landingpage-/Trackingwerte sowie rohe oder unbegrenzte Request-/Customerrecords sind verboten. Zulässig sind ausschließlich die exakt minimierten, redigierten und begrenzten Felder `title`, `description`, `application`, `country`, der streng freigegebene Firmen-/Domainkontext und die gepinnten Vertragsdaten.

Stage-1-Quellen sind auf 20 normalisierte HTTP(S)-URLs mit jeweils maximal 2.048 Zeichen begrenzt; Response- und Call-IDs sind nichtleer und maximal 320 Zeichen. Doppelte normalisierte URLs werden dedupliziert. Der Validator materialisiert alle vollständig validierten Stage-1-Quellen mit separater Response-/Call-Bindung in `verified_sources`; Stage-2-Evidence ergänzt positive Codes nur an tatsächlich passende Quellen. Bei einer fachlichen Abstention bleiben die technischen Stage-1-Quellen mit leeren Code-Arrays erhalten, während `valid=false` bleibt. `evidence_provenance` hat exakt den gemeinsam mit der DB gepinnten 15-Key-Vertrag; `verified_sources[]` hat exakt fünf Keys. Research-Cache-Provenienz ist in Phase 6 verboten.

## Graphänderung

Der Kandidat hat 23 statt 20 Nodes und 20 statt 17 Connection-Quellen. Neu sind:

- `Research Required?`
- `Company Research`
- `Prepare Strict Classification`

Fünf bestehende Nodes werden begrenzt aktualisiert: Claim, Payload, Build, Classifier und Validator. Der bestehende Fehlerpfad wird für alle drei neuen Nodes weiterverwendet. Der bestehende, deaktivierte Trello-Zweig bleibt unverändert und liefert weiterhin keine Items.

## Backup, Forward und Reverse

Der vollständige Draft- und Published-Active-Stand wurde read-only am `2026-08-20T12:10:31Z` gesichert:

- Version/Active-Version: `5dc73e80-3249-4985-a51b-001c5cb69223`
- Version Counter: `118`
- Draft SHA-256: `f0927f96011b340e9198f083b3ab0cb85b4880d8052e86e24f4c9a4cc2487a9e`
- Active SHA-256: `59f4a6bfe5ce524eebfbb867c320ad86365e2307d872d45b193e6b5b1f2147cc`
- Graph SHA-256: `4b5a7c2187a05f5c39f62968efeed983e1011ac670b924a15bf7ae9d8f852485`

`forward-patch.json` enthält neun atomare Operationen. `reverse-patch.json` enthält neun exakte Gegenoperationen und stellt den vollständigen v3-Prestate bytegleich im Offline-Harness wieder her. `full-diff.json` und `expected-diff.json` pinnen den vollständigen erlaubten Delta-Raum.

## Validierung

- Phase-6 Offline-Suite: 23/23 grün, einschließlich NT-9-Positiv-/Konfliktfällen und Research-Abstention-Provenienz.
- Vollständiger Kandidatengraph: gültig, 23 Nodes, 23 gültige Verbindungen, 0 ungültige Verbindungen, 0 Fehler, 11 bereits vorhandene Warnungen zum deaktivierten Trello-Zweig bzw. bestehenden Payload-Gate.
- n8n `validateOnly` Forward: 9/9 gültig.
- n8n `validateOnly` Forward plus Reverse: 18/18 gültig.
- Vollständiger Draft- und Published-Active-Live-Readback nach `validateOnly`: exakt unverändert auf Version `5dc73e80-3249-4985-a51b-001c5cb69223`, Counter 118, 20 Nodes und 17 Connection-Quellen.

Die älteren Phase-3- und Phase-5-Funktionsprüfungen liefen ebenfalls grün. Der übergreifende Altsuite-Lauf enthält zwei nicht durch Phase 6 verursachte Harness-Probleme: lokal fehlt das Phase-2-Testpaket `ajv`, und ein Phase-5-Standalone-Artefakt pinnt den absoluten Pfad seines ursprünglichen Worktrees.

## Spätere, separat freizugebende Betriebsreihenfolge

1. Zuerst nur die inaktive Phase-6-DB-Basis separat ausrollen und nachweisen; Phase 2 bleibt aktiv und autoritativ.
2. Vor dem n8n-Write nachweisen, dass keine v2-Segmentierungsjobs mehr `processing` sind. Full/Active-Version, Counter, Graph und Node-Hashes unmittelbar davor erneut gegen das Manifest prüfen.
3. Den n8n-v5-Forward atomar anwenden, veröffentlichen, vollständig diffen und Draft sowie Published Active vollständig zurücklesen.
4. Vor jeder Gold-Staging-Aktion einen natürlichen v5-Claim-Lauf mit leerem Ergebnis (`[]`) nachweisen.
5. Erst danach exakt vier gehaltene Gold-Evaluationsjobs separat freigeben und ausschließlich deren dedizierte Verarbeitung beobachten; kein Kundenkanal und keine Trello-Projektion.
6. Nach dem Viererfenster erneut `processing=0` nachweisen, dann den exakten Reverse auf v3 anwenden, veröffentlichen und vollständig zurücklesen.
7. Abschließend die natürliche Wiederaufnahme der normalen v2-Verarbeitung und den Queue-Zustand nachweisen.

Diese Betriebsreihenfolge ist nicht Teil des vorliegenden lokalen Prepare-Schritts.
