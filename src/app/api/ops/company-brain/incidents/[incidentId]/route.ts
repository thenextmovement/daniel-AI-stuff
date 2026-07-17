import { NextRequest } from "next/server";
import {
  authorizeCompanyBrainActor,
  hasCompanyBrainRole,
  requireCompanyBrainRole,
} from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import { transitionCompanyBrainOperationalIncident } from "@/lib/ops/company-brain-operational-intelligence";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
) {
  const access = await authorizeCompanyBrainActor(request);
  if (!access.ok) return access.response;
  const roleError = requireCompanyBrainRole(access.actor, ["operator"]);
  if (roleError) return roleError;
  try {
    const body = (await request.json().catch(() => ({}))) as { status?: unknown; note?: unknown; assignedTo?: unknown };
    const status = String(body.status || "").toLowerCase();
    if (status === "ignored"
      && !hasCompanyBrainRole(access.actor, "automation_admin")
      && !hasCompanyBrainRole(access.actor, "company_admin")) {
      throw new QuoteValidationError("Nur Automation Admins dürfen Incidents ignorieren.", ["automation_admin_required"], 403);
    }
    const actorCanOwnIncident = /^[^\s@]+@neontrip\.de$/i.test(access.actor.email);
    const assignedTo = body.assignedTo
      ?? (status === "acknowledged" && actorCanOwnIncident ? access.actor.email : null);
    const { incidentId } = await context.params;
    const incident = await transitionCompanyBrainOperationalIncident({
      incidentId,
      status,
      actor: access.actor,
      note: body.note,
      assignedTo,
    });
    return companyBrainJson({ ok: true, incident });
  } catch (error) {
    return companyBrainApiFailure(error, "incident-transition");
  }
}
