import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/ops/social-studio/route";
import catalog from "@/lib/ops/social-studio/catalog.json";
import {
  CHANNELS,
  FORMATS,
  type Texts,
} from "@/lib/ops/social-studio/studio-contract";

const id = catalog[0].id;
const texts = Object.fromEntries([
  ...CHANNELS.map((c) => [
    c,
    "Ein leuchtendes Schild. https://anfrage.neontrip.de",
  ]),
  ["pinterestTitle", "Leuchtendes Schild"],
]) as Texts;
const image = "/9j/" + "A".repeat(200);
const due = new Date(Date.now() + 86400000 * 10).toISOString();

async function harness(run: (s: any) => Promise<void>) {
  const originalFetch = globalThis.fetch,
    originalEnv = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "development",
    SUPABASE_URL: "https://studio-test.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only",
    STUDIO_GATEWAY_URL: "https://gateway-test.invalid",
    STUDIO_GATEWAY_KEY: "test-only",
  });
  const state = {
    drafts: [
      {
        id,
        texts: JSON.stringify(texts),
        revision: 1,
        status: "draft",
        due_at: null,
        approved_by: null,
        approved_at: null,
        updated_at: new Date().toISOString(),
      },
    ] as any[],
    deliveries: [] as any[],
    calls: [] as any[],
    posts: new Map(),
    timeout: false,
    changed: false,
  };
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input)),
      body = init?.body ? JSON.parse(String(init.body)) : null;
    if (u.hostname === "gateway-test.invalid") {
      state.calls.push(body);
      if (body.action === "reserve")
        return Response.json({
          ok: true,
          slot: {
            status: state.changed ? "changed" : "reserved",
            scheduled_at: due,
          },
        });
      if (body.action === "upload")
        return Response.json({
          ok: true,
          imageUrl: "https://media.invalid/" + body.format,
        });
      if (body.action === "publish") {
        const post = {
          id: "buffer-" + body.channel,
          status: "scheduled",
          dueAt: body.dueAt,
        };
        state.posts.set(post.id, post);
        if (state.timeout && body.channel === "ig")
          throw new Error("timeout after submission");
        return Response.json({ ok: true, post });
      }
      if (body.action === "edit") {
        const post = {
          id: body.bufferId,
          status: body.operation === "withdraw" ? "draft" : "scheduled",
          dueAt: body.dueAt,
        };
        state.posts.set(post.id, post);
        return Response.json({ ok: true, post });
      }
      if (body.action === "status")
        return Response.json({
          ok: true,
          data: { post: state.posts.get(body.bufferId) },
        });
      return Response.json({ ok: true, slot: { scheduled_at: due }, texts });
    }
    assert.equal(
      u.hostname,
      "studio-test.invalid",
      "Tests must never call a real database/provider",
    );
    const target = u.pathname.endsWith("neontrip_social_drafts")
      ? state.drafts
      : state.deliveries;
    const matches = (r: any) =>
      [...u.searchParams].every(([k, v]) =>
        v.startsWith("eq.")
          ? String(r[k]) === v.slice(3)
          : v.startsWith("in.")
            ? v.slice(4, -1).split(",").includes(String(r[k]))
            : true,
      );
    const found = target.filter(matches);
    if (init?.method === "PATCH") {
      found.forEach((r) => Object.assign(r, body));
      return Response.json(found);
    }
    if (init?.method === "POST") {
      for (const r of Array.isArray(body) ? body : [body])
        if (
          !target.some(
            (x) =>
              x.id === r.id &&
              x.draft_id === r.draft_id &&
              x.channel === r.channel,
          )
        )
          target.push(r);
      return Response.json([]);
    }
    return Response.json(found);
  };
  try {
    await run(state);
  } finally {
    globalThis.fetch = originalFetch;
    for (const k of Object.keys(process.env))
      if (!(k in originalEnv)) delete process.env[k];
    Object.assign(process.env, originalEnv);
  }
}
function request(body: object, origin = "http://localhost:3000") {
  return POST(
    new Request("http://localhost:3000/api/ops/social-studio", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}
const approval = {
  action: "approve",
  id,
  texts,
  revision: 1,
  images: { portrait: image, landscape: image, pin: image },
  confirmed: true,
  expectedDueAt: due,
};

test("Social Studio: rejects cross-origin changes before any database/provider call", () =>
  harness(async (s) => {
    const r = await request(approval, "https://unrelated.invalid");
    assert.equal(r.status, 403);
    assert.equal(s.calls.length, 0);
    assert.equal(s.drafts[0].revision, 1);
  }));
test("Social Studio: stale revision cannot overwrite a saved draft", () =>
  harness(async (s) => {
    const first = await request({ action: "save", id, texts, revision: 1 });
    assert.equal(first.status, 200);
    const stale = await request({ action: "save", id, texts, revision: 1 });
    assert.equal(stale.status, 409);
    assert.equal(s.drafts[0].revision, 2);
    assert.equal(s.calls.length, 0);
  }));
test("Social Studio: explicit approval is required before a reservation", () =>
  harness(async (s) => {
    const r = await request({ ...approval, confirmed: false });
    assert.equal(r.status, 400);
    assert.equal(s.calls.length, 0);
  }));
test("Social Studio: simultaneous approvals schedule exactly five platform posts with correct formats and trusted actor", () =>
  harness(async (s) => {
    await Promise.all([request(approval), request(approval)]);
    const published = s.calls.filter((x: any) => x.action === "publish");
    assert.equal(published.length, 5);
    assert.equal(s.calls.filter((x: any) => x.action === "reserve").length, 1);
    for (const p of published) {
      assert.equal(
        p.imageUrl,
        "https://media.invalid/" +
          FORMATS[p.channel as keyof typeof FORMATS].key,
      );
      assert.equal(p.dueAt, due);
    }
    assert.equal(s.drafts[0].status, "scheduled");
    assert.equal(s.drafts[0].approved_by, "local-ops");
    assert.equal(s.deliveries.length, 5);
    await request({ ...approval, revision: 2 });
    assert.equal(s.calls.filter((x: any) => x.action === "publish").length, 5);
  }));
test("Social Studio: changed slot requires another approval and creates no uploads or posts", () =>
  harness(async (s) => {
    s.changed = true;
    const r = await request(approval);
    assert.equal(r.status, 409);
    assert.equal(s.drafts[0].status, "draft");
    assert.equal(
      s.calls.filter((x: any) => ["upload", "publish"].includes(x.action))
        .length,
      0,
    );
  }));
test("Social Studio: ambiguous provider result stays manual_review and is never blindly retried", () =>
  harness(async (s) => {
    s.timeout = true;
    await request(approval);
    assert.equal(s.drafts[0].status, "manual_review");
    await request({ ...approval, revision: 2 });
    assert.equal(s.calls.filter((x: any) => x.action === "publish").length, 5);
    const withdraw = await request({
      action: "withdraw",
      id,
      revision: 2,
      confirmed: true,
    });
    assert.equal(withdraw.status, 400);
    assert.equal(s.calls.filter((x: any) => x.action === "edit").length, 0);
  }));
test("Social Studio: withdrawal and reapproval reuse the same Buffer IDs", () =>
  harness(async (s) => {
    await request(approval);
    const ids = s.deliveries.map((x: any) => x.buffer_id).sort();
    const r = await request({
      action: "withdraw",
      id,
      revision: 2,
      confirmed: true,
    });
    assert.equal(r.status, 200);
    assert.equal(s.drafts[0].status, "draft");
    await request({ ...approval, revision: 3 });
    assert.equal(s.drafts[0].status, "scheduled");
    assert.deepEqual(s.deliveries.map((x: any) => x.buffer_id).sort(), ids);
    assert.equal(s.calls.filter((x: any) => x.action === "publish").length, 5);
  }));
