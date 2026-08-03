import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { NextRequest } from "next/server";
import { config, middleware } from "../../src/middleware";

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

function base64Url(input: BufferSource | string) {
  const buffer =
    typeof input === "string"
      ? Buffer.from(input)
      : Buffer.from(input instanceof ArrayBuffer ? input : input.buffer);
  return buffer.toString("base64url");
}

async function buildServiceAccessJwt(options: {
  audience: string;
  commonName: string;
  issuer: string;
  kid: string;
  privateKey: CryptoKey;
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: options.kid, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      aud: options.audience,
      common_name: options.commonName,
      exp: now + 600,
      iat: now,
      iss: options.issuer,
      sub: "",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = await webcrypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    options.privateKey,
    Buffer.from(signingInput),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

async function withOpsMiddlewareEnv<T>(callback: () => Promise<T>) {
  const original = {
    aud: process.env.OPS_CLOUDFLARE_ACCESS_AUD,
    accessServiceTokenIds: process.env.OPS_ALLOWED_ACCESS_SERVICE_TOKEN_IDS,
    domains: process.env.OPS_ALLOWED_EMAIL_DOMAINS,
    emails: process.env.OPS_ALLOWED_EMAILS,
    issuer: process.env.OPS_CLOUDFLARE_ACCESS_ISSUER,
    controlTowerPortalToken: process.env.CONTROL_TOWER_OPS_PORTAL_TOKEN,
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
    delete process.env.OPS_ALLOWED_ACCESS_SERVICE_TOKEN_IDS;
    delete process.env.CONTROL_TOWER_OPS_PORTAL_TOKEN;
    delete process.env.OPS_PORTAL_TOKEN;
    delete process.env.QUOTE_INTERNAL_API_TOKEN;

    return await callback();
  } finally {
    for (const [key, value] of Object.entries({
      OPS_CLOUDFLARE_ACCESS_AUD: original.aud,
      OPS_ALLOWED_ACCESS_SERVICE_TOKEN_IDS: original.accessServiceTokenIds,
      OPS_ALLOWED_EMAIL_DOMAINS: original.domains,
      OPS_ALLOWED_EMAILS: original.emails,
      OPS_CLOUDFLARE_ACCESS_ISSUER: original.issuer,
      CONTROL_TOWER_OPS_PORTAL_TOKEN: original.controlTowerPortalToken,
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

test("ops middleware accepts a session issued from the separate Control Tower token", async () => {
  await withOpsMiddlewareEnv(async () => {
    delete process.env.OPS_CLOUDFLARE_ACCESS_ISSUER;
    delete process.env.OPS_CLOUDFLARE_ACCESS_AUD;
    delete process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS;
    process.env.OPS_PORTAL_TOKEN = "primary-preview-token";
    process.env.CONTROL_TOWER_OPS_PORTAL_TOKEN = "control-tower-operator-token";
    const session = createHash("sha256")
      .update("neontrip:ops:control-tower-operator-token")
      .digest("hex");

    const response = await middleware(
      buildRequest("https://ops.neontrip.de/api/ops/design/jobs", {
        headers: { cookie: `neontrip_ops_session=${session}` },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});

test("ops middleware accepts an explicitly allowed Cloudflare Access service token", async () => {
  await withOpsMiddlewareEnv(async () => {
    const originalFetch = globalThis.fetch;
    const issuer = "https://neontrip-middleware-service.cloudflareaccess.com";
    const audience = "aud-neontrip-ops-middleware-service";
    const serviceTokenId = "tower-middleware-client.access";
    const kid = `kid-middleware-service-${Date.now()}`;
    const keyPair = await webcrypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = (await webcrypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & { kid?: string };
    publicJwk.kid = kid;
    publicJwk.alg = "RS256";

    process.env.OPS_CLOUDFLARE_ACCESS_ISSUER = issuer;
    process.env.OPS_CLOUDFLARE_ACCESS_AUD = audience;
    process.env.OPS_ALLOWED_ACCESS_SERVICE_TOKEN_IDS = serviceTokenId;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      const token = await buildServiceAccessJwt({
        audience,
        commonName: serviceTokenId,
        issuer,
        kid,
        privateKey: keyPair.privateKey,
      });
      const response = await middleware(
        buildRequest("https://ops.neontrip.de/api/ops/design/jobs", {
          headers: { "cf-access-jwt-assertion": token },
        }),
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("ops middleware lets supplier sales route validate its own automation auth", async () => {
  await withOpsMiddlewareEnv(async () => {
    const response = await middleware(
      buildRequest("https://ops.neontrip.de/api/ops/supplier-sales", {
        method: "POST",
        headers: { authorization: "Bearer internal-token" },
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
