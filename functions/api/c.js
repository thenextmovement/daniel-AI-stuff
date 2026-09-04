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
const CUSTOMER_MATCH_CONSENT_SOURCE = "neontrip_cookiebot_marketing_edge";
const CUSTOMER_MATCH_CONSENT_POLICY_VERSION = "nt_customer_match_cookiebot_v1_20260818";

const BLOCKED_PERSONAL_EMAIL_DOMAINS = new Set([
  "10minutemail.com", "aol.com", "aol.de", "discard.email", "dispostable.com",
  "emailondeck.com", "example.com", "example.net", "example.org", "fakemail.net",
  "fastmail.com", "freenet.de", "getnada.com", "gmail.com", "gmx.at", "gmx.ch",
  "gmx.com", "gmx.de", "gmx.net", "googlemail.com", "grr.la", "guerrillamail.com",
  "hey.com", "hotmail.co.uk", "hotmail.com", "hotmail.de", "hotmail.fr", "icloud.com",
  "icloud.de", "laposte.net", "live.com", "live.de", "mac.com", "mail.com", "mail.de", "mail.ru",
  "mailbox.org", "maildrop.cc", "mailinator.com", "me.com", "msn.com", "orange.fr",
  "outlook.com", "outlook.de", "pm.me", "posteo.de", "proton.me", "protonmail.ch", "protonmail.com",
  "rocketmail.com", "sharklasers.com", "spamgourmet.com", "t-online.de",
  "temp-mail.org", "tempmail.com", "throwawaymail.com", "tuta.com", "tuta.io",
  "tutanota.com", "tutanota.de", "web.de", "yahoo.co.uk", "yahoo.com", "yahoo.de",
  "yahoo.fr", "yandex.com", "yandex.ru", "ymail.com", "yopmail.com", "zoho.com",
]);

