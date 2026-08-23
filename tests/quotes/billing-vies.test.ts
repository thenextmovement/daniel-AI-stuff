import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVatId, validateVatIdWithVies, VatValidationError } from "../../src/lib/ops/billing/vies";

test("Austrian VAT IDs require ATU plus exactly eight digits", () => {
  assert.deepEqual(normalizeVatId("AT", "ATU 46674503"), { countryCode: "AT", normalizedVatId: "ATU46674503", vatNumber: "U46674503" });
  assert.throws(() => normalizeVatId("AT", "ATU466745000"), (error) => error instanceof VatValidationError && error.code === "vat_id_format_invalid");
  assert.throws(() => normalizeVatId("AT", "DE123456789"), (error) => error instanceof VatValidationError && error.code === "vat_id_country_mismatch");
});

test("VIES evidence distinguishes a valid ID and a non-blocking identity mismatch", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    isValid: true,
    name: "Österreichische Post Aktiengesellschaft",
    address: "Rochusplatz 1\nAT-1030 Wien",
    requestDate: "2026-08-23T21:01:30.462Z",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const result = await validateVatIdWithVies({ deliveryCountry: "Österreich", vatId: "ATU46674503", company: "NEONTRIP E2E TEST GmbH" });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedVatId, "ATU46674503");
    assert.equal(result.identityComparison, "MISMATCH");
    assert.equal(result.source, "EU_VIES");
  } finally {
    global.fetch = originalFetch;
  }
});

test("VIES invalid response remains invalid", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ isValid: false, name: "---", address: "---" }), { status: 200 });
  try {
    const result = await validateVatIdWithVies({ deliveryCountry: "AT", vatId: "ATU46674500" });
    assert.equal(result.valid, false);
  } finally {
    global.fetch = originalFetch;
  }
});
