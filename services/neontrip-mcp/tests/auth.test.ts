import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { HashedTokenVerifier } from "../src/auth.js";
import type { Identity } from "../src/types.js";

const token = "test-token-that-is-never-a-production-secret";
const identity: Identity = {
  clientId: "billing-test",
  actor: "billing-test@neontrip",
  role: "billing_automation",
  tokenSha256: createHash("sha256").update(token).digest("hex"),
  scopes: ["system:read", "billing:read", "billing:change:accept"],
  expiresAt: Math.floor(Date.now() / 1000) + 3_600,
};

test("verifies a hashed, unexpired token and returns its constrained identity", async () => {
  const verifier = new HashedTokenVerifier([identity], new URL("https://mcp.example.test/mcp"));
  const auth = await verifier.verifyAccessToken(token);
  assert.equal(auth.clientId, identity.clientId);
  assert.deepEqual(auth.scopes, identity.scopes);
  assert.equal(auth.extra?.role, "billing_automation");
});

test("rejects an unknown bearer token", async () => {
  const verifier = new HashedTokenVerifier([identity], new URL("https://mcp.example.test/mcp"));
  await assert.rejects(() => verifier.verifyAccessToken("wrong-token"), /invalid or expired/i);
});
