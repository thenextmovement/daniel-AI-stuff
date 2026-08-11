import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

function sameSecret(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function hasServiceRoleCredential(headers, serviceRoleKey) {
  const apiKey = headers.apikey ?? "";
  const authorization = headers.authorization ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim() ?? "";
  return sameSecret(apiKey, serviceRoleKey) ||
    sameSecret(bearerToken, serviceRoleKey);
}

test("deployed source accepts either service-role header shape", () => {
  assert.match(source, /request\.headers\.get\("apikey"\)/);
  assert.match(source, /request\.headers\.get\("authorization"\)/);
  assert.match(source, /authorization\.match\(\/\^Bearer\\s\+\(\.\+\)\$\/i\)/);
  assert.match(source, /!hasServiceRoleCredential/);
  assert.doesNotMatch(
    source,
    /!sameSecret\(request\.headers\.get\("apikey"\)[\s\S]{0,80}SERVICE_ROLE_KEY\)/,
  );
});

test("service role is accepted from apikey", () => {
  assert.equal(
    hasServiceRoleCredential({ apikey: "service-secret" }, "service-secret"),
    true,
  );
});

test("service role is accepted from bearer authorization", () => {
  assert.equal(
    hasServiceRoleCredential(
      { authorization: "Bearer service-secret" },
      "service-secret",
    ),
    true,
  );
});

test("non-service credentials remain rejected", () => {
  assert.equal(
    hasServiceRoleCredential(
      { apikey: "anon-key", authorization: "Bearer user-jwt" },
      "service-secret",
    ),
    false,
  );
  assert.equal(hasServiceRoleCredential({}, "service-secret"), false);
});
