# NEONTRIP KI-Modell-Update-Monitor

Production n8n workflow for official-source model-update alerts from OpenAI/ChatGPT, Anthropic/Claude, Google/Gemini, and xAI/Grok. Email summaries are generated in German from the fetched official excerpts, then deterministically validated before delivery.

## Plan and node structure

1. Schedule trigger runs at minute 15 every six hours in `Europe/Berlin`.
2. Eight HTTP nodes fetch official RSS feeds, changelogs, release notes, and the Anthropic sitemap with retries and hard failure handling.
3. `Updates analysieren` validates every source, extracts model IDs and lifecycle events, uses stable event identities, and checks workflow static data.
4. A schema-version change creates a silent one-time baseline so the new key format cannot resend historical releases.
5. `Neue Updates?` routes only unseen updates into the summary branch.
6. `Deutsche Key Points erstellen` uses `gemini-3.5-flash` to propose 2–4 German bullets and per-model event roles from the official excerpts only. Search, URL context, and code execution are disabled.
7. `E-Mail finalisieren` validates keys, bullet lengths, event types, and model IDs. Invalid or missing model output is replaced by deterministic German fallback bullets.
8. Workflow impacts are emitted only when a model classified as released/updated/deprecated/shutdown exactly matches the confirmed production dependency inventory.
9. Outlook sends at most one aggregate HTML email per run to `info@neontrip.de`.
10. Notification idempotency keys are persisted only after successful delivery. The no-change branch initializes or refreshes the baseline.
11. Runtime failures stop the workflow and are routed through `NEONTRIP Error Alerting v1.0`; summary-only failures fall back safely after retries.

## Repair prepared on 2026-09-30

- Workflow ID: `vseFp5GZU975CeOM`. Observed published version: `06022b5f-52c8-416a-b100-66a887c4107d`, created 2026-09-06, named `Weekly AI model news: Monday 09:15 Berlin`. Its cron was `15 9 * * 1`; the trigger label still said six hours.
- Restore the documented `15 */6 * * *` schedule: 00:15, 06:15, 12:15, 18:15 in `Europe/Berlin`. Notifications remain conditional on unseen updates, not mandatory every six hours.
- All six existing sources currently return HTTP 200 from the local verified TLS client. The old parser silently extracts zero entries from the OpenAI API and Anthropic release-note sources; their other provider sources mask this gap. Parse official OpenAI Markdown and remove Anthropic heading button text; require each repaired source to produce model entries.
- xAI release notes and model catalog return HTTP 200; `https://x.ai/news` returns HTTP 403 on direct requests and is excluded. xAI Markdown omits exact publication days/years, so the monitor preserves its month labels without inventing dates. Model IDs come from text, not Markdown link destinations.
- Keep existing sent keys. Reuse the existing schema-migration mechanism with schema 3: the first successful scheduled check adds a silent baseline for all current findings, including restored coverage and xAI; it deliberately sends no historical catch-up email. Existing keys are retained, then unchanged replay produces no notification.
- Save successful executions as well as errors so future scheduled checks and send/no-send branches are traceable. The pre-repair setting was `none`, and no historical executions for this workflow are currently returned. Persisted static data records the last successful send path on 2026-09-28 at 07:15 UTC; mailbox delivery was not independently inspected.
- Keep the existing summary fallback, Outlook credential references and global error workflow. Outlook sends are not exactly-once: an ambiguous remote acceptance/timeout can duplicate a retry; a successful send followed by failed state persistence can also replay. This repair does not introduce a new delivery ledger.
- Ziel: six-hour official-source checks including Grok, working OpenAI/Anthropic extraction. Nachbar: deterministic summaries, exact impact matching, internal recipient, existing credentials/error route. Wirkung: one conditional internal email after successful validated analysis; local tests do not send mail. Allowed tracked files: this directory.
- The code and import artifact are prepared locally. Publication requires the exact clean commit approval specified by repository `AGENTS.md`; preparation is not runtime proof. Before an authorized write, refresh and back up the complete workflow, recheck the active/draft version, patch only the intended fields, compare the complete readback and confirm the published graph. The monitor is not currently exposed to n8n instance MCP; no exposure flag or production test run is introduced by this repair.

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
- `https://developers.openai.com/api/docs/changelog.md` (official Markdown; fixes the changed HTML date layout)
- `https://platform.claude.com/docs/en/release-notes/overview`
- `https://www.anthropic.com/sitemap.xml`
- `https://ai.google.dev/gemini-api/docs/changelog`
- `https://blog.google/technology/ai/rss/`
- `https://docs.x.ai/developers/release-notes.md`
- `https://docs.x.ai/developers/models.md` (catalog presence; not a release date)

## Risks

- A provider can change its HTML structure. Source-length validation and per-provider candidate validation fail closed and trigger operations alerting.
- RSS and changelog coverage can overlap. The workflow aggregates all findings into a single message and deduplicates by stable source/event identity.
- The impact inventory is intentionally small and explicit. It must be updated when production model IDs or owning workflows change.
- The AI summary can omit or misclassify a detail. Model IDs are constrained to IDs present in the official excerpt, exact dependency matching is deterministic, and invalid summaries use fallback bullets without emitting an uncertain workflow impact.
- Workflow static data is scoped to this workflow. Recreating the workflow requires a fresh baseline run before notifications resume.
- Outlook credentials can expire. The existing retry policy precedes global error alerting; ambiguous acceptance is a duplicate-delivery risk.

## Test plan

- `node test-parser.js` uses hermetic official-source-shaped fixtures to verify seed/no-change/key-migration behavior, complete ER-2 endpoint extraction, German bullets, safe fallback, no Robotics false positive, and exact `gemini-3.5-flash` dependency matches.
- Optional `node test-parser.js <official-source-cache-directory> <pre-repair-workflow-snapshot>` checks freshly fetched source bodies and a cloned copy of the existing sent-key state; it has no network, email, or production writes. The cache uses each output-field name plus `.txt`, with `openaiApiMarkdown.txt` for OpenAI API.
- Validate generated JSON using strict n8n workflow validation.
- Publish with the six-hour schedule unchanged. The first run after the schema upgrade establishes a silent baseline without sending email.
- Confirm the active graph, node count, model ID, disabled built-in Gemini tools, and a successful baseline/no-change execution.
- Do not send a synthetic production email to `info@neontrip.de`; Outlook delivery is covered by the existing credential used by active NEONTRIP workflows.

## Rollback

- Immediate: deactivate n8n workflow `vseFp5GZU975CeOM`.
- Structural: restore the complete freshly captured pre-repair workflow and activation state, after rechecking concurrent changes. The local preparation snapshot is outside Git in `~/codex-backups/ai-model-update-monitor-20260930-094724/`; refresh it immediately before a live write.
- Full removal: delete the inactive workflow after confirming no execution is running.
- The workflow writes no external database state. Its only side effect is the internal notification email.

## Files

- `build-workflow.js`: canonical generator and embedded parser/recording logic.
- `neontrip-ai-model-update-monitor-v1.json`: generated import artifact.
- `test-parser.js`: hermetic parser, idempotency, German summary, fallback, and exact dependency-matching tests.
