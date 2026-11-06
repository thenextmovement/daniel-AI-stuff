export type BillingInvoiceRequest = {
  expectedRevision: number; expectedUpdatedAt: string; customerRequestConfirmed: true;
  customerRequestRef: string; actor: string; idempotencyKey: string;
};

export function parseBillingInvoiceRequest(value: unknown): BillingInvoiceRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fields = ["expectedRevision", "expectedUpdatedAt", "customerRequestConfirmed", "customerRequestRef", "actor", "idempotencyKey"];
  if (Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))) return null;
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0
    || typeof input.expectedUpdatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.expectedUpdatedAt)
    || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) || input.customerRequestConfirmed !== true) return null;
  for (const [key, max] of [["customerRequestRef", 1000], ["actor", 200]] as const) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > max || /[\u0000-\u001f\u007f]/.test(input[key])) return null;
  }
  if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$/.test(input.idempotencyKey)) return null;
  return input as BillingInvoiceRequest;
}
