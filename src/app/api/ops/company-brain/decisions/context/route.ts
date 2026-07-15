import { NextRequest } from "next/server";
import { authorizeCompanyBrainRequest, companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { searchActiveCompanyDecisions } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const decisions = await searchActiveCompanyDecisions(await request.json());
    return companyBrainJson({ ok: true, decisions });
  } catch (error) {
    return companyBrainApiFailure(error, "decision-context");
  }
}
