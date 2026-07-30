# NEONTRIP KI-Modell-Update-Monitor

Production n8n workflow for official-source model-update alerts from OpenAI/ChatGPT, Anthropic/Claude, and Google/Gemini. Email summaries are generated in German from the fetched official excerpts, then deterministically validated before delivery.

## Plan and node structure

1. Schedule trigger runs at minute 15 every six hours in `Europe/Berlin`.
2. Six HTTP nodes fetch official RSS feeds, changelogs, release notes, and the Anthropic sitemap with retries and hard failure handling.
3. `Updates analysieren` validates every source, extracts model IDs and lifecycle events, uses stable event identities, and checks workflow static data.
4. A schema-version change creates a silent one-time baseline so the new key format cannot resend historical releases.
5. `Neue Updates?` routes only unseen updates into the summary branch.
6. `Deutsche Key Points erstellen` uses `gemini-3.5-flash` to propose 2–4 German bullets and per-model event roles from the official excerpts only. Search, URL context, and code execution are disabled.
7. `E-Mail finalisieren` validates keys, bullet lengths, event types, and model IDs. Invalid or missing model output is replaced by deterministic German fallback bullets.
8. Workflow impacts are emitted only when a model classified as released/updated/deprecated/shutdown exactly matches the confirmed production dependency inventory.
9. Outlook sends at most one aggregate HTML email per run to `info@neontrip.de`.
10. The idempotency keys are persisted only after successful delivery. The no-change branch initializes or refreshes the baseline.
11. Runtime failures stop the workflow and are routed through `NEONTRIP Error Alerting v1.0`; summary-only failures fall back safely after retries.

## NEONTRIP impact inventory

Confirmed read-only on 2026-07-30:

- Anthropic `claude-sonnet-4-6`: active AI Email Agent nodes.
- OpenAI `gpt-4o-mini` and `gpt-4o`: active Request Segmenter and unstructured-request nodes.
- Gemini `gemini-3.5-flash`: active Preview Delivery video QC and this monitor's German summary node.
- Gemini `gemini-3-pro-image`: active Gemini Mockup Worker lanes/manual retry and customer color-variant generation.
- Gemini `gemini-2.5-flash`: active customer color QA analysis.

General provider, family, modality, comparison-model, replacement-model, and “potential test candidate” matches do not produce affected-workflow cards. The old `9FoJMH6OUdsi36FB` / `HIFQvcfBKPEK9oSN` and Runway mappings were removed.

## Official sources

- `https://openai.com/news/rss.xml`
- `https://developers.openai.com/api/docs/changelog`
- `https://platform.claude.com/docs/en/release-notes/overview`
- `https://www.anthropic.com/sitemap.xml`
- `https://ai.google.dev/gemini-api/docs/changelog`
- `https://blog.google/technology/ai/rss/`

## Risks

- A provider can change its HTML structure. Source-length validation and per-provider candidate validation fail closed and trigger operations alerting.
- RSS and changelog coverage can overlap. The workflow aggregates all findings into a single message and deduplicates by stable source/event identity.
- The impact inventory is intentionally small and explicit. It must be updated when production model IDs or owning workflows change.
- The AI summary can omit or misclassify a detail. Model IDs are constrained to IDs present in the official excerpt, exact dependency matching is deterministic, and invalid summaries use fallback bullets without emitting an uncertain workflow impact.
- Workflow static data is scoped to this workflow. Recreating the workflow requires a fresh baseline run before notifications resume.
- Outlook credentials can expire. Retries occur before the global error workflow alerts support.

## Test plan

- `node test-parser.js` uses hermetic official-source-shaped fixtures to verify seed/no-change/key-migration behavior, complete ER-2 endpoint extraction, German bullets, safe fallback, no Robotics false positive, and exact `gemini-3.5-flash` dependency matches.
- Validate generated JSON using strict n8n workflow validation.
- Publish with the six-hour schedule unchanged. The first run after the schema upgrade establishes a silent baseline without sending email.
- Confirm the active graph, node count, model ID, disabled built-in Gemini tools, and a successful baseline/no-change execution.
- Do not send a synthetic production email to `info@neontrip.de`; Outlook delivery is covered by the existing credential used by active NEONTRIP workflows.

## Rollback

- Immediate: deactivate n8n workflow `vseFp5GZU975CeOM`.
- Structural: restore `backups/2026-07-30/vseFp5GZU975CeOM.active-before.json` or the pre-update n8n version.
- Full removal: delete the inactive workflow after confirming no execution is running.
- The workflow writes no external database state. Its only side effect is the internal notification email.

## Files

- `build-workflow.js`: canonical generator and embedded parser/recording logic.
- `neontrip-ai-model-update-monitor-v1.json`: generated import artifact.
- `test-parser.js`: hermetic parser, idempotency, German summary, fallback, and exact dependency-matching tests.
