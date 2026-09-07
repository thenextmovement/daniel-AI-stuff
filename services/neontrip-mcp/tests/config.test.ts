import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadConfig, missingRequiredServices } from "../src/config.js";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  return {
    NODE_ENV: "test",
    MCP_PUBLIC_URL: "http://localhost:8787/mcp",
    MCP_IDENTITIES_JSON: JSON.stringify([{
      clientId: "billing-test",
      actor: "billing-test@neontrip",
      role: "billing_automation",
      tokenSha256: createHash("sha256").update("test-token").digest("hex"),
      scopes: ["system:read", "billing:read", "billing:change:accept"],
      expiresAt,
    }]),
    ...overrides,
  };
}

test("automation identities cannot receive operator scopes", () => {
  const parsed = JSON.parse(environment().MCP_IDENTITIES_JSON!);
  parsed[0].scopes.push("offers:write");
  assert.throws(() => loadConfig(environment({ MCP_IDENTITIES_JSON: JSON.stringify(parsed) })), /unzulässige Rechte/);
});

test("production configuration requires HTTPS endpoints", () => {
  assert.throws(() => loadConfig(environment({ NODE_ENV: "production", MCP_PUBLIC_URL: "http://mcp.example.test/mcp" })), /HTTPS/);
});

test("readiness reports every required service without complete credentials", () => {
  const config = loadConfig(environment());
  assert.deepEqual(missingRequiredServices(config), ["billing", "offers"]);
});
