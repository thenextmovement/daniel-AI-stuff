import assert from "node:assert/strict";
import test from "node:test";
import { dunningOfferUrl } from "../../src/lib/ops/dunning-offer-link";

test("uses the order's explicit offer reference", () => {
  assert.equal(dunningOfferUrl({ customAttributes: [{key: "NEONTRIP Offer URL", value: "https://angebote.neontrip.de/offer/abc12345"}] }), "https://angebote.neontrip.de/offer/abc12345");
  assert.equal(dunningOfferUrl({ note: "Angebotslink: https://angebote.neontrip.de/offer/old12345\nKunde" }), "https://angebote.neontrip.de/offer/old12345");
});
test("does not fabricate or expose unrelated/unsafe links", () => {
  for (const value of ["javascript:alert(1)", "https://example.com/offer/abc12345", "https://angebote.neontrip.de.evil.test/offer/abc12345"]) {
    assert.equal(dunningOfferUrl({ customAttributes: [{key: "NEONTRIP Offer URL", value}] }), null);
  }
  assert.equal(dunningOfferUrl({ note: "Rechnung: https://angebote.neontrip.de/offer/abc12345" }), null);
  assert.equal(dunningOfferUrl({}), null);
});
