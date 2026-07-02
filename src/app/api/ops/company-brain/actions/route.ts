import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  addCustomerOpsNote,
  getCustomerRecordByRequestId,
  reportCustomerSpecialCase,
  type CustomerSpecialCaseKind,
  type UpdateActor,
} from "@/lib/ops/customer-records";
import { createOpsInternalTask } from "@/lib/ops/internal-tasks";
import {
  normalizeCompanyBrainProblemType,
  type CompanyBrainProblemType,
} from "@/lib/ops/company-brain";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

type CompanyBrainActionKey = "open_problem_case" | "create_internal_task" | "save_case_note";

type CompanyBrainActionInput = {
  actionKey?: CompanyBrainActionKey;
  requestId?: string;
  problemType?: CompanyBrainProblemType | null;
  specialCaseKind?: CustomerSpecialCaseKind | null;
  title?: string | null;
  description?: string | null;
  note?: string | null;
  operatorName?: string | null;
  assigneeLabel?: string | null;
  dueAt?: string | null;
  urgent?: boolean | null;
  confirmed?: boolean;
  confirmationText?: string | null;
};

const ALLOWED_SPECIAL_CASE_KINDS: CustomerSpecialCaseKind[] = [
  "gift",
  "replacement",
  "dimmer_defect",
  "power_supply",
  "open_question",
  "other",
];

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }
  console.error("ops company-brain action route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function authorize(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: notConfigured(), host };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: unauthorized(), host };
  }
  return { ok: true as const, host };
}

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeActionKey(value: unknown): CompanyBrainActionKey {
  if (value === "open_problem_case" || value === "create_internal_task" || value === "save_case_note") return value;
  throw new QuoteValidationError("Unbekannte Company-Brain-Aktion.", ["Diese Aktion ist nicht freigegeben."], 422);
}

function normalizeSpecialCaseKind(value: unknown): CustomerSpecialCaseKind {
  return ALLOWED_SPECIAL_CASE_KINDS.includes(value as CustomerSpecialCaseKind) ? value as CustomerSpecialCaseKind : "open_question";
}

function requireConfirmation(body: CompanyBrainActionInput) {
  if (!body.confirmed) {
    throw new QuoteValidationError("Bestätigung erforderlich.", ["Die Aktion muss vor Ausführung bestätigt werden."], 422);
  }
  const confirmation = cleanText(body.confirmationText, 80).toLowerCase();
  if (confirmation !== "freigabe") {
    throw new QuoteValidationError("Bestätigungstext fehlt.", ["Bitte mit 'Freigabe' bestätigen."], 422);
  }
}

function sourceRefFor(actionKey: CompanyBrainActionKey, requestId: string, problemType: CompanyBrainProblemType | null) {
  const raw = `company-brain:${actionKey}:${requestId}:${problemType || "none"}:v1`;
  return `company-brain:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function problemTypeLabel(problemType: CompanyBrainProblemType | null) {
  switch (problemType) {
    case "color_dispute":
      return "Farbkonflikt";
    case "damaged_sign":
      return "Schild beschädigt/defekt";
    case "offer_not_sent":
      return "Angebot nicht raus";
    case "customer_waiting":
      return "Kunde wartet";
    case "design_unclear":
      return "Design unklar";
    case "delivery_problem":
      return "Lieferproblem";
    case "payment_order_unclear":
      return "Zahlung/Bestellung unklar";
    case "automation_failed":
      return "Automation fehlgeschlagen";
    case "other":
      return "Sonstiger Problemfall";
    default:
      return "Company-Brain-Problemfall";
  }
}

function actorFor(host: string | null | undefined, request: NextRequest, operatorName: string | null): UpdateActor {
  return {
    host,
    mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
    userAgent: request.headers.get("user-agent"),
    operatorName,
  };
}

export async function POST(request: NextRequest) {
  const access = await authorize(request);
  if (!access.ok) return access.response;

  try {
    const body = (await request.json()) as CompanyBrainActionInput;
    requireConfirmation(body);

    const actionKey = normalizeActionKey(body.actionKey);
    const requestId = cleanText(body.requestId, 160);
    if (!requestId) throw new QuoteValidationError("Request-ID fehlt.", ["Ohne Request-ID wird keine Aktion ausgeführt."], 422);

    const record = await getCustomerRecordByRequestId(requestId);
    const problemType = normalizeCompanyBrainProblemType(body.problemType || null);
    const specialCaseKind = normalizeSpecialCaseKind(body.specialCaseKind);
    const operatorName = cleanText(body.operatorName, 120) || null;
    const actor = actorFor(access.host, request, operatorName);
    const sourceRef = sourceRefFor(actionKey, record.requestId, problemType);
    const title = cleanText(body.title, 160) || `${problemTypeLabel(problemType)}: ${record.requestId}`;
    const description = cleanText(body.description || body.note, 6000) || "Company-Brain-Aktion ohne Beschreibung.";
    const note = cleanText(body.note || description, 6000);

    let task = null;
    let specialCase = null;
    let savedNote = null;

    if (actionKey === "open_problem_case") {
      if (record.specialCase.status !== "open") {
        specialCase = await reportCustomerSpecialCase(
          record.requestId,
          {
            kind: specialCaseKind,
            note,
            ownerName: operatorName,
            dueAt: cleanText(body.dueAt, 80) || null,
            urgent: Boolean(body.urgent),
          },
          actor,
        );
      }
      task = await createOpsInternalTask(
        {
          title,
          description,
          status: "open",
          priority: body.urgent ? "urgent" : "high",
          category: "problem",
          assigneeLabel: cleanText(body.assigneeLabel, 120) || operatorName,
          dueAt: cleanText(body.dueAt, 80) || null,
          requestId: record.requestId,
          customerName: record.displayName || record.company || null,
          customerEmail: record.email || null,
          trelloCardId: record.request?.trelloCardId || null,
          sourceApp: "company_brain",
          sourceRef,
          metadata: {
            problem_type: problemType,
            special_case_kind: specialCaseKind,
            company_brain_action: actionKey,
          },
        },
        { operatorName },
      );
    }

    if (actionKey === "create_internal_task") {
      task = await createOpsInternalTask(
        {
          title,
          description,
          status: "open",
          priority: body.urgent ? "urgent" : "high",
          category: "problem",
          assigneeLabel: cleanText(body.assigneeLabel, 120) || operatorName,
          dueAt: cleanText(body.dueAt, 80) || null,
          requestId: record.requestId,
          customerName: record.displayName || record.company || null,
          customerEmail: record.email || null,
          trelloCardId: record.request?.trelloCardId || null,
          sourceApp: "company_brain",
          sourceRef,
          metadata: {
            problem_type: problemType,
            company_brain_action: actionKey,
          },
        },
        { operatorName },
      );
    }

    if (actionKey === "save_case_note") {
      savedNote = await addCustomerOpsNote(
        record.requestId,
        {
          note,
          kind: "note",
          assigneeLabel: cleanText(body.assigneeLabel, 120) || null,
        },
        actor,
      );
    }

    return NextResponse.json({
      ok: true,
      actionKey,
      requestId: record.requestId,
      task,
      note: savedNote,
      specialCase,
      idempotencyKey: sourceRef,
      customerCommunicationSent: false,
    });
  } catch (error) {
    return failureResponse(error);
  }
}
