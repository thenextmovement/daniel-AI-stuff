import assert from "node:assert/strict";
import test from "node:test";
import { dunningOfferUrl, dunningOfferReference } from "../../src/lib/ops/dunning-offer-link";

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

test("keeps the explicit offer number and uses the internal admin route", () => {
  assert.deepEqual(dunningOfferReference({customAttributes: [
    {key: "NEONTRIP Offer Number", value: "A/N 15903"},
    {key: "NEONTRIP Offer ID", value: "abc12345"},
  ]}), {number: "A/N 15903", adminUrl: "/api/ops/customer-records/offers/abc12345/admin"});
  assert.deepEqual(dunningOfferReference({note: "NEONTRIP Offer Number: A/N 15903\nNEONTRIP Offer ID: abc12345"}),
    {number: "A/N 15903", adminUrl: "/api/ops/customer-records/offers/abc12345/admin"});
});
test("direct orders and unsafe offer ids do not acquire invented links", () => {
  assert.deepEqual(dunningOfferReference({}), {number: null, adminUrl: null});
  assert.equal(dunningOfferReference({customAttributes: [{key: "NEONTRIP Offer ID", value: "../other/offer"}]}).adminUrl, null);
  assert.equal(dunningOfferReference({note: "Kunde hat A/N 999 erwähnt"}).number, null);
});
