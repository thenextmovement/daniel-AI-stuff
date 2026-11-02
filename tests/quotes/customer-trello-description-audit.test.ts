import test from "node:test";
import assert from "node:assert/strict";
import { syncCustomerTrelloMockupDescription } from "../../src/lib/ops/customer-records";
import { buildMockupTrelloDescription } from "../../src/lib/ops/mockup-context";

const requestId = "request-description-audit";
const cardId = "6ae000000000000000000001";
const boardId = "63d10c34105771f01ccf4296";
const currentDescription = buildMockupTrelloDescription({
  requestId, customerCompany: "Ada Lovelace", customerEmail: "ada@example.com",
  requestTitle: "Logo", backboard: "Rueckplatte laut Angebot",
});

for (const scenario of [
  { name: "manual description", description: "Manual production requirements", reason: "manual_description", updated: 0, audit: true },
  { name: "already current", description: currentDescription, reason: "already_current", updated: 0, audit: true },
  { name: "empty description", description: "", reason: null, updated: 1, audit: true },
  { name: "dry run", description: "", reason: null, updated: 1, audit: false, options: { dryRun: true } },
  { name: "optional skip audit disabled", description: "Manual production requirements", reason: "manual_description", updated: 0, audit: false, options: { auditSkipped: false } },
]) {
  test(`Trello description audit: ${scenario.name}`, async () => {
    const previousFetch = globalThis.fetch;
    const env = {
      SUPABASE_URL: "https://supabase.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      TRELLO_API_KEY: "test-trello-key",
      TRELLO_TOKEN: "test-trello-token",
    };
    const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    Object.assign(process.env, env);
    const audits: Array<Record<string, unknown>> = [];
    const trelloWrites: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = String(init.method || "GET").toUpperCase();
      if (url.hostname === "supabase.example.test") {
        if (method === "POST" && url.pathname === "/rest/v1/workflow_audit_log") {
          const body = JSON.parse(String(init.body));
          // The live constraint rejects warning; the attempt projection treats skipped as failed.
          assert.equal(body.status, "success");
          audits.push(body);
          return new Response(null, { status: 204 });
        }
        assert.equal(method, "GET", "no customer, queue, or task mutation is part of this sync");
        if (url.pathname === "/rest/v1/master_customers") return Response.json([{
          id: "customer-1", request_id: requestId, email: "ada@example.com",
          first_name: "Ada", last_name: "Lovelace", name: "Ada Lovelace", cc_emails: [],
        }]);
        if (url.pathname === "/rest/v1/master_requests") return Response.json([{
          id: "request-1", request_id: requestId, customer_id: "customer-1", title: "Logo", trello_card_id: cardId,
        }]);
        return Response.json([]);
      }
      assert.equal(url.hostname, "api.trello.com", "no mail or other provider may be called");
      if (method === "PUT") {
        assert.equal(url.pathname, `/1/cards/${cardId}`);
        assert.equal(url.searchParams.get("desc"), currentDescription);
        trelloWrites.push(cardId);
        return Response.json({ id: cardId });
      }
      assert.equal(method, "GET");
      if (url.pathname === "/1/search") return Response.json({ cards: [{ id: cardId, idBoard: boardId }] });
      if (url.pathname === `/1/cards/${cardId}`) return Response.json({
        id: cardId, idBoard: boardId, name: "Logo", desc: scenario.description, attachments: [], customFieldItems: [],
      });
      return Response.json([]);
    }) as typeof fetch;
    try {
      const result = await syncCustomerTrelloMockupDescription(requestId, { operatorName: "Test" }, scenario.options);
      assert.equal(result.updated.length, scenario.updated);
      assert.deepEqual(result.skipped.map((entry) => entry.reason), scenario.reason ? [scenario.reason] : []);
      assert.equal(trelloWrites.length, scenario.options?.dryRun ? 0 : scenario.updated);
      assert.equal(audits.length, scenario.audit ? 1 : 0);
      if (audits.length) {
        assert.equal(audits[0].action, "customer_trello_mockup_description_synced");
        const metadata = audits[0].metadata as Record<string, unknown>;
        assert.deepEqual(metadata.updated, result.updated);
        assert.deepEqual(metadata.skipped, result.skipped);
        assert.deepEqual(metadata.changed_fields, scenario.updated ? ["trello.card.desc"] : []);
      }
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
}
