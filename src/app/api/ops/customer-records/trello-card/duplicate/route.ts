import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  duplicateCustomerTrelloCard,
  type CustomerTrelloCardDuplicateInput,
  type UpdateActor,
} from "@/lib/ops/customer-records";
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

  console.error("ops customer-records trello-card duplicate route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      requestId?: string;
      duplicate?: CustomerTrelloCardDuplicateInput;
      operatorName?: string | null;
    };

    const actor: UpdateActor = {
      host,
      mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
      userAgent: request.headers.get("user-agent"),
      operatorName: body.operatorName || null,
    };

    const result = await duplicateCustomerTrelloCard(
      String(body.requestId || ""),
      body.duplicate as CustomerTrelloCardDuplicateInput,
      actor,
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failureResponse(error);
  }
}
