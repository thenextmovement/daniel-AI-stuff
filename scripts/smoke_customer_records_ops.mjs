import { pathToFileURL } from "node:url";

const defaultPaths = [
  "/ops/customer-records",
  "/ops/customer-records/calls",
  "/ops/customer-records/price-review",
  "/ops/customer-records/shipping",
  "/ops/customer-records/inbound-shipping",
  "/api/ops/customer-records/calls",
  "/api/ops/customer-records/price-predictions?status=pending&limit=10",
  "/api/ops/customer-records/shipping",
  "/api/ops/customer-records/inbound-shipping",
  "/api/ops/customer-records?query=c5e0fb42-ef50-44a7-b64e-a91590118e6a",
];

function getBaseUrl() {
  const value = String(process.env.OPS_SMOKE_BASE_URL || process.argv[2] || "").trim();
  if (!value) {
    throw new Error("OPS_SMOKE_BASE_URL oder erstes CLI-Argument fehlt.");
  }
  return value.replace(/\/+$/, "");
}

function expectProtectedMode() {
  return String(process.env.OPS_SMOKE_EXPECT_PROTECTED || "").trim().toLowerCase() === "true";
}

function cookieFromSetCookie(headers) {
  const setCookie = headers.get("set-cookie") || "";
  return setCookie.split(";")[0] || "";
}

async function login(baseUrl) {
  const token = String(process.env.OPS_PORTAL_TOKEN || "").trim();
  if (!token) return "";

  const response = await fetch(`${baseUrl}/api/ops/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    throw new Error(`Ops-Session Login fehlgeschlagen: HTTP ${response.status}`);
  }
  return cookieFromSetCookie(response.headers);
}

async function request(baseUrl, path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
  const contentType = response.headers.get("content-type") || "";
  let body = "";
  if (contentType.includes("application/json")) {
    body = JSON.stringify(await response.json());
  } else {
    body = (await response.text()).slice(0, 500);
  }
  return { path, status: response.status, contentType, body };
}

export function assertProtectedResult(result) {
  if ([401, 403, 302, 303, 307, 308].includes(result.status)) return;

  const cloudflareAccessLogin = result.status === 200
    && result.contentType.includes("text/html")
    && /<title>\s*Sign in[^<]*Cloudflare Access\s*<\/title>/i.test(result.body)
    && /<meta\s+name=["']robots["']\s+content=["']noindex["']/i.test(result.body);
  if (cloudflareAccessLogin) return;

  throw new Error(
    `${result.path} sollte ohne Cloudflare-Access-Login geblockt sein, bekam aber HTTP ${result.status}: ${result.body}`,
  );
}

function assertResult(result) {
  if (result.path.startsWith("/api/")) {
    if (result.status !== 200) {
      throw new Error(`${result.path} erwartet 200, bekam ${result.status}: ${result.body}`);
    }
    if (!result.contentType.includes("application/json")) {
      throw new Error(`${result.path} erwartet JSON, bekam ${result.contentType}`);
    }
    if (!result.body.includes('"ok":true')) {
      throw new Error(`${result.path} meldet kein ok=true: ${result.body}`);
    }
    return;
  }

  if (result.status !== 200) {
    throw new Error(`${result.path} erwartet 200, bekam ${result.status}`);
  }
  if (!result.contentType.includes("text/html")) {
    throw new Error(`${result.path} erwartet HTML, bekam ${result.contentType}`);
  }
}

async function main() {
  const baseUrl = getBaseUrl();
  const protectedMode = expectProtectedMode();
  const cookie = protectedMode ? "" : await login(baseUrl);
  const results = [];

  for (const path of defaultPaths) {
    const result = await request(baseUrl, path, cookie);
    if (protectedMode) {
      assertProtectedResult(result);
    } else {
      assertResult(result);
    }
    results.push({ path: result.path, status: result.status, contentType: result.contentType });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        mode: protectedMode ? "protected" : "authenticated",
        authenticated: Boolean(cookie),
        results,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Customer Records Ops Smoke fehlgeschlagen: ${error.message}`);
    if (error.cause?.message) {
      console.error(`Ursache: ${error.cause.message}`);
    }
    process.exit(1);
  });
}
