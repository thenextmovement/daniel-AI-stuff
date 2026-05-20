// =============================================================================
// NEONTRIP — LP Lead Intake Proxy (Cloudflare Pages Function)
// =============================================================================
// Route: POST https://anfrage.neontrip.de/api/c
//
// Purpose: Same-origin proxy for landing-page form submissions so that
// client-side ad blockers, corporate firewalls and TLD-blocklists cannot
// block requests to fuajob.online. The browser only ever talks to its own
// origin — we forward to n8n server-to-server from the Cloudflare edge.
//
// Deployed 2026-04-09 after customer incident at 18:29 Berlin where the
// direct fetch to fuajob.online was blocked client-side, triggering
// fail-loud banner and losing the lead (customer manually clicked
// support@neontrip.de from the banner to recover).
// =============================================================================

const UPSTREAM_URL = "https://fuajob.online/webhook/landing-anfrage";
const UPSTREAM_TIMEOUT_MS = 25000; // Pages Functions hard limit is 30s — 5s buffer
const FAIL_REPORT_PATH = "/api/r"; // same-origin, relative

// Allowed request origins for CORS. Same-origin requests don't trigger CORS
// at all, but we support OPTIONS preflights defensively in case someone
// embeds the form via iframe or calls it from a staging preview.
const ALLOWED_ORIGINS = new Set([
  "https://anfrage.neontrip.de",
  "https://neontrip-lp.pages.dev",
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://anfrage.neontrip.de";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

// Fire-and-forget error beacon to the same-origin fail-report endpoint.
// Uses ctx.waitUntil so the response returns immediately but the log finishes.
function reportFailure(ctx, origin, payload) {
  try {
    const beacon = fetch(new URL(FAIL_REPORT_PATH, origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "c-function",
        ...payload,
        ts: new Date().toISOString(),
      }),
    }).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(beacon);
    }
  } catch (_) {
    // never let the beacon itself surface
  }
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || ""),
  });
}

// Pages Functions routing: method-specific handlers (onRequestPost,
// onRequestOptions) take precedence over the generic onRequest. So POST
// always goes through onRequestPost where we receive the full context
// (ctx.waitUntil etc.). The generic onRequest is a catch-all that only
// ever sees unexpected methods — we use it to return a clean 405.
export async function onRequest() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST, OPTIONS" },
  });
}

export async function onRequestPost(ctx) {
  return handlePost(ctx.request, ctx);
}

