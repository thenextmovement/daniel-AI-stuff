import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { resolveCompanyBrain, type CompanyBrainResolveInput } from "@/lib/ops/company-brain";
import { OpsOfferApiError } from "@/lib/ops/offers";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Cf-Access-Jwt-Assertion",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

function unauthorized() {
  return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return jsonResponse({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return jsonResponse({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return jsonResponse({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }
  if (error instanceof OpsOfferApiError) {
    return jsonResponse({ ok: false, error: error.message, code: error.code, issues: error.issues }, { status: error.status });
  }
  console.error("ops company-brain route failed", error);
  return jsonResponse({ ok: false, error: "internal_error" }, { status: 500 });
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

export async function POST(request: NextRequest) {
  const authorized = await authorize(request);
  if (!authorized.ok) return authorized.response;

  try {
    const body = (await request.json()) as CompanyBrainResolveInput;
    const result = await resolveCompanyBrain(body);
    return jsonResponse({ ok: true, result });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const authorized = await authorize(request);
  if (!authorized.ok) return authorized.response;

  try {
    const result = await resolveCompanyBrain({
      query: request.nextUrl.searchParams.get("query") || "",
      question: request.nextUrl.searchParams.get("question") || null,
      limit: Number(request.nextUrl.searchParams.get("limit") || 5),
    });
    return jsonResponse({ ok: true, result });
  } catch (error) {
    return failureResponse(error);
  }
}
