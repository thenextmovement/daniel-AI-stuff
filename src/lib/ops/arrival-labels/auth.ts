import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isAuthorized(headers: Headers, candidates: string[]) {
  const bearer = (headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!bearer) return false;
  const bearerDigest = digest(bearer);
  let authorized = false;
  for (const candidate of candidates.filter((value) => value.length >= 24)) {
    authorized = timingSafeEqual(digest(candidate), bearerDigest) || authorized;
  }
  return authorized;
}

export function isArrivalLabelsRequestAuthorized(headers: Headers) {
  return isAuthorized(headers, [String(process.env.ARRIVAL_LABEL_AGENT_API_TOKEN || "").trim()]);
}

export function isArrivalLabelsRunRequestAuthorized(headers: Headers) {
  return isAuthorized(headers, [
    String(process.env.ARRIVAL_LABEL_AGENT_API_TOKEN || "").trim(),
    String(process.env.ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN || "").trim(),
  ]);
}

export function isArrivalPrintWorkerAuthorized(headers: Headers) {
  const expected = String(process.env.ARRIVAL_LABEL_PRINT_API_TOKEN || "").trim();
  const bearer = (headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (expected.length < 32 || !bearer) return false;
  return timingSafeEqual(digest(expected), digest(bearer));
}
