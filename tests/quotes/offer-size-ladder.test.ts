import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOfferSizeLadderOptionOverrides,
  buildOfferSizeLadderOfferPatch,
  extractOfferSizeLadderAnchorsFromTrelloFields,
  generateOfferSizeLadder,
  generateOfferSizeLadderFromTrello,
  listOfferSizeLadderDrafts,
  OFFER_SIZE_LADDER_CUSTOMER_FACTOR,
} from "../../src/lib/ops/offer-size-ladder";

test("offer size ladder extracts three anchors from Trello Size Production Shipping fields", () => {
  const extraction = extractOfferSizeLadderAnchorsFromTrelloFields({
    Size_1: "75x45cm",
    Production_1: "100",
    Shipping_1: "120",
    Size_2: "120x72cm",
    Production_2: "190",
    Shipping_2: "210",
    Size_3: "250x150cm",
    Production_3: "520",
    Shipping_3: "610",
  });

  assert.equal(extraction.anchors.length, 3);
  assert.equal(extraction.anchors[0]?.role, "minimum");
  assert.equal(extraction.anchors[0]?.widthCm, 75);
  assert.equal(extraction.anchors[1]?.role, "requested");
  assert.equal(extraction.anchors[1]?.productionPrice, 190);
  assert.equal(extraction.anchors[2]?.role, "max_250");
  assert.equal(extraction.anchors[2]?.shippingPrice, 610);
  assert.deepEqual(extraction.warnings, []);
});

test("offer size ladder extracts anchors from combined Trello custom fields", () => {
  const extraction = extractOfferSizeLadderAnchorsFromTrelloFields({
    Minimum: "80x40cm Production price: $110 Shipping cost: $95",
    Kundenwunsch: "140x70cm Production 220 Shipping 180",
    "250cm": "250x125cm prod 520 ship 590",
  });

  assert.equal(extraction.anchors.length, 3);
  assert.equal(extraction.anchors[0]?.heightCm, 40);
  assert.equal(extraction.anchors[1]?.productionPrice, 220);
  assert.equal(extraction.anchors[2]?.shippingPrice, 590);
});

test("offer size ladder uses the new 2.6 customer factor", async () => {
  const result = await generateOfferSizeLadder({
    trelloCardId: "https://trello.com/c/cardFactor1/example",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 100, heightCm: 50, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 150, heightCm: 75, productionPrice: 150, shippingPrice: 150 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 280, shippingPrice: 320 },
    ],
  });

  assert.equal(result.trelloCardId, "cardFactor1");
  const minimum = result.options.find((option) => option.isDefault);
  assert.equal(OFFER_SIZE_LADDER_CUSTOMER_FACTOR, 2.6);
  assert.equal(minimum?.supplierTotalEstimated, 200);
  assert.equal(minimum?.customerUnitPriceNet, 520);
});

test("offer size ladder reflects design area, not only one dimension", async () => {
  const narrow = await generateOfferSizeLadder({
    trelloCardId: "cardNarrow1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 100, heightCm: 10, productionPrice: 60, shippingPrice: 70 },
      { role: "requested", widthCm: 150, heightCm: 15, productionPrice: 85, shippingPrice: 90 },
      { role: "max_250", widthCm: 250, heightCm: 25, productionPrice: 130, shippingPrice: 160 },
    ],
  });
  const square = await generateOfferSizeLadder({
    trelloCardId: "cardSquare1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 100, heightCm: 100, productionPrice: 220, shippingPrice: 180 },
      { role: "requested", widthCm: 150, heightCm: 150, productionPrice: 390, shippingPrice: 330 },
      { role: "max_250", widthCm: 250, heightCm: 250, productionPrice: 880, shippingPrice: 780 },
    ],
  });

  const narrow100 = narrow.options.find((option) => option.longSideCm === 100);
  const square100 = square.options.find((option) => option.longSideCm === 100);
  assert.ok(narrow100);
  assert.ok(square100);
  assert.ok(square100!.customerUnitPriceNet > narrow100!.customerUnitPriceNet * 2);
});

