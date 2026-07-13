import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "neontrip-ops",
    commit: String(process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || "unknown"),
    voiceCallPlatformConfigured: String(process.env.VOICE_CALL_PLATFORM_ENABLED || "").toLowerCase() === "true",
  }, { headers: { "cache-control": "no-store" } });
}
