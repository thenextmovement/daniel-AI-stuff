import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  listCompanyBrainTrelloAliasRepairs,
  repairCompanyBrainTrelloAlias,
  type CompanyBrainAliasRepairInput,
} from "@/lib/ops/company-brain-alias-repair";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Cf-Access-Jwt-Assertion",
};

type AliasRepairPostBody = CompanyBrainAliasRepairInput & {
  confirmed?: boolean;
  confirmationText?: string | null;
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
    return jsonResponse({ ok: false, error: error.message, code: "supabase_error" }, { status: error.status });
  }
  console.error("ops company-brain trello-alias route failed", error);
  return jsonResponse({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function authorize(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: notConfigured(), host };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: unauthorized(), host };
  }
  return { ok: true as const, host };
}

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function requireConfirmation(body: AliasRepairPostBody) {
  if (!body.confirmed) {
    throw new QuoteValidationError("Bestätigung erforderlich.", ["Die Alias-Reparatur muss vor Ausführung bestätigt werden."], 422);
  }
  const confirmation = cleanText(body.confirmationText, 80).toLowerCase();
  if (confirmation !== "freigabe") {
    throw new QuoteValidationError("Bestätigungstext fehlt.", ["Bitte mit 'Freigabe' bestätigen."], 422);
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const items = await listCompanyBrainTrelloAliasRepairs(Number.isFinite(limit) ? limit : 50);
    return jsonResponse({ ok: true, items, generatedAt: new Date().toISOString() });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => ({})) as AliasRepairPostBody;
    requireConfirmation(body);
    const repair = await repairCompanyBrainTrelloAlias(body);
    return jsonResponse({
      ok: true,
      repair,
      customerCommunicationSent: false,
    });
  } catch (error) {
    return failureResponse(error);
  }
}
