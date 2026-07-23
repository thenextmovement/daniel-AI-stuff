import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/internal/arrival-labels/trello-arrivals/process/route";

const TOKEN = "arrival-label-agent-test-token";
const WORKER_ID = "n8n-arrival-finalizer:test";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const CARD_ID = "0123456789abcdef01234567";
const BOARD_ID = "62bae9b97705e7419ed64593";
const SOURCE_LIST_ID = "6347e09cb326e6014856bc3b";
const TARGET_LIST_ID = "646c788ae63245624b6d6a7a";
const TRACKING = "5065735500";

function request(token = TOKEN, workerId = WORKER_ID) {
  return new NextRequest("https://ops.example.invalid/api/internal/arrival-labels/trello-arrivals/process", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Neontrip-Trello-Arrival-Worker": workerId,
    },
    body: JSON.stringify({ workerId }),
  });
}

async function withEnvironment<T>(run: () => Promise<T>) {
  const names = [
    "ARRIVAL_LABEL_AGENT_API_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TRELLO_API_KEY",
    "TRELLO_TOKEN",
    "ARRIVAL_LABEL_TRELLO_BOARD_ID",
    "ARRIVAL_LABEL_TRELLO_SIGN_SHIPPED_LIST_ID",
    "ARRIVAL_LABEL_TRELLO_SIGN_ARRIVED_LIST_ID",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = TOKEN;
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";
  process.env.ARRIVAL_LABEL_TRELLO_BOARD_ID = BOARD_ID;
  process.env.ARRIVAL_LABEL_TRELLO_SIGN_SHIPPED_LIST_ID = SOURCE_LIST_ID;
  process.env.ARRIVAL_LABEL_TRELLO_SIGN_ARRIVED_LIST_ID = TARGET_LIST_ID;
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

test("Trello arrival processor requires bearer plus matching worker header", async () => {
  await withEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    assert.equal((await POST(request("wrong-token"))).status, 401);
    const mismatch = new NextRequest("https://ops.example.invalid/process", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "X-Neontrip-Trello-Arrival-Worker": "different-worker",
      },
      body: JSON.stringify({ workerId: WORKER_ID }),
    });
    assert.equal((await POST(mismatch)).status, 400);
    assert.equal(called, false);
  });
});

test("Trello arrival processor marks dispatching before exactly one move", async () => {
  await withEnvironment(async () => {
    const actions: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/rpc/arrival_labels_claim_trello_arrival")) {
        actions.push("claim");
        return Response.json([{
          id: JOB_ID,
          trello_card_id: CARD_ID,
          expected_tracking_number: TRACKING,
          status: "claimed",
        }]);
      }
      if (url.includes("/rpc/arrival_labels_update_trello_arrival")) {
        const body = JSON.parse(String(init?.body || "{}")) as { p_result?: string; p_moved_card_id?: string };
        actions.push(String(body.p_result));
        return Response.json([{ status: body.p_result, moved_card_id: body.p_moved_card_id || null }]);
      }
      if (url.includes(`/1/cards/${CARD_ID}`) && String(init?.method || "GET") === "PUT") {
        actions.push("move");
        return Response.json({ id: CARD_ID, idList: TARGET_LIST_ID });
      }
      if (url.includes(`/1/cards/${CARD_ID}`)) {
        return Response.json({ id: CARD_ID, name: `${TRACKING} | #NEONT100`, desc: "", idBoard: BOARD_ID, idList: SOURCE_LIST_ID, closed: false });
      }
      if (url.includes(`/1/lists/${SOURCE_LIST_ID}`)) {
        return Response.json({ id: SOURCE_LIST_ID, name: "Sign SHIPPED (NEON TRIP)", idBoard: BOARD_ID, closed: false });
      }
      if (url.includes(`/1/lists/${TARGET_LIST_ID}`)) {
        return Response.json({ id: TARGET_LIST_ID, name: "Sign Arrived", idBoard: BOARD_ID, closed: false });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const response = await POST(request());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, "moved");
    assert.deepEqual(actions, ["claim", "dispatching", "move", "moved"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("post-dispatch Trello failure becomes manual review and is not retried", async () => {
  await withEnvironment(async () => {
    let moveCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/rpc/arrival_labels_claim_trello_arrival")) {
        return Response.json([{ id: JOB_ID, trello_card_id: CARD_ID, expected_tracking_number: TRACKING, status: "claimed" }]);
      }
      if (url.includes("/rpc/arrival_labels_update_trello_arrival")) {
        const body = JSON.parse(String(init?.body || "{}")) as { p_result?: string };
        return Response.json([{ status: body.p_result === "uncertain" ? "manual_review" : body.p_result }]);
      }
      if (url.includes(`/1/cards/${CARD_ID}`) && String(init?.method || "GET") === "PUT") {
        moveCalls += 1;
        return new Response("timeout", { status: 503 });
      }
      if (url.includes(`/1/cards/${CARD_ID}`)) {
        return Response.json({ id: CARD_ID, name: `${TRACKING} | #NEONT100`, desc: "", idBoard: BOARD_ID, idList: SOURCE_LIST_ID, closed: false });
      }
      if (url.includes(`/1/lists/${SOURCE_LIST_ID}`)) {
        return Response.json({ id: SOURCE_LIST_ID, name: "Sign SHIPPED (NEON TRIP)", idBoard: BOARD_ID, closed: false });
      }
      if (url.includes(`/1/lists/${TARGET_LIST_ID}`)) {
        return Response.json({ id: TARGET_LIST_ID, name: "Sign Arrived", idBoard: BOARD_ID, closed: false });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const response = await POST(request());
    const payload = await response.json();
    assert.equal(payload.status, "manual_review");
    assert.equal(moveCalls, 1);
  });
});
