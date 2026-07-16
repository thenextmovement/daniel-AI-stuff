import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { reviewCompanyIdentity } from "@/lib/ops/company-brain-identity";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ reviewId: string }> }) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["approver"]);
  if (roleError) return roleError;
  try {
    const { reviewId } = await context.params;
    const body = await request.json();
    const review = await reviewCompanyIdentity({
      reviewId,
      decision: body.decision,
      note: body.note,
      actor: access.actor.email,
    });
    return companyBrainJson({ ok: true, review });
  } catch (error) {
    return companyBrainApiFailure(error, "identity-review");
  }
}
