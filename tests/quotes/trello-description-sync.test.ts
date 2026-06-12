import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { handleTrelloDescriptionSyncPost } from "@/lib/ops/trello-description-sync-route";
import {
  dryRunTrelloDescriptionBackfill,
  syncTrelloDescriptionFromStoredSegment,
  type TrelloDescriptionSyncDeps,
} from "@/lib/ops/trello-description-sync";

const AUTH_KEY = "test-internal-key-1234567890";

function request(body: Record<string, unknown>, authorized = true) {
  return new NextRequest("https://ops.neontrip.de/api/internal/trello-description-sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${AUTH_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function syncResult(overrides: Partial<Awaited<ReturnType<TrelloDescriptionSyncDeps["syncDescription"]>>> = {}) {
  return {
    requestId: "req-1",
    dryRun: false,
    descriptionLength: 480,
    updated: [],
    skipped: [],
    ...overrides,
  };
}

function deps(overrides: Partial<TrelloDescriptionSyncDeps> = {}): TrelloDescriptionSyncDeps {
  return {
    async findRequestByRequestId(requestId) {
      return {
        request_id: requestId,
        trello_card_id: "card-1",
        segment: "NT-14",
        s_kategorie: null,
        segment_source: "request_segmenter",
      };
    },
    async findRequestByTrelloCardId(trelloCardId) {
      return {
        request_id: "req-from-card",
        trello_card_id: trelloCardId,
        segment: "NT-14",
        s_kategorie: null,
        segment_source: "request_segmenter",
      };
    },
    async listBackfillCandidates() {
      return [];
    },
    async syncDescription(requestId, _actor, options) {
      return syncResult({
        requestId,
        dryRun: Boolean(options?.dryRun),
        updated: [{
          boardKey: "requests",
          boardName: "Requests",
          cardId: options?.cardId || "card-1",
          cardUrl: null,
          previousDescriptionLength: 0,
        }],
      });
    },
    trelloConfigured() {
      return true;
    },
    ...overrides,
  };
}

test("trello description sync route updates by requestId", async () => {
  process.env.OPS_INTERNAL_API_KEY = AUTH_KEY;
  let receivedAuditSkipped: boolean | undefined;
  const response = await handleTrelloDescriptionSyncPost(
    request({ requestId: "req-1" }),
    deps({
      async syncDescription(requestId, _actor, options) {
        receivedAuditSkipped = options?.auditSkipped;
        return syncResult({
          requestId,
          updated: [{
            boardKey: "requests",
            boardName: "Requests",
            cardId: options?.cardId || "card-1",
            cardUrl: null,
            previousDescriptionLength: 0,
          }],
        });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "updated");
  assert.equal(body.requestId, "req-1");
  assert.equal(body.trelloCardId, "card-1");
  assert.equal(receivedAuditSkipped, false);
});

test("trello description sync route resolves by trelloCardId", async () => {
  process.env.OPS_INTERNAL_API_KEY = AUTH_KEY;
  let syncedRequestId: string | null = null;
  let syncedCardId: string | null | undefined = null;
  const response = await handleTrelloDescriptionSyncPost(
    request({ trelloCardId: "card-2", dryRun: true }),
    deps({
      async syncDescription(requestId, _actor, options) {
        syncedRequestId = requestId;
        syncedCardId = options?.cardId;
        return syncResult({
          requestId,
          dryRun: true,
          updated: [{
            boardKey: "requests",
            boardName: "Requests",
            cardId: options?.cardId || "card-2",
            cardUrl: null,
            previousDescriptionLength: 0,
          }],
        });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "would_update");
  assert.equal(body.requestId, "req-from-card");
  assert.equal(syncedRequestId, "req-from-card");
  assert.equal(syncedCardId, "card-2");
});

test("trello description sync skips missing segment with 202", async () => {
  process.env.OPS_INTERNAL_API_KEY = AUTH_KEY;
  let syncCalled = false;
  const response = await handleTrelloDescriptionSyncPost(
    request({ requestId: "req-missing-segment" }),
    deps({
      async findRequestByRequestId(requestId) {
        return {
          request_id: requestId,
          trello_card_id: "card-1",
          segment: null,
          s_kategorie: null,
          segment_source: null,
        };
      },
      async syncDescription() {
        syncCalled = true;
        return syncResult();
      },
    }),
  );

  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "missing_segment");
  assert.equal(body.reason, "missing_segment");
  assert.equal(syncCalled, false);
});

test("trello description sync preserves manual descriptions", async () => {
  const result = await syncTrelloDescriptionFromStoredSegment(
    { requestId: "req-1" },
    undefined,
    deps({
      async syncDescription(requestId) {
        return syncResult({
          requestId,
          skipped: [{
            boardKey: "requests",
            boardName: "Requests",
            cardId: "card-1",
            reason: "manual_description",
          }],
        });
      },
    }),
  );

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "manual_description");
});

test("trello description sync reports Trello config errors clearly", async () => {
  await assert.rejects(
    () => syncTrelloDescriptionFromStoredSegment(
      { requestId: "req-1" },
      undefined,
      deps({ trelloConfigured: () => false }),
    ),
    /Trello API-Konfiguration fehlt/,
  );
});

test("trello description sync route rejects unauthorized calls", async () => {
  process.env.OPS_INTERNAL_API_KEY = AUTH_KEY;
  const response = await handleTrelloDescriptionSyncPost(request({ requestId: "req-1" }, false), deps());
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "unauthorized");
});

test("trello description backfill dry-run classifies candidates without writes", async () => {
  const result = await dryRunTrelloDescriptionBackfill(
    { dryRun: true, limit: 10 },
    undefined,
    deps({
      async listBackfillCandidates() {
        return [
          { request_id: "req-would", trello_card_id: "card-would", segment: "NT-14", segment_source: "request_segmenter" },
          { request_id: "req-missing", trello_card_id: "card-missing", segment: null, s_kategorie: null, segment_source: null },
          { request_id: "req-manual", trello_card_id: "card-manual", segment: "NT-2", segment_source: "request_segmenter" },
        ];
      },
      async syncDescription(requestId, _actor, options) {
        if (requestId === "req-manual") {
          return syncResult({
            requestId,
            dryRun: true,
            skipped: [{
              boardKey: "requests",
              boardName: "Requests",
              cardId: options?.cardId || null,
              reason: "manual_description",
            }],
          });
        }
        return syncResult({
          requestId,
          dryRun: true,
          updated: [{
            boardKey: "requests",
            boardName: "Requests",
            cardId: options?.cardId || "card-would",
            cardUrl: null,
            previousDescriptionLength: 0,
          }],
        });
      },
    }),
  );

  assert.equal(result.scanned, 3);
  assert.equal(result.counts.would_update, 1);
  assert.equal(result.counts.missing_segment, 1);
  assert.equal(result.counts.skip_manual, 1);
});
