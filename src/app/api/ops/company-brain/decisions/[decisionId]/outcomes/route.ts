import { NextRequest } from "next/server";
import { authorizeCompanyBrainRequest, companyBrainApiFailure, companyBrainJson, requireIdentifiedCompanyBrainActor } from "@/lib/ops/company-brain-api";
import { listCompanyDecisionOutcomes, recordCompanyDecisionOutcome } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ decisionId: string }> }) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const { decisionId } = await context.params;
    return companyBrainJson({ ok: true, outcomes: await listCompanyDecisionOutcomes(decisionId) });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-outcomes-list");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ decisionId: string }> }) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  const actorError = requireIdentifiedCompanyBrainActor(auth);
  if (actorError) return actorError;
  try {
    const { decisionId } = await context.params;
    const outcome = await recordCompanyDecisionOutcome({ ...(await request.json()), decisionId, recordedBy: auth.actor });
    return companyBrainJson({ ok: true, outcome }, { status: 201 });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-outcome");
  }
}
