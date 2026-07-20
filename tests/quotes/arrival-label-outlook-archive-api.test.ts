import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/internal/arrival-labels/outlook-archives/process/route";

const TOKEN = "arrival-label-agent-test-token";
const WORKER_ID = "n8n-outlook-archive:test";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "AAMk-source-message-id";
const TRACKING = "5065735500";

function request(token = TOKEN, workerId = WORKER_ID) {
  return new NextRequest("https://ops.example.invalid/api/internal/arrival-labels/outlook-archives/process", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Neontrip-Outlook-Archive-Worker": workerId,
    },
    body: JSON.stringify({ workerId }),
  });
}

async function withEnvironment<T>(run: () => Promise<T>) {
  const names = [
    "ARRIVAL_LABEL_AGENT_API_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MICROSOFT_GRAPH_TENANT_ID",
    "MICROSOFT_GRAPH_CLIENT_ID",
    "MICROSOFT_GRAPH_CLIENT_SECRET",
    "MICROSOFT_GRAPH_MAILBOX",
    "DHL_EXPRESS_SENDER_DOMAINS",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = TOKEN;
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.MICROSOFT_GRAPH_TENANT_ID = "tenant-test";
  process.env.MICROSOFT_GRAPH_CLIENT_ID = "client-test";
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = "secret-test";
  process.env.MICROSOFT_GRAPH_MAILBOX = "support@example.invalid";
  process.env.DHL_EXPRESS_SENDER_DOMAINS = "dhl.com";
  try {
    return await run();
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = previousFetch;
  }
}

test("archive processor requires bearer plus matching worker header", async () => {
  await withEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const unauthorized = await POST(request("wrong-token"));
    assert.equal(unauthorized.status, 401);
    const mismatch = new NextRequest("https://ops.example.invalid/process", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "X-Neontrip-Outlook-Archive-Worker": "different-worker",
      },
      body: JSON.stringify({ workerId: WORKER_ID }),
    });
    const invalid = await POST(mismatch);
    assert.equal(invalid.status, 400);
    assert.equal(called, false);
  });
});

test("archive processor durably marks dispatching before exactly one Graph move", async () => {
  await withEnvironment(async () => {
    const actions: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/rpc/arrival_labels_claim_outlook_archive")) {
        actions.push("claim");
        return Response.json([{
          id: JOB_ID,
          case_id: "22222222-2222-4222-8222-222222222222",
          print_job_id: "33333333-3333-4333-8333-333333333333",
          idempotency_key: `arrival-outlook-archive:${"a".repeat(64)}`,
          source_message_id: SOURCE_ID,
          source_message_id_sha256: "b".repeat(64),
          expected_tracking_number: TRACKING,
          status: "claimed",
          attempts: 1,
          max_attempts: 3,
          lease_owner: WORKER_ID,
          lease_expires_at: "2026-07-20T20:00:00Z",
          moved_message_id: null,
          last_error: null,
        }]);
      }
      if (url.includes("login.microsoftonline.com")) return Response.json({ access_token: "graph-token" });
      if (url.includes("/mailFolders/inbox")) return Response.json({ id: "inbox-folder-id" });
      if (url.includes(`/messages/${SOURCE_ID}/move`)) {
        actions.push("move");
        return Response.json({ id: "AAMk-moved-message-id" }, { status: 201 });
      }
      if (url.includes(`/messages/${SOURCE_ID}`)) {
        return Response.json({
          id: SOURCE_ID,
          parentFolderId: "inbox-folder-id",
          subject: `DHL Express Sendungsnummer ${TRACKING}`,
          body: { contentType: "text", content: `DHL Express Sendungsnummer ${TRACKING}` },
          from: { emailAddress: { address: "tracking@express.dhl.com" } },
        });
      }
      if (url.includes("/rpc/arrival_labels_update_outlook_archive")) {
        const body = JSON.parse(String(init?.body || "{}")) as { p_result?: string; p_moved_message_id?: string };
        actions.push(String(body.p_result));
        return Response.json([{ status: body.p_result, moved_message_id: body.p_moved_message_id || null }]);
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const response = await POST(request());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, "archived");
    assert.deepEqual(actions, ["claim", "dispatching", "move", "archived"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("archive processor turns a post-dispatch Graph failure into manual review without retry", async () => {
  await withEnvironment(async () => {
    let moveCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/rpc/arrival_labels_claim_outlook_archive")) {
        return Response.json([{
          id: JOB_ID,
          source_message_id: SOURCE_ID,
          expected_tracking_number: TRACKING,
          status: "claimed",
        }]);
      }
      if (url.includes("login.microsoftonline.com")) return Response.json({ access_token: "graph-token" });
      if (url.includes("/mailFolders/inbox")) return Response.json({ id: "inbox-folder-id" });
      if (url.includes(`/messages/${SOURCE_ID}/move`)) { moveCalls += 1; return new Response("timeout", { status: 503 }); }
      if (url.includes(`/messages/${SOURCE_ID}`)) {
        return Response.json({
          id: SOURCE_ID,
          parentFolderId: "inbox-folder-id",
          subject: `DHL Express Sendungsnummer ${TRACKING}`,
          body: { content: `DHL Express Sendungsnummer ${TRACKING}` },
          from: { emailAddress: { address: "tracking@dhl.com" } },
        });
      }
      if (url.includes("/rpc/arrival_labels_update_outlook_archive")) {
        const body = JSON.parse(String(init?.body || "{}")) as { p_result?: string };
        return Response.json([{ status: body.p_result === "uncertain" ? "manual_review" : body.p_result }]);
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const response = await POST(request());
    const payload = await response.json();
    assert.equal(payload.status, "manual_review");
    assert.equal(moveCalls, 1);
  });
});
