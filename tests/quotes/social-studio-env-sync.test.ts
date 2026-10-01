import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import crypto from "node:crypto";

const yaml = readFileSync(".github/workflows/coolify-secret-sync.yml", "utf8");
const code = yaml
  .split("          node <<'NODE'\n")[1]
  .split("\n          NODE")[0];
const ops = "zs80848k80oskk0ow0kc0cos";
async function run(
  options: { uuid?: string; domain?: string; existing?: string } = {},
) {
  const key = "a".repeat(64),
    envs: any[] = [
      { key: "UNRELATED_SETTING", value: "preserve", is_preview: false },
      {
        key: "SUPABASE_URL",
        value: "https://klibiejfisijpagzkxls.supabase.co",
        is_preview: false,
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        value: "fixture-server-only",
        is_preview: false,
      },
    ],
    logs: string[] = [],
    errors: string[] = [],
    writes: any[] = [],
    exits: number[] = [];
  if (options.existing)
    envs.push({
      key: "STUDIO_GATEWAY_KEY",
      value: options.existing,
      is_preview: false,
    });
  const program = new Script(code);
  await program.runInNewContext({
    require: (n: string) => {
      assert.equal(n, "crypto");
      return crypto;
    },
    URL,
    process: {
      env: {
        MODE: "sync_ops_social_studio_credentials",
        OPS_KIND: "application",
        OPS_UUID: options.uuid || ops,
        STUDIO_GATEWAY_KEY: key,
        COOLIFY_DEPLOY_WEBHOOK: "https://coolify-test.invalid/deploy",
        COOLIFY_API_TOKEN: "fixture-only",
      },
      exit: (n: number) => exits.push(n),
    },
    console: {
      log: (x: string) => logs.push(x),
      error: (x: string) => errors.push(x),
    },
    fetch: async (url: string, init: any = {}) => {
      const u = new URL(url);
      assert.equal(u.hostname, "coolify-test.invalid");
      if (u.pathname === `/api/v1/applications/${ops}`)
        return Response.json({
          uuid: ops,
          fqdn: options.domain || "https://ops.neontrip.de",
        });
      assert.equal(
        u.pathname,
        `/api/v1/applications/${ops}/envs`,
        "Must never restart or deploy Ops",
      );
      if (!init.method) return Response.json(envs.map((x) => ({ ...x })));
      const b = JSON.parse(init.body);
      writes.push(b);
      const current = envs.find((e) => e.key === b.key);
      if (init.method === "PATCH" && !current)
        return new Response("not found", { status: 404 });
      if (current) Object.assign(current, b);
      else envs.push(b);
      return Response.json({ ok: true });
    },
  });
  return { logs, errors, writes, envs, key, exits };
}
test("Social Studio configuration: exactly two runtime keys, unrelated settings preserved, no restart or secret logs", async () => {
  const r = await run();
  assert.deepEqual([...new Set(r.writes.map((w) => w.key))].sort(), [
    "STUDIO_GATEWAY_KEY",
    "STUDIO_GATEWAY_URL",
  ]);
  assert.deepEqual(r.envs[0], {
    key: "UNRELATED_SETTING",
    value: "preserve",
    is_preview: false,
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.logs.join("").includes(r.key), false);
  assert.equal(JSON.parse(r.logs[0]).restarted, false);
  assert.ok(
    r.writes.every((w) => w.is_runtime && !w.is_buildtime && !w.is_preview),
  );
});
test("Social Studio configuration: wrong resource or domain cannot write any environment", async () => {
  for (const options of [
    { uuid: "other-business" },
    { domain: "https://unrelated.invalid" },
  ]) {
    const r = await run(options);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(r.exits, [1]);
  }
});
test("Social Studio configuration: a different existing key is preserved for review", async () => {
  const r = await run({ existing: "existing-value" });
  assert.equal(r.writes.length, 0);
  assert.equal(
    r.envs.find((e) => e.key === "STUDIO_GATEWAY_KEY")?.value,
    "existing-value",
  );
  assert.deepEqual(r.exits, [1]);
});