test("offer size ladder blocks implausibly cheap 250cm anchors", async () => {
  const result = await generateOfferSizeLadder({
    trelloCardId: "cardBad250",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 140, shippingPrice: 130 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 150, shippingPrice: 140 },
    ],
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.includes("area_increase_price_increase_too_low")));
  assert.equal(result.options.at(-1)?.reviewStatus, "blocked");
});

test("offer size ladder routes UV print to manual review", async () => {
  const result = await generateOfferSizeLadder({
    trelloCardId: "cardUv123",
    sourceText: "LED Neonflex with UV-Print logo details",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 120, shippingPrice: 110 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 190, shippingPrice: 170 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 540, shippingPrice: 520 },
    ],
  });

  assert.equal(result.productModel, "uv_print");
  assert.equal(result.status, "needs_review");
  assert.equal(result.options[0]?.reviewStatus, "needs_review");
});

test("offer size ladder builds an offer patch with minimum size selected by default", async () => {
  const sizeLadder = await generateOfferSizeLadder({
    trelloCardId: "cardOfferApply1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 160, shippingPrice: 150 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 500, shippingPrice: 520 },
    ],
  });
  const offer = {
    offerId: "offer_1",
    offerNumber: "A/N 1",
    documentReference: "A/N 1",
    trelloCardId: "cardOfferApply1",
    publicUrl: "https://angebote.neontrip.de/offer/token",
    status: "DRAFT",
    updatedAt: "2026-07-09T08:00:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    acceptance: null,
    lock: { editable: true, lockLevel: "none" as const, lockReason: null, requiresRevisionReason: false },
    offer: {
      customerCompany: null,
      customerFirstName: null,
      customerLastName: null,
      customerEmail: null,
      customerPhone: null,
      validUntil: null,
      productionTime: null,
      notes: null,
      discountText: null,
      projectTitle: null,
      currency: "EUR",
      vatRate: 19,
    },
    items: [{
      id: "item_1",
      section: "LED-Leuchtschild",
      title: "LED Logo Wandschild",
      description: "Größe: 80x40cm\nLeuchtfarbe: Wie Logo",
      quantity: 1,
      unitPriceNet: 520,
      listPriceNet: null,
      discountLabel: null,
      selectable: true,
      selectedByDefault: true,
      selectedFinal: null,
      quantityEditable: false,
      minQuantity: 1,
      maxQuantity: null,
      sortOrder: 0,
    }],
    images: [],
    totals: {},
  };

  const { patch, defaultOption, appliedOptions } = buildOfferSizeLadderOfferPatch({
    offer,
    sizeLadder,
    offerItemId: "item_1",
    operatorName: "Test",
  });

  assert.equal(patch.items?.length, sizeLadder.options.length);
  assert.equal(patch.items?.[0]?.id, "item_1");
  assert.equal(patch.items?.[0]?.selectedByDefault, true);
  assert.match(patch.items?.[0]?.description || "", /Größe: 80 x 40cm/);
  assert.equal(patch.items?.[0]?.unitPriceNet, defaultOption.customerUnitPriceNet);
  assert.equal(appliedOptions[0]?.isDefault, true);
  assert.ok(patch.items?.slice(1).every((item) => item.id.startsWith("new-item-size-ladder-")));
  assert.ok(patch.items?.slice(1).every((item) => item.selectedByDefault === false));
});

