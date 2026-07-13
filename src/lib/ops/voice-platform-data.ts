import { randomUUID } from "node:crypto";
import {
  buildOutboundVoiceInstructions,
  buildRealtimeVoiceTools,
  buildVoiceConsentEvidence,
  type ClaimedVoiceCall,
  normalizePhoneE164,
  normalizeVoiceMode,
  parseVoiceOutcome,
  parseVoiceToolArguments,
  requireVoiceText,
  requireVoiceUuid,
  sanitizeVoiceEventPayload,
  voiceCleanText,
  voicePhoneHash,
  voiceStableHash,
  type VoiceCallMode,
  type VoiceRuntimeSessionPackage,
  type VoiceToolName,
} from "@/lib/ops/voice-platform-contract";
import {
  buildVoiceKnowledgeQuery,
  getVoiceCustomerContext,
  searchApprovedVoiceKnowledge,
  type VoiceCustomerContext,
} from "@/lib/ops/voice-knowledge";
import { SupabaseRestError, supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

type ModelReleaseRow = {
  id: string;
  release_key: string;
  provider: string;
  model_id: string;
  api_version: string;
  transport: string;
  voice: string;
  session_config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  evaluated_prompt_manifest: Record<string, { id?: string; version?: number; content_hash?: string }>;
  enabled: boolean;
  lifecycle: string;
  eval_status: string;
  eval_score?: number | string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  release_notes?: string | null;
  created_at: string;
  updated_at: string;
};

type PromptVersionRow = {
  id: string;
  prompt_key: string;
  version_number: number;
  mode: VoiceCallMode;
  instructions_template: string;
  content_hash: string;
  status: string;
  authored_by: string;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
};

type RuntimeSettingsRow = {
  global_enabled: boolean;
  internal_test_calls_enabled: boolean;
  customer_calls_enabled: boolean;
  max_concurrent_calls: number;
  default_timezone: string;
  updated_by: string;
  updated_at: string;
};

type CampaignRow = {
  id: string;
  name: string;
  mode: VoiceCallMode;
  status: string;
  model_channel: "candidate" | "production";
  prompt_version_id: string;
  allowlist_only: boolean;
  timezone: string;
  contact_window_start: string;
  contact_window_end: string;
  allowed_weekdays: number[];
  max_attempts: number;
  retry_delay_minutes: number;
  created_by: string;
  activated_by?: string | null;
  activated_at?: string | null;
  created_at: string;
  updated_at: string;
};

type TargetRow = {
  id: string;
  campaign_id: string;
  request_id: string;
  offer_id?: string | null;
  consent_id: string;
  phone_e164: string;
  phone_hash: string;
  contact_name?: string | null;
  company_name?: string | null;
  status: string;
  attempt_count: number;
  next_attempt_at: string;
  blocked_reason?: string | null;
  claimed_by?: string | null;
  created_at: string;
  updated_at: string;
};

type AttemptRow = {
  id: string;
  target_id: string;
  attempt_number: number;
  model_release_id: string;
  prompt_version_id: string;
  provider: string;
  provider_call_id?: string | null;
  openai_call_id?: string | null;
  status: string;
  context_snapshot: Record<string, unknown>;
  model_snapshot: Record<string, unknown>;
  prompt_snapshot: Record<string, unknown>;
  reserved_at: string;
  dialing_at?: string | null;
  connected_at?: string | null;
  ended_at?: string | null;
  failure_code?: string | null;
  created_at: string;
  updated_at: string;
};

type ActionRow = {
  id: string;
  attempt_id: string;
  tool_call_id: string;
  tool_name: VoiceToolName;
  result: Record<string, unknown>;
  status: "completed" | "rejected" | "failed";
};

const MODEL_SELECT = "id,release_key,provider,model_id,api_version,transport,voice,session_config,capabilities,evaluated_prompt_manifest,enabled,lifecycle,eval_status,eval_score,approved_by,approved_at,release_notes,created_at,updated_at";
const PROMPT_SELECT = "id,prompt_key,version_number,mode,instructions_template,content_hash,status,authored_by,approved_by,approved_at,created_at,updated_at";
const CAMPAIGN_SELECT = "id,name,mode,status,model_channel,prompt_version_id,allowlist_only,timezone,contact_window_start,contact_window_end,allowed_weekdays,max_attempts,retry_delay_minutes,created_by,activated_by,activated_at,created_at,updated_at";
const TARGET_SELECT = "id,campaign_id,request_id,offer_id,consent_id,phone_e164,phone_hash,contact_name,company_name,status,attempt_count,next_attempt_at,blocked_reason,claimed_by,created_at,updated_at";
const ATTEMPT_SELECT = "id,target_id,attempt_number,model_release_id,prompt_version_id,provider,provider_call_id,openai_call_id,status,context_snapshot,model_snapshot,prompt_snapshot,reserved_at,dialing_at,connected_at,ended_at,failure_code,created_at,updated_at";

export function isVoiceCallPlatformEnabled() {
  return String(process.env.VOICE_CALL_PLATFORM_ENABLED || "").trim().toLowerCase() === "true";
}

export function assertActiveVoiceInquiry(context: VoiceCustomerContext, mode: VoiceCallMode) {
  const requestStatus = voiceCleanText(context.request.status, 80).toLowerCase();
  const terminalRequestStatuses = new Set(["cancelled", "canceled", "closed", "completed", "deleted", "archived", "lost", "won"]);
  if (!requestStatus || terminalRequestStatuses.has(requestStatus)) {
    throw new QuoteValidationError("Die gebundene Anfrage ist nicht aktiv.", ["inactive_request"], 409);
  }
  const offerStatus = voiceCleanText(context.offer?.status, 80).toLowerCase();
  if (mode === "follow_up" && ["accepted", "declined", "expired", "void"].includes(offerStatus)) {
    throw new QuoteValidationError("Das gebundene Angebot ist bereits abgeschlossen.", ["inactive_offer"], 409);
  }
}

function mapClaimedCall(row: Record<string, unknown>): ClaimedVoiceCall {
  return {
    attemptId: String(row.attempt_id),
    targetId: String(row.target_id),
    campaignId: String(row.campaign_id),
    requestId: String(row.request_id),
    offerId: row.offer_id ? String(row.offer_id) : null,
    phoneE164: String(row.phone_e164),
    contactName: row.contact_name ? String(row.contact_name) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    mode: normalizeVoiceMode(row.mode),
    modelReleaseId: String(row.model_release_id),
    modelId: String(row.model_id),
    voice: String(row.voice),
    sessionConfig: row.session_config as Record<string, unknown> || {},
    capabilities: row.capabilities as Record<string, unknown> || {},
    promptVersionId: String(row.prompt_version_id),
    instructionsTemplate: String(row.instructions_template),
    attemptNumber: Number(row.attempt_number),
    allowlistOnly: row.allowlist_only === true,
  };
}

export async function prepareVoiceRuntimeSession(call: ClaimedVoiceCall): Promise<VoiceRuntimeSessionPackage> {
  const context = await getVoiceCustomerContext(call.requestId);
  assertActiveVoiceInquiry(context, call.mode);
  const knowledgeMatches = await searchApprovedVoiceKnowledge(buildVoiceKnowledgeQuery(context, call.mode), call.mode, 6);
  return {
    ...call,
    safetyIdentifier: voiceStableHash({ requestId: call.requestId }),
    context,
    knowledgeMatches,
    instructions: buildOutboundVoiceInstructions({
      mode: call.mode,
      instructionsTemplate: call.instructionsTemplate,
      context,
      knowledgeMatches,
    }),
    tools: buildRealtimeVoiceTools(),
  };
}

export async function claimNextVoiceRuntimeSession(workerIdInput: unknown) {
  if (!isVoiceCallPlatformEnabled()) {
    throw new QuoteValidationError("Voice Call Platform ist deaktiviert.", ["voice_platform_disabled"], 503);
  }
  const workerId = requireVoiceText(workerIdInput, "Worker-ID", 120, 3);
  const rows = await supabaseRpc<Array<Record<string, unknown>>>("claim_next_voice_call", {
    p_worker_id: workerId,
    p_lease_seconds: 180,
  });
  if (!rows[0]) return null;
  const claimed = mapClaimedCall(rows[0]);
  try {
    return await prepareVoiceRuntimeSession(claimed);
  } catch (error) {
    const ineligible = error instanceof QuoteValidationError && error.issues.some((issue) => ["inactive_request", "inactive_offer"].includes(issue));
    await finalizeVoiceCall(claimed.attemptId, {
      terminalStatus: ineligible ? "cancelled" : "failed",
      outcomeCode: "technical_failure",
      summaryForHuman: ineligible
        ? "Der Anruf wurde blockiert, weil Anfrage oder Angebot nicht mehr aktiv ist."
        : "Der gebundene Kundenkontext konnte vor dem Anruf nicht sicher geladen werden.",
      customerIntent: null,
      productInterest: null,
      objections: [],
      callbackAt: null,
      humanHandoffRequested: false,
      humanHandoffCompleted: false,
      customerRequestedStop: false,
      unsafeOrUnsupportedRequest: false,
      failureCode: ineligible ? "ineligible_customer_context" : "context_preparation_failed",
      failureDetail: error instanceof Error ? error.message : "unknown context error",
    });
    throw error;
  }
}

async function loadAttempt(attemptIdInput: unknown) {
  const attemptId = requireVoiceUuid(attemptIdInput, "Attempt-ID");
  const attempts = await supabaseRequest<AttemptRow[]>("voice_call_attempts", undefined, {
    select: ATTEMPT_SELECT,
    id: `eq.${attemptId}`,
    limit: 1,
  });
  const attempt = attempts[0];
  if (!attempt) throw new QuoteValidationError("Voice Attempt wurde nicht gefunden.", ["attempt_not_found"], 404);
  return attempt;
}

export async function getVoiceRuntimeSessionByAttempt(attemptIdInput: unknown) {
  const attempt = await loadAttempt(attemptIdInput);
  if (!["reserved", "dialing", "ringing", "live"].includes(attempt.status)) {
    throw new QuoteValidationError("Voice Attempt ist nicht aktiv.", ["attempt_not_active"], 409);
  }
  const [targets, models, prompts] = await Promise.all([
    supabaseRequest<TargetRow[]>("voice_call_targets", undefined, { select: TARGET_SELECT, id: `eq.${attempt.target_id}`, limit: 1 }),
    supabaseRequest<ModelReleaseRow[]>("voice_model_releases", undefined, { select: MODEL_SELECT, id: `eq.${attempt.model_release_id}`, limit: 1 }),
    supabaseRequest<PromptVersionRow[]>("voice_prompt_versions", undefined, { select: PROMPT_SELECT, id: `eq.${attempt.prompt_version_id}`, limit: 1 }),
  ]);
  const target = targets[0];
  if (!target) throw new QuoteValidationError("Voice Target wurde nicht gefunden.", ["target_not_found"], 404);
  const campaign = (await supabaseRequest<CampaignRow[]>("voice_call_campaigns", undefined, {
    select: CAMPAIGN_SELECT,
    id: `eq.${target.campaign_id}`,
    limit: 1,
  }))[0];
  const model = models[0];
  const prompt = prompts[0];
  if (!campaign || !model || !prompt) throw new QuoteValidationError("Voice Session-Konfiguration ist unvollstaendig.", ["session_configuration_missing"], 409);
  return prepareVoiceRuntimeSession({
    attemptId: attempt.id,
    targetId: target.id,
    campaignId: campaign.id,
    requestId: target.request_id,
    offerId: target.offer_id || null,
    phoneE164: target.phone_e164,
    contactName: target.contact_name || null,
    companyName: target.company_name || null,
    mode: campaign.mode,
    modelReleaseId: model.id,
    modelId: model.model_id,
    voice: model.voice,
    sessionConfig: model.session_config || {},
    capabilities: model.capabilities || {},
    promptVersionId: prompt.id,
    instructionsTemplate: prompt.instructions_template,
    attemptNumber: attempt.attempt_number,
    allowlistOnly: campaign.allowlist_only,
  });
}

export async function listRecoverableVoiceRuntimeSessions(workerIdInput: unknown) {
  if (!isVoiceCallPlatformEnabled()) return [];
  const workerId = requireVoiceText(workerIdInput, "Worker-ID", 120, 3);
  if (!/^[A-Za-z0-9._:-]+$/.test(workerId)) {
    throw new QuoteValidationError("Worker-ID ist ungueltig.", ["invalid_worker_id"], 422);
  }
  const targets = await supabaseRequest<TargetRow[]>("voice_call_targets", undefined, {
    select: TARGET_SELECT,
    claimed_by: `eq.${workerId}`,
    status: "in.(dialing,live)",
    limit: 100,
  });
  if (!targets.length) return [];
  const targetIds = targets.map((entry) => entry.id);
  const attempts = await supabaseRequest<AttemptRow[]>("voice_call_attempts", undefined, {
    select: ATTEMPT_SELECT,
    target_id: `in.(${targetIds.join(",")})`,
    status: "in.(dialing,ringing,live)",
    openai_call_id: "not.is.null",
    limit: 100,
  });
  if (!attempts.length) return [];
  const attemptIds = attempts.map((entry) => entry.id);
  const recoveryEvents = await supabaseRequest<Array<{ attempt_id: string; event_type: string }>>("voice_call_events", undefined, {
    select: "attempt_id,event_type",
    attempt_id: `in.(${attemptIds.join(",")})`,
    event_type: "in.(disclosure.confirmed,twilio.completed)",
    limit: 200,
  });
  const disclosed = new Set(recoveryEvents.filter((entry) => entry.event_type === "disclosure.confirmed").map((entry) => entry.attempt_id));
  const providerCompleted = new Set(recoveryEvents.filter((entry) => entry.event_type === "twilio.completed").map((entry) => entry.attempt_id));
  return Promise.all(attempts.map(async (attempt) => ({
    ...(await getVoiceRuntimeSessionByAttempt(attempt.id)),
    openAiCallId: String(attempt.openai_call_id),
    disclosureConfirmed: disclosed.has(attempt.id),
    providerCompleted: providerCompleted.has(attempt.id),
  })));
}

export async function updateVoiceAttemptProvider(input: {
  attemptId: unknown;
  providerCallId?: unknown;
  openAiCallId?: unknown;
  status?: unknown;
}) {
  const attemptId = requireVoiceUuid(input.attemptId, "Attempt-ID");
  const status = voiceCleanText(input.status, 30);
  if (status && !["dialing", "ringing", "live"].includes(status)) {
    throw new QuoteValidationError("Voice Attempt Status ist ungueltig.", ["invalid_attempt_status"], 422);
  }
  const current = await loadAttempt(attemptId);
  const stateRank: Record<string, number> = { reserved: 0, dialing: 1, ringing: 2, live: 3 };
  if (status && (stateRank[current.status] === undefined || stateRank[status] < stateRank[current.status])) {
    throw new QuoteValidationError("Voice Attempt Status darf nicht zurueckgesetzt werden.", ["invalid_status_transition"], 409);
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const providerCallId = voiceCleanText(input.providerCallId, 200);
  const openAiCallId = voiceCleanText(input.openAiCallId, 200);
  if (providerCallId) patch.provider_call_id = providerCallId;
  if (openAiCallId) patch.openai_call_id = openAiCallId;
  if (status) {
    patch.status = status;
    if (status === "dialing") patch.dialing_at = new Date().toISOString();
    if (status === "live") patch.connected_at = new Date().toISOString();
  }
  const rows = await supabaseRequest<AttemptRow[]>("voice_call_attempts", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  }, {
    id: `eq.${attemptId}`,
    status: "not.in.(completed,failed,cancelled,handed_off)",
  });
  if (!rows[0]) throw new QuoteValidationError("Voice Attempt ist bereits beendet oder nicht vorhanden.", ["attempt_not_active"], 409);
  if (status) {
    await supabaseRequest("voice_call_targets", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: status === "live" ? "live" : "dialing", updated_at: new Date().toISOString() }),
    }, { id: `eq.${rows[0].target_id}` });
  }
  return rows[0];
}

