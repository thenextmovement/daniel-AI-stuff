import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/app/ops/sales-vergabe/page-client.tsx", "utf8");

test("Sales-Vergabe shows only item-specific purchased images on product rows", () => {
  assert.match(source, /itemKind\(item\) === "product" && item\.imageIsItemSpecific && item\.imageUrl/);
  assert.match(source, /Gekauftes Design/);
  assert.match(source, /alt={`Gekauftes Design: \$\{item\.title\}`}/);
});
