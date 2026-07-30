import assert from "node:assert/strict";
import test from "node:test";
import { boardCustomFieldsUrl, buildFieldUpdates } from "./board-field-resolution.mjs";
import {
  DYNAMIC_BOARD_FIELDS_URL,
  GET_FIELDS_NODE,
  PREPARE_FIELDS_NODE,
  PREPARE_FIELD_DATA_CODE,
  patchWorkflow,
} from "./patch-workflow.mjs";

const BOARD_A = "62bae9b97705e7419ed64593";
const BOARD_B = "63d10c34105771f01ccf4296";
const CARD_ID = "6a6b1df780fea8ef63ba6884";

function fieldsFor(boardId, suffix) {
  return [
    {
      id: `67a200bd23b1ffd304e6${suffix}`,
      idModel: boardId,
      modelType: "board",
      name: "Nerdy-Forms_ID",
      type: "text",
    },
    {
      id: `6a671cb3ffd9bae3b3cb${suffix}`,
      idModel: boardId,
      modelType: "board",
      name: "Product 1",
      type: "list",
      options: [{ value: { text: "LED Neon" }, _id: `6a6902856fc44afc4d69${suffix}` }],
    },
  ];
}

function fixtureWorkflow() {
  return {
    id: "fixture",
    name: "fixture",
    nodes: [
      { id: "create", name: "Create Trello Card", parameters: { listId: "moving-list" } },
      {
        id: "get",
        name: GET_FIELDS_NODE,
        parameters: { url: `https://api.trello.com/1/boards/${BOARD_A}/customFields` },
        credentials: { trelloApi: { id: "credential", name: "Trello account" } },
      },
      { id: "prepare", name: PREPARE_FIELDS_NODE, parameters: { jsCode: "old" } },
      {
        id: "set",
        name: "Set Trello Custom Field",
        parameters: { method: "PUT" },
        retryOnFail: true,
        maxTries: 5,
      },
      { id: "unrelated", name: "Unrelated", parameters: { keep: true } },
    ],
    connections: {
      "Create Trello Card": { main: [[{ node: GET_FIELDS_NODE, type: "main", index: 0 }]] },
      [GET_FIELDS_NODE]: { main: [[{ node: PREPARE_FIELDS_NODE, type: "main", index: 0 }]] },
    },
    settings: { errorWorkflow: "existing-error-workflow" },
  };
}

test("derives the custom-field endpoint from the actual created card board", () => {
  assert.equal(
    boardCustomFieldsUrl({ id: CARD_ID, idBoard: BOARD_B }),
    `https://api.trello.com/1/boards/${BOARD_B}/customFields`,
  );
});

test("selects IDs only from the actual card board", () => {
  const updates = buildFieldUpdates({
    card: { id: CARD_ID, idBoard: BOARD_B },
    customFields: fieldsFor(BOARD_B, "3335"),
    requestId: "request-123",
  });
  assert.equal(updates.length, 2);
  assert.equal(updates[0].boardId, BOARD_B);
  assert.equal(updates[0].customFieldId, "67a200bd23b1ffd304e63335");
  assert.equal(updates[1].customFieldId, "6a671cb3ffd9bae3b3cb3335");
  assert.equal(updates[1].customFieldPayload.idValue, "6a6902856fc44afc4d693335");
  assert.match(updates[0].idempotencyKey, /request-123/);
});

test("rejects fields fetched from a different board", () => {
  assert.throws(
    () =>
      buildFieldUpdates({
        card: { id: CARD_ID, idBoard: BOARD_B },
        customFields: fieldsFor(BOARD_A, "3335"),
        requestId: "request-123",
      }),
    /board mismatch/,
  );
});

test("rejects missing and ambiguous required fields", () => {
  const fields = fieldsFor(BOARD_B, "3335");
  assert.throws(
    () => buildFieldUpdates({ card: { id: CARD_ID, idBoard: BOARD_B }, customFields: fields.slice(1), requestId: "x" }),
    /exactly one Nerdy-Forms_ID/,
  );
  assert.throws(
    () => buildFieldUpdates({ card: { id: CARD_ID, idBoard: BOARD_B }, customFields: [...fields, fields[0]], requestId: "x" }),
    /exactly one Nerdy-Forms_ID/,
  );
});

test("patch changes only the two intended node parameters", () => {
  const workflow = fixtureWorkflow();
  const before = structuredClone(workflow);
  const patched = patchWorkflow(workflow);
  assert.equal(patched.nodes.length, before.nodes.length);
  assert.deepEqual(patched.connections, before.connections);
  assert.deepEqual(patched.settings, before.settings);
  assert.equal(patched.nodes.find((node) => node.name === GET_FIELDS_NODE).parameters.url, DYNAMIC_BOARD_FIELDS_URL);
  assert.equal(patched.nodes.find((node) => node.name === PREPARE_FIELDS_NODE).parameters.jsCode, PREPARE_FIELD_DATA_CODE);
  for (const name of ["Create Trello Card", "Set Trello Custom Field", "Unrelated"]) {
    assert.deepEqual(
      patched.nodes.find((node) => node.name === name),
      before.nodes.find((node) => node.name === name),
    );
  }
});

test("patch is idempotent and keeps Product 2 untouched", () => {
  const once = patchWorkflow(fixtureWorkflow());
  const twice = patchWorkflow(once);
  assert.deepEqual(twice, once);
  assert.doesNotMatch(PREPARE_FIELD_DATA_CODE, /Product 2|product_2/i);
  assert.match(DYNAMIC_BOARD_FIELDS_URL, /Create Trello Card/);
  assert.doesNotMatch(DYNAMIC_BOARD_FIELDS_URL, new RegExp(BOARD_A));
});