export async function recordVoiceCallEvent(input: {
  attemptId: unknown;
  source: unknown;
  eventType: unknown;
  idempotencyKey: unknown;
  providerEventId?: unknown;
  payload?: unknown;
  occurredAt?: unknown;
}) {
  const attemptId = requireVoiceUuid(input.attemptId, "Attempt-ID");
  const source = requireVoiceText(input.source, "Eventquelle", 30, 2);
  if (!["runtime", "openai", "telephony", "n8n", "ops"].includes(source)) {
    throw new QuoteValidationError("Eventquelle ist ungueltig.", ["invalid_event_source"], 422);
  }
  const eventType = requireVoiceText(input.eventType, "Eventtyp", 120, 2);
  const idempotencyKey = requireVoiceText(input.idempotencyKey, "Idempotency-Key", 240, 8);
  const providerEventId = voiceCleanText(input.providerEventId, 200) || null;
  const occurredAt = voiceCleanText(input.occurredAt, 80) || new Date().toISOString();
  if (Number.isNaN(new Date(occurredAt).getTime())) throw new QuoteValidationError("Eventzeitpunkt ist ungueltig.", ["invalid_event_time"], 422);
  return supabaseRpc<Array<{ event_id: string; duplicate: boolean }>>("record_voice_call_event", {
    p_attempt_id: attemptId,
    p_source: source,
    p_event_type: eventType,
    p_idempotency_key: idempotencyKey,
    p_provider_event_id: providerEventId,
    p_payload: sanitizeVoiceEventPayload(input.payload),
    p_occurred_at: occurredAt,
  });
}

