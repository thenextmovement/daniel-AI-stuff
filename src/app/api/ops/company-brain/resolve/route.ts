import { NextRequest } from "next/server";
import {
  authorizeCompanyBrainRequest,
  companyBrainApiFailure,
  companyBrainJson,
} from "@/lib/ops/company-brain-api";
import { resolveCompanyBrain, type CompanyBrainResolveInput } from "@/lib/ops/company-brain";
import { correlateCompanyBrainResult } from "@/lib/ops/company-brain-identity";
import { OpsOfferApiError } from "@/lib/ops/offers";

export const dynamic = "force-dynamic";

function failureResponse(error: unknown) {
  if (error instanceof OpsOfferApiError) {
    return companyBrainJson({ ok: false, error: error.message, code: error.code, issues: error.issues }, { status: error.status });
  }
  return companyBrainApiFailure(error, "resolve");
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as CompanyBrainResolveInput;
    const result = await resolveCompanyBrain(body);
    let canonicalCase = null;
    let canonicalCaseWarning = null;
    try {
      canonicalCase = await correlateCompanyBrainResult(result, auth.actor);
    } catch (error) {
      console.error("company brain canonical correlation failed", error);
      canonicalCaseWarning = "canonical_case_correlation_failed";
    }
    return companyBrainJson({ ok: true, result, canonicalCase, canonicalCaseWarning });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await resolveCompanyBrain({
      query: request.nextUrl.searchParams.get("query") || "",
      question: request.nextUrl.searchParams.get("question") || null,
      limit: Number(request.nextUrl.searchParams.get("limit") || 5),
    });
    let canonicalCase = null;
    let canonicalCaseWarning = null;
    try {
      canonicalCase = await correlateCompanyBrainResult(result, auth.actor);
    } catch (error) {
      console.error("company brain canonical correlation failed", error);
      canonicalCaseWarning = "canonical_case_correlation_failed";
    }
    return companyBrainJson({ ok: true, result, canonicalCase, canonicalCaseWarning });
  } catch (error) {
    return failureResponse(error);
  }
}
