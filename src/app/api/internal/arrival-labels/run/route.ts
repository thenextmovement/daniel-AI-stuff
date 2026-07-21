import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isArrivalLabelsRunRequestAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { arrivalRunMarkdown } from "@/lib/ops/arrival-labels/report";
import { runArrivalLabels } from "@/lib/ops/arrival-labels/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  localDate?: string;
  mode?: "dry_run" | "execute";
  persist?: boolean;
  triggerType?: "manual_api" | "n8n_email" | "n8n_schedule" | "local_schedule";
};

const NO_STORE = { "Cache-Control": "no-store" };
const ALLOWED_KEYS = new Set(["localDate", "mode", "persist", "triggerType"]);

export async function POST(request: NextRequest) {
  if (!isArrivalLabelsRunRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const requestId = randomUUID();
  try {
    const body = await readBoundedJson<RequestBody>(request);
    if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) throw new PrintInputError("Request enthaelt unbekannte Felder.");
    if (body.localDate !== undefined && (typeof body.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.localDate))) {
      throw new PrintInputError("localDate muss YYYY-MM-DD sein.");
    }
    if (body.mode !== undefined && !["dry_run", "execute"].includes(body.mode)) throw new PrintInputError("Ungueltiger Modus.");
    if (body.persist !== undefined && typeof body.persist !== "boolean") throw new PrintInputError("persist muss boolean sein.");
    if (body.triggerType !== undefined && !["manual_api", "n8n_email", "n8n_schedule", "local_schedule"].includes(body.triggerType)) {
      throw new PrintInputError("Ungueltiger Trigger-Typ.");
    }
    const result = await runArrivalLabels({
      localDate: body.localDate,
      mode: body.mode || "dry_run",
      persist: body.persist === true,
      triggerType: body.triggerType || "manual_api",
    });
    return NextResponse.json({ ok: true, requestId, result, report: arrivalRunMarkdown(result) }, { headers: NO_STORE });
  } catch (error) {
    const invalid = error instanceof PrintInputError;
    console.error("arrival labels run failed", { requestId, name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({
      ok: false,
      requestId,
      error: invalid ? "invalid_request" : "arrival_labels_failed",
      message: invalid ? error.message : "Arrival-Label-Lauf fehlgeschlagen; Audit pruefen.",
    }, { status: invalid ? 400 : 500, headers: NO_STORE });
  }
}
