import test from "node:test";
import assert from "node:assert/strict";
import { getTrelloCard } from "../../src/lib/quotes/trello";
import {
  buildQuoteReadySizeLadderPreflightFromTrelloCard,
  classifyManualReleaseSizeLadderPreflight,
} from "../../src/lib/ops/offer-size-ladder";

test("Trello product dropdowns keep equal-size mixed products and supplier prices separate", async (t) => {
  const previousKey = process.env.TRELLO_API_KEY;
  const previousToken = process.env.TRELLO_TOKEN;
  process.env.TRELLO_API_KEY = "test-key";
  process.env.TRELLO_TOKEN = "test-token";
  t.after(() => {
    if (previousKey === undefined) delete process.env.TRELLO_API_KEY;
    else process.env.TRELLO_API_KEY = previousKey;
    if (previousToken === undefined) delete process.env.TRELLO_TOKEN;
    else process.env.TRELLO_TOKEN = previousToken;
  });
  const fields = [
    { id: "product-1", name: "Product 1", type: "list", options: [{ id: "ultra", value: { text: "Ultra Thin Acrylic" } }] },
    { id: "product-2", name: "Product 2", type: "list", options: [{ id: "neon", value: { text: "LED Neon" } }] },
    { id: "missing-option", name: "Unknown choice", type: "list", options: [] },
    ...["Price_1", "Size_1", "Price_2", "Size_2"].map(name => ({ id: name, name, type: "text" })),
    { id: "number", name: "Number", type: "number" },
    { id: "checked", name: "Checked", type: "checkbox" },
  ];
  const rawCard = {
    id: "mixedCard", idBoard: "board", name: "Neon flex with UV Print | LED Neon Flex",
    customFieldItems: [
      { idCustomField: "product-1", idValue: "ultra" },
      { idCustomField: "product-2", idValue: "neon" },
      { idCustomField: "missing-option", idValue: "removed-option" },
      ...Object.entries({ Price_1: "89", Size_1: "30x30cm", Price_2: "87", Size_2: "30x30cm" })
        .map(([idCustomField, text]) => ({ idCustomField, value: { text } })),
      { idCustomField: "number", value: { number: "12.5" } },
      { idCustomField: "checked", value: { checked: "true" } },
    ],
    // The independently uploaded source views must first be reconciled into
    // one current revision. The existing 24-hour freshness guard stays intact.
    attachments: ["mockup_1031_1256.jpg", "mockup_1031_1257.jpg", "mockup_1031_1258.jpg"]
      .map((name, index) => ({ id: `source-${index}`, name, date: "2026-11-02T12:00:00Z" })),
  };
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.ok(!init?.method || init.method === "GET", "inspection must not write");
    const path = new URL(String(input)).pathname;
    requests.push(path);
    if (path === "/1/cards/mixedCard") return Response.json(rawCard);
    if (path === "/1/boards/board/customFields") return Response.json(fields);
    throw new Error(`Unexpected request: ${path}`);
  });
  const card = await getTrelloCard("mixedCard");
  assert.equal(card.customFields["Product 1"], "Ultra Thin Acrylic");
  assert.equal(card.customFields["Product 2"], "LED Neon");
  assert.equal(card.customFields["Unknown choice"], "");
  assert.equal(card.customFields.Number, "12.5");
  assert.equal(card.customFields.Checked, "true");
  assert.equal(card.editableFields?.find(f => f.id === "product-2")?.value, "neon");
  const result = await buildQuoteReadySizeLadderPreflightFromTrelloCard(card, {
    persist: false, projectToTrello: false, commentToTrello: false,
  });
  assert.deepEqual(result.sourceMockupCountsByDesign, [2, 1]);
  assert.deepEqual(result.designs.map(d => d.anchorFieldIndexes), [[1], [2]]);
  assert.deepEqual(result.designs.map(d => d.sizeLadder.anchorList[0]?.supplierTotal), [89, 87]);
  const release = classifyManualReleaseSizeLadderPreflight(result);
  assert.equal(release.decision, "skipped");
  assert.equal(release.reason, "non_standard_neon_product_uses_existing_offer_flow");
  assert.deepEqual(release.technicalIssues, []);
  assert.equal(result.offerItemsJson, null);
  assert.deepEqual(requests, ["/1/cards/mixedCard", "/1/boards/board/customFields"]);
});
