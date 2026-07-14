import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  applyCustomerCaseOutcome,
  blockCustomerContact,
  logCustomerCall,
  pausePendingCustomerFollowups,
  repairCustomerDownstreamSync,
  reportCustomerSpecialCase,
  reschedulePendingCustomerFollowups,
  resolveCustomerSpecialCase,
  rollbackLastCustomerRecordUpdate,
  scheduleCustomerCallback,
  setCustomerRequestSegment,
  setCustomerCaseFlowState,
  startCustomerSalesRecovery,
  type CustomerCaseFlowStateInput,
  type CustomerCaseOutcomeInput,
  type CustomerSpecialCaseInput,
  setCustomerCaseTeamState,
  setCustomerWorkboardState,
  type CustomerCallLogInput,
  type CustomerTeamStateInput,
  type CustomerWorkboardStateInput,
  type UpdateActor,
} from "@/lib/ops/customer-records";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message, issues: error.issues },
      { status: error.status },
    );
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json(
      { ok: false, error: error.message, details: error.details },
      { status: error.status },
    );
  }

  console.error("ops customer-records actions route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      requestId?: string;
      action?: "rollback_last_update" | "pause_pending_followups" | "reschedule_pending_followups" | "block_customer_contact" | "log_customer_call" | "schedule_callback" | "workboard_handled" | "workboard_snoozed" | "apply_case_outcome" | "set_case_team_state" | "set_case_flow_state" | "set_request_segment" | "repair_downstream_sync" | "start_sales_recovery" | "report_special_case" | "resolve_special_case";
      resumeAt?: string;
      reason?: string;
      segment?: string;
      operatorName?: string;
      call?: CustomerCallLogInput;
      workboard?: CustomerWorkboardStateInput;
      outcome?: CustomerCaseOutcomeInput;
      teamState?: CustomerTeamStateInput;
      flowState?: CustomerCaseFlowStateInput;
      specialCase?: CustomerSpecialCaseInput;
    };

    const actor: UpdateActor = {
      host,
      mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
      userAgent: request.headers.get("user-agent"),
      operatorName: body.operatorName || null,
    };

    if (body.action === "rollback_last_update") {
      const result = await rollbackLastCustomerRecordUpdate(String(body.requestId || ""), actor);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "pause_pending_followups") {
      const result = await pausePendingCustomerFollowups(String(body.requestId || ""), actor, body.reason);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "repair_downstream_sync") {
      const result = await repairCustomerDownstreamSync(String(body.requestId || ""), actor);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "start_sales_recovery") {
      const result = await startCustomerSalesRecovery(String(body.requestId || ""), actor, body.reason);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "report_special_case") {
      const result = await reportCustomerSpecialCase(
        String(body.requestId || ""),
        body.specialCase || { kind: "other", note: body.reason || null },
        actor,
      );
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "resolve_special_case") {
      const result = await resolveCustomerSpecialCase(String(body.requestId || ""), body.reason, actor);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "reschedule_pending_followups") {
      const result = await reschedulePendingCustomerFollowups(
        String(body.requestId || ""),
        String(body.resumeAt || ""),
        actor,
        body.reason,
      );
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "block_customer_contact") {
      const result = await blockCustomerContact(String(body.requestId || ""), actor, body.reason);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "log_customer_call") {
      const result = await logCustomerCall(String(body.requestId || ""), body.call || {
        reached: false,
        leftVoicemail: false,
        customerOnVacation: false,
        askedForCallback: false,
        noInterest: false,
        emailConfirmed: false,
        offerDiscussed: false,
        whatsappPreferred: false,
        deleteRequested: false,
        note: null,
      }, actor);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "schedule_callback") {
      const result = await scheduleCustomerCallback(
        String(body.requestId || ""),
        String(body.resumeAt || ""),
        actor,
        body.reason,
      );
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "set_request_segment") {
      const result = await setCustomerRequestSegment(String(body.requestId || ""), String(body.segment || ""), actor);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "workboard_handled") {
      const result = await setCustomerWorkboardState(String(body.requestId || ""), {
        state: "handled",
        reason: body.reason || body.workboard?.reason || null,
      }, actor);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "workboard_snoozed") {
      const result = await setCustomerWorkboardState(String(body.requestId || ""), {
        state: "snoozed",
        snoozeUntil: body.resumeAt || body.workboard?.snoozeUntil || null,
        reason: body.reason || body.workboard?.reason || null,
      }, actor);
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "apply_case_outcome") {
      const result = await applyCustomerCaseOutcome(
        String(body.requestId || ""),
        {
          outcome: body.outcome?.outcome || "callback",
          resumeAt: body.resumeAt || body.outcome?.resumeAt || null,
          reason: body.reason || body.outcome?.reason || null,
        },
        actor,
      );
      return NextResponse.json({ ok: true, action: body.action, outcome: body.outcome?.outcome || "callback", ...result });
    }

    if (body.action === "set_case_team_state") {
      const result = await setCustomerCaseTeamState(
        String(body.requestId || ""),
        body.teamState || { mode: "clear" },
        actor,
      );
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    if (body.action === "set_case_flow_state") {
      const result = await setCustomerCaseFlowState(
        String(body.requestId || ""),
        body.flowState || { state: "started" },
        actor,
      );
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return failureResponse(error);
  }
}
