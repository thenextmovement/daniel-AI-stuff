# NEONTRIP Request Segmenter – Phase 6 URL runtime repair

Status: lokal vorbereitet und eingefroren. Der Kandidat wurde offline und mit n8n `validateOnly` geprüft. Es wurde kein n8n-Write, Publish, Aktivierungswechsel, Workflow-Run, Job-Retry, DB-Write, OpenAI-Request oder Kunden-/Trello-Effekt ausgeführt.

Der zuvor veröffentlichte Ordner `2026-08-20-request-segmentation-phase6-provenance-recovery` bleibt als Audit-Historie byte-unverändert.

## Beobachteter Runtime-Blocker

Der erste kontrollierte Recovery-Job lief mit einer abgeschlossenen, exakt gebundenen Search-Response ohne attributable URL wie vorgesehen terminal in `needs_review`. Der zweite kontrollierte Job erhielt dagegen eine gültige Provider-Response mit:

- genau einem abgeschlossenen, exakt gebundenen `web_search_call`,
- einer `action.sources[]`-URL vom Typ `url`,
- fünf dokumentierten `url_citation`-Annotations derselben URL,
- gültiger HTTP(S)-URL auf der erlaubten Subdomain.

Die Prepare-Code-Node lief dennoch in den Failure-RPC. Ursache ist die n8n-Code-Sandbox: Der globale WHATWG-`URL`-Konstruktor steht dort nicht zur Verfügung. Der bisherige `try/catch` fing den `ReferenceError` ab, gab `null` zurück und verwandelte damit jede echte Source-URL in einen technischen Source-Fehler. Die anschließende Continue-Error-Ausgabe reduzierte den Fehlertext auf `Unknown error [line 10]`.

Der Workflow wurde unmittelbar vor dem Folgetick exakt auf v3 zurückgesetzt. Es gab keinen dritten Recovery-Claim.

## Begrenzte Änderung

Nur die URL-Normalisierung in den Candidate-Code-Nodes `Prepare Strict Classification` und `Validate Classifier Output` ändert sich:

- ein gemeinsamer, byte-identischer Helperblock wird in beide Nodes injiziert;
- der Helper verwendet ausschließlich JavaScript-Strings, Regex und Zahlen;
- kein `URL`-Global, `require`, `import`, Modul oder Runner-Konfiguration;
- `parseHttpUrl` liefert `{ url, hostname, dbHostname }`: URL und `hostname` behalten den rohen normalisierten Host, `dbHostname` bildet exakt den einmaligen DB-Strip für den Scope ab;
- Prepare nutzt die bereits geparste `dbHostname` direkt für Exact-/Subdomain-Scope und parst dieselbe Source nicht erneut;
- die aus dem DB-Kontext stammende Expected-Domain wird als bereits normalisiert validiert und ausschließlich gegen `dbHostname` verglichen;
- Validator nutzt denselben Normalisierungsblock für Stage-1-Allowlist und Stage-2-Bindung.

Alle übrigen sieben Forward-Operationen sind bytegleich zum committed Provenance-Recovery-Kandidaten. Bei Prepare und Validator sind jeweils ausschließlich die Runtime-Codefelder unterschiedlich. Connections, Credentials, Node-Typen, Positionen, Settings und Aktivierung bleiben unverändert.

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

Stage-1-Modell, Query, `input`, Instructions, `store:false`, `tool_choice:"required"`, Include-Felder und Output-Limit bleiben unverändert. Stage 2, DB-/RPC-Vertrag, Missing-Sources-Abstention und Failure-Lineage bleiben unverändert.

## Fail-closed URL-Vertrag

Zugelassen werden ausschließlich bereits getrimmte, druckbare ASCII-HTTP(S)-URLs mit höchstens 2.048 Zeichen und einem konservativen DNS-Host:

- Host lowercase, höchstens 253 Zeichen;
- mindestens zwei Labels, jedes 1 bis 63 Zeichen;
- nur ASCII-Buchstaben, Ziffern und innere Bindestriche;
- alphabetische TLD mit 2 bis 63 Zeichen;
- DB-deckungsgleiche Prüfung roher Source-Hosts nach genau einmaligem Entfernen eines führenden `www.`; die normalisierte URL behält ein gültiges `www.` bei;
- bereits DB-normalisierte Expected-Domains werden ohne zweiten `www.`-Strip geprüft und mit dem genau einmal normalisierten Source-Host verglichen;
- Exact-Domain oder echte Subdomain für Domain-Recherche.

Fail-closed abgelehnt werden unter anderem Whitespace, Backslashes, Quotes, Angle-Brackets, Backticks, Credentials/Userinfo, malformed Percent-Escapes, leere oder ungültige Ports, Port 0 oder größer 65535, trailing dot, raw Unicode, Punycode-TLD, localhost/`.local`, Single-Label, IPv4/IPv6 und numerische Host-Bypässe. Defaultports 80/443 werden entfernt, andere Ports kanonisch dezimal gespeichert. Fragmente werden entfernt, Path und Query bleiben erhalten; nur ein abschließender Slash im Path wird normalisiert. Gültige Percent-Escapes in Path/Query bleiben Daten.

