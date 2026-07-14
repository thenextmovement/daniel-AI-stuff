# NEONTRIP Live Call Copilot

## Status

The feature is implemented fail-closed and is not activated or deployed by this change. It assists a human operator during a call. It does not dial, speak, send messages, modify offers, or make commitments.

## User flow

1. The operator opens `Ops > Voice Copilot > Mithoeren`.
2. The operator selects an internal test, initial inquiry, or offer follow-up.
3. Customer modes require one server-bound request. Offers and Outlook evidence are loaded only through that request.
4. The operator confirms that the external participant actively consented to live transcription.
5. The browser asks the operator to share the Placetel/Webex call source with audio, then requests microphone access.
6. Customer and operator audio use separate OpenAI Realtime transcription sessions.
7. Final customer turns trigger a bounded Responses API request. The UI displays no more than three answer, question, or warning suggestions.
8. Stop closes both WebRTC sessions, stops all captured tracks, cancels suggestion requests, and completes the audit session.

## Architecture

- Browser: audio capture, local voice activity detection, transcript display, and volatile transcript state.
- `POST /api/ops/voice-copilot/transcription-session`: authenticates the Ops user, rechecks flags and consent, binds one request, creates one audited `voice_call_sessions` record, and opens two transcription-only Realtime sessions.
- `POST /api/ops/voice-copilot/suggestions`: accepts only a live audited `live_copilot` session ID, reloads its bound request, searches approved knowledge, and generates strict structured suggestions.
- Postgres: session status, request binding, knowledge version IDs, and source-status metadata. It does not receive raw transcript text.
- OpenAI: requests use `store: false` for suggestion generation. API keys remain server-side.

The browser commits speech turns after local silence detection because `gpt-realtime-whisper` transcription sessions are configured with manual turn commits. Partial transcript events are reconciled by OpenAI `item_id`.

## Configuration

Required:

```text
OPS_OPENAI_API_KEY=<secret>
OPS_COPILOT_OPENAI_MODEL=<approved Responses model>
VOICE_COPILOT_KNOWLEDGE_ENABLED=true
VOICE_LIVE_COPILOT_ENABLED=true
```

Optional model overrides:

```text
VOICE_COPILOT_SUGGESTION_MODEL=<approved Responses model>
VOICE_COPILOT_TRANSCRIPTION_MODEL=gpt-realtime-whisper
```

The feature remains unavailable if either feature flag is false. No `NEXT_PUBLIC_*` variable is used.

## Placetel limitation

The documented Placetel REST/Notify API exposes call events, call control, and post-call recordings, but no documented live media stream. The first implementation therefore captures audio from the operator's selected Placetel/Webex source through browser screen/audio sharing.

Use a headset. Loudspeaker playback can be picked up by the microphone and duplicate the customer channel. Browser and operating-system audio-sharing support must be tested on each managed workstation. If the selected source returns no audio track, the session fails before OpenAI receives audio.

A later embedded SIP/WebRTC softphone can replace screen-audio capture without changing the suggestion or knowledge APIs.

## Privacy and safety

- The Start action is disabled until active consent is confirmed in the UI.
- The server independently rejects non-internal calls unless consent is `confirmed` and a request is bound.
- The session snapshot records the server confirmation time, `operator_attestation`, and wording version `live-transcription-v1`; it does not fabricate an audio proof.
- Customer context and Outlook content remain untrusted input.
- Suggestions cannot call tools and cannot execute side effects.
- A deterministic output guard removes generated answer text that contains price, percentage, discount, guaranteed delivery, production-start, payment, or order commitments and inserts a human-review warning.
- Source labels returned by the model are filtered against the exact server-provided source allowlist.
- Raw audio and transcript storage are disabled. Transcript text remains in browser memory until discarded, navigation, or refresh.
- The customer can withdraw consent at any time; the operator must press Stop immediately and continue without the copilot.

Legal and privacy owners must approve the exact spoken consent wording, processor/data-transfer setup, employee rules, and retention policy before customer use. See `docs/legal/voice-consent-and-disclosure.md`.

## Rollout

1. Keep `VOICE_LIVE_COPILOT_ENABLED=false` in production.
2. Verify the knowledge migration and approved knowledge retrieval.
3. Configure an approved suggestion model and the transcription model.
4. Enable the flag in a non-production or internal allowlist environment.
5. Test with two consenting employees using the actual Placetel/Webex desktop path and headsets.
6. Evaluate transcript latency, speaker separation, names, numbers, product terms, interruptions, noise, and Stop behavior.
7. Obtain legal/privacy approval before any customer test.
8. Enable only for named operators, monitor structured errors, and retain the immediate kill switch.

Production activation uses the restricted GitHub Actions operation after the code commit is live:

```bash
gh workflow run coolify-secret-sync.yml --ref main \
  -f mode=enable_voice_live_copilot \
  -f ops_kind=application \
  -f ops_uuid=<ops-resource-uuid>
```

The operation changes only `VOICE_LIVE_COPILOT_ENABLED`. It skips the restart when the requested value is already configured.

## Rollback

Set `VOICE_LIVE_COPILOT_ENABLED=false` and restart Ops. This blocks new transcription and suggestion requests without deleting session audit data or changing the existing voice agent.

The restricted production rollback operation is:

```bash
gh workflow run coolify-secret-sync.yml --ref main \
  -f mode=disable_voice_live_copilot \
  -f ops_kind=application \
  -f ops_uuid=<ops-resource-uuid>
```

## Verification

```bash
node --import tsx --test tests/quotes/voice-copilot.test.ts tests/quotes/voice-knowledge.test.ts tests/quotes/voice-platform.test.ts
npx tsc --noEmit
npm run build:voice-runtime
npm run build
```
