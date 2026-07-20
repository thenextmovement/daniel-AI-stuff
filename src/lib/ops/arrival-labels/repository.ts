import { randomUUID } from "node:crypto";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import type { ArrivalCaseDecision, DhlArrival, ExistingDpdEvidence, ProductConfig } from "./domain";
import type { ArrivalDataClients } from "./clients";
import type { ArrivalReviewNotification } from "./review-notifications";
import { readBoundedResponseBytes } from "./printing";

type ProductConfigRow = {
  version: string;
  enabled: boolean;
  standard_product_code: string | null;
  express_product_mapping: Record<string, unknown> | null;
  printer_key: string | null;
  print_media: string | null;
};

type RunRow = { id: string; correlation_id: string };
type CaseRow = { id: string; idempotency_key: string; status: string };

export type ArrivalReviewNotificationRow = {
  id: string;
  case_id: string;
  notification_key: string;
  recipient_email: string;
  subject: string;
  body_text: string;
  shopify_order_url: string | null;
  status: "pending" | "claimed" | "dispatching" | "sent" | "retryable_error" | "manual_review" | "cancelled";
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  dispatch_receipt_id: string | null;
  last_error: string | null;
};

export async function enqueueArrivalReviewNotification(input: { caseId: string; notification: ArrivalReviewNotification }) {
  const rows = await supabaseRpc<ArrivalReviewNotificationRow[]>("arrival_labels_enqueue_review_notification", {
    p_case_id: input.caseId,
    p_notification_key: input.notification.notificationKey,
    p_recipient_email: input.notification.recipientEmail,
    p_subject: input.notification.subject,
    p_body_text: input.notification.bodyText,
    p_shopify_order_url: input.notification.shopifyOrderUrl,
  });
  if (!rows[0]) throw new Error("Pruefmail konnte nicht in die Outbox eingereiht werden.");
  return rows[0];
}

export async function claimArrivalReviewNotification(input: { workerId: string; leaseSeconds?: number }) {
  const rows = await supabaseRpc<ArrivalReviewNotificationRow[]>("arrival_labels_claim_review_notification", {
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds || 180,
  });
  return rows[0] || null;
}

export async function updateArrivalReviewNotification(input: {
  notificationId: string;
  workerId: string;
  result: "dispatching" | "sent" | "retryable_error" | "uncertain";
  dispatchReceiptId?: string | null;
  error?: string | null;
}) {
  const rows = await supabaseRpc<ArrivalReviewNotificationRow[]>("arrival_labels_update_review_notification", {
    p_notification_id: input.notificationId,
    p_worker_id: input.workerId,
    p_result: input.result,
    p_dispatch_receipt_id: input.dispatchReceiptId || null,
    p_error: input.error || null,
  });
  if (!rows[0]) throw new Error("Pruefmail-Status konnte nicht aktualisiert werden.");
  return rows[0];
}

export async function loadActiveProductConfig(): Promise<ProductConfig | null> {
  const rows = await supabaseRequest<ProductConfigRow[]>("arrival_label_product_config", undefined, {
    select: "version,enabled,standard_product_code,express_product_mapping,printer_key,print_media",
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
      express_09: typeof mapping.express_09 === "string" ? mapping.express_09 : undefined,
      express_12: typeof mapping.express_12 === "string" ? mapping.express_12 : undefined,
      express_18: typeof mapping.express_18 === "string" ? mapping.express_18 : undefined,
      urgent: typeof mapping.urgent === "string" ? mapping.urgent : undefined,
    },
    printerKey: row.printer_key,
    printMedia: row.print_media,
  };
}

export type ArrivalPrintJobRow = {
  id: string;
  case_id: string;
  artifact_id: string;
  idempotency_key: string;
  printer_key: string;
  document_sha256: string;
  status: "queued" | "claimed" | "dispatching" | "submitted" | "printed" | "retryable_error" | "manual_review" | "cancelled";
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  cups_job_id: string | null;
  last_error: string | null;
};

