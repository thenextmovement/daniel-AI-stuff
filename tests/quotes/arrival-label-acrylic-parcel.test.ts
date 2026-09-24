import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as claimBrowserPurchase } from "../../src/app/api/internal/arrival-labels/browser-purchases/claim/route";
import { PDFDocument, rgb } from "pdf-lib";
import { hasAcrylicTableDevice, labelOverlayText } from "../../src/lib/ops/arrival-labels/parcels";
import { annotateDpdLabelPdf, extractPdfText, renderPdfFirstPageToPng, type DpdPdfLayout } from "../../src/lib/ops/arrival-labels/pdf";
import { validateBridgeJob, postDispatchDownloadUrl } from "../../deploy/local-easydpd-existing-chrome/extension/policy.mjs";
import { claimJob, validateClaimedJob } from "../../scripts/easydpd_browser_worker_lib.mjs";

const primaryTracking = "01476817678011";
const newTracking = "01476817678012";
const primaryUrl = "https://easydpd.247apps.de/labels/123/download/test.pdf?signature=fixture";
const newUrl = "https://easydpd.247apps.de/labels/124/download/test.pdf?signature=fixture";
const primaryPath = new URL(primaryUrl).pathname;
const job = {
  id: "11111111-1111-4111-8111-111111111111", orderName: "#NEONT9999",
  orderUrl: "https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create?id=1234567890&shop=galaxybuzzdk.myshopify.com",
  productLabel: "DPD Express 12:00", labelFormat: "Einzeln auf A6", packageWeightGrams: 500,
  maximumPurchaseCents: 1500, incomingDhlTrackingNumber: "2619113486", incomingDhlLastSix: "113486",
  parcelKind: "acrylic_table_device", parentPurchaseJobId: "22222222-2222-4222-8222-222222222222",
  expectedPrimaryDpdTracking: primaryTracking,
};

test("only the exact acrylic line item with positive integer quantity plans one add-on", () => {
  for (const title of ["Acryl LED-Tischgerät", "Acryl LED Tischgerät", " ACRYL  LED–Tischgerät "]) {
    assert.equal(hasAcrylicTableDevice([{ title, quantity: 2 }]), true);
  }
  for (const title of ["LED Acrylic", "LED Neon", "Acryl LED-Tischgerät Ersatzteil", "Kein Acryl LED-Tischgerät"]) {
    assert.equal(hasAcrylicTableDevice([{ title, quantity: 1 }]), false);
  }
  for (const quantity of [0, -1, 0.5, NaN]) assert.equal(hasAcrylicTableDevice([{ title: "Acryl LED-Tischgerät", quantity }]), false);
  assert.equal(hasAcrylicTableDevice([]), false);
  assert.equal(labelOverlayText("2619113486"), "113486");
  assert.equal(labelOverlayText("2619113486", "acrylic_table_device"), "Acryl LED-Tischgerät");
});

test("both bridge boundaries require a bound primary and preserve Express and price limits", () => {
  for (const validate of [validateBridgeJob, validateClaimedJob]) {
    assert.equal(validate(job).productLabel, "DPD Express 12:00");
    for (const delta of [
      { expectedPrimaryDpdTracking: null }, { parentPurchaseJobId: job.id },
      { parcelKind: "unknown" }, { parcelKind: "main" }, { maximumPurchaseCents: 1501 },
    ]) assert.throws(() => validate({ ...job, ...delta }));
  }
});

test("post-dispatch recovery never mistakes the already printed primary for the add-on", () => {
  const history = { found: true, labelCount: 1, downloadUrl: primaryUrl, downloadUrls: [primaryUrl], trackingNumbers: [primaryTracking] };
  assert.equal(postDispatchDownloadUrl(history, job, primaryPath), null);
  assert.equal(postDispatchDownloadUrl({ found: false }, job, primaryPath), null);
  assert.throws(() => postDispatchDownloadUrl(history, job), /Baseline fehlt/);
  const complete = { ...history, labelCount: 2, downloadUrl: null, downloadUrls: [primaryUrl, newUrl], trackingNumbers: [primaryTracking, newTracking] };
  assert.equal(postDispatchDownloadUrl(complete, job, primaryPath), newUrl);
  assert.equal(postDispatchDownloadUrl({ ...complete, downloadUrls: [primaryUrl.replace("fixture", "renewed"), newUrl] }, job, primaryPath), newUrl);
  assert.throws(() => postDispatchDownloadUrl({ ...complete, trackingNumbers: [newTracking] }, job, primaryPath));
  assert.throws(() => postDispatchDownloadUrl({ ...complete, downloadUrls: [primaryUrl, newUrl, newUrl.replace("124", "125")] }, job, primaryPath));
  assert.equal(postDispatchDownloadUrl(history, { ...job, parcelKind: "main" }), primaryUrl);
});

