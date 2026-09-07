import { z } from "zod";
import { SCOPES, type Identity, type Scope, type ServiceName } from "./types.js";

const scopeSchema = z.enum(SCOPES);
const identitySchema = z.object({
  clientId: z.string().trim().min(3).max(120),
  actor: z.string().trim().min(3).max(180),
  role: z.enum(["billing_automation", "operator"]),
  tokenSha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  scopes: z.array(scopeSchema).min(1),
  expiresAt: z.number().int().positive(),
}).strict();

const automationScopes = new Set<Scope>([
  "system:read",
  "billing:read",
  "billing:change:accept",
]);

export type GatewayConfig = {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  publicUrl: URL;
  allowedHosts: string[];
  allowedOrigins: string[];
  identities: Identity[];
  requiredServices: ServiceName[];
  requestTimeoutMs: number;
  maxResponseBytes: number;
  requestsPerMinute: number;
  allowDecisionCustomerEmail: boolean;
  ops?: { baseUrl: URL; accessClientId: string; accessClientSecret: string };
  offers?: { baseUrl: URL; apiKey: string };
};

function csv(value: string | undefined) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function requiredUrl(name: string, value: string | undefined, env: GatewayConfig["env"], allowPath = false) {
  const parsed = new URL(String(value || ""));
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(env !== "production" && local)) {
    throw new Error(`${name} muss HTTPS verwenden.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} darf keine Zugangsdaten, Query oder Fragmente enthalten.`);
  }
  if (!allowPath && parsed.pathname !== "/") throw new Error(`${name} muss eine reine Origin-URL sein.`);
  return parsed;
}

function optionalServiceUrl(name: string, value: string | undefined, env: GatewayConfig["env"]) {
  const normalized = String(value || "").trim();
  return normalized ? requiredUrl(name, normalized, env) : undefined;
}

function parseIdentities(value: string | undefined): Identity[] {
  let input: unknown;
  try {
    input = JSON.parse(String(value || "[]"));
  } catch {
    throw new Error("MCP_IDENTITIES_JSON ist kein gültiges JSON.");
  }
  const identities = z.array(identitySchema).min(1).parse(input);
  const now = Math.floor(Date.now() / 1000);
  const seenClients = new Set<string>();
  const seenHashes = new Set<string>();
  for (const identity of identities) {
    if (identity.expiresAt <= now) throw new Error(`MCP-Identität ${identity.clientId} ist abgelaufen.`);
    if (seenClients.has(identity.clientId) || seenHashes.has(identity.tokenSha256)) {
      throw new Error("MCP-Identitäten müssen eindeutige Client-IDs und Token-Hashes haben.");
    }
    seenClients.add(identity.clientId);
    seenHashes.add(identity.tokenSha256);
    if (identity.role === "billing_automation" && identity.scopes.some((scope) => !automationScopes.has(scope))) {
      throw new Error(`Automations-Identität ${identity.clientId} hat unzulässige Rechte.`);
    }
  }
  return identities;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const nodeEnv = z.enum(["development", "test", "production"]).catch("development").parse(env.NODE_ENV);
  const publicUrl = requiredUrl("MCP_PUBLIC_URL", env.MCP_PUBLIC_URL || "http://localhost:8787/mcp", nodeEnv, true);
  const opsBaseUrl = optionalServiceUrl("OPS_BASE_URL", env.OPS_BASE_URL, nodeEnv);
  const offersBaseUrl = optionalServiceUrl("OFFERS_BASE_URL", env.OFFERS_BASE_URL, nodeEnv);
  const requiredServices = z.array(z.enum(["billing", "offers"])).parse(csv(env.MCP_REQUIRED_SERVICES || "billing,offers"));

  return {
    env: nodeEnv,
    host: env.MCP_HOST || "127.0.0.1",
    port: z.coerce.number().int().min(1).max(65535).catch(8787).parse(env.MCP_PORT),
    publicUrl,
    allowedHosts: csv(env.MCP_ALLOWED_HOSTS || publicUrl.hostname),
    allowedOrigins: csv(env.MCP_ALLOWED_ORIGINS),
    identities: parseIdentities(env.MCP_IDENTITIES_JSON),
    requiredServices,
    requestTimeoutMs: z.coerce.number().int().min(500).max(30_000).catch(8_000).parse(env.MCP_REQUEST_TIMEOUT_MS),
    maxResponseBytes: z.coerce.number().int().min(10_000).max(5_000_000).catch(1_500_000).parse(env.MCP_MAX_RESPONSE_BYTES),
    requestsPerMinute: z.coerce.number().int().min(10).max(10_000).catch(240).parse(env.MCP_REQUESTS_PER_MINUTE),
    allowDecisionCustomerEmail: env.MCP_ALLOW_BILLING_DECISION_CUSTOMER_EMAIL === "true",
    ...(opsBaseUrl && env.OPS_ACCESS_CLIENT_ID && env.OPS_ACCESS_CLIENT_SECRET
      ? { ops: { baseUrl: opsBaseUrl, accessClientId: env.OPS_ACCESS_CLIENT_ID, accessClientSecret: env.OPS_ACCESS_CLIENT_SECRET } }
      : {}),
    ...(offersBaseUrl && env.OFFERS_INTERNAL_API_KEY
      ? { offers: { baseUrl: offersBaseUrl, apiKey: env.OFFERS_INTERNAL_API_KEY } }
      : {}),
  };
}

export function missingRequiredServices(config: GatewayConfig): ServiceName[] {
  return config.requiredServices.filter((service) => service === "billing" ? !config.ops : !config.offers);
}
