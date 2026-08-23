export type BillingHistoryState = {
  billingAddress: Record<string, unknown>;
  vatId: unknown;
  invoiceEmail: unknown;
  projectNumber: unknown;
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stateFromCurrent(billingCase: Record<string, unknown>): BillingHistoryState {
  return {
    billingAddress: record(billingCase.billing_address),
    vatId: billingCase.vat_id ?? null,
    invoiceEmail: billingCase.customer_email ?? null,
    projectNumber: billingCase.project_number ?? null,
  };
}

function stateFromOld(value: unknown, fallback: BillingHistoryState): BillingHistoryState {
  const old = record(value);
  return {
    billingAddress: Object.keys(record(old.billingAddress)).length ? record(old.billingAddress) : fallback.billingAddress,
    vatId: valueOrFallback(old, "vatId", fallback.vatId),
    invoiceEmail: Object.prototype.hasOwnProperty.call(old, "customerEmail")
      ? old.customerEmail
      : valueOrFallback(old, "invoiceEmail", fallback.invoiceEmail),
    projectNumber: valueOrFallback(old, "projectNumber", fallback.projectNumber),
  };
}

function stateAfterChange(previous: BillingHistoryState, value: unknown): BillingHistoryState {
  const change = record(value);
  return {
    billingAddress: Object.keys(record(change.billingAddress)).length ? record(change.billingAddress) : previous.billingAddress,
    vatId: valueOrFallback(change, "vatId", previous.vatId),
    invoiceEmail: valueOrFallback(change, "invoiceEmail", previous.invoiceEmail),
    projectNumber: valueOrFallback(change, "projectNumber", previous.projectNumber),
  };
}

export function billingChangeBaselines(
  changes: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
  billingCase: Record<string, unknown>,
) {
  const appliedOld = new Map<string, unknown>();
  for (const event of events) {
    if (String(event.event_type) !== "APPLY_CHANGE_REQUEST") continue;
    const payload = record(event.payload);
    const changeRequestId = String(payload.changeRequestId || "");
    if (changeRequestId) appliedOld.set(changeRequestId, payload.old);
  }

  const chronological = [...changes].sort(
    (left, right) => new Date(String(left.created_at)).getTime() - new Date(String(right.created_at)).getTime(),
  );
  const firstOld = chronological
    .map((change) => appliedOld.get(String(change.id)))
    .find((value) => value !== undefined);
  let state = firstOld ? stateFromOld(firstOld, stateFromCurrent(billingCase)) : stateFromCurrent(billingCase);
  const result: Record<string, BillingHistoryState> = {};

  for (const change of chronological) {
    const id = String(change.id);
    const eventOld = appliedOld.get(id);
    if (eventOld !== undefined) state = stateFromOld(eventOld, state);
    result[id] = {
      billingAddress: { ...state.billingAddress },
      vatId: state.vatId,
      invoiceEmail: state.invoiceEmail,
      projectNumber: state.projectNumber,
    };
    if (String(change.status) === "APPLIED") {
      state = stateAfterChange(state, change.applied_changes || change.ops_draft_changes || change.requested_changes);
    }
  }

  return result;
}

function valueOrFallback(source: Record<string, unknown>, key: string, fallback: unknown) {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
}

