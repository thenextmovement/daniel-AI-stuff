import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import manifest from "../../assets/neontrip-installation-documents/manifest.json";
import { prepareInstallationMail, selectInstallationDocuments, loadInstallationAttachments } from "../../src/lib/ops/shipping-installation-documents";

const led = { id: 1, title: "LED Neonschild – Test", quantity: 1 };
const wall = { id: 2, title: "Wandmontage Set", quantity: 1 };
const ceiling = { id: 3, title: "Deckenabhängung Drahtseile", quantity: 1 };
function order(items: object[] = [led, wall], shipped = items) {
  return { id: 123, name: "#TEST-123", email: "internal@example.test", line_items: items,
    fulfillments: [{ id: 456, order_id: 123, status: "success", line_items: shipped }] };
}
test("LED wall shipment selects wall, connection and mandatory power notice", () => {
  const result = selectInstallationDocuments(order(), "456");
  assert.deepEqual(result.reviewReasons, []);
  assert.deepEqual(new Set(result.documentIds), new Set(["wall", "led_connection", "power"]));
});
test("LED ceiling shipment excludes wall guide", () => {
  const result = selectInstallationDocuments(order([led, ceiling]), "456");
  assert.deepEqual(result.reviewReasons, []);
  assert.deepEqual(new Set(result.documentIds), new Set(["ceiling", "led_connection", "power"]));
});
test("combined mounting includes both once, including repeated accessory positions", () => {
  const result = selectInstallationDocuments(order([led, wall, ceiling, { ...wall, id: 4 }]), "456");
  assert.equal(result.documentIds.length, 4);
  assert.deepEqual(result.reviewReasons, []);
});
test("partial fulfillment does not include accessories only on another shipment", () => {
  const result = selectInstallationDocuments(order([led, wall, ceiling], [led, ceiling]), "456");
  assert(!result.documentIds.includes("wall"));
  assert(result.documentIds.includes("ceiling"));
});
test("accessory-only partial shipment cannot assume its parent is LED neon", () => {
  const result = selectInstallationDocuments(order([{ ...led, title: "3D Frontlit" }, wall], [wall]), "456");
  assert(result.reviewReasons.includes("mounting_parent_product_ambiguous"));
});
test("LED without purchased mounting gets connection and power documents without guessed mounting", () => {
  const result = selectInstallationDocuments(order([led]), "456");
  assert.deepEqual(result.reviewReasons, []);
  assert.deepEqual(new Set(result.documentIds), new Set(["led_connection", "power"]));
});
test("deselected hanging property does not select a ceiling PDF", () => {
  const result = selectInstallationDocuments(order([{ ...led, properties: [{ name: "Hängeset", value: "Nein" }, { name: "_Montage", value: "wall-mount" }] }]), "456");
  assert.deepEqual(result.reviewReasons, []);
  assert(result.documentIds.includes("wall"));
  assert(!result.documentIds.includes("ceiling"));
});
test("configurator selected accessory quantities are recognized", () => {
  const item = { ...led, title: "NEONTRIP Konfiguration", properties: [
    { name: "_Schrift", value: "Barcelona" }, { name: "_Leuchtmodus", value: "Statisch" },
    { name: "_Zubehörmengen pro Schild", value: '{"wall-mount":1,"hanging-kit":1,"table-stand":0,"adhesive-kit":0}' },
  ] };
  const result = selectInstallationDocuments(order([item]), "456");
  assert.deepEqual(result.reviewReasons, []);
  assert(result.documentIds.includes("wall") && result.documentIds.includes("ceiling"));
});
test("zero-quantity, duplicate, foreign and excessive fulfillment items fail closed", () => {
  for (const shipped of [[{ ...wall, quantity: 0 }], [wall, wall], [{ ...wall, id: 999 }], [{ ...wall, quantity: 2 }]]) {
    assert(selectInstallationDocuments(order([wall], shipped), "456").reviewReasons.length);
  }
});
test("cancelled, missing and foreign fulfillment never prepare a mail", async () => {
  const cancelled = { ...order(), cancelled_at: "2026-11-02T10:00:00Z" };
  assert.equal((await prepareInstallationMail(cancelled, "456")).ready, false);
  assert.equal((await prepareInstallationMail(order(), "999")).ready, false);
  const foreign = order(); foreign.fulfillments[0].order_id = 999;
  assert.equal((await prepareInstallationMail(foreign, "456")).ready, false);
});
test("advertised ceiling mounting in descriptions is not a purchased option", () => {
  const result = selectInstallationDocuments(order([{ ...led, properties: [{ name: "Beschreibung", value: "Optional mit Deckenabhängung erhältlich" }] }, wall]), "456");
  assert.deepEqual(result.reviewReasons, []);
  assert(!result.documentIds.includes("ceiling"));
});
test("unsupported products and backlit are held for review", async () => {
  for (const title of ["3D Rückbeleuchtet", "3D Frontlit", "3D Unbeleuchtet", "Leuchtkasten"]) {
    const result = await prepareInstallationMail(order([{ ...led, title }]), "456");
    assert.equal(result.ready, false, title);
  }
});
test("backlit order with canonical delivery and outdoor surcharge has only the genuine manual-review reason", () => {
  const result = selectInstallationDocuments(order([
    { ...led, title: "3D Schild Rückleuchtend – Test" },
    { id: 2, title: "3D Standardversand ca. 20 Werktage", quantity: 1 },
    { id: 3, title: "Outdoor/IP67 Ausführung", quantity: 1 },
  ]), "456");
  assert.deepEqual(result.reviewReasons, ["backlit_manual_not_cleared"]);
  assert.deepEqual(result.documentIds, ["power"]);
});
test("service words embedded in an unknown physical product never bypass review", () => {
  for (const title of ["3D Standardversand Leuchtkasten", "Outdoor/IP67 Ausführung Leuchtkasten"]) {
    assert(selectInstallationDocuments(order([{ ...led, title }]), "456").reviewReasons.includes("unknown_product"));
  }
});
test("3D PDF is selected when documented construction matches its scope", () => {
  for (const [title, type] of [["3D Frontlit", "frontlit"], ["3D Unbeleuchtet", "nonlit"]]) {
    const item = { ...led, title, properties: [{ name: "Beschreibung", value: "Befestigung: Gewindestangen mit rückseitigen Muttern\nLeuchtfarbe: Kaltweiß" }] };
    const result = selectInstallationDocuments(order([item]), "456");
    assert.deepEqual(result.reviewReasons, []);
    assert(result.documentIds.includes(type as "frontlit" | "nonlit"));
  }
});
test("contradictory mounting quantity and choice require review", () => {
  const item = { ...led, properties: [{ name: "_Montage", value: "wall-mount" }, { name: "_Zubehörmengen pro Schild", value: '{"wall-mount":0}' }] };
  assert(selectInstallationDocuments(order([item]), "456").reviewReasons.includes("accessory_selection_conflict"));
});
test("unsupported adhesive mounting cannot silently fall back to wall", () => {
  const result = selectInstallationDocuments(order([{ ...led, properties: [{ name: "Klebeset", value: "Ja" }] }, wall]), "456");
  assert(result.reviewReasons.includes("unsupported_mounting"));
});
test("all actual attachment bytes match manifest and parse as one-page PDF", async () => {
  const ids = Object.keys(manifest) as (keyof typeof manifest)[];
  for (const [index, attachment] of (await loadInstallationAttachments(ids)).entries()) {
    const bytes = Buffer.from(attachment.contentBytes, "base64");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest[ids[index]].sha256);
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  }
});
test("actual combined mail fits Graph payload limit and contains Mika signature", async () => {
  const result = await prepareInstallationMail(order([led, wall, ceiling]), "456");
  assert.equal(result.ready, true);
  if (!result.ready) return;
  assert.equal(result.graphDraft.attachments.length, 4);
  assert(result.bodyHtml.includes("Mika Zangane"));
  assert(result.bodyHtml.includes("Mika_3.jpg?v=1770127459"));
  assert(!result.bodyHtml.includes("Fabienne"));
  assert(!result.bodyHtml.includes("Abmelden"));
  assert(result.bodyHtml.includes("Überhitzung"));
  assert(Buffer.byteLength(JSON.stringify(result.graphDraft)) < 3_900_000);
});
test("customer strings are HTML-escaped; malformed recipient cannot prepare mail", async () => {
  const result = await prepareInstallationMail({ ...order(), name: '<img src=x onerror="alert(1)">' }, "456");
  assert.equal(result.ready, true);
  if (result.ready) assert(result.bodyHtml.includes("&lt;img"));
  assert.equal((await prepareInstallationMail({ ...order(), email: "broken" }, "456")).ready, false);
});
test("fulfillment identity is stable across repeats; separate fulfillments have separate keys", () => {
  const first = selectInstallationDocuments(order(), "456");
  const second = selectInstallationDocuments(order(), "456");
  assert.equal(first.notificationKey, second.notificationKey);
  assert.notEqual(first.notificationKey, selectInstallationDocuments(order(), "457").notificationKey);
});
