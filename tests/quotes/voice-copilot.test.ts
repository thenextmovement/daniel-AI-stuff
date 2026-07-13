import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/ops/voice-copilot/realtime-session/route";
import {
  buildVoiceCopilotGuidance,
  buildVoiceCopilotInstructions,
  buildVoiceCopilotRealtimeSession,
  normalizeVoiceCopilotMode,
  validateVoiceCopilotRealtimeInput,
  voiceCopilotExtractionSchema,
  VOICE_COPILOT_MODEL,
} from "../../src/lib/ops/voice-copilot";
import { QuoteValidationError } from "../../src/lib/quotes/validation";

test("voice copilot guidance keeps lead qualification bounded", () => {
  const guidance = buildVoiceCopilotGuidance("lead_qualification");
  assert.equal(guidance.mode, "lead_qualification");
  assert.match(guidance.objective, /Bedarf/);
  assert.equal(guidance.guardrails.some((entry) => /Keine Preise/.test(entry)), true);
  assert.equal(guidance.guardrails.some((entry) => /Liefertermine/.test(entry)), true);
});

test("voice copilot instructions include knowledge and prompt-injection defense", () => {
  const instructions = buildVoiceCopilotInstructions({
    mode: "follow_up",
    customerName: "Daniel",
    requestSummary: "Kunde hat ein Angebot fuer eine Bar-Leuchtreklame gesehen.",
  });
  assert.match(instructions, /Voice Copilot/);
  assert.match(instructions, /LED-Neonschilder/);
  assert.match(instructions, /Trello als Source of Truth/);
  assert.match(instructions, /untrusted input/);
  assert.match(instructions, /Anfrage-Kontext: Kunde hat ein Angebot/);
});

test("voice copilot extraction schema is strict and reviewable", () => {
  const schema = voiceCopilotExtractionSchema();
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "mode",
    "outcome",
    "customerIntent",
    "productInterest",
    "unsafeOrUnsupportedRequest",
    "summaryForHuman",
  ]);
});

test("voice copilot realtime input validation normalizes modes and rejects invalid SDP", () => {
  assert.equal(normalizeVoiceCopilotMode("follow_up"), "follow_up");
  assert.equal(normalizeVoiceCopilotMode("bad-mode"), "internal_test");
  assert.throws(
    () => validateVoiceCopilotRealtimeInput({ mode: "lead_qualification", sdp: "not-sdp" }),
    QuoteValidationError,
  );
  const input = validateVoiceCopilotRealtimeInput({
    mode: "lead_qualification",
    sdp: "v=0\r\n",
    requestSummary: "x".repeat(1300),
  });
  assert.equal(input.mode, "lead_qualification");
  assert.equal(input.requestSummary?.length, 1200);
});

test("voice copilot realtime session uses the direct realtime model", () => {
  const session = buildVoiceCopilotRealtimeSession({ mode: "internal_test" });
  assert.equal(session.model, VOICE_COPILOT_MODEL);
  assert.equal(session.audio.output.voice, "marin");
  assert.match(session.instructions, /Keine Preise/);
});

test("voice copilot route proxies SDP without exposing OpenAI secrets", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  const env = process.env as Record<string, string | undefined>;
  try {
    env.NODE_ENV = "development";
    process.env.OPENAI_API_KEY = "test-openai-key";
    let capturedAuthorization = "";
    let capturedBody: FormData | null = null;
    globalThis.fetch = (async (_url, init) => {
      capturedAuthorization = String((init?.headers as Record<string, string> | undefined)?.authorization || "");
      capturedBody = init?.body as FormData;
      return new Response("v=0\r\nanswer", { status: 200, headers: { "content-type": "application/sdp" } });
    }) as typeof fetch;

    const response = await POST(new NextRequest("http://localhost/api/ops/voice-copilot/realtime-session", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({
        sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n",
        mode: "lead_qualification",
      }),
    }));

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "v=0\r\nanswer");
    assert.equal(capturedAuthorization, "Bearer test-openai-key");
    assert.equal(capturedBody?.get("sdp"), "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n");
    assert.doesNotMatch(readFileSync("src/app/ops/voice-copilot/page-client.tsx", "utf8"), /OPENAI_API_KEY/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
    if (originalNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalNodeEnv;
    }
  }
});

test("voice copilot is exposed in ops navigation", () => {
  const source = readFileSync("src/app/ops/ops-app-switcher.tsx", "utf8");
  assert.match(source, /Voice Copilot/);
  assert.match(source, /\/ops\/voice-copilot/);
});
