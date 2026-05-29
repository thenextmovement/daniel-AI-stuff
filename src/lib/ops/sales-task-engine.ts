import { SupabaseRestError, supabaseRequest } from "@/lib/quotes/supabase-rest";

const SALES_TASKS_TABLE = "sales_tasks";

export type SalesTaskType =
  | "call_new_inquiry"
  | "call_quote_sent"
  | "call_reminder_1"
  | "call_reminder_2"
  | "call_reminder_3"
  | "callback_scheduled"
  | "waiting_customer_response"
  | "manual_followup"
  | "offer_adjustment"
  | "send_offer"
  | "send_update"
  | "price_review"
  | "email_reply_needed"
  | "blocked_data_issue";

export type SalesTaskStatus = "open" | "waiting" | "blocked" | "done" | "closed";
export type SalesTaskPriority = "standard" | "important" | "vip";
export type SalesTaskSource = "sales_call_candidate" | "sales_call_result" | "inbound_email_signal" | "manual";

export type SalesTask = {
  id: string;
  requestId: string;
  taskType: SalesTaskType;
  status: SalesTaskStatus;
  title: string;
  detail: string | null;
  dueAt: string | null;
  priorityTier: SalesTaskPriority;
  assigneeLabel: string | null;
  source: SalesTaskSource;
  sourceRef: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};

