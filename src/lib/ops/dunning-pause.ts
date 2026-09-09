import {
  SupabaseRestError,
  supabaseRpc,
} from "@/lib/quotes/supabase-rest";

export type DunningPauseMode = "manual" | "until_date";
export type DunningPauseAction = "pause" | "resume" | "auto_resume";

type DunningPauseRpcRow = {
  applied: boolean;
  event_id: string;
  result_paused: boolean;
  result_pause_mode: DunningPauseMode | null;
  result_pause_until: string | null;
  result_pause_reason: string | null;
  result_paused_at: string | null;
  result_paused_by: string | null;
  result_pause_version: number;
  result_updated_at: string;
};

export type DunningPauseResult = {
  applied: boolean;
  eventId: string;
  paused: boolean;
  pauseMode: DunningPauseMode | null;
  pauseUntil: string | null;
  pauseReason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  pauseVersion: number;
  updatedAt: string;
};

function mappedPauseError(error: unknown) {
  const details =
    error instanceof SupabaseRestError
      ? `${error.message} ${String(error.details || "")}`
      : error instanceof Error
        ? error.message
        : String(error || "");
  for (const code of [
    "DUNNING_PAUSE_STALE",
    "DUNNING_PAUSE_STATE_CHANGED",
    "DUNNING_PAUSE_STATE_MISSING",
    "DUNNING_PAUSE_SEND_IN_PROGRESS",
    "DUNNING_PAUSE_NOT_DUE",
    "DUNNING_PAUSE_INVALID",
  ]) {
    if (details.includes(code)) return new Error(code);
  }
  if (
    /apply_dunning_pause_action|schema cache|could not find the function/i.test(
      details,
    )
  )
    return new Error("DUNNING_PAUSE_NOT_CONFIGURED");
  return new Error("DUNNING_PAUSE_WRITE_FAILED");
}

export async function applyDunningPauseAction(input: {
  orderNumber: string;
  action: DunningPauseAction;
  actor: string;
  reason: string;
  pauseMode: DunningPauseMode | null;
  pauseUntil: string | null;
  expectedPauseVersion: number;
  expectedUpdatedAt: string | null;
  shopifyOrderId: string | null;
  currentStage: number;
  lastSentAt: string | null;
  idempotencyKey: string;
}): Promise<DunningPauseResult> {
  let rows: DunningPauseRpcRow[];
  try {
    rows = await supabaseRpc<DunningPauseRpcRow[]>(
      "apply_dunning_pause_action",
      {
        p_shopify_order_number: input.orderNumber,
        p_action: input.action,
        p_actor: input.actor,
        p_reason: input.reason,
        p_pause_mode: input.pauseMode,
        p_pause_until: input.pauseUntil,
        p_expected_pause_version: input.expectedPauseVersion,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_shopify_order_id: input.shopifyOrderId,
        p_current_stage: input.currentStage,
        p_last_sent_at: input.lastSentAt,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  } catch (error) {
    throw mappedPauseError(error);
  }
  const row = rows[0];
  if (!row || !row.event_id || !Number.isSafeInteger(row.result_pause_version))
    throw new Error("DUNNING_PAUSE_WRITE_FAILED");
  return {
    applied: row.applied,
    eventId: row.event_id,
    paused: row.result_paused,
    pauseMode: row.result_pause_mode,
    pauseUntil: row.result_pause_until,
    pauseReason: row.result_pause_reason,
    pausedAt: row.result_paused_at,
    pausedBy: row.result_paused_by,
    pauseVersion: row.result_pause_version,
    updatedAt: row.result_updated_at,
  };
}
