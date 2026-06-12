import { NextRequest, NextResponse } from "next/server";

const OPS_SESSION_COOKIE = "neontrip_ops_session";
const ACCESS_JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

type AccessJwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type AccessJwtPayload = {
  aud?: string | string[];
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

function readEnv(name: string) {
  return process.env[name];
}

function normalizeHost(host: string | null | undefined) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

function isLocalOpsHost(host: string | null | undefined) {
  const normalized = normalizeHost(host);
  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:")
  );
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
    readEnv("OPS_CLOUDFLARE_ACCESS_ISSUER") || readEnv("OPS_CLOUDFLARE_ACCESS_TEAM_DOMAIN"),
  );
  const audience = String(readEnv("OPS_CLOUDFLARE_ACCESS_AUD") || "").trim();
  if (!issuer || !audience) return null;

  return {
    issuer,
    audience,
    allowedDomains: splitEnvList(readEnv("OPS_ALLOWED_EMAIL_DOMAINS")),
    allowedEmails: splitEnvList(readEnv("OPS_ALLOWED_EMAILS")),
    requireAccess:
      String(readEnv("OPS_REQUIRE_CLOUDFLARE_ACCESS") || "")
        .trim()
        .toLowerCase() === "true",
  };
}

function getOpsPortalToken() {
  const token = readEnv("OPS_PORTAL_TOKEN") || readEnv("QUOTE_INTERNAL_API_TOKEN");
  const normalized = String(token || "").trim();
  return normalized || null;
}

function base64UrlDecodeToBytes(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseJwtPart<T>(part: string): T | null {
  try {
    const decoded = new TextDecoder().decode(base64UrlDecodeToBytes(part));
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function getAccessAssertion(request: NextRequest) {
  return String(request.headers.get("cf-access-jwt-assertion") || "").trim();
}

async function getAccessJwks(issuer: string) {
  const now = Date.now();
  if (accessJwksCache?.issuer === issuer && accessJwksCache.expiresAt > now) {
    return accessJwksCache.keys;
  }

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { cache: "no-store" });
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

  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    base64UrlDecodeToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
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

async function validateCloudflareAccess(request: NextRequest) {
  const config = getCloudflareAccessConfig();
  if (!config) return false;

  const token = getAccessAssertion(request);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const header = parseJwtPart<AccessJwtHeader>(parts[0]!);
  const payload = parseJwtPart<AccessJwtPayload>(parts[1]!);
  if (!header || !payload) return false;

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== config.issuer) return false;
  if (!isAccessAudienceValid(payload.aud, config.audience)) return false;
  if (typeof payload.exp !== "number" || payload.exp <= now) return false;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return false;

  try {
    const signatureValid = await verifyRs256JwtSignature(token, header, config.issuer);
    if (!signatureValid) return false;
  } catch (error) {
    console.error("cloudflare access middleware validation failed", error);
    return false;
  }

  const email = getAccessEmail(payload);
  return isAccessEmailAllowed(email, config.allowedEmails, config.allowedDomains);
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function hasPortalSessionCookie(request: NextRequest) {
  const configuredToken = getOpsPortalToken();
  if (!configuredToken) return false;

  const sessionCookie = request.cookies.get(OPS_SESSION_COOKIE)?.value;
  if (!sessionCookie) return false;

  const expected = await sha256Hex(`neontrip:ops:${configuredToken}`);
  return safeEqual(sessionCookie, expected);
}

function isOpsPortalConfigured(host: string | null | undefined) {
  return isLocalOpsHost(host) || Boolean(getCloudflareAccessConfig()) || Boolean(getOpsPortalToken());
}

async function hasOpsMiddlewareSession(request: NextRequest, host: string | null | undefined) {
  if (isLocalOpsHost(host)) return true;

  const accessConfig = getCloudflareAccessConfig();
  if (accessConfig) {
    const accessValid = await validateCloudflareAccess(request);
    if (accessValid) return true;
    if (accessConfig.requireAccess) return false;
  }

  return hasPortalSessionCookie(request);
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function isOpsApiPath(pathname: string) {
  return pathname === "/api/ops" || pathname.startsWith("/api/ops/");
}

function isOpsPagePath(pathname: string) {
  return pathname === "/ops" || pathname.startsWith("/ops/");
}

function jsonUnauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function pageUnauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function notConfigured(request: NextRequest) {
  if (isOpsApiPath(request.nextUrl.pathname)) {
    return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  }

  return new NextResponse("Ops access is not configured.", {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isOpsPagePath(pathname) && !isOpsApiPath(pathname)) {
    return NextResponse.next();
  }

  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) {
    return notConfigured(request);
  }

  if (await hasOpsMiddlewareSession(request, host)) {
    return NextResponse.next();
  }

  if (isOpsApiPath(pathname)) return jsonUnauthorized();
  return pageUnauthorized();
}

export const config = {
  matcher: ["/ops/:path*", "/api/ops/:path*"],
};