export type SalesTaskDraft = {
  requestId: string;
  taskType: SalesTaskType;
  status?: SalesTaskStatus;
  title: string;
  detail?: string | null;
  dueAt?: string | null;
  priorityTier?: SalesTaskPriority | null;
  assigneeLabel?: string | null;
  source: SalesTaskSource;
  sourceRef?: string | null;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

export type InboundEmailSignal =
  | {
      kind: "customer_will_respond";
      followUpDays: 14;
      confidence: "medium" | "high";
      reason: string;
    }
  | {
      kind: "needs_time";
      followUpDays: 7 | 14;
      confidence: "medium" | "high";
      reason: string;
    }
  | {
      kind: "price_objection";
      followUpDays: 0;
      confidence: "medium" | "high";
      reason: string;
    }
  | {
      kind: "wants_offer";
      followUpDays: 0;
      confidence: "medium" | "high";
      reason: string;
    }
  | {
      kind: "wants_update";
      followUpDays: 0;
      confidence: "medium" | "high";
      reason: string;
    }
  | {
      kind: "reply_needed";
      followUpDays: 0;
      confidence: "medium";
      reason: string;
    };

type SalesTaskRow = {
  id: string;
  request_id?: string | null;
  task_type?: SalesTaskType | null;
  status?: SalesTaskStatus | null;
  title?: string | null;
  detail?: string | null;
  due_at?: string | null;
  priority_tier?: SalesTaskPriority | null;
  assignee_label?: string | null;
  source?: SalesTaskSource | null;
  source_ref?: string | null;
  idempotency_key?: string | null;
  payload?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

function normalizeWhitespace(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function addBusinessDaysIso(days: number, from: Date = new Date()) {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + days);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(9, 30, 0, 0);
  return next.toISOString();
}

function isMissingRelationError(error: unknown, relation: string) {
  return (
    error instanceof SupabaseRestError &&
    typeof error.details === "string" &&
    (
      error.details.includes(`relation \"${relation}\" does not exist`) ||
      error.details.includes(`Could not find the table 'public.${relation}' in the schema cache`) ||
      error.details.includes(`Could not find the table '${relation}' in the schema cache`)
    )
  );
}

function mapTaskRow(row: SalesTaskRow): SalesTask {
  return {
    id: row.id,
    requestId: row.request_id || "",
    taskType: row.task_type || "manual_followup",
    status: row.status || "open",
    title: row.title || "Aufgabe",
    detail: row.detail || null,
    dueAt: row.due_at || null,
    priorityTier: row.priority_tier || "standard",
    assigneeLabel: row.assignee_label || null,
    source: row.source || "manual",
    sourceRef: row.source_ref || null,
    idempotencyKey: row.idempotency_key || "",
    payload: row.payload || {},
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    completedAt: row.completed_at || null,
  };
}

function taskPayload(input: SalesTaskDraft) {
  const dueAt = normalizeWhitespace(input.dueAt) || null;
  const due = parseDate(dueAt);
  const status = input.status || (due && due.getTime() > Date.now() ? "waiting" : "open");
  return {
    request_id: input.requestId,
    task_type: input.taskType,
    status,
    title: normalizeWhitespace(input.title),
    detail: normalizeWhitespace(input.detail) || null,
    due_at: dueAt,
    priority_tier: input.priorityTier || "standard",
    assignee_label: normalizeWhitespace(input.assigneeLabel) || null,
    source: input.source,
    source_ref: normalizeWhitespace(input.sourceRef) || null,
    idempotency_key: input.idempotencyKey,
    payload: input.payload || {},
    updated_at: new Date().toISOString(),
    completed_at: status === "done" || status === "closed" ? new Date().toISOString() : null,
  };
}

export function taskTitle(type: SalesTaskType) {
  switch (type) {
    case "call_new_inquiry":
      return "Neue Anfrage anrufen";
    case "call_quote_sent":
      return "Angebot telefonisch nachfassen";
    case "call_reminder_1":
      return "Reminder-Anruf 1";
    case "call_reminder_2":
      return "Reminder-Anruf 2";
    case "call_reminder_3":
      return "Reminder-Anruf 3";
    case "callback_scheduled":
      return "Rückruf durchführen";
    case "waiting_customer_response":
      return "Nachhaken, wenn Kunde sich nicht meldet";
    case "manual_followup":
      return "Manuell weiterführen";
    case "offer_adjustment":
      return "Angebot anpassen";
    case "send_offer":
      return "Angebot senden";
    case "send_update":
      return "Update senden";
    case "price_review":
      return "Preis prüfen";
    case "email_reply_needed":
      return "Antwort prüfen";
    case "blocked_data_issue":
      return "Datenproblem klären";
  }
}

export function classifyInboundEmailSignal(input: {
  subject?: string | null;
  body?: string | null;
  classification?: string | null;
}): InboundEmailSignal | null {
  const text = normalizeWhitespace([input.subject, input.body, input.classification].filter(Boolean).join(" ")).toLowerCase();
  if (!text) return null;

  if (/\b(wir melden uns|ich melde mich|melden uns|geben bescheid|kommen auf sie zu|komme auf sie zu|rückmeldung folgt|meldung folgt)\b/i.test(text)) {
    return {
      kind: "customer_will_respond",
      followUpDays: 14,
      confidence: "high",
      reason: "Kunde kündigt eigene Rückmeldung an.",
    };
  }

  if (/\b(brauchen noch zeit|brauche noch zeit|noch etwas zeit|intern prüfen|intern besprechen|entscheiden nächste woche|überlegen noch|wir prüfen)\b/i.test(text)) {
    return {
      kind: "needs_time",
      followUpDays: text.includes("nächste woche") || text.includes("naechste woche") ? 7 : 14,
      confidence: "high",
      reason: "Kunde braucht Bedenkzeit oder interne Abstimmung.",
    };
  }

  if (/\b(zu teuer|teurer als|günstiger|guenstiger|rabatt|preis|preislich|budget|nachlass)\b/i.test(text)) {
    return {
      kind: "price_objection",
      followUpDays: 0,
      confidence: "medium",
      reason: "E-Mail enthält Preis- oder Budget-Einwand.",
    };
  }

  if (/\b(angebot|offerte|kostenvoranschlag|preisangebot)\b/i.test(text) && /\b(bitte|schicken|senden|brauche|benötige|benoetige|möchte|moechte)\b/i.test(text)) {
    return {
      kind: "wants_offer",
      followUpDays: 0,
      confidence: "medium",
      reason: "Kunde fragt nach einem Angebot.",
    };
  }

  if (/\b(update|status|stand|neuigkeiten|mockup|entwurf|design|vorschau)\b/i.test(text) && /\b(wann|gibt es|haben sie|bitte|schicken|senden)\b/i.test(text)) {
    return {
      kind: "wants_update",
      followUpDays: 0,
      confidence: "medium",
      reason: "Kunde fragt nach Status, Design oder Update.",
    };
  }

  return {
    kind: "reply_needed",
    followUpDays: 0,
    confidence: "medium",
    reason: "Eingehende E-Mail braucht manuelle Prüfung.",
  };
}

export function buildTaskFromInboundEmailSignal(input: {
  requestId: string;
  signal: InboundEmailSignal;
  sourceRef?: string | null;
  priorityTier?: SalesTaskPriority | null;
  preview?: string | null;
}): SalesTaskDraft {
  const base = {
    requestId: input.requestId,
    priorityTier: input.priorityTier || "standard",
    source: "inbound_email_signal" as const,
    sourceRef: input.sourceRef || null,
    payload: {
      signal_kind: input.signal.kind,
      signal_reason: input.signal.reason,
      signal_confidence: input.signal.confidence,
      preview: input.preview || null,
    },
  };

  switch (input.signal.kind) {
    case "customer_will_respond":
    case "needs_time":
      return {
        ...base,
        taskType: "waiting_customer_response",
        status: "waiting",
        title: taskTitle("waiting_customer_response"),
        detail: input.signal.reason,
        dueAt: addBusinessDaysIso(input.signal.followUpDays),
        idempotencyKey: `email-waiting:${input.requestId}:${input.sourceRef || input.signal.kind}`,
      };
    case "price_objection":
      return {
        ...base,
        taskType: "price_review",
        title: taskTitle("price_review"),
        detail: input.signal.reason,
        dueAt: new Date().toISOString(),
        idempotencyKey: `email-price:${input.requestId}:${input.sourceRef || input.signal.kind}`,
      };
    case "wants_offer":
      return {
        ...base,
        taskType: "send_offer",
        title: taskTitle("send_offer"),
        detail: input.signal.reason,
        dueAt: new Date().toISOString(),
        idempotencyKey: `email-offer:${input.requestId}:${input.sourceRef || input.signal.kind}`,
      };
    case "wants_update":
      return {
        ...base,
        taskType: "send_update",
        title: taskTitle("send_update"),
        detail: input.signal.reason,
        dueAt: new Date().toISOString(),
        idempotencyKey: `email-update:${input.requestId}:${input.sourceRef || input.signal.kind}`,
      };
    case "reply_needed":
      return {
        ...base,
        taskType: "email_reply_needed",
        title: taskTitle("email_reply_needed"),
        detail: input.signal.reason,
        dueAt: new Date().toISOString(),
        idempotencyKey: `email-reply:${input.requestId}:${input.sourceRef || input.signal.kind}`,
      };
  }
}

export async function loadActiveSalesTasksByRequestId(requestIds: string[]) {
  if (!requestIds.length) return new Map<string, SalesTask[]>();
  try {
    const rows = await supabaseRequest<SalesTaskRow[]>(SALES_TASKS_TABLE, undefined, {
      select: "id,request_id,task_type,status,title,detail,due_at,priority_tier,assignee_label,source,source_ref,idempotency_key,payload,created_at,updated_at,completed_at",
      request_id: `in.(${requestIds.join(",")})`,
      status: "in.(open,waiting,blocked)",
      order: "due_at.asc.nullslast,updated_at.desc",
      limit: Math.max(requestIds.length * 4, 20),
    });
    const grouped = new Map<string, SalesTask[]>();
    for (const task of rows.map(mapTaskRow)) {
      const current = grouped.get(task.requestId) || [];
      current.push(task);
      grouped.set(task.requestId, current);
    }
    return grouped;
  } catch (error) {
    if (isMissingRelationError(error, SALES_TASKS_TABLE)) return new Map<string, SalesTask[]>();
    throw error;
  }
}

export function isActiveSalesTaskVisibleNow(task: Pick<SalesTask, "status" | "dueAt">) {
  if (task.status === "open" || task.status === "blocked") return true;
  if (task.status !== "waiting" || !task.dueAt) return false;
  const dueTime = new Date(task.dueAt).getTime();
  return Number.isFinite(dueTime) && dueTime <= Date.now();
}

export async function loadActiveSalesTaskRequestIds(limit = 500) {
  try {
    const rows = await supabaseRequest<SalesTaskRow[]>(SALES_TASKS_TABLE, undefined, {
      select: "id,request_id,task_type,status,title,detail,due_at,priority_tier,assignee_label,source,source_ref,idempotency_key,payload,created_at,updated_at,completed_at",
      status: "in.(open,waiting,blocked)",
      order: "due_at.asc.nullslast,updated_at.desc",
      limit,
    });
    return rows
      .map(mapTaskRow)
      .filter((task) => task.requestId && isActiveSalesTaskVisibleNow(task))
      .map((task) => ({
        requestId: task.requestId,
        taskType: task.taskType,
      }));
  } catch (error) {
    if (isMissingRelationError(error, SALES_TASKS_TABLE)) return [];
    throw error;
  }
}

export async function upsertSalesTask(input: SalesTaskDraft) {
  try {
    const existing = await supabaseRequest<SalesTaskRow[]>(SALES_TASKS_TABLE, undefined, {
      select: "id",
      idempotency_key: `eq.${input.idempotencyKey}`,
      limit: 1,
    });
    const payload = taskPayload(input);
    if (existing[0]?.id) {
      const rows = await supabaseRequest<SalesTaskRow[]>(
        SALES_TASKS_TABLE,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
          headers: { Prefer: "return=representation" },
        },
        { id: `eq.${existing[0].id}` },
      );
      return rows[0] ? mapTaskRow(rows[0]) : null;
    }
    const rows = await supabaseRequest<SalesTaskRow[]>(SALES_TASKS_TABLE, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { Prefer: "return=representation" },
    });
    return rows[0] ? mapTaskRow(rows[0]) : null;
  } catch (error) {
    if (isMissingRelationError(error, SALES_TASKS_TABLE)) return null;
    throw error;
  }
}

