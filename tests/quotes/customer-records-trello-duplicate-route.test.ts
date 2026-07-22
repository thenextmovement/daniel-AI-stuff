import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/ops/customer-records/trello-card/duplicate/route";

test("trello duplicate route rejects requests without an Ops session", async () => {
  const originalEnv = {
    OPS_CLOUDFLARE_ACCESS_ISSUER: process.env.OPS_CLOUDFLARE_ACCESS_ISSUER,
    OPS_CLOUDFLARE_ACCESS_AUD: process.env.OPS_CLOUDFLARE_ACCESS_AUD,
    OPS_REQUIRE_CLOUDFLARE_ACCESS: process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS,
  };
  process.env.OPS_CLOUDFLARE_ACCESS_ISSUER = "https://access.example.test";
  process.env.OPS_CLOUDFLARE_ACCESS_AUD = "ops-test-audience";
  process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS = "true";

  try {
    const response = await POST(
      new NextRequest("https://ops.neontrip.de/api/ops/customer-records/trello-card/duplicate", {
        method: "POST",
        headers: { host: "ops.neontrip.de", "Content-Type": "application/json" },
        body: JSON.stringify({
          duplicate: {
            cardUrl: "https://trello.com/c/example/example",
            customer: { firstName: "Ada", email: "ada@example.com" },
          },
        }),
      }),
    );
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.deepEqual(payload, { ok: false, error: "unauthorized" });
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