export async function enqueueArrivalPrintJob(input: {
  caseId: string;
  artifactId: string;
  printerKey: string;
  idempotencyKey: string;
}) {
  const rows = await supabaseRpc<ArrivalPrintJobRow[]>("arrival_labels_enqueue_print_job", {
    p_case_id: input.caseId,
    p_artifact_id: input.artifactId,
    p_printer_key: input.printerKey,
    p_idempotency_key: input.idempotencyKey,
  });
  if (!rows[0]) throw new Error("Druckauftrag konnte nicht angelegt werden.");
  return rows[0];
}

export async function claimArrivalPrintJob(input: { workerId: string; printerKey: string; leaseSeconds?: number }) {
  const rows = await supabaseRpc<ArrivalPrintJobRow[]>("arrival_labels_claim_print_job", {
    p_worker_id: input.workerId,
    p_printer_key: input.printerKey,
    p_lease_seconds: input.leaseSeconds || 180,
  });
  return rows[0] || null;
}

export async function updateArrivalPrintJob(input: {
  jobId: string;
  workerId: string;
  result: "dispatching" | "submitted" | "printed" | "retryable_error" | "uncertain";
  cupsJobId?: string | null;
  error?: string | null;
}) {
  const rows = await supabaseRpc<ArrivalPrintJobRow[]>("arrival_labels_update_print_job", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_result: input.result,
    p_cups_job_id: input.cupsJobId || null,
    p_error: input.error || null,
  });
  if (!rows[0]) throw new Error("Druckauftrag konnte nicht aktualisiert werden.");
  return rows[0];
}

type PrintArtifactRow = {
  id: string;
  storage_bucket: string;
  storage_key: string;
  sha256: string;
  content_type: string;
  byte_size: number;
};

export async function loadClaimedPrintArtifact(input: { jobId: string; workerId: string }) {
  const jobs = await supabaseRequest<ArrivalPrintJobRow[]>("arrival_label_print_jobs", undefined, {
    select: "id,case_id,artifact_id,idempotency_key,printer_key,document_sha256,status,attempts,max_attempts,lease_owner,lease_expires_at,cups_job_id,last_error",
    id: `eq.${input.jobId}`,
    lease_owner: `eq.${input.workerId}`,
    status: "in.(claimed,dispatching,submitted)",
    limit: 1,
  });
  const job = jobs[0];
  if (!job) return null;
  const artifacts = await supabaseRequest<PrintArtifactRow[]>("arrival_label_artifacts", undefined, {
    select: "id,storage_bucket,storage_key,sha256,content_type,byte_size",
    id: `eq.${job.artifact_id}`,
    artifact_kind: "eq.annotated_pdf",
    limit: 1,
  });
  const artifact = artifacts[0];
  if (!artifact || artifact.sha256 !== job.document_sha256 || artifact.content_type !== "application/pdf") return null;
  return { job, artifact };
}

export async function downloadPrivateArrivalArtifact(artifact: PrintArtifactRow) {
  const baseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!/^https:\/\//.test(baseUrl) || !key) throw new Error("Supabase Storage ist nicht konfiguriert.");
  if (artifact.byte_size < 1 || artifact.byte_size > 10 * 1024 * 1024) throw new Error("Druck-PDF hat eine ungueltige Groesse.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(artifact.storage_bucket)) throw new Error("Ungueltiger privater Storage-Bucket.");
  const pathSegments = artifact.storage_key.split("/");
  if (!pathSegments.length || pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255)) {
    throw new Error("Ungueltiger privater Storage-Pfad.");
  }
  const objectPath = pathSegments.map(encodeURIComponent).join("/");
  const url = `${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(artifact.storage_bucket)}/${objectPath}`;
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Druck-PDF konnte nicht geladen werden (HTTP ${response.status}).`);
  const bytes = await readBoundedResponseBytes(response, 10 * 1024 * 1024);
  if (bytes.byteLength !== Number(artifact.byte_size)) throw new Error("Druck-PDF-Groesse stimmt nicht mit dem Audit-Datensatz ueberein.");
  return bytes;
}

export async function startArrivalRun(input: {
  correlationId?: string;
  triggerType: "manual_cli" | "manual_api" | "n8n_email" | "n8n_schedule" | "fixture_test";
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
        shopifyAdminUrl: order?.adminUrl || null,
        shopifyCustomAttributes: order?.customAttributes || [],
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
