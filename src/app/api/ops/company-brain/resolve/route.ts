import { NextRequest } from "next/server";
import {
  companyBrainApiFailure,
  companyBrainJson,
} from "@/lib/ops/company-brain-api";
import { authorizeCompanyBrainActor, type CompanyBrainActor } from "@/lib/ops/company-brain-access";
import { resolveCompanyBrain, type CompanyBrainResolveInput } from "@/lib/ops/company-brain";
import { generateCompanyBrainIntelligenceBrief } from "@/lib/ops/company-brain-ai-brief";
import { correlateCompanyBrainResult } from "@/lib/ops/company-brain-identity";
import { persistCompanyBrainCaseIncidents } from "@/lib/ops/company-brain-operational-intelligence";
import { OpsOfferApiError } from "@/lib/ops/offers";

export const dynamic = "force-dynamic";

async function enrichResult(
  result: Awaited<ReturnType<typeof resolveCompanyBrain>>,
  actor: CompanyBrainActor,
) {
  let canonicalCase = null;
  let canonicalCaseWarning = null;
  let incidentWarning = null;
  let incidents: Awaited<ReturnType<typeof persistCompanyBrainCaseIncidents>> = [];

  const [canonicalOutcome, briefOutcome] = await Promise.allSettled([
    correlateCompanyBrainResult(result, actor.email),
    generateCompanyBrainIntelligenceBrief(result),
  ]);
  if (briefOutcome.status === "fulfilled") result.intelligenceBrief = briefOutcome.value;
  else result.intelligenceBrief = {
    status: "fallback",
    headline: result.employeeGuidance.resolutionLabel,
    diagnosis: result.problemResolution.rootCause,
    why: result.employeeGuidance.evidenceBullets.slice(0, 4),
    uncertainties: result.employeeGuidance.blockerBullets.slice(0, 4),
    evidenceIds: [],
    nextAction: null,
    customerContactPolicy: result.employeeGuidance.customerContactPolicy,
    model: null,
    generatedAt: new Date().toISOString(),
    warning: "KI-Erklärung konnte nicht erzeugt werden; regelbasierte Diagnose bleibt maßgeblich.",
  };

  if (canonicalOutcome.status === "fulfilled") canonicalCase = canonicalOutcome.value;
  else {
    console.error("company brain canonical correlation failed", canonicalOutcome.reason);
    canonicalCaseWarning = "canonical_case_correlation_failed";
  }

  try {
    incidents = await persistCompanyBrainCaseIncidents({
      result,
      actor,
      entityId: canonicalCase?.entityId || null,
    });
  } catch (error) {
    console.error("company brain incident persistence failed", error);
    incidentWarning = "incident_persistence_failed";
  }
  return { canonicalCase, canonicalCaseWarning, incidents, incidentWarning };
}

function failureResponse(error: unknown) {
  if (error instanceof OpsOfferApiError) {
    return companyBrainJson({ ok: false, error: error.message, code: error.code, issues: error.issues }, { status: error.status });
  }
  return companyBrainApiFailure(error, "resolve");
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCompanyBrainActor(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as CompanyBrainResolveInput;
    const result = await resolveCompanyBrain(body);
    const enrichment = await enrichResult(result, auth.actor);
    return companyBrainJson({ ok: true, result, ...enrichment });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCompanyBrainActor(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await resolveCompanyBrain({
      query: request.nextUrl.searchParams.get("query") || "",
      question: request.nextUrl.searchParams.get("question") || null,
      limit: Number(request.nextUrl.searchParams.get("limit") || 5),
    });
    const enrichment = await enrichResult(result, auth.actor);
    return companyBrainJson({ ok: true, result, ...enrichment });
  } catch (error) {
    return failureResponse(error);
  }
}
