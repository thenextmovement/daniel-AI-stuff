import { randomUUID } from "node:crypto";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import {
  ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION,
  type ArrivalCaseDecision,
  type DhlArrival,
  type ExistingDpdEvidence,
  type ProductConfig,
  type TrelloSignShippedTriggerSettings,
} from "./domain";
import type { ArrivalDataClients } from "./clients";
import type { ArrivalReviewNotification } from "./review-notifications";
import { readBoundedResponseBytes } from "./printing";
import type { BrowserArtifactRecord } from "./browser-purchase";

type ProductConfigRow = {
  version: string;
  enabled: boolean;
  standard_product_code: string | null;
  express_product_mapping: Record<string, unknown> | null;
  eu_product_mapping: Record<string, unknown> | null;
  printer_key: string | null;
  print_media: string | null;
  delivery_note_printer_key: string | null;
  delivery_note_print_media: string | null;
  pdf_layout_config: Record<string, unknown> | null;
  storage_bucket: string | null;
};

type TrelloTriggerSettingsRow = {
  enabled: boolean;
  enabled_after: string;
  board_id: string;
  source_list_id: string;
  source_list_name: string;
  title_pattern_version: string;
};

type RunRow = { id: string; correlation_id: string };
type CaseRow = {
  id: string;
  idempotency_key: string;
  status: string;
  manual_review_reason: string | null;
  delivery_note_status: string;
  existing_dpd_tracking: string | null;
};

export type ArrivalOutlookArchiveJobRow = {
  id: string;
  case_id: string;
  print_job_id: string;
  idempotency_key: string;
  source_message_id: string;
  source_message_id_sha256: string;
  expected_tracking_number: string;
  status: "pending" | "claimed" | "dispatching" | "archived" | "retryable_error" | "manual_review" | "cancelled";
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  moved_message_id: string | null;
  last_error: string | null;
};

export async function claimArrivalOutlookArchive(input: { workerId: string; leaseSeconds?: number }) {
  const rows = await supabaseRpc<ArrivalOutlookArchiveJobRow[]>("arrival_labels_claim_outlook_archive", {
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds || 180,
  });
  return rows[0] || null;
}

export async function updateArrivalOutlookArchive(input: {
  archiveJobId: string;
  workerId: string;
  result: "dispatching" | "archived" | "retryable_error" | "invalid_target" | "uncertain";
  movedMessageId?: string | null;
  error?: string | null;
}) {
  const rows = await supabaseRpc<ArrivalOutlookArchiveJobRow[]>("arrival_labels_update_outlook_archive", {
    p_archive_job_id: input.archiveJobId,
    p_worker_id: input.workerId,
    p_result: input.result,
    p_moved_message_id: input.movedMessageId || null,
    p_error: input.error || null,
  });
  if (!rows[0]) throw new Error("Outlook-Archivstatus konnte nicht aktualisiert werden.");
  return rows[0];
}

export type ArrivalTrelloArrivalJobRow = {
  id: string;
  case_id: string;
  idempotency_key: string;
  expected_tracking_number: string;
  trello_card_id: string;
  status: "pending" | "claimed" | "dispatching" | "moved" | "retryable_error" | "manual_review" | "cancelled";
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  moved_card_id: string | null;
  last_error: string | null;
};

export async function claimArrivalTrelloArrival(input: { workerId: string; leaseSeconds?: number }) {
  const rows = await supabaseRpc<ArrivalTrelloArrivalJobRow[]>("arrival_labels_claim_trello_arrival", {
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds || 180,
  });
  return rows[0] || null;
}