export async function finalizeVoiceCall(attemptIdInput: unknown, rawOutcome: unknown) {
  const attemptId = requireVoiceUuid(attemptIdInput, "Attempt-ID");
  const outcome = parseVoiceOutcome(rawOutcome);
  const rows = await supabaseRpc<Array<{ attempt_id: string; target_status: string; duplicate: boolean }>>("finalize_voice_call_attempt", {
    p_attempt_id: attemptId,
    p_terminal_status: outcome.terminalStatus,
    p_outcome_code: outcome.outcomeCode,
    p_summary_for_human: outcome.summaryForHuman,
    p_customer_intent: outcome.customerIntent,
    p_product_interest: outcome.productInterest,
    p_objections: outcome.objections,
    p_callback_at: outcome.callbackAt,
    p_handoff_requested: outcome.humanHandoffRequested,
    p_handoff_completed: outcome.humanHandoffCompleted,
    p_customer_requested_stop: outcome.customerRequestedStop,
    p_unsafe_or_unsupported_request: outcome.unsafeOrUnsupportedRequest,
    p_failure_code: outcome.failureCode,
    p_failure_detail: outcome.failureDetail,
  });
  return rows[0];
}

async function loadExistingAction(attemptId: string, toolCallId: string) {
  const rows = await supabaseRequest<ActionRow[]>("voice_call_actions", undefined, {
    select: "id,attempt_id,tool_call_id,tool_name,result,status",
    attempt_id: `eq.${attemptId}`,
    tool_call_id: `eq.${toolCallId}`,
    limit: 1,
  });
  return rows[0] || null;
}

