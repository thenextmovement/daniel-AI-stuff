import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuoteTotals } from "../../src/lib/quotes/calculate-totals";
import { validateAcceptQuotePayload, QuoteValidationError } from "../../src/lib/quotes/validation";
import type { AcceptQuotePayload, QuoteItemRecord } from "../../src/lib/quotes/types";

const items: QuoteItemRecord[] = [
  {
    id: "product-1",
    section: "products",
    name: "Produkt",
    quantity: 1,
    unit_price: 1000,
    tax_rate: 19,
    optional: true,
    selected_default: true,
    quantity_editable: true,
    sort_order: 10,
  },
  {
    id: "addon-1",
    section: "addons",
    name: "Addon",
    quantity: 1,
    unit_price: 100,
    tax_rate: 19,
    optional: true,
    selected_default: false,
    quantity_editable: false,
    sort_order: 20,
  },
];

const address = {
  company: "",
  first_name: "Max",
  last_name: "Mustermann",
  street: "Musterstr. 1",
  postal_code: "40219",
  city: "Duesseldorf",
  country: "Deutschland",
};

function validPayload(): AcceptQuotePayload {
  return {
    selected_items: [
      { item_id: "product-1", selected: true, quantity: 2 },
      { item_id: "addon-1", selected: false, quantity: 1 },
    ],
    delivery_address: address,
    billing_address: address,
    signed_name: "Max Mustermann",
    terms_accepted: true,
  };
}

test("calculateQuoteTotals uses selected items and quantities", () => {
  assert.deepEqual(calculateQuoteTotals(items, validPayload().selected_items), {
    subtotal_net: 2000,
    tax_amount: 380,
    total_gross: 2380,
  });
});

test("validateAcceptQuotePayload rejects missing signature and incomplete address", () => {
  const payload = validPayload();
  payload.signed_name = "";
  payload.delivery_address = { ...address, city: "" };

  assert.throws(() => validateAcceptQuotePayload(items, payload), QuoteValidationError);
});

test("validateAcceptQuotePayload rejects no relevant selected item", () => {
  const payload = validPayload();
  payload.selected_items = items.map((item) => ({ item_id: item.id, selected: false, quantity: 1 }));

  assert.throws(() => validateAcceptQuotePayload(items, payload), QuoteValidationError);
});
