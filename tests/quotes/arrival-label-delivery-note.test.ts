import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { processArrivalDeliveryNoteArtifact } from "../../src/lib/ops/arrival-labels/artifacts";
import { generateArrivalDeliveryNotePdf } from "../../src/lib/ops/arrival-labels/delivery-note";
import type { ArrivalCaseDecision } from "../../src/lib/ops/arrival-labels/domain";
import { extractPdfText, renderPdfPagesToPng } from "../../src/lib/ops/arrival-labels/pdf";

function austriaDecision(lineItemCount = 1): ArrivalCaseDecision {
  return {
    idempotencyKey: "shopify:gid://shopify/Order/100:dhl:1234567890",
    trackingNumber: "1234567890",
    lastSix: "567890",
    expectedArrival: "2026-07-20 (due_today)",
    trelloCard: { id: "card-1", name: "1234567890 | #NEONT100", url: "https://trello.com/c/abc123/order" },
    shopifyOrder: {
      id: "gid://shopify/Order/100",
      name: "#NEONT100",
      adminUrl: "https://neontrip.myshopify.com/admin/orders/100",
      customerName: "Marlene Muster",
      note: null,
      shippingAddress: {
        name: "Marlene Muster",
        company: "Muster GmbH",
        address1: "Kaerntner Strasse 1",
        address2: "2. Stock",
        zip: "1010",
        city: "Wien",
        provinceCode: "9",
        country: "Oesterreich",
        countryCodeV2: "AT",
      },
      customAttributes: [],
      tags: [],
      lineItems: Array.from({ length: lineItemCount }, (_, index) => ({ title: `Neonschild Design ${index + 1}`, quantity: index + 1 })),
      shippingLines: [{ title: "Standard Versand", code: "standard" }],
      fulfillments: [],
    },
    shippingClass: "standard",
    destinationCountryCode: "AT",
    destinationClass: "eu",
    deliveryNoteRequired: true,
    deliveryNoteStatus: "planned",
    selectedDpdProduct: "DPD_EU_CLASSIC_TEST",
    existingDpdTracking: null,
    status: "label_planned",
    manualReviewReason: null,
    relevantOrderNote: null,
    reasons: [],
  };
}

test("EU delivery note is a price-free A4 PDF with verified Shopify address and all references", async () => {
  const generated = await generateArrivalDeliveryNotePdf({ decision: austriaDecision(), localDate: "2026-07-20" });
  assert.equal(generated.qa.ok, true);
  assert.equal(generated.qa.a4, true);
  assert.equal(generated.qa.pageCount, 1);
  assert.equal(generated.qa.destinationCountryCode, "AT");
  assert.equal(generated.qa.containsPriceFields, false);
  const document = await PDFDocument.load(generated.pdf);
  assert.equal(document.getPageCount(), 1);
  const text = await extractPdfText(generated.pdf);
  assert.match(text, /Lieferschein/);
  assert.match(text, /#NEONT100/);
  assert.match(text, /Kaerntner Strasse 1/);
  assert.match(text, /1234567890/);
  assert.match(text, /567890/);
  assert.doesNotMatch(text, /\b(?:EUR|Netto|Brutto|MwSt|USt)\b|€/i);
  const previews = await renderPdfPagesToPng(generated.pdf, 2);
  assert.equal(previews.length, 1);
  assert.deepEqual([...previews[0].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("delivery note paginates deterministically and renders every A4 page", async () => {
  const generated = await generateArrivalDeliveryNotePdf({ decision: austriaDecision(30), localDate: "2026-07-20" });
  assert.equal(generated.qa.pageCount, 3);
  assert.equal(generated.qa.lineItemCount, 30);
  const previews = await renderPdfPagesToPng(generated.pdf, 1.25);
  assert.equal(previews.length, 3);
  assert.ok(previews.every((preview) => preview.length > 5_000));
});

test("delivery-note artifacts use the controlled case directory and retain QA previews", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "arrival-delivery-note-"));
  try {
    const result = await processArrivalDeliveryNoteArtifact({ decision: austriaDecision(), localDate: "2026-07-20", rootDirectory: root });
    assert.match(result.paths.deliveryNotePdf, /dhl_1234567890\/lieferschein-_NEONT100[.]pdf$/);
    assert.equal(result.paths.previewPngs.length, 1);
    assert.ok((await readFile(result.paths.deliveryNotePdf)).length > 1_000);
    assert.ok((await readFile(result.paths.previewPngs[0])).length > 5_000);
    const qa = JSON.parse(await readFile(result.paths.qaJson, "utf8"));
    assert.equal(qa.ok, true);
    assert.equal(qa.destinationCountryCode, "AT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delivery-note generation fails closed outside an approved EU decision", async () => {
  await assert.rejects(
    generateArrivalDeliveryNotePdf({
      decision: { ...austriaDecision(), destinationCountryCode: "CH", destinationClass: "switzerland", deliveryNoteRequired: false },
      localDate: "2026-07-20",
    }),
    /nur fuer freigegebene EU-Auslandssendungen/,
  );
});
