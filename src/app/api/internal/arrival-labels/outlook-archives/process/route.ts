import { NextRequest, NextResponse } from "next/server";
import { isArrivalLabelsRequestAuthorized } from "@/lib/ops/arrival-labels/auth";
import {
  inspectExactDhlOutlookArchiveTarget,
  isRetryableOutlookInspectionError,
  moveInspectedOutlookMessageToArchiveOnce,
  outlookArchiveErrorCode,
  validateOutlookArchiveWorkerId,
} from "@/lib/ops/arrival-labels/outlook-archive";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { claimArrivalOutlookArchive, updateArrivalOutlookArchive } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isArrivalLabelsRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const body = await readBoundedJson<{ workerId?: string }>(request);
    if (Object.keys(body).some((key) => key !== "workerId")) {
      throw new PrintInputError("Request enthaelt unbekannte Felder.");
    }
    const workerId = validateOutlookArchiveWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-outlook-archive-worker") !== workerId) {
      throw new PrintInputError("Outlook-Archiv-Worker-ID stimmt nicht ueberein.");
    }

    const job = await claimArrivalOutlookArchive({ workerId });
    if (!job) {
      return NextResponse.json({ ok: true, processed: false, status: "idle" }, { headers: NO_STORE });
    }

    let target;
    try {
      target = await inspectExactDhlOutlookArchiveTarget({
        sourceMessageId: job.source_message_id,
        expectedTrackingNumber: job.expected_tracking_number,
      });
    } catch (error) {
      const retryable = isRetryableOutlookInspectionError(error);
      const updated = await updateArrivalOutlookArchive({
        archiveJobId: job.id,
        workerId,
        result: retryable ? "retryable_error" : "invalid_target",
        error: outlookArchiveErrorCode(error),
      });
      return NextResponse.json({ ok: true, processed: true, status: updated.status }, { headers: NO_STORE });
    }

    await updateArrivalOutlookArchive({
      archiveJobId: job.id,
      workerId,
      result: "dispatching",
    });

    let movedMessageId: string;
    try {
      ({ movedMessageId } = await moveInspectedOutlookMessageToArchiveOnce(target));
    } catch (error) {
      const updated = await updateArrivalOutlookArchive({
        archiveJobId: job.id,
        workerId,
        result: "uncertain",
        error: outlookArchiveErrorCode(error),
      });
      return NextResponse.json({ ok: true, processed: true, status: updated.status }, { headers: NO_STORE });
    }

    const updated = await updateArrivalOutlookArchive({
      archiveJobId: job.id,
      workerId,
      result: "archived",
      movedMessageId,
    });
    return NextResponse.json({ ok: true, processed: true, status: updated.status }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival Outlook archive process failed", {
      name: error instanceof Error ? error.name : "unknown",
      code: outlookArchiveErrorCode(error),
    });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json({
      ok: false,
      error: invalid ? "invalid_request" : "processing_failed",
      message: invalid ? error.message : "Outlook-Archivierung konnte nicht verarbeitet werden.",
    }, { status: invalid ? 400 : 500, headers: NO_STORE });
  }
}
