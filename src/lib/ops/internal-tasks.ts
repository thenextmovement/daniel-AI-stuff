import { randomUUID } from "node:crypto";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type OpsInternalTaskStatus = "open" | "in_progress" | "waiting" | "done" | "archived";
export type OpsInternalTaskPriority = "low" | "normal" | "high" | "urgent";
export type OpsInternalTaskCategory = "customer" | "call" | "problem" | "product_restock" | "offer" | "admin" | "other";

export type OpsInternalTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: OpsInternalTaskStatus;
  priority: OpsInternalTaskPriority;
  category: OpsInternalTaskCategory;
  assignee_label: string | null;
  due_at: string | null;
  request_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  trello_card_id: string | null;
  source_app: string;
  source_ref: string | null;
  created_by: string | null;
  updated_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OpsInternalTask = {
  id: string;
  title: string;
  description: string | null;
  status: OpsInternalTaskStatus;
  priority: OpsInternalTaskPriority;
  category: OpsInternalTaskCategory;
  assigneeLabel: string | null;
  dueAt: string | null;
  requestId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  trelloCardId: string | null;
  sourceApp: string;
  sourceRef: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  completedBy: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OpsInternalTaskInput = {
  title?: string;
  description?: string | null;
  status?: OpsInternalTaskStatus;
  priority?: OpsInternalTaskPriority;
  category?: OpsInternalTaskCategory;
  assigneeLabel?: string | null;
  dueAt?: string | null;
  requestId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  trelloCardId?: string | null;
  sourceApp?: string | null;
  sourceRef?: string | null;
  metadata?: Record<string, unknown>;
};

export type OpsInternalTaskActor = {
  operatorName?: string | null;
};

export type OpsInternalTaskListOptions = {
  includeDone?: boolean;
  assigneeLabel?: string | null;
  requestId?: string | null;
  limit?: number;
};

const TASK_TABLE = "ops_internal_tasks";
const TASK_SELECT =
  "id,title,description,status,priority,category,assignee_label,due_at,request_id,customer_name,customer_email,trello_card_id,source_app,source_ref,created_by,updated_by,completed_by,completed_at,metadata,created_at,updated_at";
const SALES_TASKS_TABLE = "sales_tasks";
const SALES_TASKS_SELECT =
  "id,request_id,task_type,status,title,detail,due_at,priority_tier,assignee_label,source,source_ref,idempotency_key,payload,created_at,updated_at,completed_at";

const TASK_STATUSES: OpsInternalTaskStatus[] = ["open", "in_progress", "waiting", "done", "archived"];
const TASK_PRIORITIES: OpsInternalTaskPriority[] = ["low", "normal", "high", "urgent"];
const TASK_CATEGORIES: OpsInternalTaskCategory[] = ["customer", "call", "problem", "product_restock", "offer", "admin", "other"];

type SalesTaskFallbackRow = {
  id: string;
  request_id: string;
  task_type: string;
  status: "open" | "waiting" | "blocked" | "done" | "closed";
  title: string;
  detail: string | null;
  due_at: string | null;
  priority_tier: "standard" | "important" | "vip";
  assignee_label: string | null;
  source: string;
  source_ref: string | null;
  idempotency_key: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function cleanText(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function nullableText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function normalizeStatus(value: unknown, fallback: OpsInternalTaskStatus): OpsInternalTaskStatus {
  const next = cleanText(value, 40) as OpsInternalTaskStatus;
  return TASK_STATUSES.includes(next) ? next : fallback;
}

function normalizePriority(value: unknown, fallback: OpsInternalTaskPriority): OpsInternalTaskPriority {
  const next = cleanText(value, 40) as OpsInternalTaskPriority;
  return TASK_PRIORITIES.includes(next) ? next : fallback;
}

function normalizeCategory(value: unknown, fallback: OpsInternalTaskCategory): OpsInternalTaskCategory {
  const next = cleanText(value, 60) as OpsInternalTaskCategory;
  return TASK_CATEGORIES.includes(next) ? next : fallback;
}

function normalizeDueAt(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new QuoteValidationError("Deadline ist ungueltig.", ["Bitte eine gueltige Deadline eintragen."], 422);
  }
  return date.toISOString();
}

function mapTask(row: OpsInternalTaskRow): OpsInternalTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assigneeLabel: row.assignee_label,
    dueAt: row.due_at,
    requestId: row.request_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    trelloCardId: row.trello_card_id,
    sourceApp: row.source_app,
    sourceRef: row.source_ref,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isMissingOpsInternalTasksTable(error: unknown) {
  if (!(error instanceof SupabaseRestError)) return false;
  const details = `${String(error.details || "")} ${String(error.message || "")}`;
  return details.includes("ops_internal_tasks") && (details.includes("does not exist") || details.includes("schema cache"));
}

function fallbackStatus(row: SalesTaskFallbackRow): OpsInternalTaskStatus {
  const payloadStatus = typeof row.payload?.ops_status === "string" ? row.payload.ops_status : "";
  if (TASK_STATUSES.includes(payloadStatus as OpsInternalTaskStatus)) return payloadStatus as OpsInternalTaskStatus;
  if (row.status === "waiting" || row.status === "blocked") return "waiting";
  if (row.status === "done") return "done";
  if (row.status === "closed") return "archived";
  return "open";
}

function fallbackPriority(row: SalesTaskFallbackRow): OpsInternalTaskPriority {
  const payloadPriority = typeof row.payload?.ops_priority === "string" ? row.payload.ops_priority : "";
  if (TASK_PRIORITIES.includes(payloadPriority as OpsInternalTaskPriority)) return payloadPriority as OpsInternalTaskPriority;
  if (row.priority_tier === "vip") return "urgent";
  if (row.priority_tier === "important") return "high";
  return "normal";
}

function fallbackCategory(row: SalesTaskFallbackRow): OpsInternalTaskCategory {
  const payloadCategory = typeof row.payload?.category === "string" ? row.payload.category : "";
  return TASK_CATEGORIES.includes(payloadCategory as OpsInternalTaskCategory) ? payloadCategory as OpsInternalTaskCategory : "other";
}

function mapFallbackTask(row: SalesTaskFallbackRow): OpsInternalTask {
  return {
    id: row.id,
    title: row.title,
    description: row.detail,
    status: fallbackStatus(row),
    priority: fallbackPriority(row),
    category: fallbackCategory(row),
    assigneeLabel: row.assignee_label,
    dueAt: row.due_at,
    requestId: row.request_id.startsWith("internal:") ? null : row.request_id,
    customerName: typeof row.payload?.customer_name === "string" ? row.payload.customer_name : null,
    customerEmail: typeof row.payload?.customer_email === "string" ? row.payload.customer_email : null,
    trelloCardId: typeof row.payload?.trello_card_id === "string" ? row.payload.trello_card_id : null,
    sourceApp: "sales_tasks_fallback",
    sourceRef: row.source_ref,
    createdBy: typeof row.payload?.created_by === "string" ? row.payload.created_by : null,
    updatedBy: typeof row.payload?.updated_by === "string" ? row.payload.updated_by : null,
    completedBy: typeof row.payload?.completed_by === "string" ? row.payload.completed_by : null,
    completedAt: row.completed_at,
    metadata: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSalesTaskStatus(status: OpsInternalTaskStatus) {
  if (status === "waiting") return "waiting";
  if (status === "done") return "done";
  if (status === "archived") return "closed";
  return "open";
}

function toSalesTaskPriority(priority: OpsInternalTaskPriority) {
  if (priority === "urgent") return "vip";
  if (priority === "high") return "important";
  return "standard";
}

function actorName(actor?: OpsInternalTaskActor) {
  return nullableText(actor?.operatorName, 120);
}

function buildCreatePayload(input: OpsInternalTaskInput, actor?: OpsInternalTaskActor) {
  const title = cleanText(input.title, 240);
  if (title.length < 3) {
    throw new QuoteValidationError("Aufgabe braucht einen Titel.", ["Bitte mindestens drei Zeichen eintragen."], 422);
  }

  const status = normalizeStatus(input.status, "open");
  const completed = status === "done" || status === "archived";
  const by = actorName(actor);
  return {
    title,
    description: nullableText(input.description, 5000),
    status,
    priority: normalizePriority(input.priority, "normal"),
    category: normalizeCategory(input.category, "other"),
    assignee_label: nullableText(input.assigneeLabel, 120),
    due_at: normalizeDueAt(input.dueAt),
    request_id: nullableText(input.requestId, 120),
    customer_name: nullableText(input.customerName, 240),
    customer_email: nullableText(input.customerEmail, 240),
    trello_card_id: nullableText(input.trelloCardId, 120),
    source_app: nullableText(input.sourceApp, 80) || "ops_tasks",
    source_ref: nullableText(input.sourceRef, 240),
    created_by: by,
    updated_by: by,
    completed_by: completed ? by : null,
    completed_at: completed ? new Date().toISOString() : null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function buildFallbackCreatePayload(input: OpsInternalTaskInput, actor?: OpsInternalTaskActor) {
  const title = cleanText(input.title, 240);
  if (title.length < 3) {
    throw new QuoteValidationError("Aufgabe braucht einen Titel.", ["Bitte mindestens drei Zeichen eintragen."], 422);
  }
  const status = normalizeStatus(input.status, "open");
  const priority = normalizePriority(input.priority, "normal");
  const category = normalizeCategory(input.category, "other");
  const by = actorName(actor);
  const requestId = nullableText(input.requestId, 120) || `internal:${randomUUID()}`;
  const completed = status === "done" || status === "archived";
  return {
    request_id: requestId,
    task_type: `ops_internal_${category}`,
    status: toSalesTaskStatus(status),
    title,
    detail: nullableText(input.description, 5000),
    due_at: normalizeDueAt(input.dueAt),
    priority_tier: toSalesTaskPriority(priority),
    assignee_label: nullableText(input.assigneeLabel, 120),
    source: "ops_internal",
    source_ref: nullableText(input.sourceRef, 240),
    idempotency_key: `ops-internal:${randomUUID()}`,
    completed_at: completed ? new Date().toISOString() : null,
    payload: {
      ops_status: status,
      ops_priority: priority,
      category,
      customer_name: nullableText(input.customerName, 240),
      customer_email: nullableText(input.customerEmail, 240),
      trello_card_id: nullableText(input.trelloCardId, 120),
      created_by: by,
      updated_by: by,
      completed_by: completed ? by : null,
      source_app: nullableText(input.sourceApp, 80) || "ops_tasks",
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    },
  };
}

function buildPatchPayload(input: OpsInternalTaskInput, actor?: OpsInternalTaskActor) {
  const patch: Record<string, unknown> = {
    updated_by: actorName(actor),
    updated_at: new Date().toISOString(),
  };

  if (input.title !== undefined) {
    const title = cleanText(input.title, 240);
    if (title.length < 3) {
      throw new QuoteValidationError("Aufgabe braucht einen Titel.", ["Bitte mindestens drei Zeichen eintragen."], 422);
    }
    patch.title = title;
  }
  if (input.description !== undefined) patch.description = nullableText(input.description, 5000);
  if (input.priority !== undefined) patch.priority = normalizePriority(input.priority, "normal");
  if (input.category !== undefined) patch.category = normalizeCategory(input.category, "other");
  if (input.assigneeLabel !== undefined) patch.assignee_label = nullableText(input.assigneeLabel, 120);
  if (input.dueAt !== undefined) patch.due_at = normalizeDueAt(input.dueAt);
  if (input.requestId !== undefined) patch.request_id = nullableText(input.requestId, 120);
  if (input.customerName !== undefined) patch.customer_name = nullableText(input.customerName, 240);
  if (input.customerEmail !== undefined) patch.customer_email = nullableText(input.customerEmail, 240);
  if (input.trelloCardId !== undefined) patch.trello_card_id = nullableText(input.trelloCardId, 120);
  if (input.sourceApp !== undefined) patch.source_app = nullableText(input.sourceApp, 80) || "ops_tasks";
  if (input.sourceRef !== undefined) patch.source_ref = nullableText(input.sourceRef, 240);
  if (input.metadata !== undefined) patch.metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  if (input.status !== undefined) {
    const status = normalizeStatus(input.status, "open");
    patch.status = status;
    if (status === "done" || status === "archived") {
      patch.completed_at = new Date().toISOString();
      patch.completed_by = actorName(actor);
    } else {
      patch.completed_at = null;
      patch.completed_by = null;
    }
  }

  return patch;
}

function buildFallbackPatchPayload(input: OpsInternalTaskInput, actor?: OpsInternalTaskActor, currentPayload: Record<string, unknown> = {}) {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const payloadPatch: Record<string, unknown> = {
    updated_by: actorName(actor),
  };

  if (input.title !== undefined) {
    const title = cleanText(input.title, 240);
    if (title.length < 3) throw new QuoteValidationError("Aufgabe braucht einen Titel.", ["Bitte mindestens drei Zeichen eintragen."], 422);
    patch.title = title;
  }
  if (input.description !== undefined) patch.detail = nullableText(input.description, 5000);
  if (input.priority !== undefined) {
    const priority = normalizePriority(input.priority, "normal");
    patch.priority_tier = toSalesTaskPriority(priority);
    payloadPatch.ops_priority = priority;
  }
  if (input.category !== undefined) {
    const category = normalizeCategory(input.category, "other");
    patch.task_type = `ops_internal_${category}`;
    payloadPatch.category = category;
  }
  if (input.assigneeLabel !== undefined) patch.assignee_label = nullableText(input.assigneeLabel, 120);
  if (input.dueAt !== undefined) patch.due_at = normalizeDueAt(input.dueAt);
  if (input.requestId !== undefined) patch.request_id = nullableText(input.requestId, 120) || `internal:${randomUUID()}`;
  if (input.customerName !== undefined) payloadPatch.customer_name = nullableText(input.customerName, 240);
  if (input.customerEmail !== undefined) payloadPatch.customer_email = nullableText(input.customerEmail, 240);
  if (input.trelloCardId !== undefined) payloadPatch.trello_card_id = nullableText(input.trelloCardId, 120);
  if (input.sourceApp !== undefined) payloadPatch.source_app = nullableText(input.sourceApp, 80) || "ops_tasks";
  if (input.sourceRef !== undefined) patch.source_ref = nullableText(input.sourceRef, 240);
  if (input.metadata !== undefined) payloadPatch.metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  if (input.status !== undefined) {
    const status = normalizeStatus(input.status, "open");
    patch.status = toSalesTaskStatus(status);
    payloadPatch.ops_status = status;
    if (status === "done" || status === "archived") {
      patch.completed_at = new Date().toISOString();
      payloadPatch.completed_by = actorName(actor);
    } else {
      patch.completed_at = null;
      payloadPatch.completed_by = null;
    }
  }

  patch.payload = {
    ...currentPayload,
    ...payloadPatch,
  };
  return patch;
}

async function listFallbackTasks(options: OpsInternalTaskListOptions = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 80), 1), 150);
  const query: Record<string, string | number | boolean | null> = {
    select: SALES_TASKS_SELECT,
    source: "eq.ops_internal",
    order: "due_at.asc.nullslast,updated_at.desc",
    limit,
  };
  if (!options.includeDone) {
    query.status = "in.(open,waiting,blocked)";
  }
  if (options.assigneeLabel) query.assignee_label = `eq.${options.assigneeLabel}`;
  if (options.requestId) query.request_id = `eq.${options.requestId}`;

  const rows = await supabaseRequest<SalesTaskFallbackRow[]>(SALES_TASKS_TABLE, undefined, query);
  return rows.map(mapFallbackTask);
}

async function createFallbackTask(input: OpsInternalTaskInput, actor?: OpsInternalTaskActor) {
  const [row] = await supabaseRequest<SalesTaskFallbackRow[]>(
    SALES_TASKS_TABLE,
    {
      method: "POST",
      body: JSON.stringify(buildFallbackCreatePayload(input, actor)),
      headers: { Prefer: "return=representation" },
    },
    { select: SALES_TASKS_SELECT },
  );
  return mapFallbackTask(row);
}

async function updateFallbackTask(taskId: string, input: OpsInternalTaskInput, actor?: OpsInternalTaskActor) {
  const id = cleanText(taskId, 80);
  if (!id) throw new QuoteValidationError("Aufgaben-ID fehlt.", ["Aufgaben-ID fehlt."], 422);

  const existing = await supabaseRequest<SalesTaskFallbackRow[]>(SALES_TASKS_TABLE, undefined, {
    id: `eq.${id}`,
    source: "eq.ops_internal",
    select: SALES_TASKS_SELECT,
    limit: 1,
  });
  if (!existing[0]) throw new QuoteValidationError("Aufgabe nicht gefunden.", ["Aufgabe nicht gefunden."], 404);

  const rows = await supabaseRequest<SalesTaskFallbackRow[]>(
    SALES_TASKS_TABLE,
    {
      method: "PATCH",
      body: JSON.stringify(buildFallbackPatchPayload(input, actor, existing[0].payload || {})),
      headers: { Prefer: "return=representation" },
    },
    {
      id: `eq.${id}`,
      source: "eq.ops_internal",
      select: SALES_TASKS_SELECT,
      limit: 1,
    },
  );
  if (!rows[0]) throw new QuoteValidationError("Aufgabe nicht gefunden.", ["Aufgabe nicht gefunden."], 404);
  return mapFallbackTask(rows[0]);
}

export async function listOpsInternalTasks(options: OpsInternalTaskListOptions = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 80), 1), 150);
  const query: Record<string, string | number | boolean | null> = {
    select: TASK_SELECT,
    order: "due_at.asc.nullslast,updated_at.desc",
    limit,
  };
  if (!options.includeDone) {
    query.status = "in.(open,in_progress,waiting)";
  }
  if (options.assigneeLabel) query.assignee_label = `eq.${options.assigneeLabel}`;
  if (options.requestId) query.request_id = `eq.${options.requestId}`;

  try {
    const rows = await supabaseRequest<OpsInternalTaskRow[]>(TASK_TABLE, undefined, query);
    return rows.map(mapTask);
  } catch (error) {
    if (isMissingOpsInternalTasksTable(error)) return listFallbackTasks(options);
    throw error;
  }
}