test("legacy claimers cannot opt into an additional parcel accidentally", async () => {
  const fetchBefore = globalThis.fetch;
  const seen: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_url, init) => {
    seen.push(JSON.parse(String(init?.body)));
    return Response.json({ job });
  };
  try {
    const config = { apiBaseUrl: "https://ops.fixture.invalid", workerId: "fixture-native-host", mode: "live", token: "fixture-only" };
    await assert.rejects(claimJob(config), /nicht freigegeben/);
    assert.equal(seen[0].capability, undefined);
    assert.equal((await claimJob(config, "acrylic-parcel-v1")).parcelKind, "acrylic_table_device");
    assert.equal(seen[1].capability, "acrylic-parcel-v1");
  } finally { globalThis.fetch = fetchBefore; }
});

test("claim API forwards only the exact capability and returns the immutable parcel binding", async () => {
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN"] as const;
  const previous = keys.map((key) => process.env[key]);
  const fetchBefore = globalThis.fetch;
  const token = "fixture-test-browser-token-more-than-32-characters";
  process.env.SUPABASE_URL = "https://database.fixture.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-only";
  process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN = token;
  let capable: unknown;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(String(url)).pathname, "/rest/v1/rpc/arrival_labels_claim_browser_purchase");
    capable = JSON.parse(String(init?.body)).p_acrylic_capable;
    return Response.json(capable ? [{
      id: job.id, parcel_kind: job.parcelKind, parent_purchase_job_id: job.parentPurchaseJobId,
      expected_primary_dpd_tracking: primaryTracking, easydpd_product_label: job.productLabel,
    }] : []);
  };
  try {
    for (const capability of [undefined, "unknown", "acrylic-parcel-v1"]) {
      const response = await claimBrowserPurchase(new NextRequest("https://ops.fixture.invalid/api/internal/arrival-labels/browser-purchases/claim", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Neontrip-Browser-Worker": "fixture-worker" },
        body: JSON.stringify({ workerId: "fixture-worker", mode: "live", capability }),
      }));
      assert.equal(capable, capability === "acrylic-parcel-v1");
      assert.equal(response.status, capable ? 200 : 204);
      if (capable) {
        const payload = await response.json();
        assert.equal(payload.job.parentPurchaseJobId, job.parentPurchaseJobId);
        assert.equal(payload.job.expectedPrimaryDpdTracking, primaryTracking);
        assert.equal(payload.job.parcelKind, "acrylic_table_device");
        assert.equal(payload.job.productLabel, "DPD Express 12:00");
      }
    }
  } finally {
    globalThis.fetch = fetchBefore;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test("actual content script permits only the proven primary, then exactly one new click", async () => {
  let handler: (message: unknown, sender: unknown, response: (value: any) => void) => void;
  let clicks = 0;
  let hrefs = [primaryUrl, `https://tracking.dpd.de/status/de_DE/parcel/${primaryTracking}`];
  const product = { options: ["B2C", "B2C Predict", "DPD Express 8:30", "DPD Express 12:00", "DPD Express 18:00"].map((label) => ({ textContent: label, value: label })), value: job.productLabel, selectedOptions: [{ textContent: job.productLabel }] };
  const format = { options: ["4 Labels auf A4", "Einzeln auf A6"].map((label) => ({ textContent: label, value: label })), value: job.labelFormat, selectedOptions: [{ textContent: job.labelFormat }] };
  const weight = { value: "500", getAttribute: () => "Total package weight" };
  const button = { textContent: "Create label", disabled: false, getAttribute: () => null, click: () => { clicks += 1; } };
  const values = new Map<string, string>();
  runInNewContext(await readFile("deploy/local-easydpd-existing-chrome/extension/content_script.js", "utf8"), {
    location: { origin: "https://easydpd.247apps.de" }, URL, setTimeout,
    sessionStorage: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) },
    chrome: { runtime: { onMessage: { addListener: (fn: typeof handler) => { handler = fn; } } } },
    document: { querySelectorAll: (selector: string) => {
      if (selector === "a[href]") return [{ textContent: job.orderName, href: "https://admin.shopify.com/store/galaxybuzzdk/orders/1234567890" }, ...hrefs.map((href) => ({ href, textContent: "label" }))];
      if (selector === "select") return [product, format];
      if (selector.startsWith("input")) return [weight];
      if (selector === "button") return [button];
      return [];
    } },
  });
  const send = (override: Record<string, unknown> = {}) => new Promise<any>((resolve) => handler({ target: "neontrip-easydpd-frame", action: "purchase_once", job, primaryLabelPath: primaryPath, dispatchNonce: "fixture", ...override }, {}, resolve));
  assert.equal((await send({ job: { ...job, parcelKind: "main", parentPurchaseJobId: null, expectedPrimaryDpdTracking: null } })).ok, false);
  assert.equal(clicks, 0);
  hrefs = [];
  assert.equal((await send()).ok, false);
  hrefs = [primaryUrl, `https://tracking.dpd.de/status/de_DE/parcel/${newTracking}`];
  assert.equal((await send()).ok, false);
  hrefs = [primaryUrl, newUrl, `https://tracking.dpd.de/status/de_DE/parcel/${primaryTracking}`];
  assert.equal((await send()).ok, false);
  hrefs = [primaryUrl, `https://tracking.dpd.de/status/de_DE/parcel/${primaryTracking}`];
  assert.equal((await send({ primaryLabelPath: "/labels/wrong/download/" })).ok, false);
  assert.equal((await send()).ok, true);
  assert.equal((await send()).ok, false);
  assert.equal(clicks, 1);
});

