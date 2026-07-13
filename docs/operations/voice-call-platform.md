# NEONTRIP Voice Call Platform

## Status

The implementation is production-oriented but fail-closed. No migration, service deployment, n8n activation, model promotion, or real call is part of this change. All three n8n workflows are inactive. `VOICE_CALL_PLATFORM_ENABLED` and all database kill switches default to false.

## Purpose

The platform supports only:

- initial qualification after a concrete customer inquiry; and
- follow-up on that inquiry or its offer.

It does not support purchased lists, imported cold leads, payment reminders, or unrelated outreach. `NEONTRIP Payment Reminder Processor v1.1` remains a separate workflow and was not modified.

## Architecture

1. Postgres stores consent evidence, DNC state, campaigns, targets, atomic reservations, attempts, events, outcomes, actions, prompt versions, evaluations, and model releases.
2. The inactive n8n dispatcher asks the runtime to claim one item. It never selects a customer itself.
3. The Ops API executes `claim_next_voice_call`. One locked settings row serializes capacity checks; the target is locked with `FOR UPDATE SKIP LOCKED`.
4. The runtime asks Twilio to call the allowlisted/customer number and bridge to the OpenAI project SIP URI.
5. OpenAI sends a signed `realtime.call.incoming` webhook. The runtime accepts only calls carrying the attempt UUID plus its HMAC binding in the SIP headers and registers the webhook ID atomically before acceptance, so neither spoofing nor replay can create a second session.
6. A server-side sideband WebSocket handles function tools, stop, and SIP REFER handoff. API keys never reach a browser.
7. Structured outcomes return to Postgres. Audio recording and durable raw transcripts remain disabled.

Outcome finalization is idempotent and retries transient Ops failures with bounded exponential backoff. Stop and handoff results are attached to the active call before hangup or SIP REFER, so both the operator request and the sideband close path can safely reconcile the same result.

The runtime performs a second database eligibility check after reservation and before dialing, and another before accepting the OpenAI SIP call. It rechecks consent, DNC, global/campaign/model switches, channel approval, allowlist/customer-call permission, and the exact approved prompt. Recovery uses the immutable model, prompt, and campaign context snapshots stored on the attempt; an ineligible recovered call is terminated instead of reconnected.

Twilio's documented Call-create endpoint has no idempotency-key contract. The runtime therefore never retries an uncertain create POST. A timeout, connection loss, or interrupted `reserved` attempt is blocked as `manual_provider_reconciliation_required`; startup recovery looks up and terminates a known active provider call before finalizing. This intentionally drops an uncertain attempt instead of risking a duplicate customer call. Ops can close the case without retry or requeue it only after an operator explicitly confirms from the Twilio record that no call occurred. The atomic resolution rejects active attempts and writes an audit entry.

On startup, a runtime with the same stable `VOICE_RUNTIME_WORKER_ID` reloads its active attempts and reconnects their OpenAI `call_id` sideband sockets. A persisted `disclosure.confirmed` event prevents repeating the opening; an unconfirmed call re-enters the guarded opening flow.

