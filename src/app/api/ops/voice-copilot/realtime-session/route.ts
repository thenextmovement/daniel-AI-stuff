import { randomBytes } from "node:crypto";
import { transcriptTokenHash } from "@/lib/ops/voice-history";
import { readVoiceCopilotJson, resolveVoiceCopilotActor } from "@/lib/ops/voice-copilot-api";
import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  buildVoiceCopilotRealtimeSession,
  buildVoiceCopilotSafetyIdentifier,
  validateVoiceCopilotRealtimeInput,
  VOICE_COPILOT_MODEL,
} from "@/lib/ops/voice-copilot";
import { QuoteValidationError } from "@/lib/quotes/validation";
import {
  buildVoiceKnowledgeQuery,
  createVoiceCallSession,
  getVoiceCustomerContext,
  isVoiceKnowledgeEnabled,
  searchApprovedVoiceKnowledge,
  updateVoiceCallSessionStatus,
} from "@/lib/ops/voice-knowledge";
import { getVoiceOpenAiApiKey } from "@/lib/ops/voice-openai-config";

export const dynamic = "force-dynamic";

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  console.error("ops voice copilot live route failed");
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

async function markVoiceSession(sessionId: string | null, status: "live" | "failed") {
  if (!sessionId) return;
  try {
    await updateVoiceCallSessionStatus(sessionId, status);
  } catch (error) {
    console.error("ops voice copilot session audit update failed", { sessionId, status });
  }
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  const openAiApiKey = getVoiceOpenAiApiKey();
  if (!openAiApiKey) {
    return NextResponse.json({ ok: false, error: "openai_not_configured" }, { status: 503 });
  }

  let voiceSessionId: string | null = null;
  let liveSessionId: string | null = null;
  try {
    const body = await readVoiceCopilotJson(request);
    if (body.transcriptStorageConsent !== true) throw new QuoteValidationError("Einwilligung zur Transkriptspeicherung fehlt.", ["transcript_storage_consent_required"], 422);
    const transcriptWriteToken = randomBytes(32).toString("hex");
    const input = validateVoiceCopilotRealtimeInput(body);
    const knowledgeEnabled = isVoiceKnowledgeEnabled();
    if (!knowledgeEnabled) throw new QuoteValidationError("Wissenssystem ist nicht bereit.", ["voice_knowledge_not_enabled"], 503);
    if (input.mode !== "internal_test" && input.consentStatus !== "confirmed") throw new QuoteValidationError("Einwilligung fehlt.", ["consent_required"], 422);
    const boundContext = knowledgeEnabled && input.requestId
      ? await getVoiceCustomerContext(input.requestId)
      : null;
    if (knowledgeEnabled && input.mode !== "internal_test" && !boundContext) {
      throw new QuoteValidationError("Lead- und Follow-up-Sessions benoetigen eine gebundene Request-ID.", ["missing_bound_request"], 422);
    }
    const knowledgeMatches = knowledgeEnabled
      ? await searchApprovedVoiceKnowledge(buildVoiceKnowledgeQuery(boundContext, input.mode), input.mode, 4)
      : [];
    voiceSessionId = knowledgeEnabled
      ? await createVoiceCallSession({
          operatorName: input.operatorName,
          mode: input.mode,
          context: boundContext,
          knowledgeMatches,
          consentStatus: input.consentStatus,
          transcriptWriteTokenHash: transcriptTokenHash(transcriptWriteToken),
          consentEvidence: { method: "operator_attestation", confirmedBy: await resolveVoiceCopilotActor(request) || "authenticated_ops", wordingVersion: "voice-agent-transcript-v1", confirmedAt: new Date().toISOString() },
        })
      : null;
    const session = buildVoiceCopilotRealtimeSession({ ...input, boundContext, knowledgeMatches });
    const openAiResponse = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openAiApiKey}`,
        "OpenAI-Safety-Identifier": buildVoiceCopilotSafetyIdentifier(),
      },
      body: JSON.stringify({ session, transport: { type: "webrtc", sdp: input.sdp } }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await openAiResponse.json().catch(() => null);
    if (!openAiResponse.ok) {
      await markVoiceSession(voiceSessionId, "failed");
      console.error("ops voice copilot realtime session failed", {
        status: openAiResponse.status,
        model: VOICE_COPILOT_MODEL,

      });
      return NextResponse.json({ ok: false, error: "openai_live_failed" }, { status: openAiResponse.status });
    }

    if (typeof result?.session?.id !== "string" || typeof result?.transport?.sdp !== "string") {
      throw new QuoteValidationError("Ungültige GPT-Live-Antwort.", ["invalid_live_response"], 502);
    }
    liveSessionId = result.session.id;
    await updateVoiceCallSessionStatus(voiceSessionId, "live");

    return new NextResponse(result.transport.sdp, {
      status: 200,
      headers: {
        "content-type": "application/sdp",
        "cache-control": "no-store",
        "x-neontrip-transcript-token": transcriptWriteToken,
        ...(voiceSessionId ? { "x-neontrip-voice-session-id": voiceSessionId } : {}),
      },
    });
  } catch (error) {
    if (liveSessionId) await fetch("https://api.openai.com/v1/live/sessions/" + encodeURIComponent(liveSessionId) + "/hangup", {
      method: "POST", headers: { authorization: "Bearer " + openAiApiKey }, signal: AbortSignal.timeout(5_000),
    }).catch(() => console.error("voice live session cleanup failed"));
    await markVoiceSession(voiceSessionId, "failed");
    return failureResponse(error);
  }
}
