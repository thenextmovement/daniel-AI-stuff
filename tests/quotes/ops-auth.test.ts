import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { isOpsPortalBypassed, validateCloudflareAccess, validateOpsPortalToken } from "../../src/lib/ops/auth";

function base64Url(input: BufferSource | string) {
  const buffer =
    typeof input === "string"
      ? Buffer.from(input)
      : Buffer.from(input instanceof ArrayBuffer ? input : input.buffer);
  return buffer.toString("base64url");
}

async function buildAccessJwt(options: {
  audience: string;
  email: string;
  issuer: string;
  kid: string;
  privateKey: CryptoKey;
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: options.kid, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      aud: options.audience,
      email: options.email,
      exp: now + 600,
      iat: now,
      iss: options.issuer,
      sub: `user-${options.email}`,
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

async function withCloudflareAccessEnv<T>(callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const original = {
    aud: process.env.OPS_CLOUDFLARE_ACCESS_AUD,
    domains: process.env.OPS_ALLOWED_EMAIL_DOMAINS,
    emails: process.env.OPS_ALLOWED_EMAILS,
    issuer: process.env.OPS_CLOUDFLARE_ACCESS_ISSUER,
    controlTowerPortalToken: process.env.CONTROL_TOWER_OPS_PORTAL_TOKEN,
    portalToken: process.env.OPS_PORTAL_TOKEN,
    requireAccess: process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS,
  };

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      OPS_CLOUDFLARE_ACCESS_AUD: original.aud,
      OPS_ALLOWED_EMAIL_DOMAINS: original.domains,
      OPS_ALLOWED_EMAILS: original.emails,
      OPS_CLOUDFLARE_ACCESS_ISSUER: original.issuer,
      CONTROL_TOWER_OPS_PORTAL_TOKEN: original.controlTowerPortalToken,
      OPS_PORTAL_TOKEN: original.portalToken,
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

test("isOpsPortalBypassed only trusts localhost outside production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;

  try {
    env.NODE_ENV = "development";
    assert.equal(isOpsPortalBypassed("localhost:3000"), true);
    assert.equal(isOpsPortalBypassed("127.0.0.1:3000"), true);

    env.NODE_ENV = "production";
    assert.equal(isOpsPortalBypassed("localhost:3000"), false);
    assert.equal(isOpsPortalBypassed("127.0.0.1:3000"), false);
  } finally {
    if (originalNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalNodeEnv;
    }
  }
});

test("validateCloudflareAccess accepts a signed Access JWT for an allowed employee domain", async () => {
  await withCloudflareAccessEnv(async () => {
    const issuer = "https://neontrip.cloudflareaccess.com";
    const audience = "aud-neontrip-ops";
    const kid = `kid-${Date.now()}`;
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
    process.env.OPS_ALLOWED_EMAIL_DOMAINS = "neontrip.de";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const token = await buildAccessJwt({
      audience,
      email: "kollegin@neontrip.de",
      issuer,
      kid,
      privateKey: keyPair.privateKey,
    });

    const result = await validateCloudflareAccess({
      get: (name) => (name.toLowerCase() === "cf-access-jwt-assertion" ? token : null),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.email, "kollegin@neontrip.de");
    }
  });
});

test("validateCloudflareAccess rejects Access JWTs outside the app allowlist", async () => {
  await withCloudflareAccessEnv(async () => {
    const issuer = "https://neontrip-deny.cloudflareaccess.com";
    const audience = "aud-neontrip-ops-deny";
    const kid = `kid-deny-${Date.now()}`;
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
    process.env.OPS_ALLOWED_EMAILS = "team@neontrip.de";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const token = await buildAccessJwt({
      audience,
      email: "external@example.com",
      issuer,
      kid,
      privateKey: keyPair.privateKey,
    });

    const result = await validateCloudflareAccess({
      get: (name) => (name.toLowerCase() === "cf-access-jwt-assertion" ? token : null),
    });

    assert.deepEqual(result, { ok: false, reason: "email_not_allowed" });
  });
});

test("validateOpsPortalToken rejects token fallback when Cloudflare Access is required", async () => {
  await withCloudflareAccessEnv(async () => {
    process.env.OPS_CLOUDFLARE_ACCESS_ISSUER = "https://neontrip.cloudflareaccess.com";
    process.env.OPS_CLOUDFLARE_ACCESS_AUD = "aud-neontrip-ops";
    process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS = "true";
    process.env.OPS_PORTAL_TOKEN = "preview-token";

    assert.equal(validateOpsPortalToken("preview-token"), false);
  });
});

test("validateOpsPortalToken accepts primary and separate Control Tower tokens", async () => {
  await withCloudflareAccessEnv(async () => {
    delete process.env.OPS_CLOUDFLARE_ACCESS_ISSUER;
    delete process.env.OPS_CLOUDFLARE_ACCESS_AUD;
    delete process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS;
    process.env.OPS_PORTAL_TOKEN = "primary-preview-token";
    process.env.CONTROL_TOWER_OPS_PORTAL_TOKEN = "control-tower-operator-token";

    assert.equal(validateOpsPortalToken("primary-preview-token"), true);
    assert.equal(validateOpsPortalToken("control-tower-operator-token"), true);
    assert.equal(validateOpsPortalToken("different-token"), false);
  });
});

test("Coolify sync keeps the Control Tower token separate and reversible", () => {
  const workflow = readFileSync(".github/workflows/coolify-secret-sync.yml", "utf8");

  assert.match(workflow, /sync_ops_control_tower_portal_token/);
  assert.match(workflow, /delete_ops_control_tower_portal_token/);
  assert.match(workflow, /const key = "CONTROL_TOWER_OPS_PORTAL_TOKEN"/);
  assert.match(workflow, /refusing destructive rotation/);
  assert.match(workflow, /previous: previous \? envSummary\(previous\) : null/);
  assert.match(workflow, /valueSha256Prefix/);
  assert.doesNotMatch(workflow, /const key = "OPS_PORTAL_TOKEN";/);
});