export async function updateArrivalTrelloArrival(input: {
  jobId: string;
  workerId: string;
  result: "dispatching" | "moved" | "retryable_error" | "invalid_target" | "uncertain";
  movedCardId?: string | null;
  error?: string | null;
}) {
  const rows = await supabaseRpc<ArrivalTrelloArrivalJobRow[]>("arrival_labels_update_trello_arrival", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_result: input.result,
    p_moved_card_id: input.movedCardId || null,
    p_error: input.error || null,
  });
  if (!rows[0]) throw new Error("Trello-Arrival-Status konnte nicht aktualisiert werden.");
  return rows[0];
}

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
    select: "version,enabled,standard_product_code,express_product_mapping,eu_product_mapping,printer_key,print_media,delivery_note_printer_key,delivery_note_print_media,pdf_layout_config,storage_bucket",
    enabled: "eq.true",
    limit: 2,
  });
  if (rows.length > 1) throw new Error("Mehr als eine aktive DPD-Produktkonfiguration gefunden.");
  const row = rows[0];
  if (!row) return null;
  const mapping = row.express_product_mapping || {};
  const euMapping = row.eu_product_mapping || {};
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
    euProductMapping: {
      standard: typeof euMapping.standard === "string" ? euMapping.standard : undefined,
      express: typeof euMapping.express === "string" ? euMapping.express : undefined,
      express_09: typeof euMapping.express_09 === "string" ? euMapping.express_09 : undefined,
      express_12: typeof euMapping.express_12 === "string" ? euMapping.express_12 : undefined,
      express_18: typeof euMapping.express_18 === "string" ? euMapping.express_18 : undefined,
      urgent: typeof euMapping.urgent === "string" ? euMapping.urgent : undefined,
    },
    printerKey: row.printer_key,
    printMedia: row.print_media,
    deliveryNotePrinterKey: row.delivery_note_printer_key,
    deliveryNotePrintMedia: row.delivery_note_print_media,
    pdfLayoutConfig: row.pdf_layout_config as ProductConfig["pdfLayoutConfig"],
    storageBucket: row.storage_bucket,
  };
}

export async function loadTrelloSignShippedTriggerSettings(): Promise<TrelloSignShippedTriggerSettings | null> {
  const rows = await supabaseRequest<TrelloTriggerSettingsRow[]>("arrival_label_trello_trigger_settings", undefined, {
    select: "enabled,enabled_after,board_id,source_list_id,source_list_name,title_pattern_version",
    singleton: "eq.true",
    limit: 2,
  });
  if (rows.length > 1) throw new Error("Mehr als eine Trello-Sign-SHIPPED-Triggerkonfiguration gefunden.");
  const row = rows[0];
  if (!row) return null;
  if (
    !/^[a-f0-9]{24}$/i.test(row.board_id)
    || !/^[a-f0-9]{24}$/i.test(row.source_list_id)
    || row.source_list_name !== "Sign SHIPPED (NEON TRIP)"
    || row.title_pattern_version !== ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION
  ) {
    throw new Error("Trello-Sign-SHIPPED-Triggerkonfiguration ist ungueltig.");
  }
  return {
    enabled: row.enabled,
    enabledAfter: row.enabled_after,
    boardId: row.board_id,
    sourceListId: row.source_list_id,
    sourceListName: row.source_list_name,
    titlePatternVersion: ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION,
  };
}

export type ArrivalBrowserPurchaseJobRow = {
  id: string;
  case_id: string;
  idempotency_key: string;
  shop_domain: string;
  shopify_order_id: string;
  shopify_order_numeric_id: string;
  shopify_order_name: string;
  order_url: string;
  selected_dpd_product: string;
  easydpd_product_label: string;
  label_format: "Einzeln auf A6";
  package_weight_grams: 500;
  maximum_purchase_cents: number;
  observed_purchase_cents: number | null;
  incoming_dhl_tracking_number: string;
  incoming_dhl_last_six: string;
  status: "queued" | "claimed" | "validated" | "dispatching" | "purchased" | "artifact_uploaded" | "completed" | "retryable_error" | "manual_review" | "cancelled";
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  dpd_tracking_number: string | null;
  original_pdf_sha256: string | null;
  annotated_pdf_sha256: string | null;
  print_job_id: string | null;
  last_error: string | null;
};

export async function enqueueArrivalBrowserPurchase(caseId: string) {
  const rows = await supabaseRpc<ArrivalBrowserPurchaseJobRow[]>("arrival_labels_enqueue_browser_purchase", { p_case_id: caseId });
  if (!rows[0]) throw new Error("EasyDPD-Browser-Auftrag konnte nicht angelegt werden.");
  return rows[0];
}

