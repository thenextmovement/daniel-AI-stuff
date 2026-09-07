import { createHash, timingSafeEqual } from "node:crypto";
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { Identity } from "./types.js";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function matchesHash(token: string, expectedHex: string) {
  const actual = sha256(token);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class HashedTokenVerifier implements OAuthTokenVerifier {
  constructor(private readonly identities: Identity[], private readonly resource: URL) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const identity = this.identities.find((candidate) => matchesHash(token, candidate.tokenSha256));
    const now = Math.floor(Date.now() / 1000);
    if (!identity || identity.expiresAt <= now) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or expired.");
    }
    return {
      token,
      clientId: identity.clientId,
      scopes: identity.scopes,
      expiresAt: identity.expiresAt,
      resource: this.resource,
      extra: { actor: identity.actor, role: identity.role },
    };
  }
}

export function identityFromAuth(authInfo: AuthInfo | undefined): Identity {
  if (!authInfo) throw new OAuthError(OAuthErrorCode.InvalidToken, "Authentication is required.");
  const actor = typeof authInfo.extra?.actor === "string" ? authInfo.extra.actor : "";
  const role = authInfo.extra?.role;
  if (!actor || (role !== "billing_automation" && role !== "operator")) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Authenticated identity is incomplete.");
  }
  return {
    clientId: authInfo.clientId,
    actor,
    role,
    tokenSha256: "",
    scopes: authInfo.scopes as Identity["scopes"],
    expiresAt: authInfo.expiresAt || 0,
  };
}
