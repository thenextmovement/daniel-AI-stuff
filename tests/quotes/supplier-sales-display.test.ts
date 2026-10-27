import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryCountdownLabel,
  deliveryDaysRemaining,
  orderAgeDays,
  orderAgeLabel,
  supplierSaleMountingSelection,
} from "../../src/lib/ops/supplier-sales-display";

const now = "2026-07-29T12:00:00.000Z";

function mountingItem(overrides = {}) {
  return { title: "LED Neon Sign", variantTitle: null, quantity: 1, selectionDetails: [] as string[], ...overrides };
}

test("mounting selection recognizes purchased wall and hanging options", () => {
  for (const title of ["Wandmontage-Set", "Wandmontageset", "Wandmontage Set", "Wall Mounting Set", "Wall mounting kit"]) {
    assert.deepEqual(supplierSaleMountingSelection([mountingItem(), mountingItem({ title })]), { wall: true, hanging: false }, title);
  }
  for (const title of ["Drahtseil-Abhängeset", "Deckenabhängung Drahtseile", "Deckenabhaengung", "Hängeset", "Haengeset", "Abhängeset", "Hanging set", "Hanging kit"]) {
    assert.deepEqual(supplierSaleMountingSelection([mountingItem(), mountingItem({ title })]), { wall: false, hanging: true }, title);
  }
  assert.deepEqual(supplierSaleMountingSelection([
    mountingItem(), mountingItem({ title: "Wandmontage-Set" }), mountingItem({ title: "Deckenabhängung" }),
  ]), { wall: true, hanging: true });
});

test("mounting selection reads normalized configurator choices without mistaking adhesive for wall mounting", () => {
  for (const detail of ["Wall mount: YES", "Wandmontageset: Ja", "Mounting: Wall mounting set", "Montage: Wandmontage-Set"]) {
    assert.equal(supplierSaleMountingSelection([mountingItem({ selectionDetails: [detail] })]).wall, true, detail);
  }
  for (const detail of ["Hanging set: YES ❗", "Hängeset: Ja", "Mounting: Drahtseil-Abhängeset"]) {
    assert.deepEqual(supplierSaleMountingSelection([mountingItem({ selectionDetails: [detail] })]), { wall: false, hanging: true }, detail);
  }
  assert.deepEqual(supplierSaleMountingSelection([mountingItem({ selectionDetails: ["Adhesive mounting kit: YES ❗", "Text: Wall mount", "Mounting: adhesive mounting kit"] })]), { wall: false, hanging: false });
});

test("mounting selection does not count absent, deselected or zero-quantity accessories", () => {
  assert.deepEqual(supplierSaleMountingSelection([]), { wall: false, hanging: false });
  assert.deepEqual(supplierSaleMountingSelection([mountingItem()]), { wall: false, hanging: false });
  for (const value of ["Nein", "NO", "false", "0", "none", "nicht gewählt", "nicht ausgewählt", "Ohne Wandmontageset", "Kein Wandmontageset", ""]) {
    assert.deepEqual(supplierSaleMountingSelection([mountingItem({ selectionDetails: [`Wall mount: ${value}`, `Hanging set: ${value}`] })]), { wall: false, hanging: false }, value);
  }
  assert.deepEqual(supplierSaleMountingSelection([
    mountingItem({ title: "Wandmontageset", quantity: 0 }),
    mountingItem({ title: "Deckenabhängung", quantity: 0 }),
  ]), { wall: false, hanging: false });
  assert.deepEqual(supplierSaleMountingSelection([
    mountingItem({ title: "Wandmontageset", variantTitle: "Nein" }),
    mountingItem({ title: "Deckenabhängung", selectionDetails: ["Hanging set: NO"] }),
  ]), { wall: false, hanging: false });
});

test("mounting display leaves purchased items unchanged", () => {
  const items = [mountingItem({ selectionDetails: ["Hanging set: YES ❗", "Wall mount: NO"] })];
  const before = structuredClone(items);
  supplierSaleMountingSelection(items);
  assert.deepEqual(items, before);
});

test("order age uses Berlin calendar days", () => {
  assert.equal(orderAgeDays("2026-07-16T05:07:00.000Z", now), 13);
  assert.equal(orderAgeLabel("2026-07-16T05:07:00.000Z", now), "vor 13 Tagen");
  assert.equal(orderAgeLabel("2026-07-29T00:30:00.000Z", now), "heute bestellt");
  assert.equal(orderAgeLabel(null, now), null);
});

test("delivery countdown distinguishes remaining, today and overdue days", () => {
  assert.equal(deliveryDaysRemaining("2026-08-13", now), 15);
  assert.equal(deliveryCountdownLabel("2026-08-13", now), "noch 15 Tage");
  assert.equal(deliveryCountdownLabel("2026-07-29", now), "heute");
  assert.equal(deliveryCountdownLabel("2026-07-28", now), "1 Tag überfällig");
  assert.equal(deliveryCountdownLabel("2026-07-20", now), "9 Tage überfällig");
  assert.equal(deliveryCountdownLabel("ungueltig", now), null);
});
