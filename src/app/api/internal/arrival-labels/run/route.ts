import { NextRequest, NextResponse } from "next/server";
import { isArrivalLabelsRequestAuthorized } from "@/lib/ops/arrival-labels/auth";
import { arrivalRunMarkdown } from "@/lib/ops/arrival-labels/report";
import { runArrivalLabels } from "@/lib/ops/arrival-labels/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  localDate?: string;
  mode?: "dry_run" | "execute";
  persist?: boolean;
  triggerType?: "manual_api" | "n8n_schedule";
};

export async function POST(request: NextRequest) {
  if (!isArrivalLabelsRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as RequestBody;
  if (body.mode && !["dry_run", "execute"].includes(body.mode)) {
    return NextResponse.json({ ok: false, error: "invalid_mode" }, { status: 400 });
  }
  try {
    const result = await runArrivalLabels({
      localDate: body.localDate,
      mode: body.mode || "dry_run",
      persist: body.persist === true,
      triggerType: body.triggerType === "n8n_schedule" ? "n8n_schedule" : "manual_api",
    });
    return NextResponse.json({ ok: true, result, report: arrivalRunMarkdown(result) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    console.error("arrival labels run failed", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: "arrival_labels_failed", message }, { status: 500 });
  }
}
