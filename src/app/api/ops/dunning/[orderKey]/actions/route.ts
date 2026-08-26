import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import { createDunningActionPreview, getDunningCaseDetail, normalizeDunningOrderNumber, requestDunningStageSend } from "@/lib/ops/dunning";
import {
  createDunningCourtApplicationPreview,
  prepareDunningCourtApplication,
} from "@/lib/ops/dunning-court-application";

export const dynamic = "force-dynamic";

type ActionBody = {
  action:
    | "preview_next_stage"
    | "send_next_stage"
    | "preview_court_application"
    | "prepare_court_application";
  confirmation?: string;
  expectedStage?: number;
  expectedSnapshotHash?: string;
  idempotencyKey?: string;
  note?: string;
};

function sameOrigin(request: NextRequest, host: string | null) {
  if (isOpsPortalBypassed(host)) return true;
  const origin = request.headers.get("origin");
  if (!origin || !host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}

function parseBody(value: unknown): ActionBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(["action", "confirmation", "expectedStage", "expectedSnapshotHash", "idempotencyKey", "note"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  const action = input.action;
  if (
    action !== "preview_next_stage" &&
    action !== "send_next_stage" &&
    action !== "preview_court_application" &&
    action !== "prepare_court_application"
  )
    return null;
  if (typeof input.confirmation === "string" && input.confirmation.length > 160) return null;
  if (typeof input.expectedSnapshotHash === "string" && input.expectedSnapshotHash.length > 64) return null;
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.length > 200) return null;
  if (typeof input.note === "string" && input.note.length > 500) return null;
  return {
    action,
    confirmation: typeof input.confirmation === "string" ? input.confirmation : undefined,
    expectedStage: Number.isInteger(input.expectedStage) ? Number(input.expectedStage) : undefined,
    expectedSnapshotHash: typeof input.expectedSnapshotHash === "string" ? input.expectedSnapshotHash : undefined,
    idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined,
    note: typeof input.note === "string" ? input.note : undefined,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ orderKey: string }> }) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!sameOrigin(request, host)) return NextResponse.json({ ok: false, error: "invalid_origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ ok: false, error: "content_type_required" }, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > 8192) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  const { orderKey } = await params;
  if (!normalizeDunningOrderNumber(orderKey)) return NextResponse.json({ ok: false, error: "invalid_order_key" }, { status: 400 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 8192) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  let jsonBody: unknown = null;
  try { jsonBody = JSON.parse(rawBody); } catch { jsonBody = null; }
  const body = parseBody(jsonBody);
  if (!body) return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 422 });
  try {
    const detail = await getDunningCaseDetail(orderKey);
    if (!detail) return NextResponse.json({ ok: false, error: "dunning_case_not_found" }, { status: 404 });
    if (
      body.action === "preview_court_application" ||
      body.action === "prepare_court_application"
    ) {
      const courtPreview = createDunningCourtApplicationPreview({
        summary: detail.case,
        profile: detail.courtProfile,
        latestJob: detail.courtDraftJob,
      });
      if (body.action === "preview_court_application")
        return NextResponse.json({ ok: true, preview: courtPreview });
      const actor = await resolveOpsRequestActor(host, request.headers);
      if (!actor)
        return NextResponse.json(
          { ok: false, error: "personal_login_required" },
          { status: 403 },
        );
      if (!detail.courtProfile)
        return NextResponse.json(
          { ok: false, error: "DUNNING_COURT_PROFILE_MISSING" },
          { status: 409 },
        );
      if (body.expectedSnapshotHash !== courtPreview.snapshotHash)
        return NextResponse.json(
          { ok: false, error: "stale_preview" },
          { status: 409 },
        );
      if (body.confirmation !== courtPreview.confirmationPhrase)
        return NextResponse.json(
          { ok: false, error: "confirmation_mismatch" },
          { status: 422 },
        );
      const idempotencyKey = String(body.idempotencyKey || "").trim();
      if (!/^ops-court:[a-zA-Z0-9:_-]{16,180}$/.test(idempotencyKey))
        return NextResponse.json(
          { ok: false, error: "invalid_idempotency_key" },
          { status: 422 },
        );
      const result = await prepareDunningCourtApplication({
        preview: courtPreview,
        profile: detail.courtProfile,
        actor,
        idempotencyKey,
      });
      return NextResponse.json({ ok: true, result });
    }
    const preview = createDunningActionPreview(detail.case);
    if (!preview) return NextResponse.json({ ok: false, error: "next_stage_not_available", blockers: detail.case.blockers }, { status: 409 });
    if (body.action === "preview_next_stage") return NextResponse.json({ ok: true, preview });
    const actor = await resolveOpsRequestActor(host, request.headers);
    if (!actor) return NextResponse.json({ ok: false, error: "personal_login_required" }, { status: 403 });
    if (body.expectedStage !== preview.nextStage || body.expectedSnapshotHash !== preview.snapshotHash) return NextResponse.json({ ok: false, error: "stale_preview" }, { status: 409 });
    if (body.confirmation !== preview.confirmationPhrase) return NextResponse.json({ ok: false, error: "confirmation_mismatch" }, { status: 422 });
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!/^[a-zA-Z0-9:_-]{16,200}$/.test(idempotencyKey)) return NextResponse.json({ ok: false, error: "invalid_idempotency_key" }, { status: 422 });
    const result = await requestDunningStageSend({ preview, actor, idempotencyKey, note: body.note });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DUNNING_ACTION_FAILED";
    const expected = /^DUNNING_[A-Z_]+$/.test(message);
    console.error("dunning action failed", { orderKey, action: body.action, message: expected ? message : "unexpected" });
    const status =
      message === "DUNNING_SEND_NOT_ENABLED" ||
      message === "DUNNING_COURT_NOT_CONFIGURED" ||
      message === "DUNNING_COURT_BROWSER_NOT_AVAILABLE"
        ? 503
        : message === "DUNNING_DUPLICATE_OR_STALE" ||
            message === "DUNNING_SEND_BLOCKED" ||
            message === "DUNNING_COURT_BLOCKED" ||
            message === "DUNNING_COURT_DUPLICATE_OR_STALE" ||
            message === "DUNNING_COURT_JOB_ALREADY_RUNNING"
          ? 409
          : expected
            ? 502
            : 500;
    return NextResponse.json({ ok: false, error: expected ? message : "dunning_action_failed" }, { status });
  }
}