export async function closeActiveSalesTasksForRequest(input: {
  requestId: string;
  reason: string;
  sourceRef?: string | null;
}) {
  try {
    await supabaseRequest(
      SALES_TASKS_TABLE,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "done",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          payload: {
            closed_reason: input.reason,
            closed_source_ref: input.sourceRef || null,
          },
        }),
        headers: { Prefer: "return=minimal" },
      },
      {
        request_id: `eq.${input.requestId}`,
        status: "in.(open,waiting,blocked)",
      },
    );
  } catch (error) {
    if (isMissingRelationError(error, SALES_TASKS_TABLE)) return;
    throw error;
  }
}

const SUPERSEDED_SALES_TASK_TYPES: SalesTaskType[] = [
  "call_new_inquiry",
  "call_quote_sent",
  "call_reminder_1",
  "call_reminder_2",
  "call_reminder_3",
  "callback_scheduled",
  "waiting_customer_response",
];

export async function closeSupersededSalesTasksForRequest(input: {
  requestId: string;
  keepIdempotencyKey: string;
  reason: string;
  sourceRef?: string | null;
}) {
  try {
    await supabaseRequest(
      SALES_TASKS_TABLE,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "done",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          payload: {
            closed_reason: input.reason,
            closed_source_ref: input.sourceRef || null,
          },
        }),
        headers: { Prefer: "return=minimal" },
      },
      {
        request_id: `eq.${input.requestId}`,
        status: "in.(open,waiting,blocked)",
        task_type: `in.(${SUPERSEDED_SALES_TASK_TYPES.join(",")})`,
        idempotency_key: `neq.${input.keepIdempotencyKey}`,
      },
    );
  } catch (error) {
    if (isMissingRelationError(error, SALES_TASKS_TABLE)) return;
    throw error;
  }
}
