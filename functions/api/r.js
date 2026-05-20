// =============================================================================
// NEONTRIP — Form Failure Report Receiver (Cloudflare Pages Function)
// =============================================================================
// Route: POST https://anfrage.neontrip.de/api/r
//
// Purpose: Same-origin receiver for failure beacons sent by:
//   1. The client-side fail-loud banner (window.ntReportSubmitFailure)
//   2. The lead-intake Pages Function when upstream n8n errors
//
// Forwards the JSON payload to the n8n workflow that sends an alert email
// to info@neontrip.de so Daniel learns about failed form submissions
// within seconds rather than hours/days.
//
// Deployed 2026-04-09 alongside the lead-intake proxy.
// =============================================================================

const N8N_FAIL_REPORT_WEBHOOK = "https://fuajob.online/webhook/r";
const UPSTREAM_TIMEOUT_MS = 10000; // beacons are tiny — 10s is plenty

const ALLOWED_ORIGINS = new Set([
  "https://anfrage.neontrip.de",
  "https://neontrip-lp.pages.dev",
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://anfrage.neontrip.de";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || ""),
  });
}

export async function onRequest({ request }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, OPTIONS" },
    });
  }
  return handlePost(request);
}

export async function onRequestPost(ctx) {
  return handlePost(ctx.request);
}

async function handlePost(request) {
  const origin = request.headers.get("Origin") || "https://anfrage.neontrip.de";
  const cors = corsHeaders(origin);

  // Always respond OK to the client — beacon delivery is best-effort.
  // We never want to surface our own errors to the customer; the client-side
  // banner has already handled their UX.
  const okResponse = new Response('{"ok":true}', {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors,
    },
  });

  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    return okResponse;
  }

  // Enrich with Cloudflare context so the alert email can tell Daniel
  // where the user was (country, device).
  const cf = request.cf || {};
  let enriched;
  try {
    const parsed = JSON.parse(bodyText || "{}");
    enriched = {
      ...parsed,
      cf_country: cf.country || null,
      cf_city: cf.city || null,
      cf_colo: cf.colo || null,
      proxy_ip: request.headers.get("CF-Connecting-IP") || null,
      received_at: new Date().toISOString(),
    };
  } catch {
    // Body wasn't JSON — wrap it so n8n still gets something structured
    enriched = {
      raw: bodyText.slice(0, 2000),
      received_at: new Date().toISOString(),
    };
  }

  // Synthetic deploy smoke test. Confirms /api/r exists and parses JSON
  // without sending an operational alert.
  if (enriched.nt_dry_run === "1") {
    return new Response('{"ok":true,"dry_run":true}', {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...cors,
      },
    });
  }

  // Forward to n8n with short timeout. Any error here is logged
  // but not returned to the client.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(N8N_FAIL_REPORT_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxied-By": "neontrip-lp-pages-function/1.0",
      },
      body: JSON.stringify(enriched),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      console.error(
        `[r] n8n returned HTTP ${upstream.status}`
      );
    } else {
      console.log(
        `[r] forwarded form=${enriched.form || "?"} error=${enriched.error || "?"}`
      );
    }
  } catch (err) {
    console.error(
      "[r] forward to n8n failed:",
      err && err.message
    );
  } finally {
    clearTimeout(timeoutId);
  }

  return okResponse;
}
