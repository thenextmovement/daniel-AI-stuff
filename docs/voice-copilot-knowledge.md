# Voice Copilot Knowledge

## Scope

The Voice Copilot knowledge system adds reviewed internal knowledge, request-bound customer context, read-only Offers and Outlook evidence, and post-call knowledge candidates.

Postgres is the source of truth. Trello data is not used as trusted knowledge. Raw call transcripts are not stored by this implementation.

## Safety model

- Knowledge follows `draft -> review -> approved -> retired`.
- Only approved, time-valid, mode-allowed and non-restricted chunks are retrievable.
- AI post-call output is JSON-schema validated and remains a candidate until a human promotes it.
- Promotion creates another `review` version; it never publishes knowledge directly.
- Customer, offer and Outlook text is marked as untrusted input in the Realtime instructions.
- Lead and follow-up openings must identify the speaker as a digital AI assistant from NEONTRIP.
- Customer context is selected by the operator and bound to one exact `request_id` server-side.
- Offers are read through the internal Offers API. Price, totals and discount fields are excluded from the voice context.
- Outlook first uses the Postgres mirror and can add bounded read-only Graph evidence when Graph is configured.
- All new tables use RLS and explicit `service_role` grants. `anon` and `authenticated` have no access.

## Runtime flags

`VOICE_COPILOT_KNOWLEDGE_ENABLED=true` enables schema-backed knowledge, customer binding and session audit. It defaults to disabled.

`VOICE_COPILOT_EXTRACTION_MODEL` selects the Responses API model for post-call note analysis. If it is absent, post-call analysis returns `post_call_analysis_not_configured` without falling back to an unknown model.

Existing `OPS_OPENAI_API_KEY` (preferred) or `OPENAI_API_KEY`, Offers API and Microsoft Graph variables remain server-only. Post-call extraction uses `VOICE_COPILOT_EXTRACTION_MODEL` or falls back to `OPS_COPILOT_OPENAI_MODEL`.

`VOICE_LIVE_COPILOT_ENABLED=true` separately enables the human-in-the-loop dual-transcription and live-suggestion APIs. It defaults to disabled. `VOICE_COPILOT_SUGGESTION_MODEL` can override the Responses model used for live suggestions; otherwise the extraction model or `OPS_COPILOT_OPENAI_MODEL` is used. `VOICE_COPILOT_TRANSCRIPTION_MODEL` defaults to `gpt-realtime-whisper`.

## Activation order

1. Deploy application code with `VOICE_COPILOT_KNOWLEDGE_ENABLED` unset or false.
2. Apply `supabase/migrations/20260713105150_create_voice_copilot_knowledge.sql` through the normal reviewed migration process.
3. Verify table grants, RLS policies and `search_approved_voice_knowledge` execution as `service_role`.
4. Set `VOICE_COPILOT_KNOWLEDGE_ENABLED=true` and restart the Ops application.
5. Create a test draft, review it, start an internal session and verify the session audit row.

No production migration or deployment is performed by this change set.

## Rollback

Set `VOICE_COPILOT_KNOWLEDGE_ENABLED=false` first. This immediately returns Realtime to the existing static knowledge path.

The SQL rollback is `supabase/rollbacks/20260713105150_create_voice_copilot_knowledge_rollback.sql`. It drops Voice Copilot knowledge data, so it must only be applied after a backup and an explicit data-retention decision.

## Realtime sideband

The current deployment is a request-based Next.js runtime and does not own a durable WebSocket process for OpenAI sideband control. Phase 1 therefore resolves and binds all private context server-side before the WebRTC session is created. A true sideband tool runtime must be deployed as a separate long-lived service before dynamic in-call tool calls are enabled.