async function storeVoiceAction(input: {
  attemptId: string;
  toolCallId: string;
  toolName: VoiceToolName;
  argumentsValue: Record<string, unknown>;
  resultAudit: Record<string, unknown>;
  status?: ActionRow["status"];
}) {
  const idempotencyKey = `voice-tool:${input.attemptId}:${input.toolCallId}`;
  const rows = await supabaseRequest<ActionRow[]>("voice_call_actions", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      attempt_id: input.attemptId,
      tool_call_id: input.toolCallId,
      tool_name: input.toolName,
      idempotency_key: idempotencyKey,
      arguments: input.argumentsValue,
      result: input.resultAudit,
      status: input.status || "completed",
    }),
  });
  return rows[0] || loadExistingAction(input.attemptId, input.toolCallId);
}

export async function executeVoiceTool(input: {
  attemptId: unknown;
  toolCallId: unknown;
  toolName: unknown;
  argumentsValue: unknown;
}) {
  const attemptId = requireVoiceUuid(input.attemptId, "Attempt-ID");
  const toolCallId = requireVoiceText(input.toolCallId, "Tool-Call-ID", 200, 3);
  const toolName = voiceCleanText(input.toolName, 80) as VoiceToolName;
  const allowedTools = new Set<VoiceToolName>(buildRealtimeVoiceTools().map((tool) => tool.name));
  if (!allowedTools.has(toolName)) throw new QuoteValidationError("Voice Tool ist nicht erlaubt.", ["tool_not_allowed"], 403);
  const args = parseVoiceToolArguments(input.argumentsValue);
  const existing = await loadExistingAction(attemptId, toolCallId);
  const sideEffectTools = new Set<VoiceToolName>(["schedule_callback", "record_qualification", "request_human_handoff"]);
  if (existing && sideEffectTools.has(toolName)) return { duplicate: true, result: existing.result };

  const attempt = await loadAttempt(attemptId);
  const targets = await supabaseRequest<TargetRow[]>("voice_call_targets", undefined, {
    select: TARGET_SELECT,
    id: `eq.${attempt.target_id}`,
    limit: 1,
  });
  const target = targets[0];
  if (!target) throw new QuoteValidationError("Voice Target wurde nicht gefunden.", ["target_not_found"], 404);
  const context = await getVoiceCustomerContext(target.request_id);

  let result: Record<string, unknown>;
  let resultAudit: Record<string, unknown>;
  if (toolName === "get_customer_context") {
    result = { requestId: context.requestId, customer: context.customer, request: context.request };
    resultAudit = { ok: true, request_id: context.requestId, source: "bound_customer_context" };
  } else if (toolName === "get_offer_summary") {
    result = { requestId: context.requestId, offer: context.offer };
    resultAudit = { ok: true, request_id: context.requestId, offer_id: context.offer?.offerId || null };
  } else if (toolName === "get_outlook_context") {
    result = { requestId: context.requestId, messages: context.outlook };
    resultAudit = { ok: true, request_id: context.requestId, message_count: context.outlook.length };
  } else if (toolName === "search_approved_knowledge") {
    const query = requireVoiceText(args.query, "Suchbegriff", 240, 2);
    const campaigns = await supabaseRequest<CampaignRow[]>("voice_call_campaigns", undefined, {
      select: CAMPAIGN_SELECT,
      id: `eq.${target.campaign_id}`,
      limit: 1,
    });
    const mode = campaigns[0]?.mode;
    if (!mode) throw new QuoteValidationError("Voice Kampagne wurde nicht gefunden.", ["campaign_not_found"], 404);
    const matches = await searchApprovedVoiceKnowledge(query, mode, 6);
    result = { matches };
    resultAudit = { ok: true, query_hash: voiceStableHash(query), match_count: matches.length };
  } else if (toolName === "schedule_callback") {
    const callbackAt = requireVoiceText(args.callback_at, "Rueckrufzeitpunkt", 80, 10);
    const parsed = new Date(callbackAt);
    if (Number.isNaN(parsed.getTime())) throw new QuoteValidationError("Rueckrufzeitpunkt ist ungueltig.", ["invalid_callback_at"], 422);
    const reason = requireVoiceText(args.reason, "Rueckrufgrund", 500, 3);
    const idempotencyKey = `voice-tool:${attemptId}:${toolCallId}`;
    const rows = await supabaseRpc<Array<{ action_id: string; callback_at: string; duplicate: boolean }>>("schedule_voice_callback", {
      p_attempt_id: attemptId,
      p_tool_call_id: toolCallId,
      p_callback_at: parsed.toISOString(),
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    });
    result = { scheduled: true, callbackAt: rows[0]?.callback_at || parsed.toISOString() };
    return { duplicate: rows[0]?.duplicate === true, result };
  } else if (toolName === "record_qualification") {
    const objections = Array.isArray(args.objections)
      ? args.objections.slice(0, 10).map((entry) => voiceCleanText(entry, 300)).filter(Boolean)
      : [];
    const outcomeCode = voiceCleanText(args.outcome_code, 50);
    const allowedOutcomeCodes = new Set(["qualified_lead", "needs_human_followup", "not_interested", "callback_requested", "wrong_number", "do_not_call", "no_clear_outcome"]);
    if (!allowedOutcomeCodes.has(outcomeCode)) throw new QuoteValidationError("Qualifikations-Ergebnis ist ungueltig.", ["invalid_outcome"], 422);
    const customerRequestedStop = args.customer_requested_stop === true;
    if (customerRequestedStop !== (outcomeCode === "do_not_call")) {
      throw new QuoteValidationError("Stop-Wunsch und Ergebnis widersprechen sich.", ["stop_outcome_mismatch"], 422);
    }
    result = {
      recorded: true,
      customerIntent: voiceCleanText(args.customer_intent, 1000),
      productInterest: voiceCleanText(args.product_interest, 1000),
      objections,
      nextStep: voiceCleanText(args.next_step, 500),
      outcomeCode,
      summaryForHuman: requireVoiceText(args.summary_for_human, "Zusammenfassung", 2000, 3),
      customerRequestedStop,
      unsafeOrUnsupportedRequest: args.unsafe_or_unsupported_request === true,
    };
    resultAudit = result;
  } else {
    const reason = requireVoiceText(args.reason, "Uebergabegrund", 500, 3);
    result = { approved: true, reason, transferTargetConfigured: Boolean(process.env.VOICE_HUMAN_HANDOFF_URI) };
    resultAudit = { approved: true, reason, transfer_target_configured: Boolean(process.env.VOICE_HUMAN_HANDOFF_URI) };
  }

  await storeVoiceAction({ attemptId, toolCallId, toolName, argumentsValue: args, resultAudit });
  return { duplicate: false, result };
}

