import type { CustomerInternalTask } from "@/lib/ops/customer-records";

export type OfferCallContextRequestEntry = {
  offerId?: string;
  offerNumber?: string | null;
  documentReference?: string | null;
  requestId?: string | null;
  trelloCardId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

export type OfferCallTaskSummary = {
  id: string;
  title: string;
  dueAt?: string | null;
  assigneeName?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

function cleanText(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function unique(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function offerTaskReferenceKeys(entry: OfferCallContextRequestEntry) {
  return unique([
    cleanText(entry.offerId),
    cleanText(entry.documentReference),
    cleanText(entry.offerNumber),
  ]);
}

function taskSummary(task: CustomerInternalTask): OfferCallTaskSummary {
  return {
    id: task.id,
    title: task.title,
    dueAt: task.dueAt,
    assigneeName: task.assigneeName,
    sourceType: task.sourceType,
    sourceId: task.sourceId,
  };
}

function offerSourceMatches(task: CustomerInternalTask, referenceKeys: string[]) {
  if (!referenceKeys.length) return false;
  const sourceType = cleanText(task.sourceType);
  if (sourceType !== "neontrip_offer_call") return false;

  const sourceId = cleanText(task.sourceId);
  const idempotencyKey = cleanText(task.idempotencyKey);
  return referenceKeys.some((key) => (
    sourceId === key ||
    sourceId?.startsWith(`${key}:`) ||
    idempotencyKey === `source:neontrip_offer_call:${key}` ||
    idempotencyKey?.startsWith(`source:neontrip_offer_call:${key}:`)
  ));
}

function byDueDateThenRecentUpdate(left: CustomerInternalTask, right: CustomerInternalTask) {
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
}

export function selectPendingOfferCallTaskForOffer(
  tasks: CustomerInternalTask[],
  entry: OfferCallContextRequestEntry,
) {
  const referenceKeys = offerTaskReferenceKeys(entry);
  const task = tasks
    .filter((candidate) => (
      candidate.status === "open" &&
      candidate.category === "call" &&
      offerSourceMatches(candidate, referenceKeys)
    ))
    .sort(byDueDateThenRecentUpdate)[0] || null;

  return task ? taskSummary(task) : null;
}