function normalizeEmailDomain(rawDomain) {
  let domain = String(rawDomain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!domain || /[\\/?#:\[\]@]/.test(domain)) return "";
  try {
    domain = new URL(`http://${domain}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch (_) {
    return "";
  }
  return domain;
}

function isBlockedPersonalEmailDomain(domain) {
  if (!domain) return true;
  if (domain === "localhost" || /\.(?:invalid|localhost|test)$/.test(domain)) return true;
  for (const blocked of BLOCKED_PERSONAL_EMAIL_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function inspectBusinessEmail(value) {
  const email = String(value || "").trim();
  if (!email || email.length > 254 || /\s/.test(email)) return { valid: false, reason: "format" };
  if ((email.match(/@/g) || []).length !== 1) return { valid: false, reason: "format" };

  const [local, rawDomain] = email.split("@");
  const domain = normalizeEmailDomain(rawDomain);
  if (
    !local ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
  ) {
    return { valid: false, reason: "format" };
  }
  if (!domain || domain.length > 253 || !domain.includes(".")) return { valid: false, reason: "format" };

  const labels = domain.split(".");
  for (const label of labels) {
    if (
      !label ||
      label.length > 63 ||
      !/^[a-z0-9-]+$/.test(label) ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      return { valid: false, reason: "format" };
    }
  }
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) {
    return { valid: false, reason: "format" };
  }
  if (isBlockedPersonalEmailDomain(domain)) {
    return { valid: false, reason: "personal_domain" };
  }
  return { valid: true, normalized: `${local}@${domain}` };
}

function cleanQualificationValue(value, maxLength = 180) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function applyB2bQualificationProjection(formData) {
  const projectContext = cleanQualificationValue(formData.get("project_context"));
  const quantityBand = cleanQualificationValue(formData.get("quantity_band"));
  const desiredDeadline = cleanQualificationValue(formData.get("desired_deadline"), 10);
  const summaryLines = [];

  if (projectContext) summaryLines.push(`Anwendungsfall: ${projectContext}`);
  if (quantityBand) summaryLines.push(`Menge / Rollout: ${quantityBand}`);
  if (desiredDeadline) summaryLines.push(`Wunschtermin: ${desiredDeadline}`);

  if (summaryLines.length) {
    const originalMessage = cleanQualificationValue(formData.get("nachricht"), 4000);
    const qualificationSummary = `Projektqualifizierung:\n${summaryLines.join("\n")}`;
    formData.set(
      "nachricht",
      originalMessage ? `${originalMessage}\n\n${qualificationSummary}` : qualificationSummary
    );
  }

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(desiredDeadline) &&
    !String(formData.get("custom_6703d0b36ebc54_95825950") || "").trim()
  ) {
    formData.set("custom_6703d0b36ebc54_95825950", `Wunschtermin ${desiredDeadline}`);
  }
}

const CUSTOMER_MATCH_CONSENT_FIELDS = [
  "consent_ad_user_data",
  "consent_ad_personalization",
  "consent_recorded_at",
  "consent_source",
  "consent_policy_version",
  "consent_receipt_id",
  "consent_method",
  "consent_region",
];

function cookieValue(cookieHeader, name) {
  for (const part of String(cookieHeader || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

function parseCookiebotConsent(cookieHeader) {
  const encoded = cookieValue(cookieHeader, "CookieConsent");
  if (!encoded) return null;

  let raw;
  try {
    raw = decodeURIComponent(encoded);
  } catch (_) {
    return null;
  }

  // Cookiebot uses -1 outside consent regions. That is not affirmative consent.
  if (!raw || raw === "-1") return null;

  const marketingMatch = raw.match(/(?:^|[,{])\s*marketing\s*:\s*(true|false)(?:\s*[,}]|$)/i);
  const methodMatch = raw.match(/(?:^|[,{])\s*method\s*:\s*['"]([^'"]+)['"](?:\s*[,}]|$)/i);
  const stampMatch = raw.match(/(?:^|[,{])\s*stamp\s*:\s*['"]([^'"]+)['"](?:\s*[,}]|$)/i);
  const utcMatch = raw.match(/(?:^|[,{])\s*utc\s*:\s*(\d{10,16})(?:\s*[,}]|$)/i);
  const regionMatch = raw.match(/(?:^|[,{])\s*region\s*:\s*['"]([a-z]{2})['"](?:\s*[,}]|$)/i);

  if (!marketingMatch || !methodMatch || !stampMatch || !utcMatch) return null;

  const recordedAtMs = Number(utcMatch[1]);
  if (!Number.isFinite(recordedAtMs) || recordedAtMs <= 0 || recordedAtMs > Date.now() + (5 * 60 * 1000)) {
    return null;
  }

  const marketing = marketingMatch[1].toLowerCase() === "true";
  const method = methodMatch[1].trim().toLowerCase();
  const status = marketing && method === "explicit"
    ? "granted"
    : marketing
      ? "unknown"
      : "denied";

  return {
    ad_user_data: status,
    ad_personalization: status,
    recorded_at: new Date(recordedAtMs).toISOString(),
    source: CUSTOMER_MATCH_CONSENT_SOURCE,
    policy_version: CUSTOMER_MATCH_CONSENT_POLICY_VERSION,
    receipt_id: stampMatch[1].trim().slice(0, 160),
    method: method.slice(0, 40),
    region: (regionMatch ? regionMatch[1] : "").toLowerCase(),
  };
}

function applyCookiebotCustomerMatchConsent(formData, cookieHeader) {
  // Never trust consent fields supplied by the browser body. Rebuild them
  // from the first-party Cookiebot receipt received at the edge.
  for (const field of CUSTOMER_MATCH_CONSENT_FIELDS) formData.delete(field);

  const consent = parseCookiebotConsent(cookieHeader);
  if (!consent) {
    formData.set("consent_ad_user_data", "unknown");
    formData.set("consent_ad_personalization", "unknown");
    return null;
  }

  formData.set("consent_ad_user_data", consent.ad_user_data);
  formData.set("consent_ad_personalization", consent.ad_personalization);
  formData.set("consent_recorded_at", consent.recorded_at);
  formData.set("consent_source", consent.source);
  formData.set("consent_policy_version", consent.policy_version);
  formData.set("consent_receipt_id", consent.receipt_id);
  formData.set("consent_method", consent.method);
  if (consent.region) formData.set("consent_region", consent.region);
  return consent;
}

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
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Client-Submit-Id",
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
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const clientSubmitIdRaw = String(request.headers.get("X-Client-Submit-Id") || "").trim();
  let clientSubmitId = uuidV4Pattern.test(clientSubmitIdRaw)
    ? clientSubmitIdRaw
    : "";

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
      {
        ok: false,
        error: "invalid_body",
        request_id: requestId,
        client_submit_id: clientSubmitId || null,
      },
      400,
      { ...cors, "X-Request-Id": requestId }
    );
  }

  const isContactRecovery = String(formData.get("nt_recovery_contact") || "") === "1";

  const customerMatchConsent = applyCookiebotCustomerMatchConsent(
    formData,
    request.headers.get("Cookie") || ""
  );

  // Synthetic deploy smoke test. Verifies that the Pages Function exists,
  // accepts multipart FormData and returns JSON without creating a real lead.
  if (formData.get("nt_dry_run") === "1") {
    return jsonResponse(
      {
        ok: true,
        dry_run: true,
        request_id: requestId,
        customer_match_consent: customerMatchConsent
          ? {
              ad_user_data: customerMatchConsent.ad_user_data,
              ad_personalization: customerMatchConsent.ad_personalization,
              recorded_at: customerMatchConsent.recorded_at,
              source: customerMatchConsent.source,
              policy_version: customerMatchConsent.policy_version,
              method: customerMatchConsent.method,
              region: customerMatchConsent.region,
              has_receipt: Boolean(customerMatchConsent.receipt_id),
            }
          : null,
      },
      200,
      { ...cors, "X-Request-Id": requestId }
    );
  }

  // Cloudflare request metadata is used both by the honeypot false-positive
  // alert and by the eventual upstream n8n forward.
  const cf = request.cf || {};

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
  }

  // B2B-only intake boundary. The browser check is only UX; this edge check
  // is authoritative and runs before any n8n request or failure beacon.
  const businessEmail = inspectBusinessEmail(formData.get("email"));
  if (!businessEmail.valid) {
    return jsonResponse(
      {
        ok: false,
        error: "business_email_required",
        field: "email",
        request_id: requestId,
        client_submit_id: clientSubmitId || null,
      },
      422,
      { ...cors, "X-Request-Id": requestId }
    );
  }
  formData.set("email", businessEmail.normalized);
  applyB2bQualificationProjection(formData);

  if (honeypot) {
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

  if (!clientSubmitId) {
    const bodySubmitId = String(
      formData.get("custom_6703e7e2e253b1_87194328") ||
      formData.get("request_id") ||
      formData.get("nt_client_submit_id") ||
      ""
    ).trim();
    if (uuidV4Pattern.test(bodySubmitId)) clientSubmitId = bodySubmitId;
  }

  if (!clientSubmitId) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_client_submit_id",
        request_id: requestId,
        client_submit_id: null,
      },
      400,
      { ...cors, "X-Request-Id": requestId }
    );
  }

  // One stable UUID is authoritative for edge, workflow, database and Ads.
  formData.set("custom_6703e7e2e253b1_87194328", clientSubmitId);
  formData.set("request_id", clientSubmitId);
  formData.set("nt_client_submit_id", clientSubmitId);

  // ─── Cloudflare-enriched headers for n8n ───
  // These give n8n visibility into where the lead actually came from,
  // independent of what the client reports.
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
  upstreamHeaders.set("X-Client-Submit-Id", clientSubmitId);
  if (isContactRecovery) upstreamHeaders.set("X-Recovery-Contact", "1");
  upstreamHeaders.set("X-Proxied-By", "neontrip-lp-pages-function/1.2");

  // n8n now responds immediately after the complete request is committed to
  // Supabase. Later Trello/contact projections keep running after that receipt.
  // The edge must await and validate the receipt so a queued request can never
  // be mistaken for a persisted lead or an Ads conversion.
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
      let upstreamBody = null;
      try {
        upstreamBody = await upstreamResponse.json();
      } catch (_) {
        upstreamBody = null;
      }
      if (!upstreamResponse.ok) {
        console.error(
          `[c ${requestId}] upstream HTTP ${upstreamResponse.status} after ${elapsed}ms`
        );
        reportFailure(ctx, origin, {
          request_id: requestId,
          client_submit_id: clientSubmitId || null,
          recovery_contact: isContactRecovery,
          error: "upstream_http_error",
          status: upstreamResponse.status,
          elapsed_ms: elapsed,
          cf_country: cf.country,
          referer: request.headers.get("Referer"),
        });
        return {
          ok: false,
          status: upstreamResponse.status,
          elapsed,
          body: upstreamBody,
          error: "upstream_http_error",
        };
      } else {
        console.log(
          `[c ${requestId}] ok status=${upstreamResponse.status} elapsed=${elapsed}ms country=${cf.country || "?"}`
        );
        return {
          ok: true,
          status: upstreamResponse.status,
          elapsed,
          body: upstreamBody,
        };
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
        client_submit_id: clientSubmitId || null,
        recovery_contact: isContactRecovery,
        error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
        elapsed_ms: elapsed,
        error_message: err && err.message,
        cf_country: cf.country,
        referer: request.headers.get("Referer"),
      });
      return {
        ok: false,
        status: isTimeout ? 504 : 502,
        elapsed,
        body: null,
        error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
      };
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  const upstreamResult = await upstreamPromise;
  const receipt = upstreamResult.body || {};
  const persisted =
    upstreamResult.ok &&
    receipt.ok === true &&
    receipt.accepted === true &&
    receipt.persisted === true &&
    receipt.contact_saved === true &&
    receipt.request_id === clientSubmitId &&
    Boolean(receipt.request_row_id) &&
    Boolean(receipt.customer_id);

  // A contact-only recovery follows a definitive multipart parse failure.
  // It additionally waits for the Trello projection so the existing recovery
  // promise remains unchanged.
  if (isContactRecovery) {
    const contactSaved = persisted && Boolean(receipt.trello_card_id);

    if (!contactSaved) {
      reportFailure(ctx, origin, {
        request_id: requestId,
        client_submit_id: clientSubmitId || null,
        error: "contact_recovery_unconfirmed",
        status: upstreamResult.status,
        elapsed_ms: upstreamResult.elapsed,
        cf_country: cf.country,
        referer: request.headers.get("Referer"),
      });
      return jsonResponse(
        {
          ok: false,
          error: "contact_recovery_unconfirmed",
          request_id: requestId,
          client_submit_id: clientSubmitId || null,
        },
        upstreamResult.status >= 400 ? upstreamResult.status : 502,
        { ...cors, "X-Request-Id": requestId }
      );
    }

    return jsonResponse(
      {
        ok: true,
        accepted: true,
        persisted: true,
        recovery: true,
        contact_saved: true,
        created: receipt.created === true,
        replay: receipt.replay === true,
        request_id: requestId,
        client_submit_id: clientSubmitId,
        lead_request_id: receipt.request_id,
        request_row_id: receipt.request_row_id,
        customer_id: receipt.customer_id,
        trello_card_id: receipt.trello_card_id,
      },
      200,
      { ...cors, "X-Request-Id": requestId }
    );
  }

  if (!persisted) {
    reportFailure(ctx, origin, {
      request_id: requestId,
      client_submit_id: clientSubmitId,
      error: "persistence_unconfirmed",
      status: upstreamResult.status,
      elapsed_ms: upstreamResult.elapsed,
      cf_country: cf.country,
      referer: request.headers.get("Referer"),
    });
    return jsonResponse(
      {
        ok: false,
        error: "persistence_unconfirmed",
        request_id: requestId,
        client_submit_id: clientSubmitId,
      },
      upstreamResult.status >= 400 ? upstreamResult.status : 502,
      { ...cors, "X-Request-Id": requestId }
    );
  }

  return jsonResponse(
    {
      ok: true,
      accepted: true,
      persisted: true,
      contact_saved: true,
      created: receipt.created === true,
      replay: receipt.replay === true,
      request_id: requestId,
      client_submit_id: clientSubmitId,
      lead_request_id: receipt.request_id,
      request_row_id: receipt.request_row_id,
      customer_id: receipt.customer_id,
    },
    200,
    { ...cors, "X-Request-Id": requestId }
  );
}
