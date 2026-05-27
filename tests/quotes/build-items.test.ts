import test from "node:test";
import assert from "node:assert/strict";
import { buildAddonItems, buildProductItems, buildShippingItems } from "../../src/lib/quotes/build-items";

test("buildProductItems creates up to four product variants and ignores Price_5", () => {
  const fields = {
    Price_1: 282,
    Size_1: "75x50cm",
    Price_2: 300,
    Size_2: "100x60cm",
    Price_3: 400,
    Size_3: "120x70cm",
    Price_4: 500,
    Size_4: "140x80cm",
    Price_5: 600,
    Size_5: "160x90cm",
    Usage: "Innen",
  };
  const items = buildProductItems(fields, { factor: 2.3, taxRate: 19 });
  assert.equal(items.length, 4);
  assert.equal(items[0].unit_price, 645);
  assert.equal(items[0].selected_default, true);
});

test("buildProductItems reflects available Price_x and Size_x values", () => {
  assert.equal(buildProductItems({ Price_1: 100, Size_1: "A" }, { factor: 2.3, taxRate: 19 }).length, 1);
  assert.equal(
    buildProductItems({ Price_1: 100, Size_1: "A", Price_2: 120, Size_2: "B" }, { factor: 2.3, taxRate: 19 }).length,
    2,
  );
});

test("buildAddonItems calculates RGB price from Price_1", () => {
  const addons = buildAddonItems({ Price_1: 282 }, { factor: 2.3, taxRate: 19 });
  const rgb = addons.find((item) => item.id === "addon_rgb");
  assert.equal(rgb?.unit_price, 125);
});

test("buildShippingItems hides express options for Type 3D", () => {
  const regular = buildShippingItems({ Price_1: 282, Price_2: 300, Type: "Neon" }, { factor: 2.3, taxRate: 19 });
  const threeD = buildShippingItems({ Price_1: 282, Price_2: 300, Type: "3D" }, { factor: 2.3, taxRate: 19 });
  assert.equal(regular.length, 3);
  assert.equal(threeD.length, 1);
});
