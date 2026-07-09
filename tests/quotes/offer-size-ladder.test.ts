import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOfferSizeLadderToOffer,
  applyOfferSizeLadderOptionOverrides,
  buildOfferSizeLadderOfferPatch,
  extractOfferSizeLadderAnchorsFromTrelloFields,
  generateOfferSizeLadder,
  generateOfferSizeLadderFromTrello,
  listOfferSizeLadderDrafts,
  OFFER_SIZE_LADDER_CUSTOMER_FACTOR,
} from "../../src/lib/ops/offer-size-ladder";
import { OpsOfferApiError } from "../../src/lib/ops/offers";

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

test("offer size ladder uses the 2.3 customer factor", async () => {
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
  assert.equal(OFFER_SIZE_LADDER_CUSTOMER_FACTOR, 2.3);
  assert.equal(minimum?.supplierTotalEstimated, 200);
  assert.equal(minimum?.customerUnitPriceNet, 460);
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

test("offer size ladder uses the selected default item when multiple sign items exist", async () => {
  const sizeLadder = await generateOfferSizeLadder({
    trelloCardId: "cardMultiDefault1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 75, heightCm: 45, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 150, heightCm: 90, productionPrice: 190, shippingPrice: 210 },
      { role: "max_250", widthCm: 250, heightCm: 150, productionPrice: 480, shippingPrice: 520 },
    ],
  });
  const offer = {
    offerId: "offer_multi_default",
    offerNumber: "A/N Multi",
    documentReference: "A/N Multi",
    trelloCardId: "cardMultiDefault1",
    publicUrl: "https://angebote.neontrip.de/offer/multi",
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
    items: [
      {
        id: "item_75",
        section: "LED-Leuchtschild",
        title: "Leuchtschild Design",
        description: "Größe: 75x45cm",
        quantity: 1,
        unitPriceNet: 460,
        listPriceNet: null,
        discountLabel: null,
        selectable: true,
        selectedByDefault: true,
        selectedFinal: null,
        quantityEditable: false,
        minQuantity: 1,
        maxQuantity: null,
        sortOrder: 0,
      },
      {
        id: "item_150",
        section: "LED-Leuchtschild",
        title: "Leuchtschild Design",
        description: "Größe: 150x90cm",
        quantity: 1,
        unitPriceNet: 920,
        listPriceNet: null,
        discountLabel: null,
        selectable: true,
        selectedByDefault: false,
        selectedFinal: null,
        quantityEditable: false,
        minQuantity: 1,
        maxQuantity: null,
        sortOrder: 1,
      },
      {
        id: "item_table",
        section: "Zubehör",
        title: "Acryl LED Tischgerät",
        description: null,
        quantity: 1,
        unitPriceNet: 99,
        listPriceNet: null,
        discountLabel: null,
        selectable: true,
        selectedByDefault: false,
        selectedFinal: null,
        quantityEditable: false,
        minQuantity: 1,
        maxQuantity: null,
        sortOrder: 2,
      },
    ],
    images: [],
    totals: {},
  };

  const { targetItem, patch } = buildOfferSizeLadderOfferPatch({
    offer,
    sizeLadder,
    operatorName: "Daniel",
  });

  assert.equal(targetItem.id, "item_75");
  assert.ok(patch.items?.some((item) => item.id === "item_table"));
  assert.equal(patch.items?.find((item) => item.id === "item_table")?.title, "Acryl LED Tischgerät");
});

test("offer size ladder replaces existing adjacent same-title variants before enforcing the item limit", async () => {
  const sizeLadder = await generateOfferSizeLadder({
    trelloCardId: "cardManyVariants1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 160, shippingPrice: 150 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 500, shippingPrice: 520 },
    ],
  });
  const oldVariantItems = Array.from({ length: 35 }, (_, index) => {
    const longSide = 80 + index * 5;
    return {
      id: `old_variant_${index}`,
      section: "LED-Leuchtschild",
      title: "Leuchtschild Design",
      description: index === 0
        ? "Größe: 80x40cm\nLeuchtfarbe: Wie Logo"
        : `Größe: ${longSide}x${Math.round(longSide / 2)}cm`,
      quantity: 1,
      unitPriceNet: 520 + index,
      listPriceNet: null,
      discountLabel: null,
      selectable: true,
      selectedByDefault: index === 0,
      selectedFinal: null,
      quantityEditable: false,
      minQuantity: 1,
      maxQuantity: null,
      sortOrder: index,
    };
  });
  const accessoryItems = Array.from({ length: 20 }, (_, index) => ({
    id: `accessory_${index}`,
    section: "Zubehör",
    title: `Montage Zubehör ${index + 1}`,
    description: null,
    quantity: 1,
    unitPriceNet: 10 + index,
    listPriceNet: null,
    discountLabel: null,
    selectable: true,
    selectedByDefault: false,
    selectedFinal: null,
    quantityEditable: false,
    minQuantity: 1,
    maxQuantity: null,
    sortOrder: oldVariantItems.length + index,
  }));
  const offer = {
    offerId: "offer_many_variants",
    offerNumber: "A/N Many Variants",
    documentReference: "A/N Many Variants",
    trelloCardId: "cardManyVariants1",
    publicUrl: "https://angebote.neontrip.de/offer/many-variants",
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
    items: [...oldVariantItems, ...accessoryItems],
    images: [],
    totals: {},
  };

  const { patch } = buildOfferSizeLadderOfferPatch({
    offer,
    sizeLadder,
    operatorName: "Daniel",
  });

  assert.equal(patch.items?.length, sizeLadder.options.length + accessoryItems.length);
  assert.equal(patch.items?.filter((item) => item.title === "Leuchtschild Design").length, sizeLadder.options.length);
  assert.equal(patch.items?.filter((item) => item.section === "Zubehör").length, accessoryItems.length);
  assert.ok((patch.items?.length || 0) <= 50);
});