test("offer size ladder offer patch uses manual option price overrides", async () => {
  const sizeLadder = await generateOfferSizeLadder({
    trelloCardId: "cardManualOverride1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 160, shippingPrice: 150 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 500, shippingPrice: 520 },
    ],
  });
  const optionToOverride = sizeLadder.options.find((option) => option.longSideCm === 120);
  assert.ok(optionToOverride);
  const optionKey = `${optionToOverride!.longSideCm}:${optionToOverride!.widthCm}:${optionToOverride!.heightCm}:${optionToOverride!.sizeLabel}`;
  const overridden = applyOfferSizeLadderOptionOverrides(sizeLadder, [{
    optionKey,
    customerUnitPriceNet: 999,
  }]);

  const offer = {
    offerId: "offer_override_1",
    offerNumber: "A/N Override",
    documentReference: "A/N Override",
    trelloCardId: "cardManualOverride1",
    publicUrl: "https://angebote.neontrip.de/offer/token",
    status: "DRAFT",
    updatedAt: "2026-07-09T08:00:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    acceptance: null,
    lock: { editable: true, lockLevel: "none" as const, lockReason: null, requiresRevisionReason: false },
    offer: {
      customerCompany: null,
      customerFirstName: null,
      customerLastName: null,
      customerEmail: null,
      customerPhone: null,
      validUntil: null,
      productionTime: null,
      notes: null,
      discountText: null,
      projectTitle: null,
      currency: "EUR",
      vatRate: 19,
    },
    items: [{
      id: "item_1",
      section: "LED-Leuchtschild",
      title: "LED Logo Wandschild",
      description: "Größe: 80x40cm\nLeuchtfarbe: Wie Logo",
      quantity: 1,
      unitPriceNet: 520,
      listPriceNet: null,
      discountLabel: null,
      selectable: true,
      selectedByDefault: true,
      selectedFinal: null,
      quantityEditable: false,
      minQuantity: 1,
      maxQuantity: null,
      sortOrder: 0,
    }],
    images: [],
    totals: {},
  };

  const { patch } = buildOfferSizeLadderOfferPatch({
    offer,
    sizeLadder: overridden,
    offerItemId: "item_1",
    operatorName: "Test",
  });

  const overriddenItem = patch.items?.find((item) => item.description?.includes(optionToOverride!.sizeLabel));
  assert.equal(overriddenItem?.unitPriceNet, 999);
  assert.ok(overridden.warnings.includes("manual_offer_price_overrides"));
});

test("offer size ladder ignores unchanged option price overrides", async () => {
  const sizeLadder = await generateOfferSizeLadder({
    trelloCardId: "cardUnchangedOverride1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 160, shippingPrice: 150 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 500, shippingPrice: 520 },
    ],
  });
  const overrides = sizeLadder.options.map((option) => ({
    optionKey: `${option.longSideCm}:${option.widthCm}:${option.heightCm}:${option.sizeLabel}`,
    customerUnitPriceNet: option.customerUnitPriceNet,
  }));

  const unchanged = applyOfferSizeLadderOptionOverrides(sizeLadder, overrides);

  assert.equal(unchanged, sizeLadder);
  assert.equal(unchanged.warnings.includes("manual_offer_price_overrides"), false);
});

