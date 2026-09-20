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
  assert.ok(config.instructions.length < 4000);
  assert.match(config.instructions, /Delegation policy:/);
  assert.match(config.instructions, /Interruption policy:/);
  assert.equal(config.delegation.responses.instructions, "Bound rules");
  assert.equal(config.store, false);
  assert.equal(config.delegation.responses.model, "gpt-5.6-terra");
  assert.deepEqual(config.delegation.responses.reasoning, { effort: "low" });
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
   assert.deepEqual(body.getAll("StatusCallbackEvent"),["initiated","ringing","answered","completed"]);
   assert.match(body.get("Twiml")||"",/;transport=tls;secure=true\?/);
   assert.match(body.get("Twiml")||"",/x-neontrip-attempt-id=/);
   return Response.json({sid:"CA_TEST"});
  }) as typeof fetch;
  const adapter=new TwilioSipAdapter({twilioAccountSid:"fake",twilioAuthToken:"fake",twilioFromNumber:"+491110000002",openAiProjectId:"proj_test",sipBindingSecret:"fake",publicUrl:"https://voice.example.test"} as never);
  await adapter.startOutboundCall({attemptId:"11111111-1111-4111-8111-111111111111",phoneE164:"+491110000001"} as never);
 }finally{globalThis.fetch=original;}
});


test("small bound facts answer routine questions without embedding long procedures in Live", () => {
  const config = liveSessionConfig({ modelId: "gpt-live-1", voice: "gleam", instructions: "Long backend record " + "x".repeat(10000), tools: [], sessionConfig: {}, allowlistOnly: true,
    context: { customer: { displayName: "Test", company: null, email: "test@example.test" }, offer: { label: "A1", offerNumber: "A1", status: "sent", price: { amount: 583.1, currency: "EUR", taxBasis: "gross", asOf: "2026-09-17" } }, sourceStatus: { offer: "ok" } }
  } as never);
  assert.match(config.instructions, /test@example.test/);
  assert.match(config.instructions, /583.1/);
  assert.match(config.instructions, /direkt aus den gebundenen Fakten/);
  assert.ok(config.instructions.length < 3600);
  assert.ok(config.delegation.responses.instructions.length > 10000);
  assert.doesNotMatch(config.instructions, /x{50}/);
});


test("Live preloads only selected product facts and keeps long or unselected data out", () => {
  const config = liveSessionConfig({ modelId: "gpt-live-1", voice: "gleam", instructions: "backend", tools: [], sessionConfig: {}, allowlistOnly: true,
    context: { customer: { displayName: "Test", company: null }, request: { title: "Old inquiry", size: "80 cm", application: "outside", colors: [] },
      offer: { label: "A1", offerNumber: "A1", status: "sent", projectTitle: "Logo", items: [
        { title: "Leuchtschild", description: "90x22 cm, Kaltweiß, Innenbereich", quantity: 1, selected: true },
        { title: "Nicht ausgewähltes RGB", description: "Nicht enthalten", quantity: 1, selected: false },
        { title: "Unknown selection", description: null, quantity: 1 },
        { title: "Montage", description: "x".repeat(2000), quantity: 1, selected: true },
      ] }, sourceStatus: { offer: "ok" } }
  } as never);
  assert.match(config.instructions, /90x22 cm, Kaltweiß, Innenbereich/);
  assert.doesNotMatch(config.instructions, /Nicht ausgewähltes RGB|Unknown selection|Old inquiry|x{241}/);
  assert.match(config.instructions, /Liste kann gekürzt sein/);
  assert.ok(config.instructions.length < 4400);
});

