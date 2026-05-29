import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getOfferByTrelloCardId, OpsOfferApiError, patchOfferByTrelloCardId, type OpsOfferPatchInput } from "@/lib/ops/offers";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof OpsOfferApiError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code, issues: error.issues },
      { status: error.status },
    );
  }
  console.error("ops customer-records offers by-trello route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function authorize(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: notConfigured() };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: unauthorized() };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ trelloCardId: string }> }) {
  const authorized = await authorize(request);
  if (!authorized.ok) return authorized.response;

  try {
    const { trelloCardId } = await params;
    const offer = await getOfferByTrelloCardId(decodeURIComponent(trelloCardId));
    return NextResponse.json({ ok: true, offer });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ trelloCardId: string }> }) {
  const authorized = await authorize(request);
  if (!authorized.ok) return authorized.response;

  try {
    const { trelloCardId } = await params;
    const url = new URL(request.url);
    const body = (await request.json()) as OpsOfferPatchInput;
    const result = await patchOfferByTrelloCardId(
      decodeURIComponent(trelloCardId),
      body,
      url.searchParams.get("dryRun") === "true",
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failureResponse(error);
  }
}
