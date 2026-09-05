export const MAX_MOCKUPS_PER_CARD = 20;
export const MAX_PARALLEL_MOCKUPS_PER_CARD = 2;

const TABLE_STAND_TYPES = new Set([
  "table_stand",
  "tablestand",
  "table_stands",
  "tischaufsteller",
  "tischgerat",
  "tischgeraet",
]);

export function normalizeMockupProductType(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function expectedMockupCount(productType: string, configuredCount: number) {
  const normalized = normalizeMockupProductType(productType);
  if (!normalized) throw new Error("mockup_product_type_required");
  if (TABLE_STAND_TYPES.has(normalized)) return 1;
  if (!Number.isInteger(configuredCount) || configuredCount < 1 || configuredCount > MAX_MOCKUPS_PER_CARD) {
    throw new Error("mockup_expected_count_invalid");
  }
  return configuredCount;
}

export function quoteReadyMockupOrderKey(input: {
  trelloCardId: string;
  sourceRevision: string;
}) {
  const cardId = input.trelloCardId.trim();
  const revision = input.sourceRevision.trim();
  if (!cardId || !revision) throw new Error("mockup_order_identity_required");
  return `quote-ready:${cardId}:${revision}`;
}

export type MockupItemState = "pending" | "generating" | "generated" | "uploading" | "completed" | "retry_wait" | "failed_terminal" | "cancelled";

export function mockupOrderTerminalState(expectedCount: number, itemStates: MockupItemState[]) {
  if (itemStates.length !== expectedCount) throw new Error("mockup_slot_plan_incomplete");
  const completed = itemStates.filter((state) => state === "completed").length;
  const failed = itemStates.filter((state) => state === "failed_terminal").length;
  const open = itemStates.length - completed - failed - itemStates.filter((state) => state === "cancelled").length;
  if (completed === expectedCount) return "completed" as const;
  if (open === 0) return "failed_terminal" as const;
  return "processing" as const;
}
