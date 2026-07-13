import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOutboundVoiceInstructions, buildRealtimeVoiceTools, buildVoiceConsentEvidence,
  normalizePhoneE164, parseVoiceOutcome, sanitizeVoiceEventPayload,
} from "../../src/lib/ops/voice-platform-contract";
import { VOICE_EVAL_SCENARIOS, VOICE_MODEL_COMPARISON_IDS, validateVoiceEvalSuite } from "../../src/lib/ops/voice-platform-evals";
import { bearerMatches, signAttemptBinding, verifyAttemptBinding, verifyTwilioSignature } from "../../services/voice-runtime/security";
import { createHmac } from "node:crypto";
import { signVoiceConsentWebhook, verifyVoiceConsentWebhook } from "../../src/lib/ops/voice-consent-webhook";
import { OpsClient } from "../../services/voice-runtime/ops-client";
import { TwilioSipAdapter } from "../../services/voice-runtime/telephony";
import { assertActiveVoiceInquiry } from "../../src/lib/ops/voice-platform-data";

test("voice eval suite covers at least 50 unique German safety scenarios", () => {
  const result = validateVoiceEvalSuite();
  assert.equal(result.valid, true);
  assert.equal(result.scenarioCount, 56);
  assert.deepEqual(VOICE_MODEL_COMPARISON_IDS, ["gpt-realtime-2.1", "gpt-realtime-1.5"]);
  assert.ok(VOICE_EVAL_SCENARIOS.every((entry) => /[A-Za-zÄÖÜäöüß]/.test(entry.customerUtterance)));
});

test("outbound prompt discloses digital assistant after permission and blocks commitments", () => {
  const instructions = buildOutboundVoiceInstructions({
    mode: "lead_qualification", instructionsTemplate: "Klaere den Bedarf.",
    context: {
      requestId: "req-1",
      customer: { displayName: "Max", company: null },
      request: { title: "Schild", description: null, status: null, segment: null, application: null, size: null, colors: [], deliveryTime: null },
      offer: null, outlook: [], sourceStatus: { customerRecord: "ok", offer: "not_linked", outlook: "empty" },
    },
    knowledgeMatches: [],
  });
  assert.ok(instructions.indexOf("Passt es gerade kurz") < instructions.indexOf("KI-gestuetzter digitaler Telefonassistent"));
  assert.match(instructions, /KI-gestuetzter digitaler Telefonassistent[\s\S]+erst dann mit inhaltlicher Qualifikation/);
  assert.match(instructions, /Keine Preise, Rabatte, Liefertermine/);
  assert.match(instructions, /untrusted customer data/);
});

test("only the seven bounded tools are exposed", () => {
  assert.deepEqual(buildRealtimeVoiceTools().map((tool) => tool.name), [
    "get_customer_context", "get_offer_summary", "get_outlook_context", "search_approved_knowledge",
    "schedule_callback", "record_qualification", "request_human_handoff",
  ]);
});

test("consent evidence is canonical, purpose-bound and idempotent", () => {
  const first = buildVoiceConsentEvidence({ requestId: "REQ-42", phone: "0049 111 11111111", purposes: ["follow_up"], consentWording: "Ich willige in telefonische Follow-ups durch NEONTRIP oder einen KI-Sprachassistenten ein.", formVersion: "lead-v3", source: "website", sourceRef: "submission-7", grantedAt: "2026-07-13T10:00:00Z" });
  const second = buildVoiceConsentEvidence({ requestId: "REQ-42", phone: "+4911111111111", purposes: ["follow_up"], consentWording: "Ich willige in telefonische Follow-ups durch NEONTRIP oder einen KI-Sprachassistenten ein.", formVersion: "lead-v3", source: "website", sourceRef: "submission-7", grantedAt: "2026-07-13T10:00:00Z" });
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(normalizePhoneE164("0049 111 11111111"), "+4911111111111");
});