export async function createOpsInternalTask(input: OpsInternalTaskInput, actor?: OpsInternalTaskActor) {
  try {
    const [row] = await supabaseRequest<OpsInternalTaskRow[]>(
      TASK_TABLE,
      {
        method: "POST",
        body: JSON.stringify(buildCreatePayload(input, actor)),
        headers: { Prefer: "return=representation" },
      },
      { select: TASK_SELECT },
    );
    return mapTask(row);
  } catch (error) {
    if (isMissingOpsInternalTasksTable(error)) return createFallbackTask(input, actor);
    throw error;
  }
}

export async function updateOpsInternalTask(taskId: string, input: OpsInternalTaskInput, actor?: OpsInternalTaskActor) {
  const id = cleanText(taskId, 80);
  if (!id) throw new QuoteValidationError("Aufgaben-ID fehlt.", ["Aufgaben-ID fehlt."], 422);

  try {
    const rows = await supabaseRequest<OpsInternalTaskRow[]>(
      TASK_TABLE,
      {
        method: "PATCH",
        body: JSON.stringify(buildPatchPayload(input, actor)),
        headers: { Prefer: "return=representation" },
      },
      {
        id: `eq.${id}`,
        select: TASK_SELECT,
        limit: 1,
      },
    );
    if (!rows[0]) throw new QuoteValidationError("Aufgabe nicht gefunden.", ["Aufgabe nicht gefunden."], 404);
    return mapTask(rows[0]);
  } catch (error) {
    if (isMissingOpsInternalTasksTable(error)) return updateFallbackTask(id, input, actor);
    throw error;
  }
}

export function summarizeOpsInternalTasks(tasks: OpsInternalTask[]) {
  const now = Date.now();
  const activeTasks = tasks.filter((task) => task.status !== "done" && task.status !== "archived");
  return {
    open: activeTasks.filter((task) => task.status === "open" || task.status === "in_progress" || task.status === "waiting").length,
    urgent: activeTasks.filter((task) => task.priority === "urgent" || task.priority === "high").length,
    overdue: activeTasks.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now).length,
    dueToday: activeTasks.filter((task) => {
      if (!task.dueAt) return false;
      const due = new Date(task.dueAt);
      const nowDate = new Date();
      return due.getFullYear() === nowDate.getFullYear() && due.getMonth() === nowDate.getMonth() && due.getDate() === nowDate.getDate();
    }).length,
  };
}