export async function claimArrivalBrowserPurchase(input: { workerId: string; leaseSeconds?: number }) {
  const rows = await supabaseRpc<ArrivalBrowserPurchaseJobRow[]>("arrival_labels_claim_browser_purchase", {
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds || 300,
  });
  return rows[0] || null;
}

export async function loadOwnedArrivalBrowserPurchase(input: { jobId: string; workerId: string }) {
  const rows = await supabaseRequest<ArrivalBrowserPurchaseJobRow[]>("arrival_label_browser_purchase_jobs", undefined, {
    select: "id,case_id,idempotency_key,shop_domain,shopify_order_id,shopify_order_numeric_id,shopify_order_name,order_url,selected_dpd_product,easydpd_product_label,label_format,package_weight_grams,maximum_purchase_cents,observed_purchase_cents,incoming_dhl_tracking_number,incoming_dhl_last_six,status,attempts,max_attempts,lease_owner,lease_expires_at,dpd_tracking_number,original_pdf_sha256,annotated_pdf_sha256,print_job_id,last_error",
    id: `eq.${input.jobId}`,
    lease_owner: `eq.${input.workerId}`,
    limit: 1,
  });
  return rows[0] || null;
}

export async function updateArrivalBrowserPurchase(input: {
  jobId: string;
  workerId: string;
  result: "validated" | "dispatching" | "purchased" | "completed" | "retryable_error" | "uncertain";
  dpdTrackingNumber?: string | null;
  originalPdfSha256?: string | null;
  observedPurchaseCents?: number | null;
  printJobId?: string | null;
  error?: string | null;
}) {
  const rows = await supabaseRpc<ArrivalBrowserPurchaseJobRow[]>("arrival_labels_update_browser_purchase", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_result: input.result,
    p_dpd_tracking_number: input.dpdTrackingNumber || null,
    p_original_pdf_sha256: input.originalPdfSha256 || null,
    p_observed_purchase_cents: input.observedPurchaseCents ?? null,
    p_print_job_id: input.printJobId || null,
    p_error: input.error || null,
  });
  if (!rows[0]) throw new Error("EasyDPD-Browser-Auftrag konnte nicht aktualisiert werden.");
  return rows[0];
}

export async function blockArrivalBrowserPurchaseForExistingLabel(input: {
  jobId: string;
  workerId: string;
  existingDpdTracking?: string | null;
  evidence?: Record<string, unknown> | null;
  error?: string | null;
}) {
  const rows = await supabaseRpc<ArrivalBrowserPurchaseJobRow[]>("arrival_labels_block_browser_purchase_existing_label", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_existing_dpd_tracking: input.existingDpdTracking || null,
    p_evidence: input.evidence || {},
    p_error: input.error || null,
  });
  if (!rows[0]) throw new Error("Vorhandenes EasyDPD-Label konnte nicht als Kaufstopper gespeichert werden.");
  return rows[0];
}

function privateStorageConfiguration() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!/^https:\/\//.test(url) || !key) throw new Error("Supabase Storage ist nicht konfiguriert.");
  return { url, key };
}

function encodeStoragePath(storageKey: string) {
  const segments = storageKey.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255)) {
    throw new Error("Ungueltiger privater Storage-Pfad.");
  }
  return segments.map(encodeURIComponent).join("/");
}

export async function uploadPrivateArrivalArtifact(input: {
  bucket: string;
  storageKey: string;
  contentType: "application/pdf" | "image/png";
  bytes: Uint8Array;
  sha256: string;
}) {
  const { url, key } = privateStorageConfiguration();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.bucket)) throw new Error("Ungueltiger privater Storage-Bucket.");
  const objectPath = encodeStoragePath(input.storageKey);
  const endpoint = `${url}/storage/v1/object/${encodeURIComponent(input.bucket)}/${objectPath}`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": input.contentType };
  const response = await fetch(endpoint, { method: "POST", headers, body: Buffer.from(input.bytes), signal: AbortSignal.timeout(20_000) });
  if (response.ok) return;
  if (response.status !== 400 && response.status !== 409) throw new Error(`Privater Storage-Upload fehlgeschlagen (HTTP ${response.status}).`);

  const existing = await fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(input.bucket)}/${objectPath}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!existing.ok) throw new Error("Vorhandenes Storage-Objekt konnte nicht idempotent verifiziert werden.");
  const bytes = await readBoundedResponseBytes(existing, 10 * 1024 * 1024);
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw new Error("Storage-Pfad ist bereits mit anderem Inhalt belegt.");
}