OpenAI documents Realtime over WebRTC, WebSocket, and SIP in its [Realtime API reference](https://platform.openai.com/docs/api-reference/realtime). Incoming SIP calls expose `call_id` and `sip_headers` through the [signed webhook event](https://platform.openai.com/docs/api-reference/webhook-events/response), and call accept/reject/refer/hangup use the [Realtime Calls API](https://platform.openai.com/docs/api-reference/realtime-calls/hangup-call).

## Eligibility Gates

Every claim requires all of the following inside one database transaction:

- global platform switch enabled;
- capacity below `max_concurrent_calls`;
- active campaign and enabled campaign mode;
- enabled model on the campaign channel: a contract-checked candidate for allowlist-only sandbox calls, or a fully evaluated and approved production release for customer calls;
- approved prompt for the campaign mode;
- queued target inside attempt and contact-time limits;
- exact request, phone hash, purpose, and active consent match;
- no active phone- or request-level DNC record;
- internal allowlist plus internal-call switch, or separately enabled customer-call switch.

The target reservation and attempt snapshot are atomic. Attempt idempotency is `voice-attempt:<target-id>:<attempt-number>`. Provider events and tools have their own unique keys. Finalization is idempotent.

For allowlist-only candidate campaigns, `contract_passed` is sufficient to make real audio/SIP evaluation possible. The pre-registered candidate starts as `pending` and requires an explicit contract approval. Customer campaigns still require `eval_status=passed`, an approver and timestamp, a production lifecycle release, and proof that the exact approved prompt ID for the campaign mode was part of that evaluation. The database rejects evaluations below 50 scenarios and records `passed` only when every scenario passes and blocking safety failures are zero; the recorded manifest must contain both approved agent prompts.

## Consent Contract

An active inquiry is necessary but is not treated as consent. The signed endpoint `POST /api/internal/voice-platform/consents` accepts the exact wording, purpose, form version, timestamp, source, source reference, request ID, and E.164 phone. It requires:

- `x-neontrip-timestamp`: Unix seconds, no older/newer than five minutes;
- `x-neontrip-signature`: HMAC-SHA256 of `<timestamp>.<raw-body>`;
- `VOICE_CONSENT_INGEST_SECRET`: shared only by the Offers form/confirmation integration and Ops.

Evidence is retained for at least five years and the retention deadline is extended to five years after every call attempt that uses the consent. Withdrawal first blocks queued, claimed, dialing, and live targets, then terminates their active attempts through the OpenAI and provider controls. Stop failures are returned and persisted in the withdrawal audit record rather than hidden. A stop request during a call finalizes as `do_not_call` and creates an active DNC record.

## Legal and Transparency Review

Review date: 2026-07-13. This engineering review is a launch gate, not a substitute for NEONTRIP's external legal approval.

- German UWG section 7 requires prior express consent for consumer telephone advertising and for advertising using an automated calling machine. An active inquiry alone is therefore deliberately insufficient: <https://www.gesetze-im-internet.de/uwg_2004/__7.html>.
- UWG section 7a requires the consent to be documented when given and retained for five years from grant and after every use. The consent record, exact wording, source/form version, immutable attempt binding, and rolling retention deadline implement that evidence path: <https://www.gesetze-im-internet.de/uwg_2004/__7a.html>.
- EU AI Act Article 50 requires people interacting directly with an AI system to be informed unless that is obvious. It applies from 2026-08-02 under Article 113. The mandatory first speech turn therefore says, after NEONTRIP identity, inquiry reference, and the short availability question: `Ich unterstuetze Sie dabei als KI-gestuetzter digitaler Telefonassistent.` Qualification cannot begin before this disclosure: <https://eur-lex.europa.eu/eli/reg/2024/1689/oj>.
- Unauthorised recording of non-public speech is prohibited by German Criminal Code section 201. The German data-protection authorities also state that call recording generally requires the external party's active, informed consent before recording begins. This platform defaults audio recording and durable raw transcripts to off and has no runtime switch that silently enables them: <https://www.gesetze-im-internet.de/stgb/__201.html> and <https://www.bfdi.bund.de/SharedDocs/Downloads/DE/DSK/DSKBeschluessePositionspapiere/DSK_20180323_Beschluss_Telefongespraeche.pdf?__blob=publicationFile&v=7>.

Before customer rollout, counsel must approve the exact form checkbox, privacy notice, confirmation email, opening wording, processor/data-transfer setup, retention/deletion policy, and campaign classification. The customer-call switch must remain off until that approval is documented.

## Allowed Tools

The sideband runtime exposes exactly:

- `get_customer_context`
- `get_offer_summary`
- `get_outlook_context`
- `search_approved_knowledge`
- `schedule_callback`
- `record_qualification`
- `request_human_handoff`

Reads are bound to the attempt's request ID. Knowledge search returns approved entries only. No tool can edit an offer, price, delivery date, order, or email. Tool arguments are bounded and validated. Side effects are idempotent by attempt and OpenAI tool-call ID.

OpenAI receives a stable SHA-256 safety identifier derived from the bound request ID on both call acceptance and the sideband connection. It contains no plain customer identifier.

## Runtime Configuration

Ops service:

```text
VOICE_CALL_PLATFORM_ENABLED=false
VOICE_RUNTIME_API_TOKEN=<secret>
VOICE_RUNTIME_BASE_URL=https://<runtime-host>
VOICE_DISPATCH_TOKEN=<secret>
VOICE_CONSENT_INGEST_SECRET=<secret>
```

Voice runtime service:

```text
PORT=3100
VOICE_RUNTIME_PUBLIC_URL=https://<runtime-host>
VOICE_OPS_BASE_URL=https://ops.neontrip.de
VOICE_RUNTIME_API_TOKEN=<same runtime-to-ops secret>
VOICE_DISPATCH_TOKEN=<dispatcher/control secret>
VOICE_RUNTIME_WORKER_ID=<stable instance id>
OPENAI_API_KEY=<secret>
OPENAI_WEBHOOK_SECRET=<secret>
OPENAI_PROJECT_ID=<project id>
VOICE_SIP_BINDING_SECRET=<independent random secret>
TWILIO_ACCOUNT_SID=<secret>
TWILIO_AUTH_TOKEN=<secret>
TWILIO_FROM_NUMBER=<E.164>
VOICE_HUMAN_HANDOFF_URI=tel:<E.164 or SIP URI>
VOICE_N8N_OUTCOME_URL=https://<n8n-host>/webhook/neontrip-voice-outcome-v1
VOICE_N8N_WEBHOOK_TOKEN=<outcome webhook secret>
SOURCE_COMMIT=<deployed commit>
```

n8n uses environment variables listed in `n8n/voice-platform-workflow-manifest.json`. No secret belongs in workflow JSON.

## Operations

The global Ops app switcher exposes `/ops/voice-copilot` from all Ops modules, including Offers. The `Plattform` tab provides:

- global/internal/customer kill switches;
- model registration, model kill switch, candidate/production/rollback controls;
- prompt review state;
- allowlist, consent evidence, campaign and target creation;
- audited provider-uncertainty reconciliation without automatic retry;
- attempts and live status; and
- operator stop and human handoff.

Customer-call enablement requires a separate exact confirmation. It still cannot bypass consent, campaign, model, prompt, or time gates.

## n8n

Inactive workflows:

- Dispatcher: `Z6WbBeWfPJ7ijMDC`
- Outcome processor: `FasnNPZxB7hFC7SA`
- Failure/retry processor: `MSzTKddYH7LkSub3`

The runtime writes the outcome directly to Postgres through Ops first, then mirrors it to the optional n8n outcome webhook with `voice-outcome:<attempt-id>` as its idempotency key. A mirror failure never loses the source-of-truth result; it creates a durable failure event and a runtime error log. The n8n failure workflow finalizes bound workflow errors through the same idempotent API, which applies retry timing in Postgres.

Dispatcher and outcome processor route execution errors to the failure workflow. Postgres determines retry eligibility and timing. n8n never owns a long-lived audio connection.

Rollback before activation: keep all three inactive and delete these IDs if the drafts must be removed. The pre-change record is `n8n/backups/2026-07-13-voice-platform-prechange.json`.

## Verification

```bash
npm run eval:voice
node --import tsx --test tests/quotes/voice-platform.test.ts
npm run test:quotes
npx tsc --noEmit
npm run build:voice-runtime
npm run build
```

Database verification runs the migration and `tests/sql/voice-platform.integration.sql` against clean PostgreSQL 17, then applies the rollback and expects zero `voice_%` tables.

The 2026-07-13 live text-only comparison produced 39/56 for `gpt-realtime-2.1` and 41/56 for `gpt-realtime-1.5`, both with zero blocking safety failures. Both remain failed at the strict production gate; no model was promoted.

## Incident Response

1. Disable `global_enabled` to stop new reservations.
2. Use Stop or Handoff for active attempts.
3. If one model is implicated, disable that release; campaigns on that channel claim no new calls.
4. Preserve structured events and attempt/model/prompt snapshots. Do not turn on raw transcripts as an incident shortcut.
5. Correct the cause, run the 56-scenario suite and integration tests, then re-enable internal allowlist calls only.
6. Customer calls require a new explicit operational approval.