test("event payload strips transcript, customer and arbitrary fields", () => {
  assert.deepEqual(sanitizeVoiceEventPayload({ status: "live", duration_ms: 12, transcript: "secret", customer: "name" }), { status: "live", duration_ms: 12 });
});

test("stop outcome must be stored as do_not_call", () => {
  assert.throws(() => parseVoiceOutcome({ terminalStatus: "completed", outcomeCode: "not_interested", summaryForHuman: "Bitte nicht mehr anrufen", customerRequestedStop: true }), /do_not_call/);
});

test("call eligibility rejects inactive requests and completed follow-up offers", () => {
  const base = {
    requestId: "REQ-1", customer: { displayName: "Test", company: null },
    request: { title: "Schild", description: null, status: "open", segment: null, application: null, size: null, colors: [], deliveryTime: null },
    offer: null, outlook: [], sourceStatus: { customerRecord: "ok" as const, offer: "not_linked" as const, outlook: "empty" as const },
  };
  assert.doesNotThrow(() => assertActiveVoiceInquiry(base, "lead_qualification"));
  assert.throws(() => assertActiveVoiceInquiry({ ...base, request: { ...base.request, status: "closed" } }, "lead_qualification"), /nicht aktiv/);
  assert.throws(() => assertActiveVoiceInquiry({ ...base, offer: { offerId: "O-1", offerNumber: "A-1", status: "accepted", viewedAt: null, acceptedAt: null, projectTitle: null, items: [] } }, "follow_up"), /abgeschlossen/);
});

test("runtime bearer and Twilio callback signatures are constant-time verified", () => {
  assert.equal(bearerMatches("Bearer secret", "secret"), true);
  assert.equal(bearerMatches("Bearer wrong", "secret"), false);
  const url = "https://voice.example/webhooks/twilio?attemptId=abc";
  const params = new URLSearchParams({ CallSid: "CA123", CallStatus: "ringing" });
  const signed = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).reduce((value, [key, entry]) => `${value}${key}${entry}`, url);
  const signature = createHmac("sha1", "token").update(signed).digest("base64");
  assert.equal(verifyTwilioSignature({ signature, url, params, authToken: "token" }), true);
  const binding = signAttemptBinding("attempt-1", "binding-secret");
  assert.equal(verifyAttemptBinding("attempt-1", binding, "binding-secret"), true);
  assert.equal(verifyAttemptBinding("attempt-2", binding, "binding-secret"), false);
});

test("consent ingest rejects forged and replayed webhooks", () => {
  const previous = process.env.VOICE_CONSENT_INGEST_SECRET;
  process.env.VOICE_CONSENT_INGEST_SECRET = "consent-secret";
  try {
    const rawBody = JSON.stringify({ requestId: "REQ-1" });
    const now = Date.parse("2026-07-13T12:00:00Z");
    const timestamp = String(now / 1000);
    const signature = signVoiceConsentWebhook(rawBody, timestamp, "consent-secret");
    assert.doesNotThrow(() => verifyVoiceConsentWebhook({ rawBody, timestamp, signature, now }));
    assert.throws(() => verifyVoiceConsentWebhook({ rawBody, timestamp, signature: "0".repeat(64), now }), /Signatur/);
    assert.throws(() => verifyVoiceConsentWebhook({ rawBody, timestamp: String((now - 600_000) / 1000), signature, now }), /Zeitstempel/);
  } finally {
    if (previous === undefined) delete process.env.VOICE_CONSENT_INGEST_SECRET;
    else process.env.VOICE_CONSENT_INGEST_SECRET = previous;
  }
});

