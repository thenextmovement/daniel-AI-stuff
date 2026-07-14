import test from "node:test";
import assert from "node:assert/strict";
import { getTaxRate } from "../../src/lib/quotes/tax";

test("getTaxRate returns German VAT only for Germany", () => {
  assert.equal(getTaxRate("Deutschland"), 19);
  assert.equal(getTaxRate("Germany"), 19);
  assert.equal(getTaxRate("DE"), 19);
  assert.equal(getTaxRate("Frankreich"), 0);
  assert.equal(getTaxRate(""), 0);
});
