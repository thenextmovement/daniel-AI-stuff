import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import {
  listCompanyBrainOperationalIncidents,
  listCompanyBrainPlaybooks,
  scanCompanyBrainOperationalIncidents,
} from "@/lib/ops/company-brain-operational-intelligence";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["operator"]);
  if (roleError) return roleError;
  try {
    const [incidents, playbooks] = await Promise.all([
      listCompanyBrainOperationalIncidents({
        status: request.nextUrl.searchParams.get("status"),
        severity: request.nextUrl.searchParams.get("severity"),
        limit: request.nextUrl.searchParams.get("limit"),
      }),
      listCompanyBrainPlaybooks(),
    ]);
    return companyBrainJson({ ok: true, incidents, playbooks });
  } catch (error) {
    return companyBrainApiFailure(error, "incident-list");
  }
}

export async function POST(request: NextRequest) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["operator"]);
  if (roleError) return roleError;
  try {
    const scan = await scanCompanyBrainOperationalIncidents();
    const incidents = await listCompanyBrainOperationalIncidents({ status: "active", limit: 200 });
    return companyBrainJson({ ok: true, scan, incidents });
  } catch (error) {
    return companyBrainApiFailure(error, "incident-scan");
  }
}
