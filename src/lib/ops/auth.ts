import { cookies } from "next/headers";
import { createHash, timingSafeEqual, webcrypto } from "node:crypto";
import { NextResponse } from "next/server";

const OPS_SESSION_COOKIE = "neontrip_ops_session";
const OPS_SESSION_TTL_SECONDS = 60 * 60 * 8;
const ACCESS_JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

type HeaderReader = {
  get(name: string): string | null;
};

type AccessJwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type AccessJwtPayload = {
  aud?: string | string[];
  common_name?: string;
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  sub?: string;
  identity?: {
    email?: string;
  };
};

type AccessJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
};

type AccessJwksCache = {
  issuer: string;
  expiresAt: number;
  keys: AccessJwk[];
};

let accessJwksCache: AccessJwksCache | null = null;

function normalizeHost(host: string | null | undefined) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

export function isLocalOpsHost(host: string | null | undefined) {
  if (process.env.NODE_ENV === "production") return false;
  const normalized = normalizeHost(host);
  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:")
  );
}

export function isOpsPortalBypassed(host?: string | null) {
  return isLocalOpsHost(host);
}

function getOpsPortalTokens() {
  const dedicatedTokens = [
    process.env.OPS_PORTAL_TOKEN,
    process.env.CONTROL_TOWER_OPS_PORTAL_TOKEN,
  ]
    .map((token) => String(token || "").trim())
    .filter(Boolean);
  const tokens = dedicatedTokens.length ? dedicatedTokens : [String(process.env.QUOTE_INTERNAL_API_TOKEN || "").trim()];
  return [...new Set(tokens.filter(Boolean))];
}

function splitEnvList(value: string | undefined) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeAccessIssuer(value: string | undefined) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
}

function getCloudflareAccessConfig() {
  const issuer = normalizeAccessIssuer(
    process.env.OPS_CLOUDFLARE_ACCESS_ISSUER || process.env.OPS_CLOUDFLARE_ACCESS_TEAM_DOMAIN,
  );
  const audience = String(process.env.OPS_CLOUDFLARE_ACCESS_AUD || "").trim();
  if (!issuer || !audience) return null;

  return {
    issuer,
    audience,
    allowedAccessServiceTokenIds: splitEnvList(process.env.OPS_ALLOWED_ACCESS_SERVICE_TOKEN_IDS),
    allowedDomains: splitEnvList(process.env.OPS_ALLOWED_EMAIL_DOMAINS),
    allowedEmails: splitEnvList(process.env.OPS_ALLOWED_EMAILS),
    requireAccess:
      String(process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS || "")
        .trim()
        .toLowerCase() === "true",
  };
}

