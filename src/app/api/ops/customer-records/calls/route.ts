import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  buildFailedSalesCallModuleState,
  getSalesCallModuleState,
  recordSalesCallResult,
  type SalesCallPostReminderDecision,
  refreshSalesCallList,
  type SalesCallPriorityTier,
  type SalesCallPreset,
} from "@/lib/ops/customer-call-module";
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

  console.error("ops customer-records calls route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const state = await withTimeout(getSalesCallModuleState(), 35_000, "sales_call_state_timeout");
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    console.error("ops customer-records calls state unavailable", error);
    return NextResponse.json({
      ok: true,
      degraded: true,
      state: buildFailedSalesCallModuleState(error instanceof Error ? error.message : "sales_call_state_unavailable"),
    });
  }
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as
      {
        action?: "refresh_list" | "record_result";
        operatorName?: string;
        callListItemId?: string;
        requestId?: string;
        preset?: SalesCallPreset;
        notes?: string;
        callbackDate?: string | null;
        postReminderDecision?: SalesCallPostReminderDecision | null;
        priorityTier?: SalesCallPriorityTier | null;
        priorityReason?: string | null;
        purchaseSignal?: boolean | null;
      };

    const actor = {
      host,
      mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
      userAgent: request.headers.get("user-agent"),
      operatorName: body.operatorName || null,
    };

    if (body.action === "refresh_list") {
      try {
        const state = await withTimeout(refreshSalesCallList(actor), 35_000, "sales_call_refresh_timeout");
        return NextResponse.json({ ok: true, action: body.action, state });
      } catch (error) {
        console.error("ops customer-records calls refresh unavailable", error);
        return NextResponse.json({
          ok: true,
          action: body.action,
          degraded: true,
          state: buildFailedSalesCallModuleState(error instanceof Error ? error.message : "sales_call_refresh_unavailable"),
        });
      }
    }

    if (body.action === "record_result") {
      const result = await recordSalesCallResult(
        {
          callListItemId: String(body.callListItemId || ""),
          requestId: String(body.requestId || ""),
          preset: String(body.preset || "") as SalesCallPreset,
          notes: String(body.notes || ""),
          callbackDate: body.callbackDate || null,
          postReminderDecision: (body.postReminderDecision || null) as SalesCallPostReminderDecision | null,
          operatorId: body.operatorName || null,
          priorityTier: (body.priorityTier || null) as SalesCallPriorityTier | null,
          priorityReason: body.priorityReason || null,
          purchaseSignal: body.purchaseSignal ?? null,
        },
        actor,
      );
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return failureResponse(error);
  }
}
