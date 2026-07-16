import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { listCompanyIdentityReviews } from "@/lib/ops/company-brain-identity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["operator"]);
  if (roleError) return roleError;
  try {
    const reviews = await listCompanyIdentityReviews(
      request.nextUrl.searchParams.get("status"),
      request.nextUrl.searchParams.get("limit"),
    );
    return companyBrainJson({ ok: true, reviews });
  } catch (error) {
    return companyBrainApiFailure(error, "identity-review-list");
  }
}
