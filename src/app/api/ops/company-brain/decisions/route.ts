import { NextRequest } from "next/server";
import { authorizeCompanyBrainRequest, companyBrainApiFailure, companyBrainJson, requireIdentifiedCompanyBrainActor } from "@/lib/ops/company-brain-api";
import { createCompanyDecisionDraft, listCompanyDecisions } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const decisions = await listCompanyDecisions(request.nextUrl.searchParams.get("status"));
    return companyBrainJson({ ok: true, decisions });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-list");
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  const actorError = requireIdentifiedCompanyBrainActor(auth);
  if (actorError) return actorError;
  try {
    const decision = await createCompanyDecisionDraft({ ...(await request.json()), createdBy: auth.actor });
    return companyBrainJson({ ok: true, decision }, { status: 201 });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-create");
  }
}