export async function insertArrivalBrowserArtifact(input: Omit<BrowserArtifactRecord, "id">) {
  const inserted = await supabaseRequest<BrowserArtifactRecord[]>("arrival_label_artifacts", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(input),
  }, { on_conflict: "case_id,artifact_kind" });
  if (inserted[0]) return inserted[0];
  const rows = await supabaseRequest<BrowserArtifactRecord[]>("arrival_label_artifacts", undefined, {
    select: "id,case_id,artifact_kind,storage_bucket,storage_key,sha256,content_type,byte_size,page_width_points,page_height_points,qa_result",
    case_id: `eq.${input.case_id}`,
    artifact_kind: `eq.${input.artifact_kind}`,
    limit: 1,
  });
  const existing = rows[0];
  if (!existing || existing.sha256 !== input.sha256 || existing.storage_bucket !== input.storage_bucket || existing.storage_key !== input.storage_key) {
    throw new Error("Artefakt-Idempotenzgrenze ist bereits mit anderem Inhalt belegt.");
  }
  return existing;
}

export async function loadArrivalArtifact(input: { caseId: string; artifactKind: BrowserArtifactRecord["artifact_kind"] }) {
  const rows = await supabaseRequest<BrowserArtifactRecord[]>("arrival_label_artifacts", undefined, {
    select: "id,case_id,artifact_kind,storage_bucket,storage_key,sha256,content_type,byte_size,page_width_points,page_height_points,qa_result",
    case_id: `eq.${input.caseId}`,
    artifact_kind: `eq.${input.artifactKind}`,
    limit: 1,
  });
  return rows[0] || null;
}

export async function markArrivalDeliveryNoteQaApproved(input: { caseId: string; artifactId: string }) {
  const rows = await supabaseRpc<CaseRow[]>("arrival_labels_mark_delivery_note_qa_approved", {
    p_case_id: input.caseId,
    p_artifact_id: input.artifactId,
  });
  if (!rows[0]) throw new Error("Lieferschein-QA konnte nicht freigegeben werden.");
  return rows[0];
}

export async function registerArrivalBrowserArtifacts(input: {
  jobId: string;
  workerId: string;
  dpdTrackingNumber: string;
  originalPdfSha256: string;
  originalArtifactId: string;
  annotatedArtifactId: string;
  previewArtifactId: string;
}) {
  const rows = await supabaseRpc<ArrivalBrowserPurchaseJobRow[]>("arrival_labels_register_browser_artifacts", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_dpd_tracking_number: input.dpdTrackingNumber,
    p_original_pdf_sha256: input.originalPdfSha256,
    p_original_artifact_id: input.originalArtifactId,
    p_annotated_artifact_id: input.annotatedArtifactId,
    p_preview_artifact_id: input.previewArtifactId,
  });
  if (!rows[0]) throw new Error("EasyDPD-Artefakte konnten nicht registriert werden.");
  return rows[0];
}

export type ArrivalPrintJobRow = {
  id: string;
  case_id: string;
  artifact_id: string;
  document_kind: "label" | "delivery_note";
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

const CUPS_CONFIRMATION_TIMEOUT_ERROR = "CUPS completion could not be proven; manual check required and no automatic reprint is allowed.";

export async function loadArrivalPrintConfirmationCandidates(input: { workerId: string; printerKey: string }) {
  const rows = await supabaseRequest<ArrivalPrintJobRow[]>("arrival_label_print_jobs", undefined, {
    select: "id,case_id,artifact_id,document_kind,idempotency_key,printer_key,document_sha256,status,attempts,max_attempts,lease_owner,lease_expires_at,cups_job_id,last_error",
    lease_owner: `eq.${input.workerId}`,
    printer_key: `eq.${input.printerKey}`,
    status: "in.(submitted,manual_review)",
    cups_job_id: "not.is.null",
    order: "updated_at.asc",
    limit: 20,
  });
  return rows.filter((job) => job.status === "submitted"
    || (job.status === "manual_review" && job.last_error === CUPS_CONFIRMATION_TIMEOUT_ERROR));
}

export async function confirmArrivalPrintCompletion(input: { jobId: string; workerId: string; cupsJobId: string }) {
  const rows = await supabaseRpc<ArrivalPrintJobRow[]>("arrival_labels_confirm_cups_completion", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_cups_job_id: input.cupsJobId,
  });
  if (!rows[0]) throw new Error("CUPS-Druckabschluss konnte nicht gespeichert werden.");
  return rows[0];
}