export async function listVoicePlatformDashboard() {
  if (!isVoiceCallPlatformEnabled()) return { enabled: false, storageReady: false };
  try {
    const [settings, models, evaluations, prompts, campaigns, targets, attempts, outcomes, allowlist, consents] = await Promise.all([
      supabaseRequest<RuntimeSettingsRow[]>("voice_runtime_settings", undefined, { select: "*", singleton: "eq.true", limit: 1 }),
      supabaseRequest<ModelReleaseRow[]>("voice_model_releases", undefined, { select: MODEL_SELECT, order: "created_at.desc", limit: 50 }),
      supabaseRequest<Array<Record<string, unknown>>>("voice_model_evaluations", undefined, { select: "*", order: "evaluated_at.desc", limit: 50 }),
      supabaseRequest<PromptVersionRow[]>("voice_prompt_versions", undefined, { select: PROMPT_SELECT, order: "created_at.desc", limit: 50 }),
      supabaseRequest<CampaignRow[]>("voice_call_campaigns", undefined, { select: CAMPAIGN_SELECT, order: "created_at.desc", limit: 50 }),
      supabaseRequest<TargetRow[]>("voice_call_targets", undefined, { select: TARGET_SELECT, order: "created_at.desc", limit: 100 }),
      supabaseRequest<AttemptRow[]>("voice_call_attempts", undefined, { select: ATTEMPT_SELECT, order: "created_at.desc", limit: 100 }),
      supabaseRequest<Array<Record<string, unknown>>>("voice_call_outcomes", undefined, { select: "*", order: "created_at.desc", limit: 100 }),
      supabaseRequest<Array<Record<string, unknown>>>("voice_test_allowlist", undefined, { select: "id,phone_e164,label,enabled,approved_by,approved_at,created_at,updated_at", order: "created_at.desc", limit: 100 }),
      supabaseRequest<Array<Record<string, unknown>>>("voice_contact_consents", undefined, { select: "id,request_id,phone_e164,purposes,status,consent_wording,form_version,source,source_ref,granted_at,withdrawn_at,valid_until,evidence_retain_until,created_at,updated_at", order: "created_at.desc", limit: 100 }),
    ]);
    return { enabled: true, storageReady: true, settings: settings[0] || null, models, evaluations, prompts, campaigns, targets, attempts, outcomes, allowlist, consents };
  } catch (error) {
    if (error instanceof SupabaseRestError && (error.status === 404 || String(error.details || "").includes("does not exist"))) {
      return { enabled: true, storageReady: false };
    }
    throw error;
  }
}

function actorName(value: unknown) {
  return requireVoiceText(value, "Akteur", 120, 2);
}

export async function createVoiceConsent(input: Record<string, unknown>) {
  const evidence = buildVoiceConsentEvidence({
    requestId: input.requestId,
    phone: input.phone,
    purposes: input.purposes,
    consentWording: input.consentWording,
    formVersion: input.formVersion,
    source: input.source,
    sourceRef: input.sourceRef,
    grantedAt: input.grantedAt,
  });
  if (!evidence.sourceRef) throw new QuoteValidationError("Einwilligungsnachweis braucht eine konkrete Quellreferenz.", ["missing_consent_source_ref"], 422);
  const rows = await supabaseRequest<Array<Record<string, unknown>>>("voice_contact_consents", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      request_id: evidence.requestId,
      phone_e164: evidence.phoneE164,
      phone_hash: evidence.phoneHash,
      purposes: evidence.purposes,
      status: "granted",
      consent_wording: evidence.consentWording,
      form_version: evidence.formVersion,
      source: evidence.source,
      source_ref: evidence.sourceRef,
      evidence_hash: evidence.evidenceHash,
      granted_at: evidence.grantedAt,
      evidence_retain_until: new Date(new Date(evidence.grantedAt).setFullYear(new Date(evidence.grantedAt).getFullYear() + 5)).toISOString(),
      idempotency_key: evidence.idempotencyKey,
    }),
  });
  return rows[0] || { duplicate: true, idempotencyKey: evidence.idempotencyKey };
}

