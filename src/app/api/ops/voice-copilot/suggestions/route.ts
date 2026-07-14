import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, readVoiceCopilotJson, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import {
  buildVoiceCopilotSafetyIdentifier,
  buildVoiceCopilotSuggestionInstructions,
  enforceVoiceCopilotSuggestionGuardrails,
  extractOpenAiResponseText,
  formatVoiceCopilotTranscript,
  normalizeVoiceCopilotTranscriptTurns,
  parseVoiceCopilotSuggestions,
  voiceCopilotSuggestionSchema,
} from "@/lib/ops/voice-copilot";
import {
  buildVoiceKnowledgeQuery,
  getVoiceCallSessionBinding,
  getVoiceCustomerContext,
  searchApprovedVoiceKnowledge,
} from "@/lib/ops/voice-knowledge";
import { getVoiceCopilotSuggestionModel, getVoiceOpenAiApiKey, isVoiceLiveCopilotEnabled } from "@/lib/ops/voice-openai-config";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;

  try {
    if (!isVoiceLiveCopilotEnabled()) {
      return NextResponse.json({ ok: false, error: "voice_live_copilot_disabled" }, { status: 503 });
    }
    const body = await readVoiceCopilotJson(request);
    const session = await getVoiceCallSessionBinding(body.sessionId);
    const turns = normalizeVoiceCopilotTranscriptTurns(body.turns);
    const latestCustomerTurn = [...turns].reverse().find((turn) => turn.speaker === "customer");
    if (!latestCustomerTurn) {
      throw new QuoteValidationError("Noch kein Kundenbeitrag fuer Vorschlaege vorhanden.", ["customer_turn_required"], 422);
    }
    const apiKey = getVoiceOpenAiApiKey();
    const model = getVoiceCopilotSuggestionModel();
    if (!apiKey || !model) {
      return NextResponse.json({ ok: false, error: "suggestion_model_not_configured" }, { status: 503 });
    }

    const boundContext = session.requestId ? await getVoiceCustomerContext(session.requestId) : null;
    const knowledgeMatches = await searchApprovedVoiceKnowledge([
      buildVoiceKnowledgeQuery(boundContext, session.mode),
      latestCustomerTurn.text,
    ].join(" ").slice(0, 240), session.mode, 4);
    const allowedSourceLabels = new Set([
      ...(boundContext ? ["Kundenvorgang"] : []),
      ...(boundContext?.offer ? ["Angebot"] : []),
      ...(boundContext?.outlook.length ? ["Outlook"] : []),
      ...knowledgeMatches.map((match) => cleanText(match.title, 100)),
    ]);

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "OpenAI-Safety-Identifier": buildVoiceCopilotSafetyIdentifier(),
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 900,
        input: [
          {
            role: "system",
            content: buildVoiceCopilotSuggestionInstructions({
              mode: session.mode,
              boundContext,
              knowledgeMatches,
            }),
          },
          {
            role: "user",
            content: [
              `Erlaubte Quellenbezeichnungen: ${[...allowedSourceLabels].join(", ") || "keine"}`,
              "Verwende nur exakt diese Quellenbezeichnungen.",
              "",
              "Live-Transkript:",
              formatVoiceCopilotTranscript(turns),
            ].join("\n"),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "voice_live_copilot_suggestions",
            strict: true,
            schema: voiceCopilotSuggestionSchema(),
          },
        },
      }),
    });
    const payload = await openAiResponse.json().catch(() => null);
    if (!openAiResponse.ok) {
      console.error("voice copilot live suggestion request failed", { status: openAiResponse.status, model });
      return NextResponse.json({ ok: false, error: "openai_suggestion_failed" }, { status: 502 });
    }
    const outputText = extractOpenAiResponseText(payload);
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new QuoteValidationError("OpenAI-Ausgabe war kein gueltiges JSON.", ["invalid_model_json"], 502);
    }
    const suggestions = enforceVoiceCopilotSuggestionGuardrails(parseVoiceCopilotSuggestions(parsed)).map((suggestion) => ({
      ...suggestion,
      sourceLabels: suggestion.sourceLabels.filter((label) => allowedSourceLabels.has(label)),
    }));
    return NextResponse.json({
      ok: true,
      suggestions,
      generatedAt: new Date().toISOString(),
      transcriptStored: false,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return voiceCopilotApiFailure(error, "live-suggestions");
  }
}
