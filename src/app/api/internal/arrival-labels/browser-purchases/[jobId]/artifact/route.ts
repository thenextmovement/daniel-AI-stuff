import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isArrivalBrowserWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import {
  assertEasyDpdPdf,
  extractUniqueDpdTrackingNumber,
  validateBrowserPurchaseJobId,
  validateBrowserWorkerId,
  validateDpdPdfLayout,
} from "@/lib/ops/arrival-labels/browser-purchase";
import { annotateDpdLabelPdf, extractPdfText, renderPdfFirstPageToPng } from "@/lib/ops/arrival-labels/pdf";
import { PrintInputError, readBoundedResponseBytes } from "@/lib/ops/arrival-labels/printing";
import {
  enqueueArrivalPrintJob,
  insertArrivalBrowserArtifact,
  loadActiveProductConfig,
  loadOwnedArrivalBrowserPurchase,
  registerArrivalBrowserArtifacts,
  updateArrivalBrowserPurchase,
  uploadPrivateArrivalArtifact,
} from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ jobId: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeErrorCode(error: unknown) {
  let candidate: unknown = error;
  for (let depth = 0; depth < 3 && candidate && typeof candidate === "object"; depth += 1) {
    const code = String((candidate as { code?: unknown }).code || "");
    if (/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return null;
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!isArrivalBrowserWorkerAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  let stage = "request_validation";
  try {
    const { jobId: rawJobId } = await params;
    const jobId = validateBrowserPurchaseJobId(rawJobId);
    const workerId = validateBrowserWorkerId(String(request.headers.get("x-neontrip-browser-worker") || ""));
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/pdf") {
      throw new PrintInputError("Content-Type muss application/pdf sein.");
    }
    const requestSha256 = String(request.headers.get("x-neontrip-pdf-sha256") || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(requestSha256)) throw new PrintInputError("PDF-Pruefsumme fehlt oder ist ungueltig.");
    stage = "load_job";
    const job = await loadOwnedArrivalBrowserPurchase({ jobId, workerId });
    if (!job || !["dispatching", "purchased"].includes(job.status)) throw new PrintInputError("Browser-Auftrag ist nicht fuer einen PDF-Upload freigegeben.");

    stage = "read_pdf";
    const bytes = await readBoundedResponseBytes(new Response(request.body, { headers: request.headers }), 10 * 1024 * 1024);
    const originalSha256 = assertEasyDpdPdf(bytes);
    if (originalSha256 !== requestSha256) throw new PrintInputError("EasyDPD-PDF-Pruefsumme stimmt nicht.");
    if (job.original_pdf_sha256 && job.original_pdf_sha256 !== originalSha256) throw new PrintInputError("Dieser Auftrag ist bereits mit einer anderen PDF-Pruefsumme verknuepft.");

    stage = "extract_tracking";
    const dpdTrackingNumber = extractUniqueDpdTrackingNumber(await extractPdfText(bytes), job.incoming_dhl_tracking_number);
    if (job.dpd_tracking_number && job.dpd_tracking_number !== dpdTrackingNumber) throw new PrintInputError("Dieser Auftrag ist bereits mit einer anderen DPD-Sendungsnummer verknuepft.");
    stage = "persist_purchase";
    await updateArrivalBrowserPurchase({
      jobId,
      workerId,
      result: "purchased",
      dpdTrackingNumber,
      originalPdfSha256: originalSha256,
    });

    stage = "load_configuration";
    const config = await loadActiveProductConfig();
    if (!config?.enabled || !config.printerKey || !config.storageBucket) throw new PrintInputError("Aktive Druck- und Storage-Konfiguration fehlt.");
    const layout = validateDpdPdfLayout(config.pdfLayoutConfig);
    stage = "annotate_pdf";
    const annotated = await annotateDpdLabelPdf(bytes, job.incoming_dhl_tracking_number, layout);
    stage = "render_preview";
    const preview = await renderPdfFirstPageToPng(annotated.pdf, 3);
    const previewSha256 = sha256(preview);
    const prefix = `cases/${job.case_id}/browser-purchases/${job.id}/${originalSha256}`;
    const files = [
      { kind: "original_pdf" as const, key: `${prefix}/original.pdf`, type: "application/pdf" as const, bytes, hash: originalSha256 },
      { kind: "annotated_pdf" as const, key: `${prefix}/annotated-${job.incoming_dhl_last_six}.pdf`, type: "application/pdf" as const, bytes: annotated.pdf, hash: annotated.qa.sha256 },
      { kind: "rendered_preview" as const, key: `${prefix}/preview-${job.incoming_dhl_last_six}.png`, type: "image/png" as const, bytes: preview, hash: previewSha256 },
    ];
    stage = "upload_storage";
    for (const file of files) {
      await uploadPrivateArrivalArtifact({ bucket: config.storageBucket, storageKey: file.key, contentType: file.type, bytes: file.bytes, sha256: file.hash });
    }
    stage = "insert_artifacts";
    const [originalArtifact, annotatedArtifact, previewArtifact] = await Promise.all(files.map((file) => insertArrivalBrowserArtifact({
      case_id: job.case_id,
      artifact_kind: file.kind,
      storage_bucket: config.storageBucket as string,
      storage_key: file.key,
      sha256: file.hash,
      content_type: file.type,
      byte_size: file.bytes.byteLength,
      page_width_points: file.kind === "rendered_preview" ? null : annotated.qa.pageWidthPoints,
      page_height_points: file.kind === "rendered_preview" ? null : annotated.qa.pageHeightPoints,
      qa_result: file.kind === "annotated_pdf"
        ? annotated.qa
        : file.kind === "original_pdf"
          ? { ok: true, source: "easydpd_browser_download", sha256: originalSha256 }
          : { ok: true, sourceSha256: annotated.qa.sha256 },
    })));

    stage = "register_artifacts";
    await registerArrivalBrowserArtifacts({
      jobId,
      workerId,
      dpdTrackingNumber,
      originalPdfSha256: originalSha256,
      originalArtifactId: originalArtifact.id,
      annotatedArtifactId: annotatedArtifact.id,
      previewArtifactId: previewArtifact.id,
    });
    stage = "enqueue_print";
    const printJob = await enqueueArrivalPrintJob({
      caseId: job.case_id,
      artifactId: annotatedArtifact.id,
      printerKey: config.printerKey,
      idempotencyKey: `arrival-browser-print:${job.id}:${annotated.qa.sha256}`,
    });
    stage = "complete_job";
    const completed = await updateArrivalBrowserPurchase({ jobId, workerId, result: "completed", printJobId: printJob.id });
    return NextResponse.json({
      ok: true,
      status: completed.status,
      dpdTrackingNumber,
      incomingDhlLastSix: job.incoming_dhl_last_six,
      annotatedPdfSha256: annotated.qa.sha256,
      printJobId: printJob.id,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival browser artifact processing failed", {
      name: error instanceof Error ? error.name : "unknown",
      stage,
      code: safeErrorCode(error),
    });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json(
      {
        ok: false,
        error: invalid ? "invalid_request" : "artifact_failed",
        message: invalid ? error.message : `EasyDPD-PDF konnte in Stufe ${stage} nicht sicher verarbeitet werden.`,
      },
      { status: invalid ? 400 : 500, headers: NO_STORE },
    );
  }
}
