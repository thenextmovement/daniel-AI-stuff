import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, readVoiceCopilotJson, resolveVoiceCopilotActor, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { listVoicePlatformDashboard, runVoicePlatformAdminAction } from "@/lib/ops/voice-platform-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  try {
    return NextResponse.json({ ok: true, dashboard: await listVoicePlatformDashboard() });
  } catch (error) {
    return voiceCopilotApiFailure(error, "platform-dashboard");
  }
}

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  try {
    const body = await readVoiceCopilotJson(request) as { action?: unknown; input?: unknown };
    const input = body.input && typeof body.input === "object" && !Array.isArray(body.input)
      ? body.input as Record<string, unknown>
      : {};
    const actor = await resolveVoiceCopilotActor(request);
    if (!actor) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    const result = await runVoicePlatformAdminAction(body.action, { ...input, actor });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return voiceCopilotApiFailure(error, "platform-action");
  }
}
