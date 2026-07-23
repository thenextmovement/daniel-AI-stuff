import { NextRequest, NextResponse } from "next/server";
import { isArrivalLabelsRequestAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { claimArrivalTrelloArrival, updateArrivalTrelloArrival } from "@/lib/ops/arrival-labels/repository";
import {
  inspectExactTrelloArrivalTarget,
  isRetryableTrelloArrivalInspectionError,
  moveInspectedTrelloCardToSignArrivedTopOnce,
  trelloArrivalErrorCode,
  validateTrelloArrivalWorkerId,
} from "@/lib/ops/arrival-labels/trello-arrival";

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
    const workerId = validateTrelloArrivalWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-trello-arrival-worker") !== workerId) {
      throw new PrintInputError("Trello-Arrival-Worker-ID stimmt nicht ueberein.");
    }

    const job = await claimArrivalTrelloArrival({ workerId });
    if (!job) {
      return NextResponse.json({ ok: true, processed: false, status: "idle" }, { headers: NO_STORE });
    }

    let target;
    try {
      target = await inspectExactTrelloArrivalTarget({
        cardId: job.trello_card_id,
        expectedTrackingNumber: job.expected_tracking_number,
      });
    } catch (error) {
      const retryable = isRetryableTrelloArrivalInspectionError(error);
      const updated = await updateArrivalTrelloArrival({
        jobId: job.id,
        workerId,
        result: retryable ? "retryable_error" : "invalid_target",
        error: trelloArrivalErrorCode(error),
      });
      return NextResponse.json({ ok: true, processed: true, status: updated.status }, { headers: NO_STORE });
    }

    if (target.alreadyAtTarget) {
      const updated = await updateArrivalTrelloArrival({
        jobId: job.id,
        workerId,
        result: "moved",
        movedCardId: target.cardId,
      });
      return NextResponse.json({
        ok: true,
        processed: true,
        status: updated.status,
        alreadyAtTarget: true,
      }, { headers: NO_STORE });
    }

    await updateArrivalTrelloArrival({ jobId: job.id, workerId, result: "dispatching" });
    let movedCardId: string;
    try {
      ({ movedCardId } = await moveInspectedTrelloCardToSignArrivedTopOnce(target));
    } catch (error) {
      const updated = await updateArrivalTrelloArrival({
        jobId: job.id,
        workerId,
        result: "uncertain",
        error: trelloArrivalErrorCode(error),
      });
      return NextResponse.json({ ok: true, processed: true, status: updated.status }, { headers: NO_STORE });
    }

    const updated = await updateArrivalTrelloArrival({
      jobId: job.id,
      workerId,
      result: "moved",
      movedCardId,
    });
    return NextResponse.json({ ok: true, processed: true, status: updated.status }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival Trello projection process failed", {
      name: error instanceof Error ? error.name : "unknown",
      code: trelloArrivalErrorCode(error),
    });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json({
      ok: false,
      error: invalid ? "invalid_request" : "processing_failed",
      message: invalid ? error.message : "Trello-Arrival-Projektion konnte nicht verarbeitet werden.",
    }, { status: invalid ? 400 : 500, headers: NO_STORE });
  }
}
