import test from "node:test";
import assert from "node:assert/strict";
import { saveAssistedCallSummary } from "../../src/lib/ops/voice-assisted-summary";

test("assisted summary uses persisted speakers, skips empty calls and preserves an existing note", async t => {
  const original = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "test", OPS_OPENAI_API_KEY: "test", VOICE_COPILOT_EXTRACTION_MODEL: "test" });
  t.after(() => { process.env = original; });
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let summary: string | null = null;
  let speakers: string[] = [];
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.includes("/v1/responses")) {
      requests++;
      assert.match(JSON.parse(String(init.body)).input, /Kunde: Rechts/);
      return Response.json({ output_text: "Kabelausgang rechts." });
    }
    if (url.includes("voice_transcript_segments")) return Response.json(speakers.map(speaker => ({ speaker, text: "Rechts", is_final: true })));
    assert.equal(new URL(url).searchParams.get("id"), "eq." + id);
    if (init.method === "PATCH") {
      assert.equal(new URL(url).searchParams.get("summary"), "is.null");
      summary = JSON.parse(String(init.body)).summary;
      return new Response(null, { status: 204 });
    }
    return Response.json([{ id, summary }]);
  });
  assert.equal(await saveAssistedCallSummary(id), "empty");
  speakers = ["customer"];
  assert.equal(await saveAssistedCallSummary(id), "saved");
  assert.match(String(summary), /Nur die Kundenseite/);
  summary = null;
  speakers.push("operator");
  await saveAssistedCallSummary(id);
  assert.equal(summary, "Kabelausgang rechts.");
  await saveAssistedCallSummary(id);
  assert.equal(requests, 2);
});
