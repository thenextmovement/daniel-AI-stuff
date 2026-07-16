import { NextRequest } from "next/server";
import { authorizeCompanyBrainActor, requireCompanyBrainRole } from "@/lib/ops/company-brain-access";
import { companyBrainApiFailure, companyBrainJson } from "@/lib/ops/company-brain-api";
import {
  listCompanyBrainTrelloAliasRepairs,
  repairCompanyBrainTrelloAlias,
  type CompanyBrainAliasRepairInput,
} from "@/lib/ops/company-brain-alias-repair";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

type AliasRepairPostBody = CompanyBrainAliasRepairInput & {
  confirmed?: boolean;
  confirmationText?: string | null;
};

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return companyBrainJson({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  return companyBrainApiFailure(error, "trello-alias");
}

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function requireConfirmation(body: AliasRepairPostBody) {
  if (!body.confirmed) {
    throw new QuoteValidationError("Bestätigung erforderlich.", ["Die Alias-Reparatur muss vor Ausführung bestätigt werden."], 422);
  }
  const confirmation = cleanText(body.confirmationText, 80).toLowerCase();
  if (confirmation !== "freigabe") {
    throw new QuoteValidationError("Bestätigungstext fehlt.", ["Bitte mit 'Freigabe' bestätigen."], 422);
  }
}

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeCompanyBrainActor(request);
    if (!access.ok) return access.response;
    const roleError = requireCompanyBrainRole(access.actor, ["operator"]);
    if (roleError) return roleError;
    const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const items = await listCompanyBrainTrelloAliasRepairs(Number.isFinite(limit) ? limit : 50);
    return companyBrainJson({ ok: true, items, generatedAt: new Date().toISOString() });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await authorizeCompanyBrainActor(request);
    if (!access.ok) return access.response;
    const roleError = requireCompanyBrainRole(access.actor, ["approver"]);
    if (roleError) return roleError;
    const body = await request.json().catch(() => ({})) as AliasRepairPostBody;
    requireConfirmation(body);
    const repair = await repairCompanyBrainTrelloAlias({ ...body, operatorName: access.actor.email });
    return companyBrainJson({
      ok: true,
      repair,
      customerCommunicationSent: false,
    });
  } catch (error) {
    return failureResponse(error);
  }
}
