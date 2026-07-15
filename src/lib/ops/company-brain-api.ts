import { NextRequest, NextResponse } from "next/server";
import {
  hasOpsSession,
  isOpsPortalBypassed,
  isOpsPortalConfigured,
  validateCloudflareAccess,
} from "@/lib/ops/auth";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Cf-Access-Jwt-Assertion",
};

export function companyBrainJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

export async function authorizeCompanyBrainRequest(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) {
    return { ok: false as const, response: companyBrainJson({ ok: false, error: "ops_not_configured" }, { status: 503 }) };
  }
  const bypassed = isOpsPortalBypassed(host);
  if (!bypassed && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: companyBrainJson({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }
  if (bypassed) return { ok: true as const, actor: "local_ops", actorIdentified: true as const };
  const access = await validateCloudflareAccess(request.headers);
  return {
    ok: true as const,
    actor: access.ok ? access.email : "authenticated_ops_session",
    actorIdentified: access.ok,
  };
}

export function requireIdentifiedCompanyBrainActor(auth: { actorIdentified: boolean }) {
  return auth.actorIdentified
    ? null
    : companyBrainJson({ ok: false, error: "actor_identity_required" }, { status: 403 });
}

export function companyBrainApiFailure(error: unknown, operation: string) {
  if (error instanceof QuoteValidationError) {
    return companyBrainJson({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return companyBrainJson(
      { ok: false, error: error.message, code: "supabase_error", details: error.details },
      { status: error.status },
    );
  }
  console.error(`company brain ${operation} failed`, error);
  return companyBrainJson({ ok: false, error: "internal_error" }, { status: 500 });
}
