import assert from "node:assert/strict";
import test from "node:test";
import { runVoicePlatformAdminAction } from "../../src/lib/ops/voice-platform-data";

test("Live model registration declares the primary WebSocket contract but grants no approval", async () => {
  const originalFetch = globalThis.fetch;
  const before = { ...process.env };
  const writes: Array<{path: string; body: Record<string, unknown>}> = [];
  process.env.SUPABASE_URL = "https://voice-model.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://voice-model.test");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    writes.push({path: url.pathname, body});
    if (url.pathname.endsWith("/voice_model_releases")) return Response.json([{...body, id: "11111111-1111-4111-8111-111111111111"}]);
    if (url.pathname.endsWith("/voice_platform_audit_log")) return new Response(null, {status: 201});
    throw new Error("Unexpected database request");
  }) as typeof fetch;
  try {
    for (const transport of [undefined, "websocket", "sip"]) {
      writes.length = 0;
      await runVoicePlatformAdminAction("register_model", {modelId: "gpt-live-1", actor: "sql-test", transport});
      assert.equal(writes.length, 2);
      const row = writes[0].body;
      assert.equal(row.enabled, false);
      assert.equal(row.lifecycle, "available");
      assert.equal(row.eval_status, "pending");
      assert.equal(row.transport, transport || "websocket");
      if (transport !== "sip") {
        assert.deepEqual(row.session_config, {protocol: "live", delegation_model: "gpt-5.6-terra"});
        assert.deepEqual(row.capabilities, {speech_to_speech: true, function_tools: true, full_duplex: true, transcript_events: true});
        assert.equal(row.release_key, "openai-gpt-live-1-websocket-v1");
      } else {
        assert.equal((row.capabilities as Record<string, unknown>).sideband, true);
      }
      assert.equal(writes[1].body.action, "model_registered");
    }
    writes.length = 0;
    await assert.rejects(runVoicePlatformAdminAction("register_model", {modelId: "gpt-realtime-2.1"}), /Nur GPT-Live 1/);
    assert.equal(writes.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});
