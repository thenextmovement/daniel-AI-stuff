import { randomUUID } from "node:crypto";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import type { ArrivalCaseDecision, DhlArrival, ExistingDpdEvidence, ProductConfig } from "./domain";
import type { ArrivalDataClients } from "./clients";

type ProductConfigRow = {
  version: string;
  enabled: boolean;
  standard_product_code: string | null;
  express_product_mapping: Record<string, unknown> | null;
};

type RunRow = { id: string; correlation_id: string };
type CaseRow = { id: string; idempotency_key: string; status: string };

export async function loadActiveProductConfig(): Promise<ProductConfig | null> {
  const rows = await supabaseRequest<ProductConfigRow[]>("arrival_label_product_config", undefined, {
    select: "version,enabled,standard_product_code,express_product_mapping",
    enabled: "eq.true",
    limit: 2,
  });
  if (rows.length > 1) throw new Error("Mehr als eine aktive DPD-Produktkonfiguration gefunden.");
  const row = rows[0];
  if (!row) return null;
  const mapping = row.express_product_mapping || {};
  return {
    version: row.version,
    enabled: row.enabled,
    standardProductCode: row.standard_product_code,
    expressProductMapping: {
      express: typeof mapping.express === "string" ? mapping.express : undefined,
      urgent: typeof mapping.urgent === "string" ? mapping.urgent : undefined,
    },
  };
}

export async function startArrivalRun(input: {
  correlationId?: string;
  triggerType: "manual_cli" | "manual_api" | "n8n_schedule" | "fixture_test";
  mode: "dry_run" | "execute";
  localDate: string;
  configVersion: string | null;
}) {
  const correlationId = input.correlationId || `arrival-labels:${input.localDate}:${randomUUID()}`;
  const rows = await supabaseRequest<RunRow[]>("arrival_label_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      correlation_id: correlationId,
      trigger_type: input.triggerType,
      mode: input.mode,
      local_date: input.localDate,
      timezone: "Europe/Berlin",
      config_version: input.configVersion,
      status: "running",
    }),
  });
  if (!rows[0]) throw new Error("Arrival-Label-Lauf konnte nicht angelegt werden.");
  return rows[0];
}

export async function upsertArrivalCase(input: {
  runId: string;
  arrival: DhlArrival;
  decision: ArrivalCaseDecision;
}) {
  const order = input.decision.shopifyOrder;
  const card = input.decision.trelloCard;
  const rows = await supabaseRequest<CaseRow[]>("arrival_label_cases", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      run_id: input.runId,
      idempotency_key: input.decision.idempotencyKey,
      incoming_dhl_tracking_number: input.arrival.trackingNumber,
      expected_arrival_at: input.arrival.expectedArrivalAt,
      outlook_message_ids: input.arrival.messageIds,
      outlook_delivery_state: input.arrival.deliveryState,
      trello_card_id: card?.id || null,
      trello_card_name: card?.name || null,
      trello_card_url: card?.url || null,
      order_description: card?.name || null,
      shopify_order_id: order?.id || null,
      shopify_order_name: order?.name || null,
      customer_name: order?.customerName || null,
      shopify_note: order?.note || null,
      shopify_note_hash: order?.note ? await sha256Text(order.note) : null,
      shipping_class: input.decision.shippingClass,
      selected_dpd_product: input.decision.selectedDpdProduct,
      existing_dpd_tracking: input.decision.existingDpdTracking,
      status: input.decision.status,
      manual_review_reason: input.decision.manualReviewReason,
      source_snapshot: {
        reasons: input.decision.reasons,
        shopifyTags: order?.tags || [],
        lineItems: order?.lineItems || [],
        shippingLines: order?.shippingLines || [],
        fulfillmentCount: order?.fulfillments.length || 0,
      },
      updated_at: new Date().toISOString(),
    }),
  }, { on_conflict: "idempotency_key" });
  if (!rows[0]) throw new Error("Arrival-Label-Fall konnte nicht gespeichert werden.");
  await supabaseRequest("arrival_label_run_cases", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      run_id: input.runId,
      case_id: rows[0].id,
      decision_status: input.decision.status,
      decision_snapshot: {
        idempotencyKey: input.decision.idempotencyKey,
        shippingClass: input.decision.shippingClass,
        selectedDpdProduct: input.decision.selectedDpdProduct,
        existingDpdTracking: input.decision.existingDpdTracking,
        manualReviewReason: input.decision.manualReviewReason,
      },
    }),
  }, { on_conflict: "run_id,case_id" });
  return rows[0];
}

async function sha256Text(value: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function recordArrivalEvent(input: {
  runId: string;
  caseId?: string | null;
  eventKey: string;
  eventType: string;
  severity?: "info" | "warning" | "error" | "critical";
  payload?: Record<string, unknown>;
}) {
  await supabaseRequest("arrival_label_events", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      run_id: input.runId,
      case_id: input.caseId || null,
      event_key: input.eventKey,
      event_type: input.eventType,
      severity: input.severity || "info",
      payload: input.payload || {},
    }),
  }, { on_conflict: "event_key" });
}

export async function finishArrivalRun(input: {
  runId: string;
  status: "completed" | "completed_with_review" | "failed";
  summary: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  await supabaseRequest("arrival_label_runs", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: input.status,
      summary: input.summary,
      error_code: input.errorCode || null,
      error_message: input.errorMessage || null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }, { id: `eq.${input.runId}` });
}

type ShippingShipmentRow = {
  shopify_order_id: string | null;
  tracking_number: string | null;
  carrier: string | null;
};

function numericShopifyOrderId(value: string) {
  return value.match(/\/Order\/(\d+)$/)?.[1] || value;
}

export function createDatabaseExistingLabelClient(): ArrivalDataClients["existingLabels"] {
  return {
    async findForOrders(orderIds) {
      const result = new Map<string, ExistingDpdEvidence[]>();
      await Promise.all(orderIds.map(async (orderId) => {
        const numericId = numericShopifyOrderId(orderId);
        const rows = await supabaseRequest<ShippingShipmentRow[]>("shipping_shipments", undefined, {
          select: "shopify_order_id,tracking_number,carrier",
          shopify_order_id: `eq.${numericId}`,
          order: "updated_at.desc",
          limit: 20,
        });
        const labels = rows
          .filter((row) => row.tracking_number)
          .map((row) => ({ trackingNumber: row.tracking_number as string, source: "database" as const }));
        if (labels.length) result.set(orderId, labels);
      }));
      return result;
    },
  };
}
