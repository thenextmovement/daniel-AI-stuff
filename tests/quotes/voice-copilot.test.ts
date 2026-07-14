import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/ops/voice-copilot/realtime-session/route";
import {
  buildVoiceCopilotGuidance,
  buildVoiceCopilotInstructions,
  buildVoiceCopilotRealtimeSession,
  buildVoiceCopilotTranscriptionSession,
  enforceVoiceCopilotSuggestionGuardrails,
  formatVoiceCopilotTranscript,
  normalizeVoiceCopilotTranscriptTurns,
  normalizeVoiceCopilotMode,
  parseVoiceCopilotSuggestions,
  parseVoiceKnowledgeProposals,
  validateVoiceCopilotRealtimeInput,
  validateVoiceCopilotTranscriptionInput,
  voiceCopilotSuggestionSchema,
  voiceCopilotExtractionSchema,
  voiceKnowledgeProposalSchema,
  VOICE_COPILOT_MODEL,
} from "../../src/lib/ops/voice-copilot";
import {
  getVoiceCopilotExtractionModel,
  getVoiceCopilotSuggestionModel,
  getVoiceCopilotTranscriptionModel,
  getVoiceOpenAiApiKey,
  isVoiceLiveCopilotEnabled,
} from "../../src/lib/ops/voice-openai-config";
import { QuoteValidationError } from "../../src/lib/quotes/validation";