test("migration contains atomic claims, hard kill switches and private storage defaults", () => {
  const sql = readFileSync("supabase/migrations/20260713130606_create_voice_call_platform.sql", "utf8");
  assert.match(sql, /for update of target skip locked/i);
  assert.match(sql, /settings\.global_enabled/);
  assert.match(sql, /settings\.internal_test_calls_enabled/);
  assert.match(sql, /settings\.customer_calls_enabled/);
  assert.match(sql, /model\.enabled/);
  assert.match(sql, /v_campaign\.allowlist_only and model\.eval_status in \('contract_passed', 'passed'\)/);
  assert.match(sql, /not v_campaign\.allowlist_only[\s\S]+model\.eval_status = 'passed'[\s\S]+model\.approved_at is not null/);
  assert.match(sql, /approve_voice_model_sandbox/);
  assert.match(sql, /evaluated_prompt_manifest/);
  assert.match(sql, /model\.evaluated_prompt_manifest @> jsonb_build_object/);
  assert.match(sql, /scenario_count >= 50/);
  assert.match(sql, /check_voice_call_attempt_eligibility/);
  assert.match(sql, /consent_not_active/);
  assert.match(sql, /model_kill_switch/);
  assert.match(sql, /max_concurrent_calls/);
  assert.match(sql, /recording_enabled boolean not null default false/);
  assert.match(sql, /transcript_storage_enabled boolean not null default false/);
  assert.match(sql, /evidence_retain_until >= granted_at \+ interval '5 years'/);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);
});

test("n8n voice workflows are separate, inactive and leave payment reminder untouched", () => {
  const files = ["voice-call-dispatcher-v1.json", "voice-outcome-processor-v1.json", "voice-failure-retry-processor-v1.json"];
  const workflows = files.map((file) => JSON.parse(readFileSync(`n8n/workflows/${file}`, "utf8")) as { active: boolean; nodes: Array<{ type: string }> });
  assert.ok(workflows.every((workflow) => workflow.active === false));
  assert.ok(workflows.every((workflow) => workflow.nodes.length <= 30));
  assert.ok(!JSON.stringify(workflows).includes("HzMgctp78bcMq44A"));
});

