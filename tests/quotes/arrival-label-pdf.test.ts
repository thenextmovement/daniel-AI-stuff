import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument, rgb } from "pdf-lib";
import { processDpdLabelArtifact } from "../../src/lib/ops/arrival-labels/artifacts";
import {
  annotateDpdLabelPdf,
  extractPdfText,
  rectanglesIntersect,
  renderPdfFirstPageToPng,
  validateA6Layout,
  type DpdPdfLayout,
} from "../../src/lib/ops/arrival-labels/pdf";

const width = 105 * 72 / 25.4;
const height = 148 * 72 / 25.4;
const layout: DpdPdfLayout = {
  version: "synthetic-a6-v1",
  orientation: "portrait",
  safeArea: { x: 200, y: 360, width: 80, height: 35 },
  protectedAreas: [
    { name: "address", x: 15, y: 210, width: 170, height: 170 },
    { name: "dpd_tracking", x: 15, y: 170, width: 170, height: 30 },
    { name: "barcode", x: 15, y: 30, width: 265, height: 120 },
  ],
  fontSize: 24,
};

async function syntheticLabel() {
  const document = await PDFDocument.create();
  const page = document.addPage([width, height]);
  page.drawRectangle({ x: 15, y: 30, width: 265, height: 120, color: rgb(0.9, 0.9, 0.9) });
  for (let index = 0; index < 60; index += 1) {
    if (index % 2 === 0) page.drawRectangle({ x: 20 + index * 4, y: 35, width: 2, height: 110, color: rgb(0, 0, 0) });
  }
  page.drawText("Alexander Walden", { x: 20, y: 330, size: 12 });
  page.drawText("01476817678011", { x: 20, y: 180, size: 12 });
  return document.save({ useObjectStreams: false });
}

test("PDF annotation writes the last six digits, preserves A6 and renders for visual QA", async () => {
  const source = await syntheticLabel();
  const result = await annotateDpdLabelPdf(source, "2619113486", layout);
  assert.equal(result.qa.ok, true);
  assert.equal(result.qa.overlayText, "113486");
  assert.equal(result.qa.a6, true);
  assert.deepEqual(result.qa.protectedAreaIntersections, []);
  const text = await extractPdfText(result.pdf);
  assert.match(text, /113486/);
  assert.doesNotMatch(text, /DHL|DHL-IN/);
  const png = await renderPdfFirstPageToPng(result.pdf, 2);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1_000);
});

test("configured safe area may not overlap address, tracking or barcode regions", async () => {
  const invalid = { ...layout, safeArea: { x: 20, y: 50, width: 80, height: 35 } };
  assert.equal(rectanglesIntersect(invalid.safeArea, layout.protectedAreas[2]), true);
  assert.equal(validateA6Layout(width, height, invalid).ok, false);
  await assert.rejects(annotateDpdLabelPdf(await syntheticLabel(), "2619113486", invalid), /Schutzbereiche/);
});

test("wrong page size and multi-page labels fail closed", async () => {
  const wrong = await PDFDocument.create();
  wrong.addPage([612, 792]);
  await assert.rejects(annotateDpdLabelPdf(await wrong.save(), "2619113486", layout), /nicht A6/);
  const twoPages = await PDFDocument.create();
  twoPages.addPage([width, height]);
  twoPages.addPage([width, height]);
  await assert.rejects(annotateDpdLabelPdf(await twoPages.save(), "2619113486", layout), /genau eine/);
});

test("processed artifacts use a controlled case directory and full DHL number", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "arrival-label-artifacts-"));
  try {
    const result = await processDpdLabelArtifact({
      pdf: await syntheticLabel(),
      incomingDhlTrackingNumber: "2619113486",
      shopifyOrderId: "gid://shopify/Order/4498",
      layout,
      rootDirectory: root,
    });
    assert.match(result.paths.annotatedPdf, /dhl_2619113486\/dpd-label-2619113486\.pdf$/);
    assert.equal(result.qa.overlayText, "113486");
    const qa = JSON.parse(await readFile(result.paths.qaJson, "utf8"));
    assert.equal(qa.ok, true);
    assert.ok((await readFile(result.paths.previewPng)).length > 1_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('first-of-three overlay retains six digits and manual parcel count inside the safe area', async () => {
  const result = await annotateDpdLabelPdf(await syntheticLabel(), '0012345678', layout, 'main', 3);
  assert.equal(result.qa.overlayText, '345678 Paket 1 von 3');
  assert.equal(result.qa.ok, true);
  const text = await extractPdfText(result.pdf);
  assert.match(text, /345678/);
  assert.match(text, /Paket 1 von 3/);
  assert.match(text, /01476817678011/);
  await assert.rejects(annotateDpdLabelPdf(await syntheticLabel(), '0012345678', layout, 'acrylic_table_device', 3), /manuell/);
});

// Coordinates read from the active EasyDPD A6 configuration, 2026-10-19.
// The upper-right synthetic fixture above must never define the production position.
test('multi-parcel overlay uses the approved DPD area left of QR, above tracking', async () => {
  const productionLayout: DpdPdfLayout = {
    version: 'easydpd-a6-2026-07-22-v1', orientation: 'portrait', fontSize: 24,
    safeArea: {x:18,y:190,width:130,height:38},
    protectedAreas: [
      {name:'address_and_sender',x:8,y:285,width:281,height:126},
      {name:'reference_and_weight',x:8,y:245,width:170,height:40},
      {name:'qr_code',x:175,y:175,width:114,height:112},
      {name:'tracking_and_barcode',x:8,y:0,width:281,height:180},
    ],
  };
  const original = await PDFDocument.create(); original.addPage([width,height]);
  const result = await annotateDpdLabelPdf(await original.save(),'0012345678',productionLayout,'main',3);
  assert.equal(result.qa.ok,true);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({data:result.pdf});
  const doc = await loading.promise;
  try {
    const content = await (await doc.getPage(1)).getTextContent();
    const texts = content.items.filter((item): item is typeof item & {str:string;transform:number[];width:number;height:number;fontName:string} => 'str' in item && Boolean(item.str.trim()));
    assert.deepEqual(texts.map(item=>item.str),['345678','Paket 1 von 3']);
    for (const item of texts) {
      const [x,y] = item.transform.slice(4);
      assert.ok(x>=18 && x+item.width<=148, 'text must stay in the approved left column');
      const ascent = content.styles[item.fontName].ascent;
      assert.ok(y>=190 && y+item.height*ascent<=228, 'visible text must stay above the tracking area');
    }
  } finally { await loading.destroy(); }
});
