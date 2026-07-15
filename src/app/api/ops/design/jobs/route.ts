import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { createDesignJobDraft, listDesignJobs } from "@/lib/ops/design";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }

  console.error("ops design jobs route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      idempotencyKey?: string;
      query?: string;
      promptTitle?: string;
      promptText?: string;
      operatorName?: string | null;
      offerId?: string | null;
      referenceAttachmentIds?: string[] | null;
      referenceAssetId?: string | null;
      actionType?: "manual_edit" | "light_color" | "product_change" | "mockup_mode" | null;
      actionValue?: string | null;
      sourceFingerprint?: string | null;
    };
    const job = await createDesignJobDraft({
      idempotencyKey: String(body.idempotencyKey || ""),
      query: String(body.query || ""),
      promptTitle: String(body.promptTitle || ""),
      promptText: String(body.promptText || ""),
      operatorName: body.operatorName || null,
      offerId: body.offerId || null,
      referenceAttachmentIds: Array.isArray(body.referenceAttachmentIds) ? body.referenceAttachmentIds.map(String) : [],
      referenceAssetId: body.referenceAssetId || null,
      actionType: body.actionType || null,
      actionValue: body.actionValue || null,
      sourceFingerprint: body.sourceFingerprint || null,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const status = request.nextUrl.searchParams.get("status");
    const limit = Number(request.nextUrl.searchParams.get("limit") || 20);
    const trelloCardId = request.nextUrl.searchParams.get("trelloCardId");
    const jobs = await listDesignJobs({ status, limit, trelloCardId });
    return NextResponse.json({ ok: true, jobs });
  } catch (error) {
    if (
      isOpsPortalBypassed(host) &&
      error instanceof SupabaseRestError &&
      error.message.includes("Supabase Server-Konfiguration fehlt")
    ) {
      return NextResponse.json({ ok: true, jobs: [], warning: "supabase_not_configured" });
    }
    return failureResponse(error);
  }
}
