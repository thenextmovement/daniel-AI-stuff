import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../../src/app/api/ops/neon-studio/[[...path]]/route";

test("Neon Studio forwards manufacturing checks and keeps unrelated paths blocked", async () => {
  const keys = ["NODE_ENV", "NEON_STUDIO_URL", "NEON_STUDIO_TOKEN"] as const;
  const saved = keys.map((key) => process.env[key]);
  const env = process.env as Record<string, string | undefined>;
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  const body = JSON.stringify({ id: "test-project", settings: { width: 600 }, profile: { minBendRadius: 25 } });
  try {
    env.NODE_ENV = "development";
    env.NEON_STUDIO_URL = "http://studio.test:8080";
    env.NEON_STUDIO_TOKEN = "test-only";
    globalThis.fetch = async (input, options) => {
      calls.push({ url: String(input), body: Buffer.from(options?.body as ArrayBuffer).toString() });
      return Response.json({ approved: false, spacingWidth: 1550 });
    };
    const request = (path: string, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/ops/neon-studio/${path}`, {
      method: "POST", headers: { host: "localhost:3000", origin, "content-type": "application/json" }, body,
    });
    const context = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
    const response = await POST(request("api/manufacturing"), context("api/manufacturing"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { approved: false, spacingWidth: 1550 });
    assert.deepEqual(calls, [{ url: "http://studio.test:8080/api/manufacturing", body }]);
    assert.equal((await POST(request("api/admin"), context("api/admin"))).status, 404);
    assert.equal((await POST(request("api/manufacturing", "https://untrusted.test"), context("api/manufacturing"))).status, 403);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete env[key]; else env[key] = saved[index]; });
  }
});