test("offer size ladder loads internal offer drafts without touching offers api", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calledUrls: string[] = [];

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calledUrls.push(url);
    if (url.includes("/rest/v1/offer_size_quote_anchor_sets")) {
      return new Response(JSON.stringify([{
        id: "set-1",
        set_key: "offer-size-ladder:cardDraft1:abc",
        trello_card_id: "cardDraft1",
        trello_card_url: "https://trello.com/c/cardDraft1/test",
        offer_id: "offer_123",
        offer_item_id: "item_1",
        design_id: null,
        product_model: "neonflex",
        pricing_basis: "new_supplier_direct_2_6",
        customer_factor: "2.6",
        status: "draft",
        confidence: "0.88",
        issues: [],
        warnings: [],
        metadata: {},
        created_by: "ops",
        created_at: "2026-07-08T08:00:00.000Z",
        updated_at: "2026-07-08T08:01:00.000Z",
      }]), { status: 200 });
    }
    if (url.includes("/rest/v1/offer_size_options")) {
      return new Response(JSON.stringify([{
        id: "option-1",
        anchor_set_id: "set-1",
        offer_id: "offer_123",
        offer_item_id: "item_1",
        size_label: "100 x 50cm",
        width_cm: "100",
        height_cm: "50",
        long_side_cm: "100",
        area_cm2: "5000",
        production_price_estimated: "100",
        shipping_price_estimated: "120",
        supplier_total_estimated: "220",
        customer_factor: "2.6",
        customer_unit_price_net: "570",
        currency: "USD",
        customer_currency: "EUR",
        model_key: "anchored_offer_size_ladder",
        model_version: "anchored_offer_size_ladder_v1",
        confidence: "0.88",
        review_status: "auto_ok",
        review_reason: null,
        issues: [],
        is_default: true,
        sort_order: 0,
        metadata: {},
      }]), { status: 200 });
    }
    return new Response("unexpected url", { status: 500 });
  }) as typeof fetch;

  try {
    const drafts = await listOfferSizeLadderDrafts({ offerId: "offer_123", trelloCardId: "https://trello.com/c/cardDraft1/test" });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.offerId, "offer_123");
    assert.equal(drafts[0]?.trelloCardId, "cardDraft1");
    assert.equal(drafts[0]?.options[0]?.customerUnitPriceNet, 570);
    assert.ok(calledUrls.every((url) => url.includes("/rest/v1/offer_size_")));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("offer size ladder projects persisted Trello drafts into offer_items_json", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalTrelloKey = process.env.TRELLO_API_KEY;
  const originalTrelloToken = process.env.TRELLO_TOKEN;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";

  let projectedItems: Array<Record<string, unknown>> | null = null;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url.startsWith("https://api.trello.com/1/cards/cardTrelloProjection")) {
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body || "{}"));
        projectedItems = JSON.parse(body.value.text);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: "cardTrelloProjection",
        idBoard: "board-1",
        name: "LED Flex Lisa 75/100/150cm Color as Logo",
        desc: "Neon Flex",
        customFieldItems: [
          { idCustomField: "size-1", value: { text: "75x45cm" } },
          { idCustomField: "prod-1", value: { text: "100" } },
          { idCustomField: "ship-1", value: { text: "100" } },
          { idCustomField: "size-2", value: { text: "150x90cm" } },
          { idCustomField: "prod-2", value: { text: "190" } },
          { idCustomField: "ship-2", value: { text: "210" } },
          { idCustomField: "size-3", value: { text: "250x150cm" } },
          { idCustomField: "prod-3", value: { text: "480" } },
          { idCustomField: "ship-3", value: { text: "520" } },
          { idCustomField: "color-1", value: { text: "Wie im Logo" } },
          { idCustomField: "backboard-1", value: { text: "Formzuschnitt" } },
          { idCustomField: "items", value: { text: "[]" } },
        ],
        attachments: [],
        actions: [],
      }), { status: 200 });
    }

    if (url.startsWith("https://api.trello.com/1/boards/board-1/customFields")) {
      return new Response(JSON.stringify([
        { id: "size-1", name: "Size_1", type: "text" },
        { id: "prod-1", name: "Production_1", type: "text" },
        { id: "ship-1", name: "Shipping_1", type: "text" },
        { id: "size-2", name: "Size_2", type: "text" },
        { id: "prod-2", name: "Production_2", type: "text" },
        { id: "ship-2", name: "Shipping_2", type: "text" },
        { id: "size-3", name: "Size_3", type: "text" },
        { id: "prod-3", name: "Production_3", type: "text" },
        { id: "ship-3", name: "Shipping_3", type: "text" },
        { id: "color-1", name: "Color_1", type: "text" },
        { id: "backboard-1", name: "Backboard_1", type: "text" },
        { id: "items", name: "offer_items_json", type: "text" },
      ]), { status: 200 });
    }

    if (url.includes("/rest/v1/offer_size_quote_anchor_sets") && method === "GET") {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes("/rest/v1/offer_size_quote_anchor_sets") && method === "POST") {
      return new Response(JSON.stringify([{ id: "set-projection-1" }]), { status: 201 });
    }
    if (url.includes("/rest/v1/offer_size_") && ["POST", "DELETE", "PATCH"].includes(method)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const result = await generateOfferSizeLadderFromTrello({
      trelloCard: "cardTrelloProjection",
      persist: true,
      stepCm: 10,
      maxLongSideCm: 250,
    });

    assert.equal(result.persisted?.trelloProjection?.written, true);
    assert.ok(projectedItems);
    const items = projectedItems as Array<Record<string, unknown>>;
    assert.ok(items.length > 3);
    assert.equal(items[0]?.customerUnitPriceNet, result.options[0]?.customerUnitPriceNet);
    assert.equal(items[0]?.selectedByDefault, true);
    assert.match(String(items[0]?.description), /Größe:/);
    assert.match(String(items[0]?.description), /Leuchtfarbe: Wie im Logo/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    if (originalTrelloKey === undefined) delete process.env.TRELLO_API_KEY;
    else process.env.TRELLO_API_KEY = originalTrelloKey;
    if (originalTrelloToken === undefined) delete process.env.TRELLO_TOKEN;
    else process.env.TRELLO_TOKEN = originalTrelloToken;
  }
});
