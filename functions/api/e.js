// =============================================================================
// NEONTRIP — Optional Lead Context Enrichment (Cloudflare Pages Function)
// =============================================================================
// Route: POST https://anfrage.neontrip.de/api/e
//
// Updates an already accepted lead by its stable request_id. The database is
// the source of truth; Trello may only be updated by the downstream workflow
// after the database upsert succeeded.
// =============================================================================

const UPSTREAM_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 12 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://anfrage.neontrip.de",
  "https://neontrip-lp.pages.dev",
]);
const ALLOWED_STATUSES = new Set(["completed", "skipped", "timeout", "abandoned"]);
const ALLOWED_REQUESTER_TYPES = new Set([
  "Eigenes Unternehmen",
  "Kundenprojekt",
  "Verein oder Organisation",
  "Privat",
]);
const ALLOWED_CONTEXTS = new Set([
  "Büro, Empfang oder Innenwand",
  "Fassade oder Außenbereich",
  "Laden oder Showroom",
  "Gastronomie oder Hotel",
  "Praxis, Kanzlei oder Studio",
  "Vereinsheim oder Organisation",
  "Messe oder Event",
  "Privater Raum",
  "Anderer Einsatzort",
]);
const ALLOWED_PRIORITIES = new Set([
  "Möglichst genaue Umsetzung unserer Marke/CI",
  "Möglichst günstiger Preis",
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://anfrage.neontrip.de";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function cleanText(value, maxLength) {
  if (value == null || value === "") return null;
  return String(value).replace(/\u0000/g, "").trim().slice(0, maxLength) || null;
}

function allowedOrNull(value, allowed) {
  const cleaned = cleanText(value, 200);
  if (cleaned == null) return null;
  return allowed.has(cleaned) ? cleaned : undefined;
}

function validReference(value) {
  const cleaned = cleanText(value, 500);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function validToken(secret, requestId, token) {
  if (!secret || !token) return false;
  const [expiresRaw, signatureRaw, extra] = String(token).split(".");
  if (extra || !/^\d{10}$/.test(expiresRaw || "") || !signatureRaw) return false;
  const expiresAt = Number(expiresRaw);
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt < now || expiresAt > now + 20 * 60) return false;
  let signature;
  try { signature = decodeBase64Url(signatureRaw); } catch { return false; }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(`${requestId}.${expiresAt}`)
  );
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || ""),
  });
}

export async function onRequest() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST, OPTIONS" },
  });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get("Origin") || "https://anfrage.neontrip.de";
  const cors = corsHeaders(origin);
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "body_too_large" }, 413, cors);

  let raw;
  let input;
  try {
    raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new Error("body_too_large");
    input = JSON.parse(raw || "{}");
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message === "body_too_large" ? "body_too_large" : "invalid_json" }, error.message === "body_too_large" ? 413 : 400, cors);
  }

  if (input.nt_dry_run === "1") {
    return jsonResponse({ ok: true, dry_run: true }, 200, cors);
  }

  const requestId = cleanText(input.request_id, 64);
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return jsonResponse({ ok: false, error: "invalid_request_id" }, 400, cors);
  }
  if (!ALLOWED_STATUSES.has(input.enrichment_status)) {
    return jsonResponse({ ok: false, error: "invalid_status" }, 400, cors);
  }
  if (!(await validToken(env.LEAD_ENRICHMENT_SIGNING_SECRET, requestId, input.enrichment_token))) {
    return jsonResponse({ ok: false, error: "invalid_token" }, 403, cors);
  }

  const requesterType = allowedOrNull(input.requester_type, ALLOWED_REQUESTER_TYPES);
  const installationContext = allowedOrNull(input.installation_context, ALLOWED_CONTEXTS);
  const decisionPriority = allowedOrNull(input.decision_priority, ALLOWED_PRIORITIES);
  const mockupReference = validReference(input.mockup_reference);
  const landingPageUrl = validReference(input.landing_page_url);
  if ([requesterType, installationContext, decisionPriority, mockupReference, landingPageUrl].includes(undefined)) {
    return jsonResponse({ ok: false, error: "invalid_field_value" }, 400, cors);
  }

  const upstreamUrl = env.LEAD_ENRICHMENT_WEBHOOK_URL;
  const upstreamSecret = env.LEAD_ENRICHMENT_SHARED_SECRET;
  if (!upstreamUrl || !upstreamSecret) {
    console.error("[e] enrichment upstream is not configured");
    return jsonResponse({ ok: false, error: "service_not_configured" }, 503, cors);
  }

  const payload = {
    request_id: requestId,
    idempotency_key: `${requestId}:lead_context_v1`,
    enrichment_status: input.enrichment_status,
    enrichment_version: "lead_context_v1",
    requester_type: requesterType,
    installation_context: installationContext,
    decision_priority: decisionPriority,
    mockup_setting: cleanText(input.mockup_setting, 1000),
    mockup_reference: mockupReference,
    intent_id: cleanText(input.intent_id, 80),
    lp_variant: cleanText(input.lp_variant, 80),
    landing_page_url: landingPageUrl,
    received_at: new Date().toISOString(),
    cf_country: request.cf?.country || null,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NEONTRIP-Webhook-Secret": upstreamSecret,
        "X-Idempotency-Key": payload.idempotency_key,
        "X-Proxied-By": "neontrip-lp-pages-function/1.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      console.error(`[e ${requestId}] upstream HTTP ${upstream.status}`);
      return jsonResponse({ ok: false, error: "upstream_rejected" }, 502, cors);
    }
    return jsonResponse({ ok: true, request_id: requestId, status: input.enrichment_status }, 200, cors);
  } catch (error) {
    console.error(`[e ${requestId}] upstream failed`, error && error.message);
    return jsonResponse({ ok: false, error: error?.name === "AbortError" ? "upstream_timeout" : "upstream_unreachable" }, 502, cors);
  } finally {
    clearTimeout(timeoutId);
  }
}