test("runtime recovery reloads the persisted attempt with authenticated Ops access", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedAuthorization = "";
  globalThis.fetch = (async (input, init) => {
    observedUrl = String(input);
    observedAuthorization = new Headers(init?.headers).get("authorization") || "";
    return Response.json({ session: { attemptId: "00000000-0000-4000-8000-000000000001" } });
  }) as typeof fetch;
  try {
    const client = new OpsClient({ opsBaseUrl: "https://ops.example", opsToken: "runtime-token" } as never);
    const session = await client.getAttempt("00000000-0000-4000-8000-000000000001");
    assert.equal(session.attemptId, "00000000-0000-4000-8000-000000000001");
    assert.equal(observedUrl, "https://ops.example/api/internal/voice-platform/attempts/00000000-0000-4000-8000-000000000001");
    assert.equal(observedAuthorization, "Bearer runtime-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime retries idempotent outcome finalization after transient Ops failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls < 3) return Response.json({ error: "temporary" }, { status: 503 });
    return Response.json({ ok: true, result: { duplicate: false } });
  }) as typeof fetch;
  try {
    const client = new OpsClient({ opsBaseUrl: "https://ops.example", opsToken: "runtime-token", n8nOutcomeUrl: "" } as never);
    await client.finalize("00000000-0000-4000-8000-000000000001", {
      terminalStatus: "completed", outcomeCode: "do_not_call", summaryForHuman: "Stop",
      customerIntent: null, productInterest: null, objections: [], callbackAt: null,
      humanHandoffRequested: false, humanHandoffCompleted: false, customerRequestedStop: true,
      unsafeOrUnsupportedRequest: false, failureCode: null, failureDetail: null,
    });
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Twilio create is attempted once so an uncertain POST cannot duplicate a call", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("connection reset after request write");
  }) as typeof fetch;
  try {
    const adapter = new TwilioSipAdapter({
      twilioAccountSid: "AC00000000000000000000000000000000", twilioAuthToken: "test",
      twilioFromNumber: "+4911111111111", openAiProjectId: "project", publicUrl: "https://voice.example",
      sipBindingSecret: "binding",
    } as never);
    await assert.rejects(() => adapter.startOutboundCall({
      attemptId: "00000000-0000-4000-8000-000000000001", phoneE164: "+4915222222222",
    } as never), /connection reset/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime restart recovery requests worker-bound active sideband sessions", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  globalThis.fetch = (async (input) => {
    observedUrl = String(input);
    return Response.json({ sessions: [{ attemptId: "00000000-0000-4000-8000-000000000001", openAiCallId: "rtc_1", providerCallId: "CA1", disclosureConfirmed: true, providerCompleted: false, recoveryAction: "reconnect" }] });
  }) as typeof fetch;
  try {
    const client = new OpsClient({ opsBaseUrl: "https://ops.example", opsToken: "runtime-token", workerId: "voice-runtime-1" } as never);
    const sessions = await client.recover();
    assert.equal(sessions[0]?.openAiCallId, "rtc_1");
    assert.equal(observedUrl, "https://ops.example/api/internal/voice-platform/recover?workerId=voice-runtime-1");
    const server = readFileSync("services/voice-runtime/server.ts", "utf8");
  assert.match(server, /recoverActiveCalls\(\)/);
  assert.match(server, /realtime\.recoverCall\(session\)/);
  assert.match(server, /session\.recoveryAction === "reconcile_provider"/);
	  assert.match(server, /provider_recovery_required/);
	  assert.match(server, /telephony_start_uncertain/);
	  assert.match(server, /voice provider callback state update failed/);
	  assert.match(server, /providerCallId/);
	  assert.match(server, /await ops\.getAttempt\(claimed\.attemptId\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI ingress is replay-gated and receives a privacy-preserving safety identifier", () => {
  const server = readFileSync("services/voice-runtime/server.ts", "utf8");
  const realtime = readFileSync("services/voice-runtime/realtime.ts", "utf8");
  const data = readFileSync("src/lib/ops/voice-platform-data.ts", "utf8");
  assert.match(server, /openai-webhook:\$\{eventId\}/);
  assert.match(server, /registration\.result\?\.duplicate/);
  assert.match(realtime, /OpenAI-Safety-Identifier/);
  assert.match(data, /safetyIdentifier: voiceStableHash\(\{ requestId: call\.requestId \}\)/);
  assert.match(realtime, /hangupAfterResponse/);
  assert.match(realtime, /finishCustomerStop/);
  assert.match(realtime, /setTimeout\(\(\) => void this\.finishCustomerStop\(active\), 5_000\)/);
  assert.match(realtime, /active\.lastOutcome = active\.lastOutcome\?\.customerRequestedStop/);
  assert.match(realtime, /active\.lastOutcome = \{[\s\S]+terminalStatus: "handed_off"/);
  assert.match(realtime, /throw new Error\("invalid realtime event JSON"\)/);
  assert.doesNotMatch(server, /catch\(\(\) => undefined\)/);
});

test("runtime recovery uses immutable attempt snapshots and admin audit actors are server-derived", () => {
  const data = readFileSync("src/lib/ops/voice-platform-data.ts", "utf8");
  const route = readFileSync("src/app/api/ops/voice-platform/route.ts", "utf8");
  assert.match(data, /const modelSnapshot = attempt\.model_snapshot/);
  assert.match(data, /const promptSnapshot = attempt\.prompt_snapshot/);
  assert.match(data, /instructionsTemplate: requireVoiceText\(promptSnapshot\.instructions_template/);
  assert.match(data, /production_model_confirmation_required/);
  assert.match(data, /PROVIDER GEPRUEFT KEIN CALL/);
  assert.match(data, /consent_withdrawn/);
  assert.match(route, /resolveVoiceCopilotActor\(request\)/);
  assert.match(route, /\{ \.\.\.input, actor \}/);
});
