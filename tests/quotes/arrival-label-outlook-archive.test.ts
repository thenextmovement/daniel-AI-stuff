import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectExactDhlOutlookArchiveTarget,
  moveInspectedOutlookMessageToArchiveOnce,
  OutlookArchiveTargetError,
} from "../../src/lib/ops/arrival-labels/outlook-archive";

const SOURCE_ID = "AAMk-source-message-id";
const TRACKING = "2527991432";

async function withGraphEnvironment<T>(fetchImplementation: typeof fetch, run: () => Promise<T>) {
  const previous = {
    tenant: process.env.MICROSOFT_GRAPH_TENANT_ID,
    client: process.env.MICROSOFT_GRAPH_CLIENT_ID,
    secret: process.env.MICROSOFT_GRAPH_CLIENT_SECRET,
    mailbox: process.env.MICROSOFT_GRAPH_MAILBOX,
    domains: process.env.DHL_EXPRESS_SENDER_DOMAINS,
    fetch: globalThis.fetch,
  };
  process.env.MICROSOFT_GRAPH_TENANT_ID = "tenant-test";
  process.env.MICROSOFT_GRAPH_CLIENT_ID = "client-test";
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = "secret-test";
  process.env.MICROSOFT_GRAPH_MAILBOX = "support@example.invalid";
  process.env.DHL_EXPRESS_SENDER_DOMAINS = "dhl.com";
  globalThis.fetch = fetchImplementation;
  try {
    return await run();
  } finally {
    for (const [name, value] of [
      ["MICROSOFT_GRAPH_TENANT_ID", previous.tenant],
      ["MICROSOFT_GRAPH_CLIENT_ID", previous.client],
      ["MICROSOFT_GRAPH_CLIENT_SECRET", previous.secret],
      ["MICROSOFT_GRAPH_MAILBOX", previous.mailbox],
      ["DHL_EXPRESS_SENDER_DOMAINS", previous.domains],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = previous.fetch;
  }
}

test("Outlook archive revalidates exact inbox message, DHL sender and full tracking before one move", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  await withGraphEnvironment(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    requests.push({ url, method, body: String(init?.body || "") });
    if (url.includes("login.microsoftonline.com")) return Response.json({ access_token: "graph-token" });
    if (url.includes("/mailFolders/inbox")) return Response.json({ id: "inbox-folder-id" });
    if (url.includes(`/messages/${SOURCE_ID}/move`)) return Response.json({ id: "AAMk-moved-message-id" }, { status: 201 });
    if (url.includes(`/messages/${SOURCE_ID}`)) {
      return Response.json({
        id: SOURCE_ID,
        parentFolderId: "inbox-folder-id",
        subject: `DHL Express Sendungsnummer ${TRACKING}`,
        body: { contentType: "text", content: `Ihre DHL Express Sendungsnummer ${TRACKING} kommt heute.` },
        from: { emailAddress: { address: "tracking@express.dhl.com", name: "DHL Express" } },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const target = await inspectExactDhlOutlookArchiveTarget({ sourceMessageId: SOURCE_ID, expectedTrackingNumber: TRACKING });
    const moved = await moveInspectedOutlookMessageToArchiveOnce(target);
    assert.equal(moved.movedMessageId, "AAMk-moved-message-id");
  });
  const moveRequests = requests.filter((request) => request.url.endsWith(`/messages/${SOURCE_ID}/move`));
  assert.equal(moveRequests.length, 1);
  assert.equal(moveRequests[0]?.method, "POST");
  assert.deepEqual(JSON.parse(moveRequests[0]?.body || "{}"), { destinationId: "archive" });
});

test("Outlook archive blocks a non-DHL sender or mismatched tracking before move", async () => {
  let moveCalls = 0;
  await withGraphEnvironment(async (input) => {
    const url = String(input);
    if (url.includes("login.microsoftonline.com")) return Response.json({ access_token: "graph-token" });
    if (url.includes("/mailFolders/inbox")) return Response.json({ id: "inbox-folder-id" });
    if (url.endsWith("/move")) { moveCalls += 1; return Response.json({ id: "must-not-move" }, { status: 201 }); }
    return Response.json({
      id: SOURCE_ID,
      parentFolderId: "inbox-folder-id",
      subject: `Sendungsnummer ${TRACKING}`,
      body: { contentType: "text", content: `Sendungsnummer ${TRACKING}` },
      from: { emailAddress: { address: "attacker@example.com" } },
    });
  }, async () => {
    await assert.rejects(
      inspectExactDhlOutlookArchiveTarget({ sourceMessageId: SOURCE_ID, expectedTrackingNumber: TRACKING }),
      (error: unknown) => error instanceof OutlookArchiveTargetError && error.code === "sender_not_allowlisted",
    );
  });
  assert.equal(moveCalls, 0);
});

test("Outlook move uses no automatic retry after the dispatch boundary", async () => {
  let moveCalls = 0;
  await withGraphEnvironment(async (input) => {
    if (String(input).endsWith("/move")) moveCalls += 1;
    return new Response("temporary failure", { status: 503 });
  }, async () => {
    await assert.rejects(
      moveInspectedOutlookMessageToArchiveOnce({
        accessToken: "graph-token",
        mailbox: "support@example.invalid",
        sourceMessageId: SOURCE_ID,
      }),
      (error: unknown) => error instanceof OutlookArchiveTargetError && error.code === "graph_move_uncertain",
    );
  });
  assert.equal(moveCalls, 1);
});