`web_search_call.results` bleibt reine Observability und wird niemals Evidence.

## Gepinnter finaler v3-Prestate

Read-only gesichert am `2026-08-20T15:34:43Z`:

- Workflow: `ELpwCfdWOCRZ22gy`
- Draft/Active-Version: `3d1fb779-adb1-46d3-b199-b342a8800513`
- Version Counter: `124`
- Nodes/Connection-Quellen: `20/17`
- Draft-Datei SHA-256: `93ef238703d6fc63bd8acec5c01a55b61951cd2cef981d770969ebd455b1bf36`
- Active-Datei SHA-256: `33bfd774494435e009308c113d63cc464792c1ce8cf065f49f9ebd6aa2c3d6dc`
- Draft/Active-Graph SHA-256: `4b5a7c2187a05f5c39f62968efeed983e1011ac670b924a15bf7ae9d8f852485`

Der Graph ist exakt der gepinnte v3-Graph; nur Versions-, Counter- und Zeitmetadaten spiegeln die beiden kontrollierten Publish/Reverse-Fenster wider.

## Artefakte und Hashes

- Forward, 9 atomare Operationen, Ziel `23/20`: `a4f5784c5851acfa285cfb73f3c05eec70792d4d807d5f73dbca9c632a2d2b06`
- Reverse, 9 exakte Gegenoperationen, Ziel `20/17`: `9ba708898aca0ad0a9aa7534e87d467141d87cb0c08b917df2d5c92ddb829203`
- Full diff: `8312e059b2442c1b0d207fa83e1b289003e11203b74bce74d74d880ee157ac4d`
- Expected diff: `7d115ccf735da567977309aaab988e650dbb0d28653c14e5a63417905ff6ad1d`
- Gemeinsamer Runtime-Helper: `4147d9631f59d5fe0f35987945604061f8929219dd0e4db4dd9a04b90e61ebd5`
- Prepare Candidate-Code: `538ed892c845c36f25231f6fbcfc7782aa640764a150970ea046e214bf23bf7c`
- Validator Candidate-Code: `c42f40ce9a2c99184abe99e3a7b08b103ee39e623f287a32cc857341fa99ea77`

## Verifikation

Lokaler Haupttest:

`node --test n8n/patches/2026-08-20-request-segmentation-phase6-url-runtime-repair/url-runtime-repair.test.mjs`

Ergebnis: `34/34`.

Abgedeckt sind die bisherigen 26 Provenienztests sowie:

- VM-Ausführung mit explizit undefiniertem globalen `URL`;
- byte-identischer Helper und je Node null Vorkommen von `new URL(`, `require(` oder `import`;
- beobachtete Form mit einer Source plus fünf Duplicate-Citations;
- vollständige Accept-/Reject-Matrix für Scheme, Authority, Ports, DNS, IP-Bypässe, Unicode und Percent-Escapes;
- DB-deckungsgleiche Behandlung von `www.example.com`, `www.google`, `www.de` und den einmalig gestrippten Randfällen `www.www.de`/`www.www.www.de`;
- Scope-Matrix für bereits DB-normalisierte Expected-Domains einschließlich positiver `www.www…`-/Subdomain-Fälle und negativem Raw-Exact-vs-DB-Mismatch;
- URL-lose Missing-Sources-Abstention;
- exakte Scope-Grenze zum committed Recovery-Kandidaten.

Zusätzlich:

- Phase-3 plus committed Provenance-Recovery: `31/31`;
- Phase-5 und ursprüngliche Phase-6-Funktionstests: `29` bestanden; nur ihre zwei historischen, absolut pfadgebundenen Artefaktassertions wurden nicht als portable Nachbarschaftsprüfung gewertet;
- Offline-n8n-Validierung: `23` Nodes, `23` gültige Connections, `0` ungültige Connections, `0` Fehler, exakt `11` bestehende Warnungen;
- n8n `validateOnly`: Forward `9/9`, Forward+Reverse `18/18`;
- nach `validateOnly`: Draft/Active unverändert auf v3 `3d1fb779…`, Counter `124`, `20/17`.

## Späteres Ein-Job-Runbook

Kein weiterer Publish ist mit diesem lokalen Freeze autorisiert. Ein späteres, separat freigegebenes Fenster bleibt strikt:

1. v2/v5 `processing=0`, Locks, Jobstände und vollständigen v3-Draft/Active-Stand neu prüfen.
2. Nach einem natürlichen v3-Claim0 den Forward anwenden und Draft/Active vollständig als `23/20` zurücklesen.
3. Genau einen natürlichen v5-Claim zulassen.
4. Sobald der Claim sichtbar ist, den exakten Reverse vor dem Folgetick anwenden und v3 vollständig als `20/17` zurücklesen.
5. Den in-flight Job terminal prüfen; Cache, Master, Projektion und Trello müssen unverändert bleiben.

Keine manuelle Ausführung, kein manueller Claim, Retry oder DB-Write.
