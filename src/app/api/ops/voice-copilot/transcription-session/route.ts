import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, readVoiceCopilotJson, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import {
  buildVoiceCopilotSafetyIdentifier,
  buildVoiceCopilotTranscriptionSession,
  validateVoiceCopilotTranscriptionInput,
} from "@/lib/ops/voice-copilot";
import {
  buildVoiceKnowledgeQuery,
  createVoiceCallSession,
  getVoiceCustomerContext,
  isVoiceKnowledgeEnabled,
  searchApprovedVoiceKnowledge,
  updateVoiceCallSessionStatus,
} from "@/lib/ops/voice-knowledge";
import { getVoiceCopilotTranscriptionModel, getVoiceOpenAiApiKey, isVoiceLiveCopilotEnabled } from "@/lib/ops/voice-openai-config";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

type RealtimeTranscriptionCall = {
  answerSdp: string;
  callId: string | null;
};

function callIdFromLocation(location: string | null) {
  if (!location) return null;
  const value = location.split("?")[0]?.split("/").filter(Boolean).pop() || "";
  return /^rtc_[a-zA-Z0-9_-]+$/.test(value) ? value : null;
}

async function createTranscriptionCall(input: {
  apiKey: string;
  model: string;
  sdp: string;
  speaker: "customer" | "operator";
}) {
  const form = new FormData();
  form.set("sdp", input.sdp);
  form.set("session", JSON.stringify(buildVoiceCopilotTranscriptionSession(input.model)));
  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "OpenAI-Safety-Identifier": buildVoiceCopilotSafetyIdentifier(),
    },
    body: form,
  });
  const answerSdp = await response.text();
  if (!response.ok) {
    console.error("voice copilot transcription session failed", {
      status: response.status,
      model: input.model,
      speaker: input.speaker,
    });
    throw new QuoteValidationError("OpenAI-Transkription konnte nicht gestartet werden.", ["openai_transcription_failed"], 502);
  }
  return {
    answerSdp,
    callId: callIdFromLocation(response.headers.get("location")),
  } satisfies RealtimeTranscriptionCall;
}

async function hangupTranscriptionCall(apiKey: string, callId: string | null) {
  if (!callId) return;
  try {
    const response = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) console.error("voice copilot partial transcription cleanup failed", { status: response.status });
  } catch (error) {
    console.error("voice copilot partial transcription cleanup failed", error);
  }
}

async function markSession(sessionId: string | null, status: "live" | "failed") {
  if (!sessionId) return;
  try {
    await updateVoiceCallSessionStatus(sessionId, status);
  } catch (error) {
    console.error("voice copilot transcription audit update failed", { sessionId, status, error });
  }
}

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;

  let voiceSessionId: string | null = null;
  let customerCall: RealtimeTranscriptionCall | null = null;
  try {
    if (!isVoiceLiveCopilotEnabled()) {
      return NextResponse.json({ ok: false, error: "voice_live_copilot_disabled" }, { status: 503 });
    }
    if (!isVoiceKnowledgeEnabled()) {
      return NextResponse.json({ ok: false, error: "voice_knowledge_not_enabled" }, { status: 503 });
    }
    const input = validateVoiceCopilotTranscriptionInput(await readVoiceCopilotJson(request));
    const apiKey = getVoiceOpenAiApiKey();
    const model = getVoiceCopilotTranscriptionModel();
    if (!apiKey || !model) {
      return NextResponse.json({ ok: false, error: "openai_not_configured" }, { status: 503 });
    }

    const boundContext = input.requestId ? await getVoiceCustomerContext(input.requestId) : null;
    const knowledgeMatches = await searchApprovedVoiceKnowledge(
      buildVoiceKnowledgeQuery(boundContext, input.mode),
      input.mode,
      4,
    );
    voiceSessionId = await createVoiceCallSession({
      operatorName: input.operatorName,
      mode: input.mode,
      context: boundContext,
      knowledgeMatches,
      consentStatus: input.consentStatus,
      interactionMode: "live_copilot",
      consentEvidence: input.mode === "internal_test" ? null : {
        method: "operator_attestation",
        wordingVersion: "live-transcription-v1",
        confirmedAt: new Date().toISOString(),
      },
    });

    customerCall = await createTranscriptionCall({
      apiKey,
      model,
      sdp: input.customerSdp,
      speaker: "customer",
    });
    const operatorCall = await createTranscriptionCall({
      apiKey,
      model,
      sdp: input.operatorSdp,
      speaker: "operator",
    });
    await markSession(voiceSessionId, "live");

    return NextResponse.json({
      ok: true,
      sessionId: voiceSessionId,
      customerSdp: customerCall.answerSdp,
      operatorSdp: operatorCall.answerSdp,
      transcriptStored: false,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await markSession(voiceSessionId, "failed");
    if (customerCall) await hangupTranscriptionCall(getVoiceOpenAiApiKey(), customerCall.callId);
    return voiceCopilotApiFailure(error, "transcription-session");
  }
}
