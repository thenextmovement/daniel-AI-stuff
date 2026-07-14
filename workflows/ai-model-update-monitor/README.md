# NEONTRIP KI-Modell-Update-Monitor

Production n8n workflow for deterministic email alerts about model updates from OpenAI/ChatGPT, Anthropic/Claude, and Google/Gemini.

## Plan and node structure

1. Schedule trigger runs at minute 15 every six hours in `Europe/Berlin`.
2. Six HTTP nodes fetch official RSS feeds, changelogs, release notes, and the Anthropic sitemap with retries and hard failure handling.
3. `Updates analysieren` validates every source, extracts model-related changes, categorizes Text/Multimodal, Audio, Image, and Video, and checks durable workflow static data.
4. `Neue Updates?` routes only unseen updates to Outlook.
5. Outlook sends at most one aggregate HTML email per run to `info@neontrip.de`.
6. The idempotency keys are persisted only after successful delivery. The no-change branch initializes or refreshes the baseline.
7. Runtime failures stop the workflow and are routed through `NEONTRIP Error Alerting v1.0`.

## Official sources

- `https://openai.com/news/rss.xml`
- `https://developers.openai.com/api/docs/changelog`
- `https://platform.claude.com/docs/en/release-notes/overview`
- `https://www.anthropic.com/sitemap.xml`
- `https://ai.google.dev/gemini-api/docs/changelog`
- `https://blog.google/technology/ai/rss/`

## Risks

- A provider can change its HTML structure. Source-length validation and per-provider candidate validation fail closed and trigger operations alerting.
- RSS and changelog coverage can overlap. The workflow aggregates all findings into a single message and deduplicates by stable source identity.
- Workflow static data is scoped to this workflow. Recreating the workflow requires a fresh baseline run before notifications resume.
- Outlook credentials can expire. Retries occur before the global error workflow alerts support.

## Test plan

- `node test-parser.js` verifies current live-source parsing, baseline behavior, unchanged-source deduplication, and one simulated new update.
- Validate generated JSON using strict n8n workflow validation.
- Activate first with a one-minute schedule to establish the baseline without sending email; confirm a successful execution and stored key count.
- Restore the six-hour cron, revalidate, publish, and confirm the active graph.
- Do not send a synthetic production email to `info@neontrip.de`; Outlook delivery is covered by the existing credential used by active NEONTRIP workflows.

## Rollback

- Immediate: deactivate n8n workflow `vseFp5GZU975CeOM`.
- Structural: restore a previous n8n workflow version.
- Full removal: delete the inactive workflow after confirming no execution is running.
- The workflow writes no external database state. Its only side effect is the internal notification email.

## Files

- `build-workflow.js`: canonical generator and embedded parser/recording logic.
- `neontrip-ai-model-update-monitor-v1.json`: generated import artifact.
- `test-parser.js`: deterministic parser and idempotency test against downloaded official sources in `/tmp`.
