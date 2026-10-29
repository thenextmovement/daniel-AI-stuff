import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, readVoiceCopilotJson, resolveVoiceCopilotActor, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { listVoicePlatformCollection, listVoicePlatformDashboard, runVoicePlatformAdminAction } from "@/lib/ops/voice-platform-data";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  try {
    if (request.nextUrl.searchParams.has("collection")) {
      const params = request.nextUrl.searchParams;
      const filterValues = {
        id: params.get("id"), status: params.get("status"), mode: params.get("mode"),
        lifecycle: params.get("lifecycle"), evalStatus: params.get("evalStatus"), enabled: params.get("enabled"),
        campaignId: params.get("campaignId"), requestId: params.get("requestId"), offerId: params.get("offerId"),
        consentId: params.get("consentId"), targetId: params.get("targetId"), attemptId: params.get("attemptId"),
        modelReleaseId: params.get("modelReleaseId"), promptVersionId: params.get("promptVersionId"),
        outcomeCode: params.get("outcomeCode"), phone: params.get("phone"),
      };
      for (const name of params.keys()) {
        if (!["collection", "limit", "offset"].includes(name) && !Object.prototype.hasOwnProperty.call(filterValues, name)) {
          throw new QuoteValidationError("Unbekannter Voice-Platform-Filter.", ["invalid_collection_filter"], 422);
        }
      }
      const filters = Object.fromEntries(Object.entries(filterValues).filter((entry): entry is [string, string] => entry[1] !== null));
      return NextResponse.json({ ok: true, ...await listVoicePlatformCollection({
        collection: request.nextUrl.searchParams.get("collection") || "",
        limit: request.nextUrl.searchParams.has("limit") ? Number(request.nextUrl.searchParams.get("limit")) : undefined,
        offset: request.nextUrl.searchParams.has("offset") ? Number(request.nextUrl.searchParams.get("offset")) : undefined,
        filters,
      }) });
    }
    if (request.nextUrl.searchParams.size) {
      throw new QuoteValidationError("Filter und Paginierung brauchen eine Sammlung.", ["missing_collection"], 422);
    }
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