export function isCloudflareAccessRequired() {
  return Boolean(getCloudflareAccessConfig()?.requireAccess);
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function parseJwtPart<T>(part: string): T | null {
  try {
    return JSON.parse(base64UrlDecode(part).toString("utf8")) as T;
  } catch {
    return null;
  }
}

function getAccessAssertion(headers?: HeaderReader | null) {
  return String(headers?.get("cf-access-jwt-assertion") || "").trim();
}

async function getAccessJwks(issuer: string) {
  const now = Date.now();
  if (accessJwksCache?.issuer === issuer && accessJwksCache.expiresAt > now) {
    return accessJwksCache.keys;
  }

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Cloudflare Access JWKS konnte nicht geladen werden (${response.status}).`);
  }

  const body = (await response.json()) as { keys?: AccessJwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  accessJwksCache = {
    issuer,
    expiresAt: now + ACCESS_JWKS_CACHE_TTL_MS,
    keys,
  };
  return keys;
}

async function verifyRs256JwtSignature(token: string, header: AccessJwtHeader, issuer: string) {
  if (header.alg !== "RS256" || !header.kid) return false;

  const keys = await getAccessJwks(issuer);
  const jwk = keys.find((entry) => entry.kid === header.kid);
  if (!jwk) return false;

  const key = await webcrypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

  return webcrypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    base64UrlDecode(encodedSignature),
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
  );
}

function isAccessAudienceValid(audience: AccessJwtPayload["aud"], expectedAudience: string) {
  if (typeof audience === "string") return audience === expectedAudience;
  if (Array.isArray(audience)) return audience.includes(expectedAudience);
  return false;
}

function getAccessEmail(payload: AccessJwtPayload) {
  return String(payload.email || payload.identity?.email || "").trim().toLowerCase();
}

function isAccessEmailAllowed(email: string, allowedEmails: string[], allowedDomains: string[]) {
  if (!allowedEmails.length && !allowedDomains.length) return true;
  if (!email || !email.includes("@")) return false;
  if (allowedEmails.includes(email)) return true;

  const domain = email.split("@").pop() || "";
  return allowedDomains.includes(domain);
}

export async function validateCloudflareAccess(headers?: HeaderReader | null) {
  const config = getCloudflareAccessConfig();
  if (!config) return { ok: false as const, reason: "not_configured" as const };

  const token = getAccessAssertion(headers);
  if (!token) return { ok: false as const, reason: "missing_token" as const };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false as const, reason: "malformed_token" as const };

  const header = parseJwtPart<AccessJwtHeader>(parts[0]!);
  const payload = parseJwtPart<AccessJwtPayload>(parts[1]!);
  if (!header || !payload) return { ok: false as const, reason: "malformed_token" as const };

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== config.issuer) return { ok: false as const, reason: "invalid_issuer" as const };
  if (!isAccessAudienceValid(payload.aud, config.audience)) {
    return { ok: false as const, reason: "invalid_audience" as const };
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    return { ok: false as const, reason: "expired_token" as const };
  }
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) {
    return { ok: false as const, reason: "token_not_yet_valid" as const };
  }

  try {
    const signatureValid = await verifyRs256JwtSignature(token, header, config.issuer);
    if (!signatureValid) return { ok: false as const, reason: "invalid_signature" as const };
  } catch (error) {
    console.error("cloudflare access jwt validation failed", error);
    return { ok: false as const, reason: "jwks_validation_failed" as const };
  }

  const serviceTokenId = String(payload.common_name || "").trim().toLowerCase();
  if (serviceTokenId) {
    if (!config.allowedAccessServiceTokenIds.includes(serviceTokenId)) {
      return { ok: false as const, reason: "service_token_not_allowed" as const };
    }
    return {
      ok: true as const,
      serviceTokenId,
      subject: payload.sub || null,
    };
  }

  const email = getAccessEmail(payload);
  if (!isAccessEmailAllowed(email, config.allowedEmails, config.allowedDomains)) {
    return { ok: false as const, reason: "email_not_allowed" as const };
  }

  return { ok: true as const, email, subject: payload.sub || null };
}

function sessionDigest(token: string) {
  return createHash("sha256").update(`neontrip:ops:${token}`).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateOpsPortalToken(candidate: string) {
  if (isOpsPortalBypassed()) return true;
  if (isCloudflareAccessRequired()) return false;
  const configuredTokens = getOpsPortalTokens();
  if (!configuredTokens.length) return false;
  const normalized = String(candidate || "").trim();
  if (!normalized) return false;
  const candidateDigest = sessionDigest(normalized);
  return configuredTokens.some((token) => safeEqual(candidateDigest, sessionDigest(token)));
}

export function applyOpsSession(response: NextResponse, candidate: string) {
  if (isOpsPortalBypassed()) return response;
  const normalized = String(candidate || "").trim();
  const candidateDigest = normalized ? sessionDigest(normalized) : "";
  const configured = getOpsPortalTokens().some((token) =>
    safeEqual(candidateDigest, sessionDigest(token)),
  );
  if (!configured) {
    throw new Error("Ops portal token is not configured.");
  }
  response.cookies.set({
    name: OPS_SESSION_COOKIE,
    value: candidateDigest,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: OPS_SESSION_TTL_SECONDS,
    path: "/",
  });
  return response;
}

export function clearOpsSession(response: NextResponse) {
  if (isOpsPortalBypassed()) return response;
  response.cookies.set({
    name: OPS_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
  return response;
}

export function isOpsPortalConfigured(host?: string | null) {
  return isOpsPortalBypassed(host) || Boolean(getCloudflareAccessConfig()) || getOpsPortalTokens().length > 0;
}

export async function hasOpsSession(host?: string | null, headers?: HeaderReader | null) {
  if (isOpsPortalBypassed(host)) return true;

  const accessConfig = getCloudflareAccessConfig();
  if (accessConfig) {
    const access = await validateCloudflareAccess(headers);
    if (access.ok) return true;
    if (accessConfig.requireAccess) return false;
  }

  const configuredTokens = getOpsPortalTokens();
  if (!configuredTokens.length) return false;
  const store = await cookies();
  const value = store.get(OPS_SESSION_COOKIE)?.value;
  return Boolean(value && configuredTokens.some((token) => safeEqual(value, sessionDigest(token))));
}

export async function resolveOpsRequestActor(host?: string | null, headers?: HeaderReader | null) {
  if (isOpsPortalBypassed(host)) return "local-ops";
  const access = await validateCloudflareAccess(headers);
  if (access.ok) {
    if ("email" in access && access.email) return access.email;
    if ("serviceTokenId" in access && access.serviceTokenId) return access.serviceTokenId;
    return access.subject || "cloudflare-access";
  }
  return (await hasOpsSession(host, headers)) ? "ops-session" : null;
}