test("offer size ladder blocks offer apply without a reviewer name", async () => {
  const sizeLadder = await generateOfferSizeLadder({
    trelloCardId: "cardMissingReviewer1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 160, shippingPrice: 150 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 500, shippingPrice: 520 },
    ],
    stepCm: 10,
    maxLongSideCm: 250,
    customerFactor: OFFER_SIZE_LADDER_CUSTOMER_FACTOR,
  });
  const offer = {
    offerId: "offer_missing_reviewer",
    offerNumber: "A/N Missing",
    documentReference: "A/N Missing",
    trelloCardId: "cardMissingReviewer1",
    publicUrl: "https://angebote.neontrip.de/offer/missing-reviewer",
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
      description: "Größe: 80x40cm",
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

  assert.throws(
    () => buildOfferSizeLadderOfferPatch({ offer, sizeLadder, offerItemId: "item_1" }),
    /Reviewer-Name fehlt/,
  );
  assert.throws(
    () => buildOfferSizeLadderOfferPatch({ offer, sizeLadder, offerItemId: "item_1", operatorName: "ops_session" }),
    /Reviewer-Name fehlt/,
  );
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

test("offer size ladder from Trello uses the canonical card id for offer lookup", async () => {
  const originalFetch = globalThis.fetch;
  const originalTrelloKey = process.env.TRELLO_API_KEY;
  const originalTrelloToken = process.env.TRELLO_TOKEN;
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url.startsWith("https://api.trello.com/1/cards/shortLisa1")) {
      assert.equal(method, "GET");
      return new Response(JSON.stringify({
        id: "65f000000000000000000123",
        idBoard: "board-1",
        name: "LED Flex Lisa 75/100/120/150cm",
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
      ]), { status: 200 });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const result = await generateOfferSizeLadderFromTrello({
      trelloCard: "https://trello.com/c/shortLisa1/32831-led-flex-lisa",
      persist: false,
      stepCm: 10,
      maxLongSideCm: 250,
    });

    assert.equal(result.trelloCardId, "65f000000000000000000123");
    assert.equal(result.trelloCardUrl, "https://trello.com/c/shortLisa1/32831-led-flex-lisa");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTrelloKey === undefined) delete process.env.TRELLO_API_KEY;
    else process.env.TRELLO_API_KEY = originalTrelloKey;
    if (originalTrelloToken === undefined) delete process.env.TRELLO_TOKEN;
    else process.env.TRELLO_TOKEN = originalTrelloToken;
  }
});

