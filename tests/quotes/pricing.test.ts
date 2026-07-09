import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail } from "../../src/lib/quotes/customer";
import { getFactor, roundDownToFive } from "../../src/lib/quotes/pricing";

test("roundDownToFive rounds down to five euro steps", () => {
  assert.equal(roundDownToFive(648.6), 645);
  assert.equal(roundDownToFive(650), 650);
  assert.equal(roundDownToFive(654.99), 650);
  assert.equal(roundDownToFive(200 * 2.3), 460);
});

test("getFactor uses NT-Number or fallback", () => {
  assert.equal(getFactor({ "NT-Number": "2.6" }), 2.6);
  assert.equal(getFactor({}), 2.3);
  assert.equal(getFactor({ "NT-Number": "" }), 2.3);
});

test("normalizeEmail trims, lowercases and removes trailing dots", () => {
  assert.equal(normalizeEmail("  Max@Example.COM.. "), "max@example.com");
});
