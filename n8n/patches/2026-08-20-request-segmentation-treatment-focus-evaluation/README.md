# NEONTRIP Request Segmenter – Treatment-Focus-Evaluation

Status: lokal vorbereitet und vollständig ohne Write mit n8n `validateOnly`
geprüft. Die Base-Datenbankmigration, der n8n-Forward, das Vier-Gold-Staging
und die Runtime sind noch nicht angewandt beziehungsweise ausgeführt.

## Fachliches Ziel

Der Kandidat bildet zuerst den späteren Behandlungsunterschied ab:

- `standard`: Privat, Gruender, kleine Unternehmen, Restaurants und andere
  normale Anfragen;
- `special`: öffentliche/institutionelle Kunden, Franchise/Multi-Site,
  Enterprise oder anderweitig belegtes `large|enterprise`.

Die CX8-Segmente bleiben als Diagnose erhalten. Sie lösen in diesem Pilot aber
keine Kundenaktion aus. `special` ist nur ein Evaluationsmarker für einen
späteren zurückhaltenderen Follow-up- und formelleren Angebotsprozess.

## Einfache Evidence-Regeln

- Freemail und Shared Provider führen nie zu Webrecherche.
- Eindeutige private Nutzung im minimierten Anfrageinhalt kann `NT-8` als
  `standard` belegen. Freemail allein genügt nicht.
- Eindeutige gewerbliche Nutzung trotz Freemail kann das passende normale
  Business-Segment als `standard` belegen.
- Unklare Nutzung bleibt `needs_review`; es gibt keinen Fallback.
- Bei einer gültigen Firmendomain wird ausschließlich diese Domain samt echter
  Subdomains recherchiert. Der OpenAI-Web-Search-Request enthält zusätzlich
  `filters.allowed_domains=[email_domain]`.
- Firmenname, Personenname und vollständiger Anfragekontext werden nie als
  Suchanfrage verwendet.
- Ein Standardfall darf durch exakte `request`-Evidence aus dem minimierten
  Titel, Beschreibung oder Anwendungszweck angenommen werden.
- Jede besondere Behandlung braucht passend gebundene `web_search`-Evidence.
  Ohne belegte URL bleibt sie `needs_review`.

## Versionierter Vertrag

- Taxonomie: `nt_taxonomy_v2_20260819_cx8`
- Classifier: `segment_classifier_v6_20260820_treatment_focus`
- Prompt: `segment_prompt_v6_20260820_treatment_focus`
- Policy: `nt_policy_v5_20260820_treatment_focus_shadow` (inaktiv)
- Quality Gate: `nt_quality_gate_v5_20260820_treatment_focus` (inaktiv)
- Research: `segment_research_v2_20260820_domain_filter`
- Treatment: `treatment_focus_v1_20260820_standard_vs_special`
- Validator: `n8n_cx8_validator_v3`
- Worker: `n8n-request-segmenter-v6`
- Quelle: `gold_re_evaluation_phase7_treatment`
- Research-Modell: `gpt-4o-mini-2024-07-18`
- Classifier-Modell: `gpt-5.5-2026-04-23`, Reasoning `medium`

## Wirkungsgrenze

Die Lane ist strikt evaluation-only:

- exakt vier immutable-current Gold-Fälle;
- Claim-Limit exakt `1`, kein Node-Retry und kein manueller Run;
- `master_projection_authorized=false`;
- kein Master-, Cache-, Trello-, E-Mail-, WhatsApp-, Angebots-, Preis- oder
  Follow-up-Write;
- Candidate-Policy/Gate inaktiv, acht Rules vollständig inert;
- die bestehende v2-Policy und das bestehende v2-Gate bleiben allein aktiv.

## Gepinnter Prestate

Read-only gesichert am `2026-08-20T19:12:57.305Z`:

- Workflow `ELpwCfdWOCRZ22gy`
- Draft/Active-Version `8e783830-6a38-4dae-aa32-2daf49d1387a`
- Counter `128`, aktiv und nicht archiviert
- `20` Nodes / `17` Connection-Quellen
- Draft/Active-Graph exakt gleich
- Graph SHA-256
  `4b5a7c2187a05f5c39f62968efeed983e1011ac670b924a15bf7ae9d8f852485`
- Draft-Datei
  `c7756bbe7194719a98b0b8c3fc22f2d9f1c6f819709beec38ef7222c06cd303b`
- Active-Datei
  `f5154b6eb162cbe3062c0e02e2af7a5b36b32676a4d0d18c2f2650a5f1fbf462`

## Artefakte

- Forward, 9 atomare Operationen, Ziel `23/20`:
  `18274c980c435df29eb41ce3123f81d8ff4bac749fe9ec3056a74bb55b95897b`
- Reverse, 9 Gegenoperationen, Ziel `20/17`:
  `ae37d95727df250f4a6b77b030787da7feb52533e69de00414d9ffaaf7930ba9`
- Candidate-Graph:
  `c254c6b2558a301ea7dca9407c28129e00359444d65e5c7985f177815ae91ec5`
- Full diff:
  `726b73e55af12bbe1a7b4202a2bfa0f3ff548fc483c8442208426e790aa69335`
- Expected diff:
  `7cf8afff83d2fa3d456d4f11a41363cce10048f95c411ba9af80410416bc62dc`
- Source:
  `a15d37c88cc075d0e21461ae5b9ca00bd92f1e99b7301ee4c7d373811c9f9069`
- Test:
  `d0e1a645e0450bb73a1d42f89fa41bcdebbd6e608a66b5d4cf7327c6137fa89`
- Generator:
  `330641b13fd1c902f71a0e762f2d778eb90e27dc0a6f592e856645aec587aaf5`

## Lokal belegte Prüfungen

- Treatment-Focus n8n: `13/13`
- SQL-Schemafokus einschließlich Treatment: `44/44`
- Phase-2-Schema: `17/17`
- Phase-3/Phase-6-Provenienz/URL-Nachbarschaft: `60/60`
- vollständiges `npm run test:quotes`: `923/923`
- `npx tsc --noEmit`: grün
- `npm run build`: grün
- pglast: Base, Held, beide Rollbacks und Snapshot parsebar
- n8n `validateOnly`: Forward `9/9`, Forward+Reverse `18/18`, nicht
  angewandt

## Gehaltener Produktionsablauf

1. Exakten DB- und n8n-Prestate erneut lesen. Bei Drift abbrechen.
2. Base-Migration anwenden und beweisen: v2 allein aktiv, Kandidat inaktiv,
   18-/19-/20-Argument-Record auflösbar, Candidate-Lane leer.
3. Exakten Forward publizieren, vollständigen Draft/Active-Graph zurücklesen
   und einen natürlichen leeren v6-Claim beweisen.
4. Erst dann das Held-Artefakt anwenden; es staged genau vier Gold-Jobs und
   flippt keine Policy.
5. Nur natürliche Scheduler-Ticks zulassen. Beim ersten technischen oder
   Vertragsfehler sofort den exakten Reverse vor dem Folgetick publizieren.
6. Spätestens nach vier terminalen Jobs ebenfalls reverse auf v3, vollständiger
   Readback und natürlicher v2-Claim0.
7. Abschließend Job/Klassifikation, Treatment-Auswertung, Master, Cache, Gold,
   Policy/Gate und alle Kundenaktionsgates read-only prüfen.

Keine manuelle Ausführung, kein manueller Claim, Retry, Reset oder Kundenfall
als Canary.
