import test from "node:test";
import assert from "node:assert/strict";
import {
  liveIncoming,
  liveSessionConfig,
  liveTranscript,
  LiveToolCollector,
} from "../../services/voice-runtime/live-protocol";
import { OpenAiLiveAdapter } from "../../services/voice-runtime/live";
import { getProviderReadiness } from "../../services/voice-runtime/config";
test("Live transport binds signed SIP session ids and does not reinterpret Realtime call ids", () => {
  assert.equal(
    liveIncoming({
      type: "realtime.call.incoming",
      data: { call_id: "rtc_1" },
    }),
    null,
  );
  assert.deepEqual(
    liveIncoming({
      id: "evt_1",
      type: "live.transport.incoming",
      data: {
        type: "sip",
        session_id: "live_1",
        sip_headers: [{ name: "x-neontrip-attempt-id", value: "a" }],
      },
    }),
    {
      id: "evt_1",
      sessionId: "live_1",
      headers: [{ name: "x-neontrip-attempt-id", value: "a" }],
    },
  );
  assert.equal(
    liveIncoming({
      type: "live.transport.incoming",
      data: { type: "webrtc", session_id: "live_1", sip_headers: [] },
    }),
    null,
  );
  assert.throws(() =>
    liveIncoming({
      type: "live.transport.incoming",
      data: { type: "sip", call_id: "rtc_1", sip_headers: [] },
    }),
  );
});
test("Live transcript preserves exact whitespace and overlapping speaker timelines", () => {
  const event = {
    type: "session.input_transcript.delta",
    event_id: "ev_1",
    delta: " Farbe ",
    start_ms: 100,
    end_ms: 300,
  };
  assert.equal(liveTranscript(event)?.text, " Farbe ");
  assert.equal(liveTranscript({ ...event, delta: " " })?.text, " ");
  assert.equal(
    liveTranscript({
      ...event,
      type: "session.output_transcript.delta",
      start_ms: 150,
    })?.speaker,
    "assistant",
  );
  assert.throws(() => liveTranscript({ ...event, end_ms: 20 }));
  assert.throws(() => liveTranscript({ ...event, event_id: undefined }));
});
test("Live session uses independent delegated reasoning and no audio storage", () => {
  const session = {
    modelId: "gpt-live-1",
    voice: "marin",
    instructions: "Bound rules",
    tools: [],
    sessionConfig: {},
  } as never;
  const config = liveSessionConfig(session);
  assert.equal(config.type, "live");
  assert.notEqual(config.instructions, "Bound rules");
  assert.ok(config.instructions.length < 2300);
  assert.match(config.instructions, /Delegation policy:/);
  assert.match(config.instructions, /Interruption policy:/);
  assert.equal(config.delegation.responses.instructions, "Bound rules");
  assert.equal(config.store, false);
  assert.equal(config.delegation.responses.model, "gpt-5.6-terra");
  assert.throws(() =>
    liveSessionConfig({
      ...(session as object),
      modelId: "gpt-realtime-2.1",
    } as never),
  );
});
test("nested Responses tools survive empty terminal output and parallel delegations", () => {
  const c = new LiveToolCollector();
  const send = (id: string, event: unknown) =>
    c.collect({ type: "response.event", delegation_id: id, event });
  send("d1", { type: "response.created", response: { id: "r1" } });
  send("d2", { type: "response.created", response: { id: "r2" } });
  assert.equal(
    send("d1", {
      type: "response.function_call_arguments.done",
      arguments: "{}",
    }),
    null,
  );
  const item = {
    type: "function_call",
    call_id: "c1",
    name: "get_customer_context",
    arguments: "{}",
  };
  send("d1", { type: "response.output_item.done", item });
  send("d1", { type: "response.output_item.done", item });
  assert.deepEqual(
    send("d2", {
      type: "response.completed",
      response: { id: "r2", output: [] },
    }),
    [],
  );
  assert.deepEqual(
    send("d1", {
      type: "response.completed",
      response: { id: "r1", output: [] },
    }),
    [{ call_id: "c1", name: "get_customer_context", arguments: "{}" }],
  );
  assert.equal(
    send("d1", {
      type: "response.completed",
      response: { id: "r1", output: [] },
    }),
    null,
  );
});
test("conflicting function replay and cross-response completion are rejected", () => {
  const c = new LiveToolCollector(),
    send = (event: unknown) =>
      c.collect({ type: "response.event", delegation_id: "d", event });
  send({ type: "response.created", response: { id: "r" } });
  const item = {
    type: "function_call",
    call_id: "c",
    name: "get_customer_context",
    arguments: "{}",
  };
  send({ type: "response.output_item.done", item });
  assert.throws(() =>
    send({
      type: "response.output_item.done",
      item: { ...item, name: "schedule_callback" },
    }),
  );
  assert.throws(() =>
    send({ type: "response.completed", response: { id: "other", output: [] } }),
  );
});
test("successful REFER is only a pending transfer and preserves the monitoring socket", async () => {
  const original = globalThis.fetch;
  let closed = false;
  let finalized = false;
  const events: unknown[] = [];
  try {
    globalThis.fetch = (async (url, init) => {
      assert.match(String(url), /\/live\/sessions\/live_1\/refer$/);
      assert.equal(
        JSON.parse(String(init?.body)).target_uri,
        "sip:agent@example.test",
      );
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const adapter = new OpenAiLiveAdapter(
      {
        openAiApiKey: "fake",
        openAiWebhookSecret: "fake",
        handoffUri: "sip:agent@example.test",
      } as never,
      {
        event: async (...args: unknown[]) => {
          events.push(args);
        },
        finalize: async () => {
          finalized = true;
        },
      } as never,
    );
    const active = {
      callId: "live_1",
      attemptId: "attempt_1",
      session: { allowlistOnly: false },
      socket: {
        close: () => {
          closed = true;
        },
      },
      outcome: null,
      gap: false,
    };
    (adapter as unknown as { calls: Map<string, unknown> }).calls.set(
      "live_1",
      active,
    );
    assert.equal(await adapter.handoffAttempt("attempt_1"), true);
    assert.equal(
      (active.outcome as unknown as { humanHandoffCompleted: boolean })
        .humanHandoffCompleted,
      false,
    );
    assert.equal(active.gap, true);
    assert.equal(closed, false);
    assert.equal(finalized, false);
    assert.equal(events.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("old provider credentials alone cannot enable Live dispatch", () => {
  const env = Object.fromEntries(
    [
      "OPENAI_API_KEY",
      "OPENAI_WEBHOOK_SECRET",
      "OPENAI_PROJECT_ID",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
      "VOICE_SIP_BINDING_SECRET",
    ].map((key) => [key, "fake"]),
  );
  assert.equal(getProviderReadiness(env).dispatch, false);
  assert.equal(
    getProviderReadiness({ ...env, VOICE_LIVE_SIP_ENABLED: "true" }).dispatch,
    true,
  );
});

test("runtime rejects missing storage consent and customer-context calls to any other test recipient", async () => {
  const { prepareVoiceRuntimeSession } = await import(
    "../../src/lib/ops/voice-platform-data"
  );
  const env = process.env as Record<string, string | undefined>,
    before = { ...env },
    original = globalThis.fetch;
  const snapshot: Record<string, unknown> = {};
  const call = {
    attemptId: "11111111-1111-4111-8111-111111111111",
    requestId: "internal-test:11111111-1111-4111-8111-111111111111",
    modelId: "gpt-live-1",
    allowlistOnly: true,
    phoneE164: "+491110000000",
    mode: "lead_qualification",
    contactName: "Test",
    companyName: null,
    instructionsTemplate: "Interner Test.",
    sessionConfig: {},
  } as never;
  const paths: string[] = [];
  try {
    env.SUPABASE_URL = "https://database.test";
    env.SUPABASE_SERVICE_ROLE_KEY = "fake";
    env.VOICE_INTERNAL_TEST_PHONE = "+491110000001";
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith("voice_call_attempts"))
        return Response.json([
          {
            id: "11111111-1111-4111-8111-111111111111",
            context_snapshot: snapshot,
          },
        ]);
      if (path.endsWith("search_approved_voice_knowledge"))
        return Response.json([]);
      throw new Error("Customer data must not be queried for rejected binding");
    }) as typeof fetch;
    await assert.rejects(prepareVoiceRuntimeSession(call), /Einwilligung/);
    snapshot.transcript_consent = { confirmed: true };
    snapshot.context_request_id = "REQ-OTHER";
    await assert.rejects(prepareVoiceRuntimeSession(call), /Testnummer/);
    assert.equal(paths.length, 2);
    delete snapshot.context_request_id;
    snapshot.call_brief = "Frag nach der Lieferadresse.";
    const result = await prepareVoiceRuntimeSession(call);
    assert.match(result.instructions, /Frag nach der Lieferadresse/);
    assert.equal(result.context.request.status, "internal_test");
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(env)) if (!(key in before)) delete env[key];
    Object.assign(env, before);
  }
});

test("SIP call setup requires encrypted signaling and encrypted audio without changing the recipient",async()=>{
 const {TwilioSipAdapter}=await import("../../services/voice-runtime/telephony");
 const original=globalThis.fetch;
 try{
  globalThis.fetch=(async(_url,init)=>{
   const body=new URLSearchParams(String(init?.body));
   assert.equal(body.get("To"),"+491110000001");
   assert.match(body.get("Twiml")||"",/;transport=tls;secure=true\?/);
   assert.match(body.get("Twiml")||"",/x-neontrip-attempt-id=/);
   return Response.json({sid:"CA_TEST"});
  }) as typeof fetch;
  const adapter=new TwilioSipAdapter({twilioAccountSid:"fake",twilioAuthToken:"fake",twilioFromNumber:"+491110000002",openAiProjectId:"proj_test",sipBindingSecret:"fake",publicUrl:"https://voice.example.test"} as never);
  await adapter.startOutboundCall({attemptId:"11111111-1111-4111-8111-111111111111",phoneE164:"+491110000001"} as never);
 }finally{globalThis.fetch=original;}
});
