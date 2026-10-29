import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { customerRecordHistorySources, listCustomerRecordRequests, listCustomerRecordHistory, type CustomerRecordHistorySource, listCustomerRecordsInbox, listCustomerRecordsWorkboard, previewCustomerRecordUpdate, searchCustomerRecords, updateCustomerRecord } from "@/lib/ops/customer-records";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message, issues: error.issues },
      { status: error.status },
    );
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json(
      { ok: false, error: error.message, details: error.details },
      { status: error.status },
    );
  }

  console.error("ops customer-records route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const query = request.nextUrl.searchParams.get("query") || "";
    const mode = request.nextUrl.searchParams.get("mode") || "";
    const params = request.nextUrl.searchParams;
    const allowed = mode === "requests" ? ["mode", "query", "customerId", "requestId", "status", "limit", "offset"] : mode === "history" ? ["mode", "requestId", "source", "limit", "offset"] : ["mode", "query"];
    if (!["", "search", "inbox", "workboard", "requests", "history"].includes(mode) || [...params.keys()].some((key) => !allowed.includes(key))) throw new QuoteValidationError("Unbekannter Modus oder Query-Parameter.", ["invalid_query"], 422);
    if (mode === "requests") {
      const result = await listCustomerRecordRequests({ customerId: params.get("customerId") || undefined, requestId: params.get("requestId") || undefined, query, status: params.get("status") || undefined, limit: params.has("limit") ? Number(params.get("limit")) : undefined, offset: params.has("offset") ? Number(params.get("offset")) : undefined });
      return NextResponse.json({ ok: true, ...result });
    }
    if (mode === "history") {
      const result = await listCustomerRecordHistory({ requestId: params.get("requestId") || "", source: (params.get("source") || "") as CustomerRecordHistorySource, limit: params.has("limit") ? Number(params.get("limit")) : undefined, offset: params.has("offset") ? Number(params.get("offset")) : undefined });
      return NextResponse.json({ ok: true, ...result });
    }
    const preview = { bounded: true, complete: false, requestsMode: "requests", historyMode: "history", historySources: customerRecordHistorySources };
    if (mode === "inbox") {
      const results = await listCustomerRecordsInbox();
      return NextResponse.json({ ok: true, results, preview });
    }
    if (mode === "workboard") {
      const sections = await listCustomerRecordsWorkboard();
      return NextResponse.json({ ok: true, sections, preview });
    }
    const results = await searchCustomerRecords(query);
    return NextResponse.json({ ok: true, results, preview });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      requestId?: string;
      updates?: {
        email?: string;
        billingEmail?: string;
        ccEmails?: string[] | string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        company?: string;
      };
    };

    const result = await updateCustomerRecord(String(body.requestId || ""), body.updates || {}, {
      host,
      mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
      userAgent: request.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      requestId?: string;
      updates?: {
        email?: string;
        billingEmail?: string;
        ccEmails?: string[] | string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        company?: string;
      };
    };

    const preview = await previewCustomerRecordUpdate(String(body.requestId || ""), body.updates || {});
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return failureResponse(error);
  }
}
