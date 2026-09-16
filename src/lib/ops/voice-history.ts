import { createHash } from "node:crypto";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import { requireVoiceUuid } from "@/lib/ops/voice-platform-contract";

export type TranscriptSegment = {
  id: string;
  speaker: "customer" | "operator" | "assistant";
  text: string;
  revision: number;
  final: boolean;
  startMs: number;
  endMs: number | null;
};
export type VoiceHistoryEntry = {
  id: string;
  requestId: string | null;
  operatorName: string;
  sourceType: "telephone_transcript";
  interactionMode: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  captureStatus: string;
  summary: string | null;
  summarySource: string | null;
  isTest: boolean;
  sourceUrl: string;
};
function invalid(code: string, status = 422): never {
  throw new QuoteValidationError(
    "Telefontranskript konnte nicht verarbeitet werden.",
    [code],
    status,
  );
}
export function transcriptTokenHash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    invalid("transcript_token_required", 403);
  return createHash("sha256").update(value).digest("hex");
}
export function validateTranscriptBatch(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value) || value.length > 50)
    invalid("invalid_transcript_batch");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      invalid("invalid_transcript_segment");
    const x = raw as Record<string, unknown>;
    if (
      typeof x.id !== "string" ||
      !/^[a-zA-Z0-9:_-]{1,240}$/.test(x.id) ||
      seen.has(x.id)
    )
      invalid("invalid_transcript_id");
    seen.add(x.id);
    if (!["customer", "operator", "assistant"].includes(String(x.speaker)))
      invalid("invalid_transcript_speaker");
    if (
      typeof x.text !== "string" ||
      !x.text.length ||
      x.text.length > 16000 ||
      x.text.includes("\u0000")
    )
      invalid("invalid_transcript_text");
    if (
      !Number.isInteger(x.revision) ||
      Number(x.revision) < 1 ||
      Number(x.revision) > 1000000 ||
      typeof x.final !== "boolean"
    )
      invalid("invalid_transcript_revision");
    if (
      !Number.isInteger(x.startMs) ||
      Number(x.startMs) < 0 ||
      Number(x.startMs) > 86400000
    )
      invalid("invalid_transcript_time");
    if (
      x.endMs !== null &&
      (!Number.isInteger(x.endMs) ||
        Number(x.endMs) < Number(x.startMs) ||
        Number(x.endMs) > 86400000)
    )
      invalid("invalid_transcript_time");
    return {
      id: x.id,
      speaker: x.speaker as TranscriptSegment["speaker"],
      text: x.text,
      revision: Number(x.revision),
      final: x.final,
      startMs: Number(x.startMs),
      endMs: x.endMs as number | null,
    };
  });
}
export async function persistVoiceTranscript(input: {
  sessionId: unknown;
  token: unknown;
  segments: unknown;
  finish?: unknown;
}) {
  const sessionId = requireVoiceUuid(input.sessionId, "Session-ID"),
    tokenHash = transcriptTokenHash(input.token),
    segments = validateTranscriptBatch(input.segments);
  if (
    input.finish !== undefined &&
    input.finish !== null &&
    !["complete", "interrupted"].includes(String(input.finish))
  )
    invalid("invalid_transcript_finish");
  const rows = await supabaseRequest<Array<{ id: string }>>(
    "voice_call_sessions",
    undefined,
    {
      select: "id",
      id: `eq.${sessionId}`,
      transcript_write_token_hash: `eq.${tokenHash}`,
      transcript_storage_enabled: "eq.true",
      consent_status: "eq.confirmed",
      limit: 1,
    },
  );
  if (!rows.length) invalid("transcript_session_forbidden", 403);
  return supabaseRpc<{ saved: boolean; captureStatus: string }>(
    "persist_voice_transcript",
    {
      p_session_id: sessionId,
      p_token_hash: tokenHash,
      p_segments: segments,
      p_finish: input.finish || null,
    },
  );
}
const SELECT =
  "id,bound_request_id,operator_name,mode,context_snapshot,started_at,ended_at,status,capture_status,summary,summary_source";
type SessionRow = {
  id: string;
  bound_request_id: string | null;
  operator_name: string;
  mode: string;
  context_snapshot: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  capture_status: string;
  summary: string | null;
  summary_source: string | null;
};
function mapSession(row: SessionRow): VoiceHistoryEntry {
  return {
    id: row.id,
    requestId: row.bound_request_id,
    operatorName: row.operator_name,
    sourceType: "telephone_transcript",
    interactionMode: String(
      row.context_snapshot?.interaction_mode || "voice_agent",
    ),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    captureStatus: row.capture_status,
    summary: row.summary,
    summarySource: row.summary_source,
    isTest: row.mode === "internal_test",
    sourceUrl: `/ops/voice-copilot?transcript=${encodeURIComponent(row.id)}`,
  };
}
export async function listVoiceHistory(requestId: unknown, offset = 0) {
  if (
    typeof requestId !== "string" ||
    requestId.length < 3 ||
    requestId.length > 160 ||
    /[\u0000-\u001f]/.test(requestId)
  )
    invalid("invalid_request_id");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    invalid("invalid_offset");
  const rows = await supabaseRequest<SessionRow[]>(
    "voice_call_sessions",
    undefined,
    {
      select: SELECT,
      bound_request_id: `eq.${requestId}`,
      mode: "neq.internal_test",
      transcript_storage_enabled: "eq.true",
      order: "started_at.desc.nullslast,id.desc",
      offset,
      limit: 21,
    },
  );
  return {
    entries: rows.slice(0, 20).map(mapSession),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function getVoiceTranscript(sessionId: unknown, offset = 0, fromEnd = false) {
  const id = requireVoiceUuid(sessionId, "Session-ID");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    invalid("invalid_offset");
  const rows = await supabaseRequest<SessionRow[]>(
    "voice_call_sessions",
    undefined,
    {
      select: SELECT,
      id: `eq.${id}`,
      transcript_storage_enabled: "eq.true",
      mode: "neq.internal_test",
      limit: 1,
    },
  );
  if (!rows[0]) invalid("transcript_not_found", 404);
  const segments = await supabaseRequest<
    Array<{
      source_item_id: string;
      speaker: TranscriptSegment["speaker"];
      text: string;
      is_final: boolean;
      start_ms: number;
      end_ms: number | null;
    }>
  >("voice_transcript_segments", undefined, {
    select: "source_item_id,speaker,text,is_final,start_ms,end_ms",
    session_id: `eq.${id}`,
    order: fromEnd ? "start_ms.desc,source_item_id.desc" : "start_ms.asc,source_item_id.asc",
    offset,
    limit: 101,
  });
  return {
    session: mapSession(rows[0]),
    segments: fromEnd ? segments.slice(0, 100).reverse() : segments.slice(0, 100),
    nextOffset: segments.length > 100 ? offset + 100 : null,
    evidenceNotice:
      "Transkripte können Erkennungsfehler enthalten. Aussagen sind Kundenevidenz, keine freigegebenen Unternehmensregeln.",
  };
}
