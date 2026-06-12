import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { config, middleware } from "../../src/middleware";

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

async function withOpsMiddlewareEnv<T>(callback: () => Promise<T>) {
  const original = {
    aud: process.env.OPS_CLOUDFLARE_ACCESS_AUD,
    domains: process.env.OPS_ALLOWED_EMAIL_DOMAINS,
    emails: process.env.OPS_ALLOWED_EMAILS,
    issuer: process.env.OPS_CLOUDFLARE_ACCESS_ISSUER,
    portalToken: process.env.OPS_PORTAL_TOKEN,
    quoteToken: process.env.QUOTE_INTERNAL_API_TOKEN,
    requireAccess: process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS,
  };

  try {
    process.env.OPS_CLOUDFLARE_ACCESS_ISSUER = "https://neontrip.cloudflareaccess.com";
    process.env.OPS_CLOUDFLARE_ACCESS_AUD = "aud-neontrip-ops";
    process.env.OPS_ALLOWED_EMAIL_DOMAINS = "neontrip.de";
    process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS = "true";
    delete process.env.OPS_ALLOWED_EMAILS;
    delete process.env.OPS_PORTAL_TOKEN;
    delete process.env.QUOTE_INTERNAL_API_TOKEN;

    return await callback();
  } finally {
    for (const [key, value] of Object.entries({
      OPS_CLOUDFLARE_ACCESS_AUD: original.aud,
      OPS_ALLOWED_EMAIL_DOMAINS: original.domains,
      OPS_ALLOWED_EMAILS: original.emails,
      OPS_CLOUDFLARE_ACCESS_ISSUER: original.issuer,
      OPS_PORTAL_TOKEN: original.portalToken,
      QUOTE_INTERNAL_API_TOKEN: original.quoteToken,
      OPS_REQUIRE_CLOUDFLARE_ACCESS: original.requireAccess,
    })) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("ops middleware protects internal page routes before rendering the app shell", async () => {
  await withOpsMiddlewareEnv(async () => {
    const response = await middleware(
      buildRequest("https://ops.neontrip.de/ops/customer-records", { headers: { accept: "text/html" } }),
    );

    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://ops.neontrip.de/ops-login?next=%2Fops%2Fcustomer-records");
  });
});

test("ops middleware still returns plain 401 for non-browser page probes", async () => {
  await withOpsMiddlewareEnv(async () => {
    const response = await middleware(buildRequest("https://ops.neontrip.de/ops/customer-records"));

    assert.equal(response.status, 401);
    assert.match(await response.text(), /Unauthorized/);
  });
});

test("ops middleware returns JSON 401 for internal API routes without session", async () => {
  await withOpsMiddlewareEnv(async () => {
    const response = await middleware(buildRequest("https://ops.neontrip.de/api/ops/management-kpis"));

    assert.equal(response.status, 401);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
  });
});

test("ops middleware lets session login POST reach the route handler", async () => {
  await withOpsMiddlewareEnv(async () => {
    const response = await middleware(
      buildRequest("https://ops.neontrip.de/api/ops/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});

test("ops middleware keeps localhost routes testable", async () => {
  await withOpsMiddlewareEnv(async () => {
    const response = await middleware(
      buildRequest("http://127.0.0.1:3100/ops/customer-records", { headers: { host: "127.0.0.1:3100" } }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});

test("ops middleware matcher is limited to ops routes", async () => {
  assert.deepEqual(config.matcher, ["/ops/:path*", "/api/ops/:path*"]);

  await withOpsMiddlewareEnv(async () => {
    const response = await middleware(buildRequest("https://angebote.neontrip.de/quote/customer-token"));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});
