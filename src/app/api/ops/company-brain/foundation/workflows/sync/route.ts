import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { syncN8nWorkflowRegistry } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["automation_admin"]);
  if (roleError) return roleError;
  try {
    const result = await syncN8nWorkflowRegistry({ ...(await request.json()), actor: access.actor.email });
    return companyBrainJson({ ok: true, result });
  } catch (error) {
    return companyBrainApiFailure(error, "workflow-registry-sync");
  }
}
