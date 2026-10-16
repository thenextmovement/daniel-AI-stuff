export async function readJson(request: Request, limit = 8192): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("invalid_content_type");
  if (!request.body || Number(request.headers.get("content-length") || 0) > limit) throw new Error("invalid_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error("body_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export const NO_CACHE = { "Cache-Control": "no-store" };
// Shopify custom pixels use an opaque sandbox origin. CORS does not authenticate callers;
// all public values are untrusted and must match a later authenticated Shopify order.
const ORIGINS = new Set(["null", "https://www.neontrip.de", "https://neontrip.de", "https://galaxybuzzdk.myshopify.com", "https://checkout.neontrip.de"]);
export function cors(request: Request) {
  const origin = request.headers.get("origin");
  return origin && ORIGINS.has(origin) ? { ...NO_CACHE, "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } : null;
}
