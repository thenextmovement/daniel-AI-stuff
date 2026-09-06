import {
  SupabaseRestError,
  supabaseRequest,
} from "@/lib/quotes/supabase-rest";
import {
  DUNNING_COURT_EVENT_LABELS,
  type DunningCourtEventType,
} from "@/lib/ops/dunning-status";

export { DUNNING_COURT_EVENT_LABELS } from "@/lib/ops/dunning-status";
export type { DunningCourtEventType } from "@/lib/ops/dunning-status";

type DunningCourtEventRow = {
  id: string;
  order_number: string;
  event_key: string;
  event_type: DunningCourtEventType;
  occurred_on: string;
  source_reference: string | null;
  actor: string | null;
  note: string | null;
  created_at: string;
};

export type DunningCourtEvent = {
  id: string;
  orderNumber: string;
  eventKey: string;
  eventType: DunningCourtEventType;
  eventLabel: string;
  occurredOn: string;
  sourceReference: string | null;
  actor: string | null;
  note: string | null;
  createdAt: string;
};

export type DunningCourtRepresentative = {
  function:
    | "Geschäftsführende Gesellschafterin"
    | "Geschäftsführender Gesellschafter"
    | "Geschäftsführer"
    | "Geschäftsführerin"
    | "Managing Director";
  name: string;
};

type DunningCourtProfileRow = {
  order_number: string;
  debtor_type: "company";
  legal_name: string;
  legal_form: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: "DE";
  representatives: DunningCourtRepresentative[];
  register_court: string | null;
  register_type: "HRB" | "HRA" | "GnR" | "PR" | "VR" | null;
  register_number: string | null;
  source_url: string;
  source_checked_at: string;
  communication_checked_at: string;
  verified_at: string;
  verified_by: string;
  created_at: string;
  updated_at: string;
};

