import { NextRequest } from "next/server";
import { authorizeCompanyBrainRequest, companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { getCompanyBrainFoundationOverview, resolveCompanyEntityAlias } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  try {
    return companyBrainJson({ ok: true, result: await getCompanyBrainFoundationOverview() });
  } catch (error) {
    return companyBrainApiFailure(error, "foundation-overview");
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const result = await resolveCompanyEntityAlias(await request.json());
    return companyBrainJson({ ok: true, result, matched: Boolean(result) });
  } catch (error) {
    return companyBrainApiFailure(error, "identity-resolution");
  }
}