test("offer size ladder offer apply retries short Trello links with canonical card id", async () => {
  const originalFetch = globalThis.fetch;
  const originalOffersBaseUrl = process.env.NEONTRIP_OFFERS_BASE_URL;
  const originalOffersKey = process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
  const originalTrelloKey = process.env.TRELLO_API_KEY;
  const originalTrelloToken = process.env.TRELLO_TOKEN;
  process.env.NEONTRIP_OFFERS_BASE_URL = "https://offers.test";
  process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "offers-key";
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";

  const offer = {
    offerId: "offer_canonical_1",
    offerNumber: "A/N Canonical",
    documentReference: "A/N Canonical",
    trelloCardId: "65f000000000000000000abc",
    publicUrl: "https://angebote.neontrip.de/offer/canonical",
    status: "DRAFT",
    updatedAt: "2026-07-09T10:00:00.000Z",
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
      description: "Größe: 75x45cm",
      quantity: 1,
      unitPriceNet: 460,
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

  const calledUrls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    calledUrls.push(`${method} ${url}`);

    if (url === "https://offers.test/api/internal/offers/by-trello/shortApply1" && method === "GET") {
      return new Response(JSON.stringify({ ok: false, error: "Offer not found.", code: "NOT_FOUND" }), { status: 404 });
    }
    if (url.startsWith("https://api.trello.com/1/cards/shortApply1")) {
      return new Response(JSON.stringify({
        id: "65f000000000000000000abc",
        idBoard: "board-1",
        name: "LED Flex Canonical",
        desc: "",
        customFieldItems: [],
        attachments: [],
        actions: [],
      }), { status: 200 });
    }
    if (url.startsWith("https://api.trello.com/1/boards/board-1/customFields")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url === "https://offers.test/api/internal/offers/by-trello/65f000000000000000000abc" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, offer }), { status: 200 });
    }
    if (url === "https://offers.test/api/internal/offers/by-trello/65f000000000000000000abc?dryRun=true" && method === "PATCH") {
      const body = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        offer: { ...offer, items: body.items },
        diff: { changedKeys: ["items"] },
      }), { status: 200 });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const result = await applyOfferSizeLadderToOffer({
      trelloCard: "https://trello.com/c/shortApply1/example",
      dryRun: true,
      createdBy: "Daniel",
      productModel: "neonflex",
      stepCm: 10,
      maxLongSideCm: 250,
      customerFactor: OFFER_SIZE_LADDER_CUSTOMER_FACTOR,
      anchors: [
        { role: "minimum", widthCm: 75, heightCm: 45, productionPrice: 100, shippingPrice: 100 },
        { role: "requested", widthCm: 150, heightCm: 90, productionPrice: 190, shippingPrice: 210 },
        { role: "max_250", widthCm: 250, heightCm: 150, productionPrice: 480, shippingPrice: 520 },
      ],
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.sizeLadder.trelloCardId, "65f000000000000000000abc");
    assert.ok(calledUrls.includes("GET https://offers.test/api/internal/offers/by-trello/shortApply1"));
    assert.ok(calledUrls.includes("GET https://offers.test/api/internal/offers/by-trello/65f000000000000000000abc"));
    assert.ok(calledUrls.includes("PATCH https://offers.test/api/internal/offers/by-trello/65f000000000000000000abc?dryRun=true"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOffersBaseUrl === undefined) delete process.env.NEONTRIP_OFFERS_BASE_URL;
    else process.env.NEONTRIP_OFFERS_BASE_URL = originalOffersBaseUrl;
    if (originalOffersKey === undefined) delete process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
    else process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = originalOffersKey;
    if (originalTrelloKey === undefined) delete process.env.TRELLO_API_KEY;
    else process.env.TRELLO_API_KEY = originalTrelloKey;
    if (originalTrelloToken === undefined) delete process.env.TRELLO_TOKEN;
    else process.env.TRELLO_TOKEN = originalTrelloToken;
  }
});

test("offer size ladder offer apply can use visible UI anchors without reloading Trello", async () => {
  const originalFetch = globalThis.fetch;
  const originalOffersBaseUrl = process.env.NEONTRIP_OFFERS_BASE_URL;
  const originalOffersKey = process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
  process.env.NEONTRIP_OFFERS_BASE_URL = "https://offers.test";
  process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "offers-key";

  let patchedItems: Array<Record<string, unknown>> | null = null;
  const offer = {
    offerId: "offer_direct_1",
    offerNumber: "A/N Direct",
    documentReference: "A/N Direct",
    trelloCardId: "cardDirectApply1",
    publicUrl: "https://angebote.neontrip.de/offer/direct",
    status: "DRAFT",
    updatedAt: "2026-07-09T10:00:00.000Z",
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

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.startsWith("https://api.trello.com"), false);

    if (url === "https://offers.test/api/internal/offers/by-trello/cardDirectApply1" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, offer }), { status: 200 });
    }
    if (url === "https://offers.test/api/internal/offers/by-trello/cardDirectApply1?dryRun=true" && method === "PATCH") {
      const body = JSON.parse(String(init?.body || "{}"));
      patchedItems = body.items;
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        offer: { ...offer, items: body.items, updatedAt: "2026-07-09T10:00:00.000Z" },
        diff: { changedKeys: ["items"] },
      }), { status: 200 });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const result = await applyOfferSizeLadderToOffer({
      trelloCard: "cardDirectApply1",
      dryRun: true,
      createdBy: "Daniel",
      productModel: "neonflex",
      stepCm: 10,
      maxLongSideCm: 250,
      customerFactor: OFFER_SIZE_LADDER_CUSTOMER_FACTOR,
      anchors: [
        { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
        { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 160, shippingPrice: 150 },
        { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 500, shippingPrice: 520 },
      ],
      optionOverrides: [{
        optionKey: "120:120:60:120 x 60cm",
        customerUnitPriceNet: 999,
      }],
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.applied.optionCount, 18);
    assert.ok(patchedItems);
    const items = patchedItems as Array<Record<string, unknown>>;
    const item120 = items.find((item) => String(item.description || "").includes("120 x 60cm"));
    assert.equal(item120?.unitPriceNet, 999);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOffersBaseUrl === undefined) delete process.env.NEONTRIP_OFFERS_BASE_URL;
    else process.env.NEONTRIP_OFFERS_BASE_URL = originalOffersBaseUrl;
    if (originalOffersKey === undefined) delete process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
    else process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = originalOffersKey;
  }
});