type PrintArtifactRow = {
  id: string;
  artifact_kind: "annotated_pdf" | "delivery_note_pdf";
  storage_bucket: string;
  storage_key: string;
  sha256: string;
  content_type: string;
  byte_size: number;
};

export async function loadClaimedPrintArtifact(input: { jobId: string; workerId: string }) {
  const jobs = await supabaseRequest<ArrivalPrintJobRow[]>("arrival_label_print_jobs", undefined, {
    select: "id,case_id,artifact_id,document_kind,idempotency_key,printer_key,document_sha256,status,attempts,max_attempts,lease_owner,lease_expires_at,cups_job_id,last_error",
    id: `eq.${input.jobId}`,
    lease_owner: `eq.${input.workerId}`,
    status: "in.(claimed,dispatching,submitted)",
    limit: 1,
  });
  const job = jobs[0];
  if (!job) return null;
  const artifacts = await supabaseRequest<PrintArtifactRow[]>("arrival_label_artifacts", undefined, {
    select: "id,artifact_kind,storage_bucket,storage_key,sha256,content_type,byte_size",
    id: `eq.${job.artifact_id}`,
    limit: 1,
  });
  const artifact = artifacts[0];
  const expectedKind = job.document_kind === "delivery_note" ? "delivery_note_pdf" : "annotated_pdf";
  if (!artifact || artifact.artifact_kind !== expectedKind || artifact.sha256 !== job.document_sha256 || artifact.content_type !== "application/pdf") return null;
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
  triggerType: "manual_cli" | "manual_api" | "n8n_email" | "n8n_schedule" | "local_schedule" | "fixture_test";
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
      destination_country_code: input.decision.destinationCountryCode,
      destination_class: input.decision.destinationClass,
      delivery_note_required: input.decision.deliveryNoteRequired,
      delivery_note_status: input.decision.deliveryNoteStatus,
      selected_dpd_product: input.decision.selectedDpdProduct,
      existing_dpd_tracking: input.decision.existingDpdTracking,
      status: input.decision.status,
      manual_review_reason: input.decision.manualReviewReason,
      source_snapshot: {
        arrivalSources: input.arrival.sourceKinds,
        trelloTrigger: input.arrival.trelloTrigger,
        reasons: input.decision.reasons,
        shopifyAdminUrl: order?.adminUrl || null,
        shopifyFinancialStatus: order?.financialStatus || null,
        shippingAddress: order?.shippingAddress || null,
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
  const persistedDecisionStatus = input.decision.status === "label_planned" && rows[0].status === "manual_review"
    ? "manual_review"
    : input.decision.status;
  const persistedManualReviewReason = persistedDecisionStatus === "manual_review"
    ? rows[0].manual_review_reason || input.decision.manualReviewReason
    : input.decision.manualReviewReason;
  await supabaseRequest("arrival_label_run_cases", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      run_id: input.runId,
      case_id: rows[0].id,
      decision_status: persistedDecisionStatus,
      decision_snapshot: {
        idempotencyKey: input.decision.idempotencyKey,
        arrivalSources: input.arrival.sourceKinds,
        trelloTrigger: input.arrival.trelloTrigger,
        shippingClass: input.decision.shippingClass,
        destinationCountryCode: input.decision.destinationCountryCode,
        destinationClass: input.decision.destinationClass,
        deliveryNoteRequired: input.decision.deliveryNoteRequired,
        deliveryNoteStatus: input.decision.deliveryNoteStatus,
        selectedDpdProduct: input.decision.selectedDpdProduct,
        existingDpdTracking: input.decision.existingDpdTracking,
        shopifyFinancialStatus: order?.financialStatus || null,
        manualReviewReason: persistedManualReviewReason,
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