async function handlePost(request, ctx) {
  const origin = request.headers.get("Origin") || "https://anfrage.neontrip.de";
  const cors = corsHeaders(origin);
  const requestId = crypto.randomUUID();

  // ─── Parse body ONCE as FormData ───
  // CRITICAL: Do NOT use request.clone() + streaming body forwarding. The
  // earlier implementation did that and production testing (n8n execution
  // 710604) proved it delivered an empty body to the upstream. The clone()
  // + formData() + body: request.body pattern corrupts/consumes the stream
  // in the Workers runtime in a way that leaves the forwarded body empty.
  //
  // The correct pattern: read the body once as FormData (destroying the
  // stream is fine — we no longer need it), then re-serialize the FormData
  // as the body of a new fetch. fetch() automatically encodes FormData as
  // multipart/form-data with a fresh boundary, and n8n's webhook node
  // handles multipart the same as urlencoded.
  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error(`[c ${requestId}] formdata parse failed`, err);
    return jsonResponse(
      { ok: false, error: "invalid_body", request_id: requestId },
      400,
      cors
    );
  }

  // Synthetic deploy smoke test. Verifies that the Pages Function exists,
  // accepts multipart FormData and returns JSON without creating a real lead.
  if (formData.get("nt_dry_run") === "1") {
    return jsonResponse(
      { ok: true, dry_run: true, request_id: requestId },
      200,
      { ...cors, "X-Request-Id": requestId }
    );
  }

  // ─── Honeypot: serverside spam filter ───
  // Direct bot posts that fill "website" are filtered. If the payload also
  // contains real contact fields, treat it as likely mobile/password-manager
  // autofill and forward it instead of silently losing a possible lead.
  const honeypot = formData.get("website");
  if (honeypot) {
    const hasContact =
      String(formData.get("email") || "").trim() ||
      String(formData.get("telefon") || "").trim() ||
      String(formData.get("phone") || "").trim() ||
      String(formData.get("name") || "").trim();
    if (!hasContact) {
      console.log(`[c ${requestId}] honeypot hit: "${String(honeypot).slice(0, 40)}"`);
      return jsonResponse({ ok: true, filtered: "honeypot" }, 200, cors);
    }
    console.warn(`[c ${requestId}] honeypot prefilled with contact fields; forwarding`);
    reportFailure(ctx, origin, {
      request_id: requestId,
      error: "honeypot_prefilled_forwarded",
      cf_country: cf.country,
      referer: request.headers.get("Referer"),
    });
  }
  // Remove the honeypot field from the forwarded payload so n8n never
  // sees it — keeps the data clean even for legitimate submissions.
  formData.delete("website");

  // ─── Cloudflare-enriched headers for n8n ───
  // These give n8n visibility into where the lead actually came from,
  // independent of what the client reports.
  const cf = request.cf || {};
  const upstreamHeaders = new Headers();
  // DO NOT forward Host / Content-Length / Content-Type — fetch will
  // recompute them based on the FormData body. DO NOT forward Origin.
  upstreamHeaders.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "");
  upstreamHeaders.set("X-CF-Country", cf.country || "");
  upstreamHeaders.set("X-CF-City", cf.city || "");
  upstreamHeaders.set("X-CF-Colo", cf.colo || "");
  upstreamHeaders.set("X-Original-Referer", request.headers.get("Referer") || "");
  upstreamHeaders.set("X-Original-User-Agent", request.headers.get("User-Agent") || "");
  upstreamHeaders.set("X-Request-Id", requestId);
  upstreamHeaders.set("X-Proxied-By", "neontrip-lp-pages-function/1.1");

  // ─── Fire-and-forget forward to n8n ───
  // Background task: n8n runs 11-17s (AI translate, Trello, Supabase, AC,
  // Outlook). If we awaited it, browsers timeout the fetch after ~8-10s
  // and trigger a false-positive fail-banner even though the lead went
  // through. Incident 2026-04-23 06:19 UTC: Andrei Tausean got the
  // fail-banner, but the lead (Trello #30385, Supabase) was created
  // correctly — because the browser aborted at 9s while n8n took 16.7s.
  //
  // Fix: return 200 to the client immediately, process the upstream
  // forward via ctx.waitUntil so Pages Functions keeps the worker alive
  // until the promise settles. Upstream failures still surface via the
  // fail-report beacon (reportFailure) — just asynchronously, not to the
  // client.
  const startTime = Date.now();

  const upstreamPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstreamResponse = await fetch(UPSTREAM_URL, {
        method: "POST",
        headers: upstreamHeaders,
        body: formData,
        signal: controller.signal,
      });
      const elapsed = Date.now() - startTime;
      if (!upstreamResponse.ok) {
        console.error(
          `[c ${requestId}] upstream HTTP ${upstreamResponse.status} after ${elapsed}ms`
        );
        reportFailure(ctx, origin, {
          request_id: requestId,
          error: "upstream_http_error",
          status: upstreamResponse.status,
          elapsed_ms: elapsed,
          cf_country: cf.country,
          referer: request.headers.get("Referer"),
        });
      } else {
        console.log(
          `[c ${requestId}] ok status=${upstreamResponse.status} elapsed=${elapsed}ms country=${cf.country || "?"}`
        );
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const isTimeout = err.name === "AbortError" || elapsed >= UPSTREAM_TIMEOUT_MS;
      console.error(
        `[c ${requestId}] upstream ${isTimeout ? "timeout" : "error"} after ${elapsed}ms:`,
        err && err.message
      );
      reportFailure(ctx, origin, {
        request_id: requestId,
        error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
        elapsed_ms: elapsed,
        error_message: err && err.message,
        cf_country: cf.country,
        referer: request.headers.get("Referer"),
      });
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(upstreamPromise);
  } else {
    // Dev/test fallback — without waitUntil the runtime may cancel the
    // fetch when we return. Still rare in practice.
    upstreamPromise.catch(() => {});
  }

  return jsonResponse(
    { ok: true, queued: true, request_id: requestId },
    200,
    { ...cors, "X-Request-Id": requestId }
  );
}
