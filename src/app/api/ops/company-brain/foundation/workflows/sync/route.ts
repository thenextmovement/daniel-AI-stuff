import { NextRequest } from "next/server";
import { authorizeCompanyBrainRequest, companyBrainApiFailure, companyBrainJson, requireIdentifiedCompanyBrainActor } from "@/lib/ops/company-brain-api";
import { syncN8nWorkflowRegistry } from "@/lib/ops/company-brain-foundation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth.response;
  const actorError = requireIdentifiedCompanyBrainActor(auth);
  if (actorError) return actorError;
  try {
    const result = await syncN8nWorkflowRegistry({ ...(await request.json()), actor: auth.actor });
    return companyBrainJson({ ok: true, result });
  } catch (error) {
    return companyBrainApiFailure(error, "workflow-registry-sync");
  }
}