test("extra A6 overlay fits the verified live area and leaves protected content untouched", async () => {
  const layout: DpdPdfLayout = {
    version: "easydpd-a6-2026-07-22-v1", orientation: "portrait", fontSize: 24,
    safeArea: { x: 18, y: 190, width: 130, height: 38 },
    protectedAreas: [
      { name: "address_and_sender", x: 8, y: 285, width: 281, height: 126 },
      { name: "reference_and_weight", x: 8, y: 245, width: 170, height: 40 },
      { name: "qr_code", x: 175, y: 175, width: 114, height: 112 },
      { name: "tracking_and_barcode", x: 8, y: 0, width: 281, height: 180 },
    ],
  };
  const document = await PDFDocument.create();
  const page = document.addPage([105 * 72 / 25.4, 148 * 72 / 25.4]);
  for (const area of layout.protectedAreas) page.drawRectangle({ ...area, color: rgb(.93, .93, .93) });
  page.drawText("TEST - KEIN VERSANDLABEL", { x: 15, y: 390, size: 14 });
  page.drawText(newTracking, { x: 15, y: 155, size: 18 });
  const source = await document.save();
  const normal = await annotateDpdLabelPdf(source, job.incomingDhlTrackingNumber, layout);
  const extra = await annotateDpdLabelPdf(source, job.incomingDhlTrackingNumber, layout, "acrylic_table_device");
  assert.equal(normal.qa.overlayText, "113486");
  assert.equal(extra.qa.overlayText, "Acryl LED-Tischgerät");
  assert.equal(extra.qa.a6, true);
  assert.deepEqual(extra.qa.protectedAreaIntersections, []);
  const text = await extractPdfText(extra.pdf);
  assert.match(text.replace(/\s+/g, " "), /Acryl LED-\s*Tischgerät/);
  assert.match(text, new RegExp(newTracking));
  assert.doesNotMatch(text, /113486/);
  const png = await renderPdfFirstPageToPng(extra.pdf, 3);
  assert.ok(png.length > 1000);
  if (process.env.ARRIVAL_ACRYLIC_QA_DIR) {
    await mkdir(process.env.ARRIVAL_ACRYLIC_QA_DIR, { recursive: true });
    await writeFile(join(process.env.ARRIVAL_ACRYLIC_QA_DIR, "acrylic-a6-test.pdf"), extra.pdf);
    await writeFile(join(process.env.ARRIVAL_ACRYLIC_QA_DIR, "acrylic-a6-test.png"), png);
  }
  await assert.rejects(annotateDpdLabelPdf(source, job.incomingDhlTrackingNumber, { ...layout, safeArea: { x: 18, y: 190, width: 40, height: 10 } }, "acrylic_table_device"), /zu klein/);
});
