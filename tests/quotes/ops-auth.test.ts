import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { validateCloudflareAccess, validateOpsPortalToken } from "../../src/lib/ops/auth";

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
