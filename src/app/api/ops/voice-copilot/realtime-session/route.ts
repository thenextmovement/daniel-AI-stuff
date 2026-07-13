import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  buildVoiceCopilotRealtimeSession,
  buildVoiceCopilotSafetyIdentifier,
  validateVoiceCopilotRealtimeInput,
  VOICE_COPILOT_MODEL,
} from "@/lib/ops/voice-copilot";
import { QuoteValidationError } from "@/lib/quotes/validation";

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

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  const openAiApiKey = process.env.OPENAI_API_KEY || "";
  if (!openAiApiKey) {
    return NextResponse.json({ ok: false, error: "openai_not_configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const input = validateVoiceCopilotRealtimeInput(body);
    const form = new FormData();
    form.set("sdp", input.sdp);
    form.set("session", JSON.stringify(buildVoiceCopilotRealtimeSession(input)));

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
      console.error("ops voice copilot realtime session failed", {
        status: openAiResponse.status,
        model: VOICE_COPILOT_MODEL,
        body: responseBody.slice(0, 500),
      });
      return NextResponse.json({ ok: false, error: "openai_realtime_failed" }, { status: openAiResponse.status });
    }

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "content-type": "application/sdp",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return failureResponse(error);
  }
}
