export const SCOPES = [
  "system:read",
  "billing:read",
  "billing:change:accept",
  "billing:change:draft",
  "billing:change:reject",
  "billing:actions",
  "offers:read",
  "offers:write",
  "offers:send",
] as const;

export type Scope = (typeof SCOPES)[number];
export type IdentityRole = "billing_automation" | "operator";

export type Identity = {
  clientId: string;
  actor: string;
  role: IdentityRole;
  tokenSha256: string;
  scopes: Scope[];
  expiresAt: number;
};

export type ServiceName = "billing" | "offers";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ToolSuccess = {
  ok: true;
  data: JsonValue;
  meta: { capability: string; correlationId: string };
};

export type ToolFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requiresHumanReview: boolean;
  };
  meta: { capability: string; correlationId: string };
};

export type ToolEnvelope = ToolSuccess | ToolFailure;