export async function withdrawVoiceConsent(input: Record<string, unknown>) {
  const consentId = requireVoiceUuid(input.consentId, "Consent-ID");
  const rows = await supabaseRequest<Array<Record<string, unknown>>>("voice_contact_consents", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "withdrawn", withdrawn_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  }, { id: `eq.${consentId}`, status: "eq.granted" });
  if (!rows[0]) throw new QuoteValidationError("Einwilligung ist nicht aktiv oder wurde nicht gefunden.", ["consent_not_active"], 409);
  await supabaseRequest("voice_call_targets", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "blocked", blocked_reason: "consent_withdrawn", claimed_by: null, claimed_until: null, updated_at: new Date().toISOString() }),
  }, { consent_id: `eq.${consentId}`, status: "in.(queued,retry,claimed,dialing)" });
  return rows[0];
}

export async function addVoiceAllowlist(input: Record<string, unknown>) {
  const phoneE164 = normalizePhoneE164(input.phone);
  const label = requireVoiceText(input.label, "Bezeichnung", 120, 2);
  const approvedBy = actorName(input.actor);
  const rows = await supabaseRequest<Array<Record<string, unknown>>>("voice_test_allowlist", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ phone_e164: phoneE164, phone_hash: voicePhoneHash(phoneE164), label, enabled: true, approved_by: approvedBy, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  }, { on_conflict: "phone_hash" });
  return rows[0];
}

export async function createVoiceCampaign(input: Record<string, unknown>) {
  const mode = normalizeVoiceMode(input.mode);
  const promptVersionId = requireVoiceUuid(input.promptVersionId, "Prompt-Version-ID");
  const name = requireVoiceText(input.name, "Kampagnenname", 160, 3);
  const actor = actorName(input.actor);
  const modelChannel = voiceCleanText(input.modelChannel, 30) || "production";
  if (!new Set(["candidate", "production"]).has(modelChannel)) throw new QuoteValidationError("Modellkanal ist ungueltig.", ["invalid_model_channel"], 422);
  const rows = await supabaseRequest<CampaignRow[]>("voice_call_campaigns", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name,
      mode,
      status: "draft",
      model_channel: modelChannel,
      prompt_version_id: promptVersionId,
      allowlist_only: input.allowlistOnly !== false,
      timezone: voiceCleanText(input.timezone, 80) || "Europe/Berlin",
      contact_window_start: voiceCleanText(input.contactWindowStart, 8) || "09:00",
      contact_window_end: voiceCleanText(input.contactWindowEnd, 8) || "17:00",
      allowed_weekdays: Array.isArray(input.allowedWeekdays) ? input.allowedWeekdays : [1, 2, 3, 4, 5],
      max_attempts: Math.max(1, Math.min(Number(input.maxAttempts) || 3, 10)),
      retry_delay_minutes: Math.max(5, Math.min(Number(input.retryDelayMinutes) || 1440, 43200)),
      created_by: actor,
    }),
  });
  return rows[0];
}

export async function addVoiceTarget(input: Record<string, unknown>) {
  const campaignId = requireVoiceUuid(input.campaignId, "Kampagnen-ID");
  const consentId = requireVoiceUuid(input.consentId, "Consent-ID");
  const requestId = requireVoiceText(input.requestId, "Request-ID", 160, 3);
  const phoneE164 = normalizePhoneE164(input.phone);
  const [campaigns, consents] = await Promise.all([
    supabaseRequest<CampaignRow[]>("voice_call_campaigns", undefined, { select: CAMPAIGN_SELECT, id: `eq.${campaignId}`, limit: 1 }),
    supabaseRequest<Array<Record<string, unknown>>>("voice_contact_consents", undefined, { select: "id,request_id,phone_e164,purposes,status,valid_until", id: `eq.${consentId}`, limit: 1 }),
  ]);
  const campaign = campaigns[0];
  const consent = consents[0];
  const purposes = Array.isArray(consent?.purposes) ? consent.purposes.map(String) : [];
  const consentExpired = consent?.valid_until ? new Date(String(consent.valid_until)).getTime() <= Date.now() : false;
  if (!campaign || !consent || consent.status !== "granted" || consentExpired
      || String(consent.request_id || "") !== requestId || String(consent.phone_e164 || "") !== phoneE164
      || !purposes.includes(campaign.mode)) {
    throw new QuoteValidationError("Call-Ziel passt nicht exakt zur aktiven Einwilligung und Kampagne.", ["target_consent_mismatch"], 409);
  }
  assertActiveVoiceInquiry(await getVoiceCustomerContext(requestId), campaign.mode);
  const idempotencyKey = `voice-target:${campaignId}:${voiceStableHash({ requestId, phoneE164 })}`;
  const rows = await supabaseRequest<TargetRow[]>("voice_call_targets", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      campaign_id: campaignId,
      request_id: requestId,
      offer_id: voiceCleanText(input.offerId, 160) || null,
      consent_id: consentId,
      phone_e164: phoneE164,
      phone_hash: voicePhoneHash(phoneE164),
      contact_name: voiceCleanText(input.contactName, 160) || null,
      company_name: voiceCleanText(input.companyName, 160) || null,
      status: "queued",
      next_attempt_at: voiceCleanText(input.nextAttemptAt, 80) || new Date().toISOString(),
      idempotency_key: idempotencyKey,
    }),
  });
  return rows[0] || { duplicate: true, idempotencyKey };
}