test("SIP accept pins GPT-Live and project; sideband only observes negotiated audio", async () => {
  const { EventEmitter } = await import("node:events");
  const { setImmediate: tick } = await import("node:timers/promises");
  const original = globalThis.fetch;
  const events: unknown[][] = [], transcripts: unknown[][] = [], sent: Record<string, unknown>[] = [];
  let finalized = false, connections = 0;
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (raw: string) => sent.push(JSON.parse(raw)),
    close: () => socket.emit("close"),
  });
  try {
    globalThis.fetch = (async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/live/sessions/live_sip_fixture/accept");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("OpenAI-Project"), "proj_fixture");
      assert.equal(headers.get("OpenAI-Safety-Identifier"), "fixture");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.session.type, "live");
      assert.equal(body.session.model, "gpt-live-1");
      assert.equal(body.session.audio.output.voice, "gleam");
      assert.equal(Object.hasOwn(body.session.audio, "format"), false);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const adapter = new OpenAiLiveAdapter({openAiApiKey:"fixture",openAiWebhookSecret:"fixture",openAiProjectId:"proj_fixture"} as never, {
      updateAttempt: async () => {},
      transcript: async (...args: unknown[]) => { transcripts.push(args); return {saved:true}; },
      event: async (...args: unknown[]) => { events.push(args); },
      finalize: async () => { finalized = true; },
    } as never, (url, options) => {
      connections++;
      assert.equal(url, "wss://api.openai.com/v1/live/sessions/live_sip_fixture/attach");
      assert.equal((options.headers as Record<string,string>)["OpenAI-Project"], "proj_fixture");
      return socket as never;
    });
    await adapter.acceptIncomingCall("live_sip_fixture", "attempt_fixture", {
      attemptId:"attempt_fixture", modelId:"gpt-live-1",voice:"gleam",sessionConfig:{},instructions:"fixture",tools:[],allowlistOnly:true,safetyIdentifier:"fixture",
    } as never);
    assert.equal(connections, 1);
    assert.deepEqual(events[0].slice(2), ["live.session.accepted", "live-sip-accept:live_sip_fixture", {
      call_id:"live_sip_fixture",model:"gpt-live-1",voice:"gleam",status:"accepted",
    }]);
    socket.emit("open");
    const receive = (event: unknown) => socket.emit("message", Buffer.from(JSON.stringify(event)));
    receive({type:"session.output_audio.delta",delta:"AQI=",start_ms:0,end_ms:1});
    receive({type:"session.input_audio.append",audio:"AQI="});
    receive({type:"session.input_transcript.delta",event_id:"sip_text",delta:"Hallo",start_ms:100,end_ms:300});
    receive({type:"session.closed",reason:"remote_hangup"});
    for (let n=0;n<1000 && !finalized;n++) await tick();
    assert.equal(finalized,true);
    assert.ok(sent.every(event => !["session.start", "session.input_audio.append"].includes(String(event.type))));
    assert.ok(transcripts.some(args => JSON.stringify(args[1]).includes("Hallo")));
    assert.equal(transcripts.at(-1)?.[2],"complete");
  } finally { globalThis.fetch = original; }
});

test("SIP storage and provider failures never produce an accepted-model audit or sideband", async () => {
  const original = globalThis.fetch;
  try {
    for (const storageOk of [false, true]) {
      let requested = 0, audit = 0, connections = 0;
      globalThis.fetch = (async () => { requested++; return new Response(null, {status:403}); }) as typeof fetch;
      const adapter = new OpenAiLiveAdapter({openAiApiKey:"fixture",openAiWebhookSecret:"fixture",openAiProjectId:"proj_fixture"} as never, {
        updateAttempt: async () => {}, transcript: async () => ({saved:storageOk}), event: async () => {audit++;},
      } as never, () => {connections++;throw new Error("must not connect");});
      await assert.rejects(adapter.acceptIncomingCall("live_fixture","attempt_fixture", {
        modelId:"gpt-live-1",voice:"gleam",sessionConfig:{},instructions:"fixture",tools:[],
      } as never), storageOk ? /live_accept_http_403/ : /transcript_not_acknowledged/);
      assert.equal(requested,storageOk?1:0);assert.equal(audit,0);assert.equal(connections,0);
    }
  } finally {globalThis.fetch=original;}
});