test("offer size ladder normalizes nested Offers API errors during dry-run", async () => {
  const originalFetch = globalThis.fetch;
  const originalOffersBaseUrl = process.env.NEONTRIP_OFFERS_BASE_URL;
  const originalOffersKey = process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
  process.env.NEONTRIP_OFFERS_BASE_URL = "https://offers.test";
  process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "offers-key";

  const offer = {
    offerId: "offer_direct_error",
    offerNumber: "A/N Error",
    documentReference: "A/N Error",
    trelloCardId: "cardDirectError",
    publicUrl: "https://angebote.neontrip.de/offer/error",
    status: "DRAFT",
    updatedAt: "2026-07-09T10:00:00.000Z",
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
      description: "Größe: 80x40cm",
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

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url === "https://offers.test/api/internal/offers/by-trello/cardDirectError" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, offer }), { status: 200 });
    }
    if (url === "https://offers.test/api/internal/offers/by-trello/cardDirectError?dryRun=true" && method === "PATCH") {
      return new Response(JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Dieses Angebot kann nicht automatisch aktualisiert werden.",
        },
      }), { status: 422 });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => applyOfferSizeLadderToOffer({
        trelloCard: "cardDirectError",
        dryRun: true,
        createdBy: "Daniel",
        productModel: "neonflex",
        stepCm: 10,
        maxLongSideCm: 250,
        customerFactor: OFFER_SIZE_LADDER_CUSTOMER_FACTOR,
        anchors: [
          { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
          { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 160, shippingPrice: 150 },
          { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 500, shippingPrice: 520 },
        ],
      }),
      (error: unknown) => {
        assert.ok(error instanceof OpsOfferApiError);
        assert.equal(error.message, "Dieses Angebot kann nicht automatisch aktualisiert werden.");
        assert.equal(error.code, "VALIDATION_FAILED");
        assert.equal(error.status, 422);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOffersBaseUrl === undefined) delete process.env.NEONTRIP_OFFERS_BASE_URL;
    else process.env.NEONTRIP_OFFERS_BASE_URL = originalOffersBaseUrl;
    if (originalOffersKey === undefined) delete process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
    else process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = originalOffersKey;
  }
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
        warnings: [{ code: "trello_projection_failed", message: "Trello-Projektion fehlgeschlagen" }],
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
    assert.deepEqual(drafts[0]?.warnings, ["Trello-Projektion fehlgeschlagen"]);
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

test("offer size ladder creates missing Trello offer_items_json field before projection", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalTrelloKey = process.env.TRELLO_API_KEY;
  const originalTrelloToken = process.env.TRELLO_TOKEN;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";

  let createdFieldBody: Record<string, unknown> | null = null;
  let projectedItems: Array<Record<string, unknown>> | null = null;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url.startsWith("https://api.trello.com/1/cards/cardTrelloProjectionCreateField")) {
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body || "{}"));
        projectedItems = JSON.parse(body.value.text);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: "cardTrelloProjectionCreateField",
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
      ]), { status: 200 });
    }

    if (url.startsWith("https://api.trello.com/1/customFields") && method === "POST") {
      createdFieldBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({
        id: "created-items",
        name: "offer_items_json",
        type: "text",
      }), { status: 200 });
    }

    if (url.includes("/rest/v1/offer_size_quote_anchor_sets") && method === "GET") {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes("/rest/v1/offer_size_quote_anchor_sets") && method === "POST") {
      return new Response(JSON.stringify([{ id: "set-projection-create-field-1" }]), { status: 201 });
    }
    if (url.includes("/rest/v1/offer_size_") && ["POST", "DELETE", "PATCH"].includes(method)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const result = await generateOfferSizeLadderFromTrello({
      trelloCard: "cardTrelloProjectionCreateField",
      persist: true,
      stepCm: 10,
      maxLongSideCm: 250,
    });

    assert.equal(result.persisted?.trelloProjection?.written, true);
    assert.equal(result.persisted?.trelloProjection?.createdField, true);
    assert.deepEqual(createdFieldBody, {
      idModel: "board-1",
      modelType: "board",
      name: "offer_items_json",
      type: "text",
      pos: "bottom",
      display_cardFront: false,
    });
    assert.ok(projectedItems);
    const items = projectedItems as Array<Record<string, unknown>>;
    assert.ok(items.length > 3);
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
