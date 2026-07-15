import { NextRequest } from "next/server";
import { authorizeCompanyBrainRequest, companyBrainApiFailure, companyBrainJson, requireIdentifiedCompanyBrainActor } from "@/lib/ops/company-brain-api";
import { reviewCompanyDecision } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ decisionId: string }> }) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  const actorError = requireIdentifiedCompanyBrainActor(auth);
  if (actorError) return actorError;
  try {
    const { decisionId } = await context.params;
    const decision = await reviewCompanyDecision({ ...(await request.json()), decisionId, actor: auth.actor });
    return companyBrainJson({ ok: true, decision });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-review");
  }
}
