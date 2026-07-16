import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { createCompanyDecisionDraft, listCompanyDecisions } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  try {
    const decisions = await listCompanyDecisions(request.nextUrl.searchParams.get("status"));
    return companyBrainJson({ ok: true, decisions });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-list");
  }
}

export async function POST(request: NextRequest) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["operator"]);
  if (roleError) return roleError;
  try {
    const decision = await createCompanyDecisionDraft({ ...(await request.json()), createdBy: access.actor.email });
    return companyBrainJson({ ok: true, decision }, { status: 201 });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-create");
  }
}
