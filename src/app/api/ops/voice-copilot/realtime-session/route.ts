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
  console.error("ops voice copilot realtime route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

async function markVoiceSession(sessionId: string | null, status: "live" | "failed") {
  if (!sessionId) return;
  try {
    await updateVoiceCallSessionStatus(sessionId, status);
  } catch (error) {
    console.error("ops voice copilot session audit update failed", { sessionId, status, error });
  }
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  const openAiApiKey = process.env.OPENAI_API_KEY || "";
  if (!openAiApiKey) {
    return NextResponse.json({ ok: false, error: "openai_not_configured" }, { status: 503 });
  }

  let voiceSessionId: string | null = null;
  try {
    const body = await request.json();
    const input = validateVoiceCopilotRealtimeInput(body);
    const knowledgeEnabled = isVoiceKnowledgeEnabled();
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
        })
      : null;
    const form = new FormData();
    form.set("sdp", input.sdp);
    form.set("session", JSON.stringify(buildVoiceCopilotRealtimeSession({
      ...input,
      boundContext,
      knowledgeMatches,
    })));

    const openAiResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        authorization: `Bearer ${openAiApiKey}`,
        "OpenAI-Safety-Identifier": buildVoiceCopilotSafetyIdentifier(),
      },
      body: form,
    });
    const responseBody = await openAiResponse.text();
    if (!openAiResponse.ok) {
      await markVoiceSession(voiceSessionId, "failed");
      console.error("ops voice copilot realtime session failed", {
        status: openAiResponse.status,
        model: VOICE_COPILOT_MODEL,
        body: responseBody.slice(0, 500),
      });
      return NextResponse.json({ ok: false, error: "openai_realtime_failed" }, { status: openAiResponse.status });
    }

    await markVoiceSession(voiceSessionId, "live");

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "content-type": "application/sdp",
        "cache-control": "no-store",
        ...(voiceSessionId ? { "x-neontrip-voice-session-id": voiceSessionId } : {}),
      },
    });
  } catch (error) {
    await markVoiceSession(voiceSessionId, "failed");
    return failureResponse(error);
  }
}
