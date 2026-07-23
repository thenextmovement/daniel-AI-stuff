import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectExactTrelloArrivalTarget,
  moveInspectedTrelloCardToSignArrivedTopOnce,
  TrelloArrivalProjectionError,
} from "../../src/lib/ops/arrival-labels/trello-arrival";

const BOARD_ID = "62bae9b97705e7419ed64593";
const SOURCE_LIST_ID = "6347e09cb326e6014856bc3b";
const TARGET_LIST_ID = "646c788ae63245624b6d6a7a";
const CARD_ID = "0123456789abcdef01234567";
const TRACKING = "5065735500";

async function withTrelloEnvironment<T>(fetchImplementation: typeof fetch, run: () => Promise<T>) {
  const names = [
    "TRELLO_API_KEY",
    "TRELLO_TOKEN",
    "ARRIVAL_LABEL_TRELLO_BOARD_ID",
    "ARRIVAL_LABEL_TRELLO_SIGN_SHIPPED_LIST_ID",
    "ARRIVAL_LABEL_TRELLO_SIGN_ARRIVED_LIST_ID",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";
  process.env.ARRIVAL_LABEL_TRELLO_BOARD_ID = BOARD_ID;
  process.env.ARRIVAL_LABEL_TRELLO_SIGN_SHIPPED_LIST_ID = SOURCE_LIST_ID;
  process.env.ARRIVAL_LABEL_TRELLO_SIGN_ARRIVED_LIST_ID = TARGET_LIST_ID;
  globalThis.fetch = fetchImplementation;
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

function exactReadResponse(url: string) {
  if (url.includes(`/1/cards/${CARD_ID}`)) {
    return Response.json({
      id: CARD_ID,
      name: `${TRACKING} | #NEONT100`,
      desc: "",
      idBoard: BOARD_ID,
      idList: SOURCE_LIST_ID,
      closed: false,
    });
  }
  if (url.includes(`/1/lists/${SOURCE_LIST_ID}`)) {
    return Response.json({ id: SOURCE_LIST_ID, name: "Sign SHIPPED (NEON TRIP)", idBoard: BOARD_ID, closed: false });
  }
  if (url.includes(`/1/lists/${TARGET_LIST_ID}`)) {
    return Response.json({ id: TARGET_LIST_ID, name: "Sign Arrived", idBoard: BOARD_ID, closed: false });
  }
  throw new Error(`unexpected URL ${url}`);
}

test("Trello arrival revalidates Quentin, both lists and the full DHL number before one top move", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  await withTrelloEnvironment(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    requests.push({ url, method, body: String(init?.body || "") });
    if (method === "PUT") {
      return Response.json({ id: CARD_ID, idList: TARGET_LIST_ID });
    }
    return exactReadResponse(url);
  }, async () => {
    const target = await inspectExactTrelloArrivalTarget({ cardId: CARD_ID, expectedTrackingNumber: TRACKING });
    const moved = await moveInspectedTrelloCardToSignArrivedTopOnce(target);
    assert.equal(moved.movedCardId, CARD_ID);
    assert.equal(moved.alreadyAtTarget, false);
  });
  const moves = requests.filter((request) => request.method === "PUT");
  assert.equal(moves.length, 1);
  const body = new URLSearchParams(moves[0]?.body);
  assert.equal(body.get("idList"), TARGET_LIST_ID);
  assert.equal(body.get("pos"), "top");
});

test("Trello arrival rejects a full-tracking mismatch before any move", async () => {
  let moveCalls = 0;
  await withTrelloEnvironment(async (input, init) => {
    if (String(init?.method || "GET") === "PUT") moveCalls += 1;
    const response = exactReadResponse(String(input));
    if (String(input).includes(`/1/cards/${CARD_ID}`)) {
      return Response.json({
        id: CARD_ID,
        name: "5065735599 | #NEONT100",
        desc: "",
        idBoard: BOARD_ID,
        idList: SOURCE_LIST_ID,
        closed: false,
      });
    }
    return response;
  }, async () => {
    await assert.rejects(
      inspectExactTrelloArrivalTarget({ cardId: CARD_ID, expectedTrackingNumber: TRACKING }),
      (error: unknown) => error instanceof TrelloArrivalProjectionError && error.code === "trello_arrival_tracking_mismatch",
    );
  });
  assert.equal(moveCalls, 0);
});

test("Trello arrival does not synthesize a tracking number across unrelated digit groups", async () => {
  await withTrelloEnvironment(async (input) => {
    const url = String(input);
    if (url.includes(`/1/cards/${CARD_ID}`)) {
      return Response.json({
        id: CARD_ID,
        name: "50657 | Auftrag 35500",
        desc: "",
        idBoard: BOARD_ID,
        idList: SOURCE_LIST_ID,
        closed: false,
      });
    }
    return exactReadResponse(url);
  }, async () => {
    await assert.rejects(
      inspectExactTrelloArrivalTarget({ cardId: CARD_ID, expectedTrackingNumber: TRACKING }),
      (error: unknown) => error instanceof TrelloArrivalProjectionError && error.code === "trello_arrival_tracking_mismatch",
    );
  });
});

test("Trello arrival is idempotent when the exact card is already in Sign Arrived", async () => {
  let moveCalls = 0;
  await withTrelloEnvironment(async (input, init) => {
    if (String(init?.method || "GET") === "PUT") moveCalls += 1;
    const url = String(input);
    if (url.includes(`/1/cards/${CARD_ID}`)) {
      return Response.json({
        id: CARD_ID,
        name: `${TRACKING} | #NEONT100`,
        desc: "",
        idBoard: BOARD_ID,
        idList: TARGET_LIST_ID,
        closed: false,
      });
    }
    return exactReadResponse(url);
  }, async () => {
    const target = await inspectExactTrelloArrivalTarget({ cardId: CARD_ID, expectedTrackingNumber: TRACKING });
    const moved = await moveInspectedTrelloCardToSignArrivedTopOnce(target);
    assert.equal(moved.alreadyAtTarget, true);
  });
  assert.equal(moveCalls, 0);
});

test("Trello move has no automatic retry after dispatch begins", async () => {
  let moveCalls = 0;
  await withTrelloEnvironment(async () => {
    moveCalls += 1;
    return new Response("temporary failure", { status: 503 });
  }, async () => {
    await assert.rejects(
      moveInspectedTrelloCardToSignArrivedTopOnce({
        cardId: CARD_ID,
        targetListId: TARGET_LIST_ID,
        alreadyAtTarget: false,
        authentication: { key: "trello-key", token: "trello-token" },
      }),
      (error: unknown) => error instanceof TrelloArrivalProjectionError && error.code === "trello_arrival_move_uncertain",
    );
  });
  assert.equal(moveCalls, 1);
});