export async function updateVoiceRuntimeSettings(input: Record<string, unknown>) {
  const actor = actorName(input.actor);
  if (input.customerCallsEnabled === true && voiceCleanText(input.confirmation, 80) !== "KUNDENANRUFE FREIGEBEN") {
    throw new QuoteValidationError("Kundenanrufe erfordern die exakte Freigabebestaetigung.", ["customer_calls_confirmation_required"], 422);
  }
  const rows = await supabaseRequest<RuntimeSettingsRow[]>("voice_runtime_settings", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      global_enabled: input.globalEnabled === true,
      internal_test_calls_enabled: input.internalTestCallsEnabled === true,
      customer_calls_enabled: input.customerCallsEnabled === true,
      max_concurrent_calls: Math.max(1, Math.min(Number(input.maxConcurrentCalls) || 1, 20)),
      updated_by: actor,
      updated_at: new Date().toISOString(),
    }),
  }, { singleton: "eq.true" });
  return rows[0];
}

async function controlVoiceAttempt(input: Record<string, unknown>, action: "stop" | "handoff") {
  const attemptId = requireVoiceUuid(input.attemptId, "Attempt-ID");
  const actor = actorName(input.actor);
  const baseUrl = String(process.env.VOICE_RUNTIME_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = String(process.env.VOICE_DISPATCH_TOKEN || "").trim();
  if (!baseUrl || !token) throw new QuoteValidationError("Voice Runtime Steuerung ist nicht konfiguriert.", ["runtime_control_unavailable"], 503);
  const response = await fetch(`${baseUrl}/attempts/${encodeURIComponent(attemptId)}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ actor }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new QuoteValidationError("Aktiver Anruf konnte nicht gesteuert werden.", ["runtime_control_failed"], response.status === 404 ? 404 : 502);
  await supabaseRequest("voice_platform_audit_log", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      actor, action: `attempt_${action}`, target_type: "voice_call_attempt", target_id: attemptId,
      idempotency_key: `voice-admin:${action}:${attemptId}:${randomUUID()}`, metadata: {},
    }),
  });
  return { attemptId, action };
}

async function setVoiceModelEnabled(input: Record<string, unknown>) {
  const modelReleaseId = requireVoiceUuid(input.modelReleaseId, "Modell-Release-ID");
  const actor = actorName(input.actor);
  const enabled = input.enabled === true;
  const rows = await supabaseRequest<ModelReleaseRow[]>("voice_model_releases", {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enabled, updated_at: new Date().toISOString() }),
  }, { id: `eq.${modelReleaseId}` });
  if (!rows[0]) throw new QuoteValidationError("Modell-Release wurde nicht gefunden.", ["model_not_found"], 404);
  await supabaseRequest("voice_platform_audit_log", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      actor, action: enabled ? "model_enabled" : "model_disabled", target_type: "voice_model_release",
      target_id: modelReleaseId, idempotency_key: `voice-admin:model-enabled:${modelReleaseId}:${randomUUID()}`, metadata: {},
    }),
  });
  return rows[0];
}

async function registerVoiceModelRelease(input: Record<string, unknown>) {
  const modelId = requireVoiceText(input.modelId, "Modell-ID", 160, 3);
  const apiVersion = requireVoiceText(input.apiVersion || "v1", "API-Version", 40, 1);
  const voice = requireVoiceText(input.voice || "marin", "Stimme", 80, 2);
  const transport = voiceCleanText(input.transport, 30) || "sip";
  if (!new Set(["sip", "webrtc", "websocket"]).has(transport)) throw new QuoteValidationError("Modell-Transport ist ungueltig.", ["invalid_transport"], 422);
  const actor = actorName(input.actor);
  const releaseKey = requireVoiceText(input.releaseKey || `openai-${modelId}-${transport}-${apiVersion}`, "Release-Key", 200, 3);
  const rows = await supabaseRequest<ModelReleaseRow[]>("voice_model_releases", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      release_key: releaseKey, provider: "openai", model_id: modelId, api_version: apiVersion,
      transport, voice, session_config: { turn_detection: { type: "server_vad" } },
      capabilities: { speech_to_speech: true, function_tools: true, sip: transport === "sip", sideband: true, barge_in: true },
      enabled: false, lifecycle: "available", eval_status: "pending",
      release_notes: voiceCleanText(input.releaseNotes, 1000) || `Registered by ${actor}; disabled until capability and safety evaluation.`,
    }),
  });
  if (!rows[0]) throw new QuoteValidationError("Release-Key existiert bereits.", ["model_release_exists"], 409);
  await supabaseRequest("voice_platform_audit_log", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ actor, action: "model_registered", target_type: "voice_model_release", target_id: rows[0].id, idempotency_key: `voice-admin:model-register:${rows[0].id}`, metadata: { model_id: modelId, transport, api_version: apiVersion } }),
  });
  return rows[0];
}

export async function setVoiceCampaignStatus(input: Record<string, unknown>) {
  const campaignId = requireVoiceUuid(input.campaignId, "Kampagnen-ID");
  const status = voiceCleanText(input.status, 30);
  if (!new Set(["draft", "paused", "active", "completed", "cancelled"]).has(status)) {
    throw new QuoteValidationError("Kampagnenstatus ist ungueltig.", ["invalid_campaign_status"], 422);
  }
  const actor = actorName(input.actor);
  if (status === "active") {
    const campaigns = await supabaseRequest<CampaignRow[]>("voice_call_campaigns", undefined, { select: CAMPAIGN_SELECT, id: `eq.${campaignId}`, limit: 1 });
    const campaign = campaigns[0];
    if (!campaign) throw new QuoteValidationError("Kampagne wurde nicht gefunden.", ["campaign_not_found"], 404);
    const [prompts, models] = await Promise.all([
      supabaseRequest<PromptVersionRow[]>("voice_prompt_versions", undefined, { select: PROMPT_SELECT, id: `eq.${campaign.prompt_version_id}`, status: "eq.approved", limit: 1 }),
      supabaseRequest<ModelReleaseRow[]>("voice_model_releases", undefined, { select: MODEL_SELECT, lifecycle: `eq.${campaign.model_channel}`, enabled: "eq.true", limit: 1 }),
    ]);
    if (!prompts[0]) throw new QuoteValidationError("Kampagnen-Prompt ist nicht freigegeben.", ["prompt_not_approved"], 409);
    const model = models[0];
    const sandboxReady = campaign.allowlist_only && model && ["contract_passed", "passed"].includes(model.eval_status);
    const evaluatedPromptId = model?.evaluated_prompt_manifest?.[campaign.mode]?.id;
    const customerReady = !campaign.allowlist_only && model?.eval_status === "passed" && Boolean(model.approved_at)
      && evaluatedPromptId === campaign.prompt_version_id;
    if (!sandboxReady && !customerReady) throw new QuoteValidationError("Modellkanal ist fuer diese Kampagne nicht freigegeben.", ["model_not_approved"], 409);
  }
  const rows = await supabaseRequest<CampaignRow[]>("voice_call_campaigns", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status,
      ...(status === "active" ? { activated_by: actor, activated_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }),
  }, { id: `eq.${campaignId}` });
  if (!rows[0]) throw new QuoteValidationError("Kampagne wurde nicht gefunden.", ["campaign_not_found"], 404);
  return rows[0];
}

export async function runVoicePlatformAdminAction(actionInput: unknown, input: Record<string, unknown>) {
  const action = requireVoiceText(actionInput, "Aktion", 80, 2);
  if (action === "create_consent") return createVoiceConsent(input);
  if (action === "withdraw_consent") return withdrawVoiceConsent(input);
  if (action === "add_allowlist") return addVoiceAllowlist(input);
  if (action === "create_campaign") return createVoiceCampaign(input);
  if (action === "add_target") return addVoiceTarget(input);
  if (action === "set_runtime_settings") return updateVoiceRuntimeSettings(input);
  if (action === "set_campaign_status") return setVoiceCampaignStatus(input);
  if (action === "stop_attempt") return controlVoiceAttempt(input, "stop");
  if (action === "handoff_attempt") return controlVoiceAttempt(input, "handoff");
  if (action === "set_model_enabled") return setVoiceModelEnabled(input);
  if (action === "register_model") return registerVoiceModelRelease(input);
  const actor = actorName(input.actor);
  const idempotencyKey = voiceCleanText(input.idempotencyKey, 240) || `voice-admin:${action}:${randomUUID()}`;
  if (action === "approve_prompt") {
    return supabaseRpc("approve_voice_prompt_version", { p_prompt_version_id: requireVoiceUuid(input.promptVersionId, "Prompt-Version-ID"), p_actor: actor, p_idempotency_key: idempotencyKey });
  }
  if (action === "select_candidate") {
    return supabaseRpc("select_voice_model_candidate", { p_release_id: requireVoiceUuid(input.modelReleaseId, "Modell-Release-ID"), p_actor: actor, p_idempotency_key: idempotencyKey });
  }
  if (action === "approve_model_sandbox") {
    if (voiceCleanText(input.confirmation, 80) !== "SANDBOX-MODELL FREIGEBEN") {
      throw new QuoteValidationError("Sandbox-Modellfreigabe erfordert die exakte Bestaetigung.", ["sandbox_model_confirmation_required"], 422);
    }
    return supabaseRpc("approve_voice_model_sandbox", {
      p_release_id: requireVoiceUuid(input.modelReleaseId, "Modell-Release-ID"),
      p_actor: actor,
      p_idempotency_key: idempotencyKey,
    });
  }
  if (action === "promote_model") {
    return supabaseRpc("promote_voice_model_release", { p_release_id: requireVoiceUuid(input.modelReleaseId, "Modell-Release-ID"), p_approved_by: actor, p_idempotency_key: idempotencyKey });
  }
  if (action === "rollback_model") {
    return supabaseRpc("rollback_voice_model_release", { p_actor: actor, p_idempotency_key: idempotencyKey });
  }
  if (action === "record_evaluation") {
    const scenarioCount = Number(input.scenarioCount);
    const passedCount = Number(input.passedCount);
    const safetyFailureCount = Number(input.safetyFailureCount || 0);
    const averageScore = Number(input.averageScore);
    if (!Number.isInteger(scenarioCount) || scenarioCount < 1 || !Number.isInteger(passedCount) || passedCount < 0 || passedCount > scenarioCount) {
      throw new QuoteValidationError("Eval-Zaehler sind ungueltig.", ["invalid_eval_counts"], 422);
    }
    const approvedPrompts = await supabaseRequest<PromptVersionRow[]>("voice_prompt_versions", undefined, {
      select: PROMPT_SELECT,
      status: "eq.approved",
      limit: 10,
    });
    const promptManifest = Object.fromEntries(approvedPrompts.map((prompt) => [prompt.mode, {
      id: prompt.id,
      prompt_key: prompt.prompt_key,
      version: prompt.version_number,
      content_hash: prompt.content_hash,
    }]));
    if (!promptManifest.lead_qualification || !promptManifest.follow_up) {
      throw new QuoteValidationError("Beide Voice-Prompts muessen vor dem Modell-Eval freigegeben sein.", ["incomplete_eval_prompt_manifest"], 409);
    }
    return supabaseRpc("record_voice_model_evaluation", {
      p_release_id: requireVoiceUuid(input.modelReleaseId, "Modell-Release-ID"),
      p_suite_version: requireVoiceText(input.suiteVersion, "Eval-Suite", 120, 2),
      p_idempotency_key: idempotencyKey,
      p_scenario_count: scenarioCount,
      p_passed_count: passedCount,
      p_safety_failure_count: safetyFailureCount,
      p_average_score: averageScore,
      p_status: input.status === "passed" ? "passed" : "failed",
      p_report: input.report && typeof input.report === "object" ? input.report : {},
      p_prompt_manifest: promptManifest,
      p_evaluated_by: actor,
    });
  }
  throw new QuoteValidationError("Voice Platform Aktion ist nicht erlaubt.", ["action_not_allowed"], 403);
}