test("voice copilot guidance keeps lead qualification bounded", () => {
  const guidance = buildVoiceCopilotGuidance("lead_qualification");
  assert.equal(guidance.mode, "lead_qualification");
  assert.match(guidance.objective, /Bedarf/);
  assert.equal(guidance.guardrails.some((entry) => /Keine Preise/.test(entry)), true);
  assert.equal(guidance.guardrails.some((entry) => /Liefertermine/.test(entry)), true);
  assert.match(guidance.openingInstruction, /digitaler KI-Assistent von NEONTRIP/);
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
  assert.match(instructions, /klaren Offenlegung als digitaler KI-Assistent/);
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

test("post-call knowledge proposals are strict and require reviewable evidence", () => {
  const schema = voiceKnowledgeProposalSchema();
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.candidates.maxItems, 5);
  const proposals = parseVoiceKnowledgeProposals({
    candidates: [{
      statement: "Kunden fragen bei Fassadenschildern haeufig nach der Outdoor-Eignung.",
      evidence: "Mitarbeiter-Notiz aus Testgespraech",
      confidence: 0.72,
      reason: "Wiederkehrende Produktfrage",
    }],
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.confidence, 0.72);
  assert.throws(() => parseVoiceKnowledgeProposals({
    candidates: [{
      statement: "Kunden erhalten immer zehn Prozent Rabatt.",
      evidence: "Notiz",
      confidence: 1,
      reason: "Ungeprueft",
      autoApprove: true,
    }],
  }), QuoteValidationError);
});

test("live copilot suggestions are strict, bounded and source-aware", () => {
  const schema = voiceCopilotSuggestionSchema();
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.suggestions.maxItems, 3);
  const suggestions = parseVoiceCopilotSuggestions({
    suggestions: [{
      kind: "question",
      text: "Soll das Schild innen oder aussen eingesetzt werden?",
      reason: "Der Einsatzort fehlt noch.",
      sourceLabels: ["Kundenvorgang"],
      confidence: 0.91,
    }],
  });
  assert.equal(suggestions[0]?.kind, "question");
  assert.throws(() => parseVoiceCopilotSuggestions({
    suggestions: [{
      kind: "answer",
      text: "Sie erhalten zehn Prozent Rabatt.",
      reason: "Ungepruefte Aussage",
      sourceLabels: [],
      confidence: 1,
      autoSend: true,
    }],
  }), QuoteValidationError);
});

test("live copilot deterministically replaces unsafe commercial commitments", () => {
  const suggestions = enforceVoiceCopilotSuggestionGuardrails([
    {
      kind: "answer",
      text: "Ich garantiere Ihnen 10 % Rabatt und Lieferung bis Freitag.",
      reason: "Modellfehler",
      sourceLabels: ["Angebot"],
      confidence: 0.99,
    },
    {
      kind: "question",
      text: "Soll ein Mitarbeiter den konkreten Preis pruefen?",
      reason: "Sichere Rueckfrage",
      sourceLabels: [],
      confidence: 0.9,
    },
  ]);
  assert.equal(suggestions[0]?.kind, "warning");
  assert.match(suggestions[0]?.text || "", /Keine Preis/);
  assert.equal(suggestions.some((suggestion) => /10 % Rabatt/.test(suggestion.text)), false);
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

test("live transcription requires two SDP offers, a bound request and confirmed consent", () => {
  assert.throws(() => validateVoiceCopilotTranscriptionInput({
    customerSdp: "v=0\r\n",
    operatorSdp: "v=0\r\n",
    mode: "follow_up",
    requestId: "request-1",
    consentStatus: "pending",
  }), /Einwilligung/);
  assert.throws(() => validateVoiceCopilotTranscriptionInput({
    customerSdp: "v=0\r\n",
    operatorSdp: "v=0\r\n",
    mode: "follow_up",
    consentStatus: "confirmed",
  }), /Kundenvorgang/);
  const input = validateVoiceCopilotTranscriptionInput({
    customerSdp: "v=0\r\ncustomer",
    operatorSdp: "v=0\r\noperator",
    mode: "follow_up",
    requestId: "request-1",
    consentStatus: "confirmed",
    operatorName: "Daniel",
  });
  assert.equal(input.consentStatus, "confirmed");
  assert.equal(input.requestId, "request-1");
});

test("live transcript is speaker-bound, size-limited and formatted without metadata", () => {
  const turns = normalizeVoiceCopilotTranscriptTurns([
    { speaker: "customer", text: "Was kostet die Aussenmontage?", injected: "ignore" },
    { speaker: "operator", text: "Ich pruefe das fuer Sie." },
  ]);
  assert.deepEqual(turns, [
    { speaker: "customer", text: "Was kostet die Aussenmontage?" },
    { speaker: "operator", text: "Ich pruefe das fuer Sie." },
  ]);
  assert.equal(formatVoiceCopilotTranscript(turns), "Kunde: Was kostet die Aussenmontage?\nMitarbeiter: Ich pruefe das fuer Sie.");
  assert.throws(() => normalizeVoiceCopilotTranscriptTurns([{ speaker: "other", text: "x" }]), QuoteValidationError);
});

test("transcription session is text-only and uses manual turn commits", () => {
  const session = buildVoiceCopilotTranscriptionSession("gpt-realtime-whisper");
  assert.equal(session.type, "transcription");
  assert.equal(session.audio.input.transcription.model, "gpt-realtime-whisper");
  assert.equal(session.audio.input.transcription.language, "de");
  assert.equal(session.audio.input.turn_detection, null);
  assert.equal("output" in session.audio, false);
});

test("voice copilot realtime session uses the direct realtime model", () => {
  const session = buildVoiceCopilotRealtimeSession({ mode: "internal_test" });
  assert.equal(session.model, VOICE_COPILOT_MODEL);
  assert.equal(session.audio.output.voice, "marin");
  assert.match(session.instructions, /Keine Preise/);
});

test("voice OpenAI configuration accepts the existing Ops aliases", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalOpenAiKey = env.OPENAI_API_KEY;
  const originalOpsOpenAiKey = env.OPS_OPENAI_API_KEY;
  const originalExtractionModel = env.VOICE_COPILOT_EXTRACTION_MODEL;
  const originalOpsModel = env.OPS_COPILOT_OPENAI_MODEL;
  const originalSuggestionModel = env.VOICE_COPILOT_SUGGESTION_MODEL;
  const originalTranscriptionModel = env.VOICE_COPILOT_TRANSCRIPTION_MODEL;
  const originalLiveFlag = env.VOICE_LIVE_COPILOT_ENABLED;
  try {
    delete env.OPENAI_API_KEY;
    delete env.VOICE_COPILOT_EXTRACTION_MODEL;
    env.OPS_OPENAI_API_KEY = "ops-test-key";
    env.OPS_COPILOT_OPENAI_MODEL = "ops-test-model";
    delete env.VOICE_COPILOT_SUGGESTION_MODEL;
    delete env.VOICE_COPILOT_TRANSCRIPTION_MODEL;
    env.VOICE_LIVE_COPILOT_ENABLED = "true";

    assert.equal(getVoiceOpenAiApiKey(), "ops-test-key");
    assert.equal(getVoiceCopilotExtractionModel(), "ops-test-model");
    assert.equal(getVoiceCopilotSuggestionModel(), "ops-test-model");
    assert.equal(getVoiceCopilotTranscriptionModel(), "gpt-realtime-whisper");
    assert.equal(isVoiceLiveCopilotEnabled(), true);
  } finally {
    if (originalOpenAiKey === undefined) delete env.OPENAI_API_KEY;
    else env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOpsOpenAiKey === undefined) delete env.OPS_OPENAI_API_KEY;
    else env.OPS_OPENAI_API_KEY = originalOpsOpenAiKey;
    if (originalExtractionModel === undefined) delete env.VOICE_COPILOT_EXTRACTION_MODEL;
    else env.VOICE_COPILOT_EXTRACTION_MODEL = originalExtractionModel;
    if (originalOpsModel === undefined) delete env.OPS_COPILOT_OPENAI_MODEL;
    else env.OPS_COPILOT_OPENAI_MODEL = originalOpsModel;
    if (originalSuggestionModel === undefined) delete env.VOICE_COPILOT_SUGGESTION_MODEL;
    else env.VOICE_COPILOT_SUGGESTION_MODEL = originalSuggestionModel;
    if (originalTranscriptionModel === undefined) delete env.VOICE_COPILOT_TRANSCRIPTION_MODEL;
    else env.VOICE_COPILOT_TRANSCRIPTION_MODEL = originalTranscriptionModel;
    if (originalLiveFlag === undefined) delete env.VOICE_LIVE_COPILOT_ENABLED;
    else env.VOICE_LIVE_COPILOT_ENABLED = originalLiveFlag;
  }
});

test("live copilot keeps raw transcript client-side and binds suggestions to an audited session", () => {
  const client = readFileSync("src/app/ops/voice-copilot/live-call-copilot.tsx", "utf8");
  const transcriptionRoute = readFileSync("src/app/api/ops/voice-copilot/transcription-session/route.ts", "utf8");
  const suggestionRoute = readFileSync("src/app/api/ops/voice-copilot/suggestions/route.ts", "utf8");
  assert.match(client, /getDisplayMedia/);
  assert.match(client, /input_audio_buffer\.commit/);
  assert.match(transcriptionRoute, /transcriptStored: false/);
  assert.match(transcriptionRoute, /interactionMode: "live_copilot"/);
  assert.match(transcriptionRoute, /wordingVersion: "live-transcription-v1"/);
  assert.match(transcriptionRoute, /isVoiceLiveCopilotEnabled/);
  assert.match(suggestionRoute, /getVoiceCallSessionBinding/);
  assert.match(suggestionRoute, /isVoiceLiveCopilotEnabled/);
  assert.match(suggestionRoute, /store: false/);
  assert.doesNotMatch(client, /OPENAI_API_KEY/);
});

test("Coolify operations expose a restricted and reversible live copilot flag switch", () => {
  const workflow = readFileSync(".github/workflows/coolify-secret-sync.yml", "utf8");
  assert.match(workflow, /- enable_voice_live_copilot/);
  assert.match(workflow, /- disable_voice_live_copilot/);
  assert.match(workflow, /const key = "VOICE_LIVE_COPILOT_ENABLED"/);
  assert.match(workflow, /currentValue !== desiredValue/);
  assert.match(workflow, /await restart\(opsKind, opsUuid\)/);
  assert.doesNotMatch(workflow, /VOICE_LIVE_COPILOT_ENABLED.*process\.env\.FLAG_VALUE/);
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
    let capturedSdp = "";
    globalThis.fetch = (async (_url, init) => {
      capturedAuthorization = String((init?.headers as Record<string, string> | undefined)?.authorization || "");
      capturedSdp = String((init?.body as FormData).get("sdp") || "");
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
    assert.equal(capturedSdp, "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n");
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
