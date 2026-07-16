import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { reviewCompanyDecision } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ decisionId: string }> }) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  try {
    const { decisionId } = await context.params;
    const body = await request.json();
    const requiredRole = body.action === "approve" ? "approver" : "operator";
    const roleError = requireCompanyBrainRole(access.actor, [requiredRole]);
    if (roleError) return roleError;
    const decision = await reviewCompanyDecision({ ...body, decisionId, actor: access.actor.email });
    return companyBrainJson({ ok: true, decision });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-review");
  }
}
