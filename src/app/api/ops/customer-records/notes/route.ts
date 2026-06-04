import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { addCustomerOpsNote } from "@/lib/ops/customer-records";
import { createOpsInternalTask, type OpsInternalTask } from "@/lib/ops/internal-tasks";
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

  console.error("ops customer-records notes route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function taskTitleFromNote(note: string) {
  const firstLine = note.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "Customer-Records-Aufgabe";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      requestId?: string;
      note?: string;
      kind?: "note" | "task" | "update";
      assigneeLabel?: string | null;
      operatorName?: string | null;
    };

    const note = await addCustomerOpsNote(
      String(body.requestId || ""),
      {
        note: String(body.note || ""),
        kind: body.kind,
        assigneeLabel: body.assigneeLabel,
      },
      {
        host,
        mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
        userAgent: request.headers.get("user-agent"),
      },
    );

    let task: OpsInternalTask | null = null;
    let taskError: string | null = null;

    if (body.kind === "task") {
      try {
        task = await createOpsInternalTask(
          {
            title: taskTitleFromNote(String(body.note || "")),
            description: String(body.note || ""),
            status: "open",
            priority: "normal",
            category: "customer",
            assigneeLabel: body.assigneeLabel || null,
            requestId: String(body.requestId || ""),
            sourceApp: "customer_records",
            sourceRef: note.id,
            metadata: {
              note_id: note.id,
              note_kind: "task",
            },
          },
          { operatorName: body.operatorName || null },
        );
      } catch (error) {
        taskError = error instanceof Error ? error.message : "Aufgabe konnte nicht im Aufgabenboard angelegt werden.";
        console.error("customer note saved but internal task creation failed", error);
      }
    }

    return NextResponse.json({ ok: true, note, task, taskError });
  } catch (error) {
    return failureResponse(error);
  }
}
