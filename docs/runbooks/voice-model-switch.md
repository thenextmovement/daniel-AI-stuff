# Voice Model Switch Runbook

## Registry States

Each release stores provider, exact model ID, API version, transport, voice, audio session config, capabilities, the exact evaluated prompt manifest, approval, score, and lifecycle:

- `available`: registered but unused;
- `candidate`: used only by candidate campaigns after approval;
- `production`: production channel;
- `rollback`: previous approved production release;
- `retired`: unavailable for selection.

`enabled=false` is an independent model kill switch.

## Add A New Model Without Code Changes

1. Confirm the exact public API model ID in official OpenAI documentation and `GET /v1/models`. A ChatGPT product label is not an API model ID.
2. In Ops, register the model ID, API version, SIP transport, and supported voice. Registration creates `available`, `pending`, and disabled state.
3. Verify the documented SIP, sideband WebSocket, function-tool, voice/audio, and event-schema contract. Record this review with `Sandbox-Vertrag`; this produces `contract_passed` but can never authorize customer calls or production promotion.
4. Enable the independent model kill switch and select the model as `candidate`. Only allowlist-only campaigns can use a `contract_passed` candidate.
5. Approve exactly one prompt version for each mode (`lead_qualification` and `follow_up`).
6. Run all 56 scenario IDs from `de-neontrip-voice-v1` against this candidate and the current baseline. Any exact public model ID can be evaluated without code changes: `VOICE_EVAL_MODEL_IDS=<model-id> npm run eval:voice:live`. Record passed count, safety failures, average score, and report reference through the Ops eval form. The server records both approved prompt IDs, versions, and hashes as the immutable evaluation manifest.
7. A release is promotable only with `eval_status=passed`, zero blocking safety failures under the review policy, a complete two-mode prompt manifest, and an approver/timestamp.
8. Run allowlist-only calls. Confirm stop, DNC, callback, handoff, interruption, and provider failure paths.
9. Promote in Ops. The prior production release atomically becomes `rollback`.

The implementation currently registers `gpt-realtime-2.1` and `gpt-realtime-1.5`. Both use the same 56 scenario IDs. Neither seed is production-approved by the migration.

## Current Comparison

Synthetic text-only Realtime run on 2026-07-13 with identical prompts and scenarios:

| Model | Passed | Blocking safety failures | Registry result |
| --- | ---: | ---: | --- |
| `gpt-realtime-2.1` | 39/56 | 0 | failed production gate |
| `gpt-realtime-1.5` | 41/56 | 0 | failed production gate |

Reports are stored under `artifacts/voice-evals/` and contain hashes and structured checks, not raw model text. The remaining misses are expected-tool, handoff, or first-turn-disclosure assertions. Because the production RPC requires all scenarios plus zero safety failures, neither result can be promoted. The migration keeps `gpt-realtime-2.1` as the initial sandbox candidate because current OpenAI documentation recommends it for strongest Realtime reasoning, instruction following, interruption, noise handling, and tool use; the small text-only score difference does not replace audio/telephony evaluation.

## “GPT Live 1” Procedure

Do not enter the ChatGPT UI label as a guessed API ID. When OpenAI publishes an API model:

1. register its exact model ID;
2. leave it disabled;
3. run the contract check and store `contract_passed`;
4. select candidate and run the configurable 56-scenario evaluation;
5. run separately approved internal allowlist calls;
6. store a full passing evaluation, approve, and promote.

No business-process, n8n, campaign, prompt, or runtime code change is needed if it supports the existing SIP/Realtime contract and tool schema. A code change is required only when OpenAI changes the transport/event contract or the model lacks a required capability.

## Rollback

1. Disable the problematic model immediately.
2. Use `Modell-Rollback` in Ops. The database serializes the swap and audits the actor.
3. Verify production and rollback lifecycle values in Ops.
4. Keep global calls disabled until a sandbox claim uses the expected model snapshot.
5. Re-enable internal allowlist calls first.

Rollback cannot select a release that is disabled, unevaluated, unapproved, or missing its evaluated two-mode prompt manifest.
