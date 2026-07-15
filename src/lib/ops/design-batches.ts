import { createHash, randomUUID } from "node:crypto";
import { createDesignJobDraft, generateDesignJobNow, attachDesignAssetToTrello, loadDesignWorkspace } from "@/lib/ops/design";
import { canonicalDesignActionValue, designActionPrompt, isJpegMimeType, type DesignBatchActionType } from "@/lib/ops/design-contract";
import { isEligibleAiMockupSourceName } from "@/lib/ops/design-source";
import { supabaseRequest, supabaseRpc, SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type DesignBatchItemSummary = {
  id: string;
  sequenceNumber: number;
  sourceCardId: string;
  sourceAttachmentId: string;
  sourceAttachmentName: string;
  sourceMimeType: string | null;
  sourceFingerprint: string;
  jobId: string | null;
  assetId: string | null;
  status: string;
  attemptCount: number;
  errorMessage: string | null;
  trelloNewAttachmentId: string | null;
  trelloOriginalName: string | null;
  trelloArchivedName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type DesignBatchSummary = {
  id: string;
  batchKey: string;
  sourceQuery: string;
  requestId: string | null;
  trelloCardId: string;
  trelloCardUrl: string | null;
  actionType: DesignBatchActionType;
  actionValue: string;
  replaceTrello: boolean;
  status: string;
  operatorName: string | null;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  retryableCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  items: DesignBatchItemSummary[];
};

type DesignBatchRow = {
  id: string;
  batch_key: string;
  source_query: string;
  request_id: string | null;
  trello_card_id: string;
  trello_card_url: string | null;
  action_type: DesignBatchActionType;
  action_value: string;
  replace_trello: boolean;
  status: string;
  operator_name: string | null;
  total_count: number;
  completed_count: number;
  failed_count: number;
  metadata: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type DesignBatchItemRow = {
  id: string;
  item_key: string;
  batch_id: string;
  sequence_number: number;
  source_card_id: string;
  source_attachment_id: string;
  source_attachment_name: string;
  source_mime_type: string | null;
  source_fingerprint: string;
  job_id: string | null;
  asset_id: string | null;
  status: string;
  attempt_count: number;
  worker_run_id: string | null;
  error_message: string | null;
  trello_new_attachment_id: string | null;
  trello_original_name: string | null;
  trello_archived_name: string | null;
  metadata: Record<string, unknown> | null;
  started_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const BATCH_SELECT = "id,batch_key,source_query,request_id,trello_card_id,trello_card_url,action_type,action_value,replace_trello,status,operator_name,total_count,completed_count,failed_count,metadata,started_at,finished_at,created_at,updated_at";
const ITEM_SELECT = "id,item_key,batch_id,sequence_number,source_card_id,source_attachment_id,source_attachment_name,source_mime_type,source_fingerprint,job_id,asset_id,status,attempt_count,worker_run_id,error_message,trello_new_attachment_id,trello_original_name,trello_archived_name,metadata,started_at,heartbeat_at,finished_at,created_at,updated_at";

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function batchItem(row: DesignBatchItemRow): DesignBatchItemSummary {
  return {
    id: row.id,
    sequenceNumber: row.sequence_number,
    sourceCardId: row.source_card_id,
    sourceAttachmentId: row.source_attachment_id,
    sourceAttachmentName: row.source_attachment_name,
    sourceMimeType: row.source_mime_type,
    sourceFingerprint: row.source_fingerprint,
    jobId: row.job_id,
    assetId: row.asset_id,
    status: row.status,
    attemptCount: row.attempt_count,
    errorMessage: row.error_message,
    trelloNewAttachmentId: row.trello_new_attachment_id,
    trelloOriginalName: row.trello_original_name,
    trelloArchivedName: row.trello_archived_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function batchSummary(row: DesignBatchRow): Promise<DesignBatchSummary> {
  const items = await supabaseRequest<DesignBatchItemRow[]>("design_batch_items", undefined, {
    select: ITEM_SELECT,
    batch_id: `eq.${row.id}`,
    order: "sequence_number.asc",
    limit: 50,
  });
  return {
    id: row.id,
    batchKey: row.batch_key,
    sourceQuery: row.source_query,
    requestId: row.request_id,
    trelloCardId: row.trello_card_id,
    trelloCardUrl: row.trello_card_url,
    actionType: row.action_type,
    actionValue: row.action_value,
    replaceTrello: row.replace_trello,
    status: row.status,
    operatorName: row.operator_name,
    totalCount: row.total_count,
    completedCount: row.completed_count,
    failedCount: row.failed_count,
    retryableCount: items.filter((item) => item.status === "failed" && item.attempt_count < 3).length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    items: items.map(batchItem),
  };
}

async function getBatchRow(batchId: string) {
  const id = text(batchId);
  if (!id) throw new QuoteValidationError("Batch-ID ist erforderlich.");
  const rows = await supabaseRequest<DesignBatchRow[]>("design_batches", undefined, {
    select: BATCH_SELECT,
    id: `eq.${id}`,
    limit: 1,
  });
  if (!rows[0]) throw new QuoteValidationError("Design-Batch wurde nicht gefunden.", [], 404);
  return rows[0];
}

export async function getDesignBatch(batchId: string) {
  return batchSummary(await getBatchRow(batchId));
}

export async function createDesignBatch(input: {
  idempotencyKey: string;
  query: string;
  actionType: DesignBatchActionType;
  actionValue: string;
  attachmentIds: string[];
  replaceTrello?: boolean | null;
  operatorName?: string | null;
}) {
  const batchKey = text(input.idempotencyKey);
  const query = text(input.query);
  if (!batchKey || batchKey.length < 12 || batchKey.length > 180) throw new QuoteValidationError("Gueltiger Idempotency-Key ist erforderlich.");
  if (!query) throw new QuoteValidationError("Suchbegriff ist erforderlich.");
  if (input.actionType !== "light_color" && input.actionType !== "product_change") throw new QuoteValidationError("Batch-Aktion ist ungueltig.");
  const actionValue = canonicalDesignActionValue(input.actionType, input.actionValue);
  if (!actionValue) throw new QuoteValidationError("Zielwert der Batch-Aktion ist nicht freigegeben.");
  const attachmentIds = Array.from(new Set(input.attachmentIds.map(String).map((value) => value.trim()).filter(Boolean))).slice(0, 20);
  if (!attachmentIds.length) throw new QuoteValidationError("Mindestens ein Ausgangs-Mockup ist erforderlich.");

  const existing = await supabaseRequest<DesignBatchRow[]>("design_batches", undefined, {
    select: BATCH_SELECT,
    batch_key: `eq.${batchKey}`,
    limit: 1,
  });

  const workspace = await loadDesignWorkspace(query);
  const selected = workspace.cards.flatMap((card) => card.attachments
    .filter((attachment) => attachmentIds.includes(attachment.id))
    .map((attachment) => ({ card, attachment })));
  if (selected.length !== attachmentIds.length) throw new QuoteValidationError("Mindestens ein Ausgangsbild gehört nicht zum geladenen Arbeitsbereich.");
  const cardIds = new Set(selected.map(({ card }) => card.cardId));
  if (cardIds.size !== 1) throw new QuoteValidationError("Ein Bulk-Batch darf nur Bilder derselben Trello-Karte enthalten.");
  for (const { attachment } of selected) {
    if (!isEligibleAiMockupSourceName(attachment.name) || (attachment.mimeType && !isJpegMimeType(attachment.mimeType))) {
      throw new QuoteValidationError(`${attachment.name} ist kein zulaessiges Mockup + AI + JPG.`);
    }
  }
  const sourceCard = selected[0]!.card;
  const operatorName = text(input.operatorName);
  let batch = existing[0] || null;
  if (!batch) {
    try {
      const createdRows = await supabaseRequest<DesignBatchRow[]>("design_batches", {
        method: "POST",
        body: JSON.stringify({
          batch_key: batchKey,
          source_query: query,
          request_id: workspace.record?.requestId || null,
          trello_card_id: sourceCard.cardId,
          trello_card_url: sourceCard.cardUrl,
          action_type: input.actionType,
          action_value: actionValue,
          replace_trello: Boolean(input.replaceTrello),
          status: "pending",
          operator_name: operatorName,
          total_count: selected.length,
          metadata: { source: "ops_design_ui", contract_version: 2 },
        }),
        headers: { Prefer: "return=representation" },
      });
      batch = createdRows[0] || null;
    } catch (error) {
      if (!(error instanceof SupabaseRestError) || error.status !== 409) throw error;
      const raced = await supabaseRequest<DesignBatchRow[]>("design_batches", undefined, {
        select: BATCH_SELECT,
        batch_key: `eq.${batchKey}`,
        limit: 1,
      });
      if (!raced[0]) throw error;
      batch = raced[0];
    }
  }
  if (!batch) throw new QuoteValidationError("Design-Batch konnte nicht erstellt werden.");

  if (
    batch.source_query !== query ||
    batch.trello_card_id !== sourceCard.cardId ||
    batch.action_type !== input.actionType ||
    batch.action_value !== actionValue ||
    batch.replace_trello !== Boolean(input.replaceTrello) ||
    batch.total_count !== selected.length
  ) {
    throw new QuoteValidationError("Der Idempotency-Key gehört bereits zu einem anderen Design-Batch.", [], 409);
  }

  const current = await batchSummary(batch);
  if (current.items.length === selected.length) return current;
  if (current.items.length > 0) {
    throw new QuoteValidationError("Design-Batch ist unvollständig und muss administrativ geprüft werden.", [], 409);
  }

  const itemRows = selected.map(({ card, attachment }, index) => {
      const fingerprint = hash([card.cardId, attachment.id, attachment.name, attachment.mimeType || "unknown"].join("|"));
      return {
        item_key: `design-batch-item:${hash(`${batchKey}|${attachment.id}`).slice(0, 32)}`,
        batch_id: batch.id,
        sequence_number: index,
        source_card_id: card.cardId,
        source_attachment_id: attachment.id,
        source_attachment_name: attachment.name,
        source_mime_type: attachment.mimeType,
        source_fingerprint: fingerprint,
        status: "pending",
        metadata: { source: "ops_design_ui", action_type: input.actionType, action_value: actionValue },
      };
    });
  try {
    await supabaseRequest<DesignBatchItemRow[]>("design_batch_items", {
      method: "POST",
      body: JSON.stringify(itemRows),
      headers: { Prefer: "return=representation" },
    });
  } catch (error) {
    if (!(error instanceof SupabaseRestError) || error.status !== 409) throw error;
  }
  const result = await getDesignBatch(batch.id);
  if (result.items.length !== selected.length) {
    throw new QuoteValidationError("Design-Batch-Einzeljobs konnten nicht vollständig angelegt werden.", [], 409);
  }
  return result;
}

async function patchBatchItem(itemId: string, body: Record<string, unknown>) {
  const rows = await supabaseRequest<DesignBatchItemRow[]>("design_batch_items", {
    method: "PATCH",
    body: JSON.stringify({ ...body, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    headers: { Prefer: "return=representation" },
  }, { id: `eq.${itemId}` });
  return rows[0] || null;
}

async function refreshBatch(batchId: string) {
  await supabaseRpc<DesignBatchRow[]>("refresh_design_batch_status", { p_batch_id: batchId });
  return getDesignBatch(batchId);
}

export async function processNextDesignBatchItem(input: {
  batchId: string;
  operatorName?: string | null;
}) {
  const batch = await getBatchRow(input.batchId);
  if (["completed", "completed_with_errors", "cancelled"].includes(batch.status)) {
    return { batch: await batchSummary(batch), processedItemId: null };
  }
  const workerRunId = `ops-design-batch:${randomUUID()}`;
  const claimed = await supabaseRpc<DesignBatchItemRow[]>("claim_next_design_batch_item", {
    p_batch_id: batch.id,
    p_worker_run_id: workerRunId,
    p_stale_before: new Date(Date.now() - 5 * 60_000).toISOString(),
    p_max_attempts: 3,
  });
  const item = claimed[0] || null;
  if (!item) return { batch: await refreshBatch(batch.id), processedItemId: null };

  try {
    const promptText = designActionPrompt(batch.action_type, batch.action_value);
    if (!promptText) throw new QuoteValidationError("Gespeicherte Batch-Aktion ist nicht mehr gueltig.");
    const job = await createDesignJobDraft({
      idempotencyKey: item.item_key,
      query: batch.source_query,
      promptTitle: `${batch.action_value} · ${item.source_attachment_name}`,
      promptText,
      operatorName: text(input.operatorName) || batch.operator_name,
      referenceAttachmentIds: [item.source_attachment_id],
      actionType: batch.action_type,
      actionValue: batch.action_value,
      sourceFingerprint: item.source_fingerprint,
    });
    await patchBatchItem(item.id, { job_id: job.id, status: "generating" });
    const generated = await generateDesignJobNow({
      jobId: job.id,
      idempotencyKey: item.item_key,
      operatorName: text(input.operatorName) || batch.operator_name,
    });
    if (!generated.asset) throw new QuoteValidationError("Design-Job lieferte kein Asset.");
    await patchBatchItem(item.id, { asset_id: generated.asset.id, status: batch.replace_trello ? "attaching" : "generated" });
    let trelloResult: Awaited<ReturnType<typeof attachDesignAssetToTrello>> | null = null;
    if (batch.replace_trello) {
      trelloResult = await attachDesignAssetToTrello({
        jobId: job.id,
        assetId: generated.asset.id,
        replacementAttachmentId: item.source_attachment_id,
        operatorName: text(input.operatorName) || batch.operator_name,
      });
    }
    await patchBatchItem(item.id, {
      asset_id: generated.asset.id,
      status: "completed",
      error_message: null,
      trello_new_attachment_id: trelloResult?.trelloAttachmentId || null,
      trello_original_name: item.source_attachment_name,
      trello_archived_name: trelloResult?.archivedAttachmentName || null,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Design-Batch-Item ist fehlgeschlagen.";
    await patchBatchItem(item.id, {
      status: "failed",
      error_message: message.slice(0, 1000),
      finished_at: new Date().toISOString(),
    });
  }
  return { batch: await refreshBatch(batch.id), processedItemId: item.id };
}

export async function cancelDesignBatch(batchId: string) {
  const batch = await getBatchRow(batchId);
  if (["completed", "completed_with_errors", "cancelled"].includes(batch.status)) return batchSummary(batch);
  const now = new Date().toISOString();
  await supabaseRequest("design_batch_items", {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", finished_at: now, updated_at: now }),
  }, { batch_id: `eq.${batch.id}`, status: "eq.pending" });
  const rows = await supabaseRequest<DesignBatchRow[]>("design_batches", {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", finished_at: now, updated_at: now }),
    headers: { Prefer: "return=representation" },
  }, { id: `eq.${batch.id}` });
  return batchSummary(rows[0] || { ...batch, status: "cancelled", finished_at: now, updated_at: now });
}
