import { randomBytes, createHash } from "node:crypto";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { requireVoiceUuid } from "@/lib/ops/voice-platform-contract";
import { getVoiceRuntimeSessionByAttempt } from "@/lib/ops/voice-platform-data";
import { validateTranscriptBatch } from "@/lib/ops/voice-history";
import { QuoteValidationError } from "@/lib/quotes/validation";

type Row = {
  id: string;
  transcript_write_token_hash: string;
  status: string;
  ended_at: string | null;
};
export async function saveRuntimeTranscript(input: Record<string, unknown>) {
  const attemptId = requireVoiceUuid(input.attemptId, "Attempt-ID");
  const segments = validateTranscriptBatch(input.segments);
  if (
    input.finish !== undefined &&
    !["complete", "interrupted"].includes(String(input.finish))
  )
    throw new QuoteValidationError(
      "Ungültiger Abschluss.",
      ["invalid_finish"],
      422,
    );
  const lookup = () =>
    supabaseRequest<Row[]>("voice_call_sessions", undefined, {
      select: "id,transcript_write_token_hash,status,ended_at",
      attempt_id: "eq." + attemptId,
      limit: 1,
    });
  let rows = await lookup();
  if (!rows[0]) {
    const session = await getVoiceRuntimeSessionByAttempt(attemptId);
    if (!session.transcriptConsent)
      throw new QuoteValidationError(
        "Einwilligung zur Transkriptspeicherung fehlt.",
        ["transcript_consent_required"],
        409,
      );
    const tokenHash = createHash("sha256")
      .update(randomBytes(32))
      .digest("hex");
    await supabaseRequest(
      "voice_call_sessions",
      {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          idempotency_key: "runtime-transcript:" + attemptId,
          attempt_id: attemptId,
          operator_name: "Nia · KI-Assistent",
          mode: session.allowlistOnly ? "internal_test" : session.mode,
          bound_request_id: session.allowlistOnly ? null : session.requestId,
          consent_status: "confirmed",
          transcript_storage_enabled: true,
          transcript_write_token_hash: tokenHash,
          status: "live",
          started_at: new Date().toISOString(),
          context_snapshot: {
            interaction_mode: "voice_agent",
            consent_evidence: session.transcriptConsent,
            context_request_id: session.context.requestId,
            model: session.modelId,
          },
        }),
      },
      { on_conflict: "idempotency_key" },
    );
    rows = await lookup();
  }
  const row = rows[0];
  if (!row) throw new Error("transcript_session_missing");
  const result = await supabaseRpc("persist_voice_transcript", {
    p_session_id: row.id,
    p_token_hash: row.transcript_write_token_hash,
    p_segments: segments,
    p_finish: input.finish || null,
  });
  if (input.finish && !row.ended_at)
    await supabaseRequest(
      "voice_call_sessions",
      {
        method: "PATCH",
        body: JSON.stringify({
          status: input.finish === "complete" ? "completed" : "cancelled",
          ended_at: new Date().toISOString(),
        }),
      },
      { id: "eq." + row.id, ended_at: "is.null" },
    );
  return result;
}
