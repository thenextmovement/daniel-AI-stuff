import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { listCompanyBrainActionRuns } from "@/lib/ops/company-brain-action-governance";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["operator"]);
  if (roleError) return roleError;
  try {
    const runs = await listCompanyBrainActionRuns(
      request.nextUrl.searchParams.get("status"),
      request.nextUrl.searchParams.get("limit"),
    );
    return companyBrainJson({
      ok: true,
      actor: { email: access.actor.email, roles: access.actor.roles },
      runs,
    });
  } catch (error) {
    return companyBrainApiFailure(error, "action-run-list");
  }
}
