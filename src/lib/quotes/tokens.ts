import { randomBytes } from "crypto";

export function generateSecureShareToken() {
  return randomBytes(24).toString("base64url");
}
