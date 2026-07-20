import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isArrivalLabelsRequestAuthorized(headers: Headers) {
  const expected = String(process.env.ARRIVAL_LABEL_AGENT_API_TOKEN || "").trim();
  const bearer = (headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (expected.length < 24 || !bearer) return false;
  return timingSafeEqual(digest(expected), digest(bearer));
}
