import assert from "node:assert/strict";
import test from "node:test";
import { assertProtectedResult } from "./smoke_customer_records_ops.mjs";

test("protected smoke accepts Cloudflare Access redirects and auth failures", () => {
  for (const status of [401, 403, 302, 303, 307, 308]) {
    assert.doesNotThrow(() => assertProtectedResult({ path: "/ops", status, contentType: "", body: "" }));
  }
});

test("protected smoke accepts the Cloudflare Access sign-in document returned with HTTP 200", () => {
  assert.doesNotThrow(() => assertProtectedResult({
    path: "/ops",
    status: 200,
    contentType: "text/html; charset=UTF-8",
    body: `<!doctype html><html><head>
      <title>Sign in ・ Cloudflare Access</title>
      <meta name="robots" content="noindex" />
    </head></html>`,
  }));
});

test("protected smoke rejects an unprotected application page", () => {
  assert.throws(() => assertProtectedResult({
    path: "/ops",
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>NEONTRIP Ops</title>",
  }), /sollte ohne Cloudflare-Access-Login geblockt sein/);
});

test("protected smoke rejects server errors", () => {
  assert.throws(() => assertProtectedResult({
    path: "/ops",
    status: 500,
    contentType: "text/plain",
    body: "internal error",
  }));
});
