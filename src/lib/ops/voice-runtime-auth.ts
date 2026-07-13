import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function digest(value: string) {
  return createHash("sha256").update(`neontrip:voice-runtime:${value}`).digest();
}

function safeEqual(left: string, right: string) {
  const leftDigest = digest(left);
  const rightDigest = digest(right);
  return leftDigest.length === rightDigest.length && timingSafeEqual(leftDigest, rightDigest);
}

export function authorizeVoiceRuntimeRequest(request: NextRequest) {
  const configured = String(process.env.VOICE_RUNTIME_API_TOKEN || "").trim();
  if (!configured) {
    return NextResponse.json({ ok: false, error: "voice_runtime_auth_not_configured" }, { status: 503 });
  }
  const authorization = String(request.headers.get("authorization") || "");
  const candidate = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if (!candidate || !safeEqual(candidate, configured)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