export type DunningCourtProfile = {
  orderNumber: string;
  debtorType: "company";
  legalName: string;
  legalForm: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: "DE";
  representatives: DunningCourtRepresentative[];
  registerCourt: string | null;
  registerType: "HRB" | "HRA" | "GnR" | "PR" | "VR" | null;
  registerNumber: string | null;
  sourceUrl: string;
  sourceCheckedAt: string;
  communicationCheckedAt: string;
  verifiedAt: string;
  verifiedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DunningCourtDraftJobStatus =
  | "pending"
  | "processing"
  | "pdf_created"
  | "email_dispatching"
  | "email_sent"
  | "retryable_error"
  | "manual_review"
  | "cancelled";

type DunningCourtDraftJobRow = {
  id: string;
  order_number: string;
  idempotency_key: string;
  snapshot_hash: string;
  status: DunningCourtDraftJobStatus;
  case_snapshot: Record<string, unknown>;
  requested_by: string;
  pdf_filename: string | null;
  pdf_sha256: string | null;
  pdf_bytes: number | null;
  overview_sha256: string | null;
  graph_draft_id: string | null;
  internal_recipient: string | null;
  last_error_code: string | null;
  created_at: string;
  processing_at: string | null;
  email_dispatching_at: string | null;
  email_sent_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type DunningCourtDraftJob = {
  id: string;
  orderNumber: string;
  idempotencyKey: string;
  snapshotHash: string;
  status: DunningCourtDraftJobStatus;
  caseSnapshot: Record<string, unknown>;
  requestedBy: string;
  pdfFilename: string | null;
  pdfSha256: string | null;
  pdfBytes: number | null;
  overviewSha256: string | null;
  graphDraftId: string | null;
  internalRecipient: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  processingAt: string | null;
  emailDispatchingAt: string | null;
  emailSentAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export function dunningCourtEventLabel(eventType: DunningCourtEventType) {
  return DUNNING_COURT_EVENT_LABELS[eventType];
}

export function dunningCourtNextAction(
  event: DunningCourtEvent | null,
): string | null {
  if (!event) return null;
  switch (event.eventType) {
    case "application_draft_created":
      return "Mahnantrag prüfen und beim Gericht einreichen";
    case "application_submitted":
      return "Gerichtseingang, Bearbeitung und Zustellung abwarten";
    case "court_order_served":
      return "Widerspruchsfrist überwachen";
    case "objection_received":
      return "Widerspruch rechtlich prüfen";
    case "enforcement_order_requested":
      return "Entscheidung über Vollstreckungsbescheid abwarten";
    case "enforcement_order_issued":
      return "Vollstreckung bewusst prüfen";
    case "closed":
      return "Gerichtliches Mahnverfahren abgeschlossen";
  }
}

function eventFromRow(row: DunningCourtEventRow): DunningCourtEvent {
  return {
    id: row.id,
    orderNumber: row.order_number,
    eventKey: row.event_key,
    eventType: row.event_type,
    eventLabel: dunningCourtEventLabel(row.event_type),
    occurredOn: row.occurred_on,
    sourceReference: row.source_reference,
    actor: row.actor,
    note: row.note,
    createdAt: row.created_at,
  };
}

function profileFromRow(row: DunningCourtProfileRow): DunningCourtProfile {
  return {
    orderNumber: row.order_number,
    debtorType: row.debtor_type,
    legalName: row.legal_name,
    legalForm: row.legal_form,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    countryCode: row.country_code,
    representatives: Array.isArray(row.representatives)
      ? row.representatives
      : [],
    registerCourt: row.register_court,
    registerType: row.register_type,
    registerNumber: row.register_number,
    sourceUrl: row.source_url,
    sourceCheckedAt: row.source_checked_at,
    communicationCheckedAt: row.communication_checked_at,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function draftJobFromRow(row: DunningCourtDraftJobRow): DunningCourtDraftJob {
  return {
    id: row.id,
    orderNumber: row.order_number,
    idempotencyKey: row.idempotency_key,
    snapshotHash: row.snapshot_hash,
    status: row.status,
    caseSnapshot: row.case_snapshot,
    requestedBy: row.requested_by,
    pdfFilename: row.pdf_filename,
    pdfSha256: row.pdf_sha256,
    pdfBytes: row.pdf_bytes,
    overviewSha256: row.overview_sha256,
    graphDraftId: row.graph_draft_id,
    internalRecipient: row.internal_recipient,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    processingAt: row.processing_at,
    emailDispatchingAt: row.email_dispatching_at,
    emailSentAt: row.email_sent_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function missingCourtTable(error: unknown, table: string) {
  const details =
    error instanceof SupabaseRestError ? String(error.details || "") : "";
  return (
    error instanceof SupabaseRestError &&
    (error.status === 404 ||
      (details.includes(table) &&
        (details.includes("does not exist") || details.includes("schema cache"))))
  );
}

export async function loadDunningCourtEvents() {
  try {
    const rows = await supabaseRequest<DunningCourtEventRow[]>(
      "dunning_court_events",
      undefined,
      {
        select:
          "id,order_number,event_key,event_type,occurred_on,source_reference,actor,note,created_at",
        order: "occurred_on.desc,created_at.desc",
        limit: 5000,
      },
    );
    const byOrder = new Map<string, DunningCourtEvent[]>();
    for (const row of rows) {
      const event = eventFromRow(row);
      byOrder.set(row.order_number, [
        ...(byOrder.get(row.order_number) || []),
        event,
      ]);
    }
    return byOrder;
  } catch (error) {
    const details =
      error instanceof SupabaseRestError ? String(error.details || "") : "";
    if (
      error instanceof SupabaseRestError &&
      (error.status === 404 ||
        (details.includes("dunning_court_events") &&
          (details.includes("does not exist") ||
            details.includes("schema cache"))))
    )
      return new Map<string, DunningCourtEvent[]>();
    throw error;
  }
}

export async function loadDunningCourtProfile(orderNumber: string) {
  try {
    const rows = await supabaseRequest<DunningCourtProfileRow[]>(
      "dunning_court_profiles",
      undefined,
      {
        select: "*",
        order_number: `eq.${orderNumber}`,
        limit: 1,
      },
    );
    return rows[0] ? profileFromRow(rows[0]) : null;
  } catch (error) {
    if (missingCourtTable(error, "dunning_court_profiles")) return null;
    throw error;
  }
}

export async function saveDunningCourtProfile(
  profile: Omit<DunningCourtProfile, "createdAt" | "updatedAt">,
) {
  const now = new Date().toISOString();
  const rows = await supabaseRequest<DunningCourtProfileRow[]>(
    "dunning_court_profiles",
    {
      method: "POST",
      body: JSON.stringify({
        order_number: profile.orderNumber,
        debtor_type: profile.debtorType,
        legal_name: profile.legalName,
        legal_form: profile.legalForm,
        street: profile.street,
        postal_code: profile.postalCode,
        city: profile.city,
        country_code: profile.countryCode,
        representatives: profile.representatives,
        register_court: profile.registerCourt,
        register_type: profile.registerType,
        register_number: profile.registerNumber,
        source_url: profile.sourceUrl,
        source_checked_at: profile.sourceCheckedAt,
        communication_checked_at: profile.communicationCheckedAt,
        verified_at: profile.verifiedAt,
        verified_by: profile.verifiedBy,
        updated_at: now,
      }),
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
    },
    { on_conflict: "order_number" },
  );
  if (!rows[0]) throw new Error("DUNNING_COURT_PROFILE_SAVE_FAILED");
  return profileFromRow(rows[0]);
}

export async function loadLatestDunningCourtDraftJob(orderNumber: string) {
  try {
    const rows = await supabaseRequest<DunningCourtDraftJobRow[]>(
      "dunning_court_draft_jobs",
      undefined,
      {
        select: "*",
        order_number: `eq.${orderNumber}`,
        order: "created_at.desc",
        limit: 1,
      },
    );
    return rows[0] ? draftJobFromRow(rows[0]) : null;
  } catch (error) {
    if (missingCourtTable(error, "dunning_court_draft_jobs")) return null;
    throw error;
  }
}

export async function loadDunningCourtDraftJobByKey(idempotencyKey: string) {
  const rows = await supabaseRequest<DunningCourtDraftJobRow[]>(
    "dunning_court_draft_jobs",
    undefined,
    {
      select: "*",
      idempotency_key: `eq.${idempotencyKey}`,
      limit: 1,
    },
  );
  return rows[0] ? draftJobFromRow(rows[0]) : null;
}

export async function createDunningCourtDraftJob(input: {
  orderNumber: string;
  idempotencyKey: string;
  snapshotHash: string;
  caseSnapshot: Record<string, unknown>;
  requestedBy: string;
}) {
  try {
    const rows = await supabaseRequest<DunningCourtDraftJobRow[]>(
      "dunning_court_draft_jobs",
      {
        method: "POST",
        body: JSON.stringify({
          order_number: input.orderNumber,
          idempotency_key: input.idempotencyKey,
          snapshot_hash: input.snapshotHash,
          status: "pending",
          case_snapshot: input.caseSnapshot,
          requested_by: input.requestedBy,
        }),
        headers: { Prefer: "return=representation" },
      },
    );
    if (!rows[0]) throw new Error("DUNNING_COURT_JOB_CREATE_FAILED");
    return draftJobFromRow(rows[0]);
  } catch (error) {
    if (error instanceof SupabaseRestError && error.status === 409) {
      const existing = await loadDunningCourtDraftJobByKey(input.idempotencyKey);
      if (existing) return existing;
      const active = await loadLatestDunningCourtDraftJob(input.orderNumber);
      if (active) return active;
    }
    throw error;
  }
}

export async function updateDunningCourtDraftJob(
  id: string,
  patch: Partial<{
    status: DunningCourtDraftJobStatus;
    pdf_filename: string;
    pdf_sha256: string;
    pdf_bytes: number;
    overview_sha256: string;
    graph_draft_id: string;
    internal_recipient: string;
    last_error_code: string | null;
    processing_at: string;
    email_dispatching_at: string;
    email_sent_at: string;
    completed_at: string;
  }>,
  expectedStatuses?: DunningCourtDraftJobStatus[],
) {
  const rows = await supabaseRequest<DunningCourtDraftJobRow[]>(
    "dunning_court_draft_jobs",
    {
      method: "PATCH",
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=representation" },
    },
    {
      id: `eq.${id}`,
      ...(expectedStatuses?.length
        ? { status: `in.(${expectedStatuses.join(",")})` }
        : {}),
    },
  );
  if (!rows[0])
    throw new Error(
      expectedStatuses?.length
        ? "DUNNING_COURT_JOB_ALREADY_RUNNING"
        : "DUNNING_COURT_JOB_UPDATE_FAILED",
    );
  return draftJobFromRow(rows[0]);
}

export async function recordDunningCourtDraftCreated(input: {
  orderNumber: string;
  eventKey: string;
  occurredOn: string;
  sourceReference: string;
  actor: string;
  note: string;
}) {
  await supabaseRequest(
    "dunning_court_events",
    {
      method: "POST",
      body: JSON.stringify({
        order_number: input.orderNumber,
        event_key: input.eventKey,
        event_type: "application_draft_created",
        occurred_on: input.occurredOn,
        source_reference: input.sourceReference,
        actor: input.actor,
        note: input.note,
      }),
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    },
    { on_conflict: "event_key" },
  );
}
