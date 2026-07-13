# Voice Runtime

Long-lived Node.js service for Twilio-to-OpenAI SIP calls and OpenAI Realtime sideband control.

Build with `npm run build:voice-runtime` or `docker build -f Dockerfile.voice-runtime .`. The service exposes:

- `GET /health`
- `POST /dispatch` with `VOICE_DISPATCH_TOKEN`
- `POST /webhooks/openai` with OpenAI SDK signature verification
- `POST /webhooks/twilio?attemptId=...` with Twilio signature verification
- `POST /attempts/:id/stop` with `VOICE_DISPATCH_TOKEN`
- `POST /attempts/:id/handoff` with `VOICE_DISPATCH_TOKEN`

The runtime is stateless for recovery: an OpenAI incoming SIP webhook reloads the attempt/session package from Postgres through Ops. On process startup, a stable `VOICE_RUNTIME_WORKER_ID` reloads active attempts and reconnects existing `openai_call_id` sideband sockets. A per-attempt HMAC in the SIP headers binds that call to the dispatcher. Signed OpenAI webhook IDs are persisted as idempotency keys before call acceptance, and every OpenAI session receives a hashed request-level safety identifier. Outcomes are committed to Ops/Postgres first and optionally mirrored to n8n through `VOICE_N8N_OUTCOME_URL`; mirror failures are recorded without rolling back the durable outcome. The in-memory map is used only for currently connected sideband sockets. No transcript or audio is persisted.
