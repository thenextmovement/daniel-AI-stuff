import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.BILLING_PREVIEW_URL || "http://127.0.0.1:3218";
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin), "Local synthetic preview only");
const token = "a".repeat(43);
const url = origin + "/rechnung/" + token;
const address = { company: "Testkommune", street: "Testweg 1", zip: "10115", city: "Berlin", country: "DE", invoiceEmail: "accounts@example.com" };
const base = {
  ok: true, readOnly: false, changes: [],
  billingCase: {
    id: "fixture", shopify_order_name: "#NEONT98001", customer_email: "accounts@example.com",
    invoiceEmail: "accounts@example.com", billing_address: address, delivery_address: address,
    line_items: [{ title: "Testschild", quantity: 1, unitPriceGross: 119 }],
    totals: { subtotalNet: 100, vatAmount: 19, totalGross: 119 }, total_gross_cents: 11900,
    currency: "EUR", status: "PAYMENT_PENDING", tax_review_status: "NOT_REQUIRED",
    tax_treatment: "DE_STANDARD", payment_method: "VORKASSE", current_revision: 0,
    updated_at: "2026-10-23T10:00:00.000Z", final_invoice_at: null, invoice_requested_at: null,
  },
  documents: [{ id: "proforma", document_type: "PROFORMA", revision: 0, document_number: "PF-NEONT98001", status: "SENT" }],
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let current = structuredClone(base);
let requests = 0;
let mode = "success";
await page.route("**/*", async route => {
  const request = route.request();
  const requestUrl = new URL(request.url());
  if (requestUrl.origin !== origin) return route.abort();
  if (requestUrl.pathname === "/api/rechnung/" + token + "/invoice") {
    requests++;
    assert.deepEqual(request.postDataJSON(), {
      confirmed: true, consentVersion: "2026-10-23", revision: 0,
      updatedAt: current.billingCase.updated_at,
    });
    if (mode === "stale") {
      current.billingCase.updated_at = "2026-10-23T10:01:00.000Z";
      return route.fulfill({ status: 409, json: { ok: false, error: "BILLING_INVOICE_STALE" } });
    }
    current.readOnly = true;
    current.billingCase.invoice_requested_at = "2026-10-23T10:02:00.000Z";
    current.billingCase.status = "INVOICE_PENDING";
    if (mode === "lost-response") return route.abort();
    return route.fulfill({ status: 202, json: { ok: true, status: "INVOICE_PENDING", invoiceRequestedAt: current.billingCase.invoice_requested_at } });
  }
  if (requestUrl.pathname === "/api/rechnung/" + token) return route.fulfill({ status: 200, json: current });
  return route.continue();
});
const checkbox = () => page.getByRole("checkbox", { name: /Ich bestätige, dass alle Positionen/ });
const action = () => page.getByRole("button", { name: "Verbindliche Rechnung erstellen", exact: true });
const section = () => page.getByRole("region", { name: "Verbindliche Rechnung", exact: true });
async function ready() {
  await page.goto(url);
  await action().waitFor();
}
try {
  await ready();
  assert.equal(await checkbox().isChecked(), false);
  assert.equal(await action().isDisabled(), true);
  assert.equal(requests, 0);
  await checkbox().check();
  assert.equal(await action().isEnabled(), true);
  await page.getByRole("button", { name: "Rechnungsdaten bearbeiten" }).click();
  assert.equal(await checkbox().isChecked(), false);
  assert.equal(await checkbox().isDisabled(), true);
  await page.getByRole("button", { name: /Abbrechen/ }).click();
  await checkbox().check();
  await section().screenshot({ path: "/tmp/portal-invoice-desktop-20261023.png" });
  await action().click();
  await page.getByText("Ihre Rechnung wurde angefordert und wird erstellt.", { exact: false }).waitFor();
  assert.equal(requests, 1);
  assert.equal(await page.getByRole("button", { name: "Rechnungsdaten bearbeiten" }).count(), 0);
  await page.reload();
  await page.getByText("Pro-forma und Rechnungsdaten sind für Änderungen gesperrt.").waitFor();

  current = structuredClone(base);
  mode = "stale";
  await ready();
  await checkbox().check();
  await action().click();
  await page.getByRole("alert").filter({ hasText: /zwischenzeitlich aktualisiert/ }).waitFor();
  assert.equal(await checkbox().isChecked(), false);
  assert.equal(await action().isDisabled(), true);

  current = structuredClone(base);
  current.changes = [{ status: "PENDING", requested_changes: { billingAddress: { city: "Hamburg" } } }];
  await ready();
  assert.equal(await checkbox().isDisabled(), true);

  current = structuredClone(base);
  mode = "lost-response";
  await ready();
  await checkbox().check();
  await action().click();
  await page.getByText("Pro-forma und Rechnungsdaten sind für Änderungen gesperrt.").waitFor();
  assert.equal(await action().count(), 0);

  current = structuredClone(base);
  mode = "success";
  await page.setViewportSize({ width: 390, height: 844 });
  await ready();
  await section().scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await section().screenshot({ path: "/tmp/portal-invoice-mobile-20261023.png" });
  await checkbox().check();
  assert.equal(await action().isEnabled(), true);
  current = structuredClone(base);
  current.readOnly = true;
  current.billingCase.invoice_requested_at = "2026-10-23T10:02:00.000Z";
  current.billingCase.status = "SYNC_BLOCKED";
  await page.reload();
  await page.getByText("Erstellung oder Versand benötigen eine Prüfung durch NEONTRIP.", { exact: false }).waitFor({ timeout: 5000 });
  assert.equal(await action().count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: default consent, edit reset, pending changes, stale data, immediate/reloaded lock, lost response, desktop/mobile and no horizontal overflow.");
} finally {
  await browser.close();
}
