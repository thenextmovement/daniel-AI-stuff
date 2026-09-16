import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  validateTranscriptBatch,
  transcriptTokenHash,
  listVoiceHistory,
  getVoiceTranscript,
  persistVoiceTranscript,
} from "../../src/lib/ops/voice-history";
import { VoiceTranscriptBuffer } from "../../src/lib/ops/voice-transcript-buffer";
import {
  POST,
  GET,
} from "../../src/app/api/ops/voice-copilot/transcript/route";
const segment = {
  id: "customer:item_1",
  speaker: "customer" as const,
  text: " Bitte RAL 9031 prüfen. ",
  revision: 1,
  final: false,
  startMs: 120,
  endMs: 400,
};
const sessionId = "11111111-1111-4111-8111-111111111111";
test("transcript validation preserves exact text and requires speaker, stable event id, bounds and revision", () => {
  assert.deepEqual(validateTranscriptBatch([segment]), [segment]);
  for (const change of [
    { text: "" },
    { speaker: "system" },
    { revision: 0 },
    { startMs: -1 },
    { endMs: 1 },
    { text: "x".repeat(16001) },
    { id: "x/y" },
    { final: "true" },
  ])
    assert.throws(() => validateTranscriptBatch([{ ...segment, ...change }]));
  assert.throws(() => validateTranscriptBatch([segment, segment]));
  assert.throws(() => validateTranscriptBatch(Array(51).fill(segment)));
  assert.equal(transcriptTokenHash("a".repeat(64)).length, 64);
  assert.throws(() => transcriptTokenHash(""));
});
test("retry queue retains failed writes and does not overwrite a newer revision while a save is in flight", async () => {
  let fail = true;
  const sent: number[] = [];
  const buffer = new VoiceTranscriptBuffer(async (rows) => {
    sent.push(rows[0].revision);
    if (fail) {
      fail = false;
      throw new Error("offline");
    }
    if (rows[0].revision === 1)
      buffer.stage({
        ...segment,
        revision: 2,
        text: "Bitte RAL 9013 prüfen.",
        final: true,
      });
  });
  buffer.stage(segment);
  await assert.rejects(buffer.flush());
  assert.equal(buffer.size, 1);
  await buffer.flush();
  assert.equal(buffer.size, 0);
  assert.deepEqual(sent, [1, 1, 2]);
});
test("retry queue serializes concurrent saves and bounds UTF-8 batches", async () => {
  let inFlight = 0,
    max = 0;
  const buffer = new VoiceTranscriptBuffer(async (rows) => {
    inFlight++;
    max = Math.max(max, inFlight);
    assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length < 55000);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
  });
  for (let i = 0; i < 80; i++)
    buffer.stage({ ...segment, id: "event_" + i, text: "ä".repeat(1200) });
  await Promise.all([buffer.flush(), buffer.flush()]);
  assert.equal(max, 1);
  assert.equal(buffer.size, 0);
});
test("unauthenticated transcript read and write never touch storage", async () => {
  const env = process.env as Record<string, string | undefined>,
    before = { ...env },
    original = globalThis.fetch;
  try {
    env.NODE_ENV = "production";
    env.OPS_CLOUDFLARE_ACCESS_ISSUER = "https://access.test";
    env.OPS_CLOUDFLARE_ACCESS_AUD = "test";
    env.OPS_REQUIRE_CLOUDFLARE_ACCESS = "true";
    globalThis.fetch = (async () => {
      throw new Error("must not fetch");
    }) as typeof fetch;
    for (const handler of [GET, POST]) {
      const response = await handler(
        new NextRequest(
          "https://ops.neontrip.de/api/ops/voice-copilot/transcript",
          {
            method: handler === POST ? "POST" : "GET",
            headers: { host: "ops.neontrip.de" },
          },
        ),
      );
      assert.ok([401, 503].includes(response.status));
    }
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(env)) if (!(key in before)) delete env[key];
    Object.assign(env, before);
  }
});
test("history and full transcript lookup always exclude tests and keep secrets out of selected fields", async () => {
  const env = process.env as Record<string, string | undefined>,
    before = { ...env },
    original = globalThis.fetch;
  const urls: URL[] = [];
  try {
    env.SUPABASE_URL = "https://database.test";
    env.SUPABASE_SERVICE_ROLE_KEY = "fake-test-key";
    globalThis.fetch = (async (url) => {
      urls.push(new URL(String(url)));
      return Response.json([]);
    }) as typeof fetch;
    await listVoiceHistory("REQ-TEST", 20);
    assert.equal(urls[0].searchParams.get("mode"), "neq.internal_test");
    assert.equal(urls[0].searchParams.get("offset"), "20");
    assert.ok(!urls[0].searchParams.get("select")?.includes("token"));
    await assert.rejects(getVoiceTranscript(sessionId));
    assert.equal(urls[1].searchParams.get("mode"), "neq.internal_test");
    await assert.rejects(
      persistVoiceTranscript({
        sessionId,
        token: "a".repeat(64),
        segments: [segment],
      }),
    );
    assert.equal(
      urls.length,
      3,
      "denied ownership never invokes the write RPC",
    );
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(env)) if (!(key in before)) delete env[key];
    Object.assign(env, before);
  }
});
