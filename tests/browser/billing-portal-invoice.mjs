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
const launch = () => page.getByRole("button", { name: "Proforma in reguläre Rechnung umwandeln", exact: true });
const dialog = () => page.getByRole("dialog", { name: "Reguläre Rechnung erstellen", exact: true });
const checkbox = () => dialog().getByRole("checkbox", { name: /Ich bestätige, dass alle Positionen/ });
const action = () => dialog().getByRole("button", { name: "Jetzt reguläre Rechnung erstellen", exact: true });
const deliverySection = () => page.getByRole("region", { name: "Rechnungsversand", exact: true });
async function ready() {
  await page.goto(url);
  await launch().waitFor({ timeout: 5000 });
}
async function openReview() {
  await launch().click();
  await dialog().waitFor();
}
try {
  await ready();
  assert.equal(await dialog().count(), 0);
  assert.equal(await deliverySection().getByRole("button", { name: "Proforma in reguläre Rechnung umwandeln" }).count(), 1);
  const emailBox = await page.getByLabel("Rechnungs-E-Mail", { exact: true }).boundingBox();
  const buttonBox = await launch().boundingBox();
  assert.ok(buttonBox.y >= emailBox.y + emailBox.height, "Launch button must sit below the invoice email");
  assert.equal(requests, 0);
  await deliverySection().screenshot({ path: "/tmp/portal-invoice-button-20261023.png" });

  await openReview();
  assert.equal(requests, 0, "Opening the review must not request an invoice");
  await launch().evaluate(element => element.focus());
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest("dialog")), true, "Background controls must stay inert");
  for (const value of ["Testkommune", "Testweg 1", "10115 Berlin", "accounts@example.com", "Testschild", "119,00"]) {
    assert.ok((await dialog().innerText()).includes(value), "Review missing " + value);
  }
  assert.equal(await checkbox().isChecked(), false);
  assert.equal(await action().isDisabled(), true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    // Native dialogs allow the browser toolbar to receive focus, but never background page controls.
    assert.equal(await page.evaluate(() => !document.hasFocus() || !!document.activeElement?.closest("dialog")), true, "Page focus escaped modal");
  }
  await checkbox().check();
  await page.keyboard.press("Escape");
  assert.equal(await dialog().count(), 0);
  assert.equal(await launch().evaluate(element => element === document.activeElement), true);
  await openReview();
  assert.equal(await checkbox().isChecked(), false);
  await dialog().getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("button", { name: "Rechnungsdaten bearbeiten" }).click();
  assert.equal(await launch().isDisabled(), true);
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await openReview();
  await checkbox().check();
  assert.equal(await action().isEnabled(), true);
  await dialog().screenshot({ path: "/tmp/portal-invoice-popup-desktop-20261023.png", animations: "disabled" });
  await action().click();
  await page.getByText("Ihre Rechnung wurde angefordert und wird erstellt.", { exact: false }).waitFor();
  assert.equal(requests, 1);
  assert.equal(await dialog().count(), 0);
  assert.equal(await launch().count(), 0);
  assert.equal(await page.getByRole("button", { name: "Rechnungsdaten bearbeiten" }).count(), 0);
  await page.reload();
  await page.getByText("Pro-forma und Rechnungsdaten sind für Änderungen gesperrt.").waitFor();

  current = structuredClone(base);
  mode = "stale";
  await ready();
  await openReview();
  await checkbox().check();
  await action().click();
  await page.getByRole("alert").filter({ hasText: /zwischenzeitlich aktualisiert/ }).waitFor();
  assert.equal(await dialog().count(), 0);
  await openReview();
  assert.equal(await checkbox().isChecked(), false);
  assert.equal(await action().isDisabled(), true);

  current = structuredClone(base);
  current.changes = [{ status: "PENDING", requested_changes: { billingAddress: { city: "Hamburg" } } }];
  await ready();
  await openReview();
  assert.equal(await checkbox().isDisabled(), true);
  assert.ok((await dialog().innerText()).includes("10115 Berlin"), "Only saved invoice data can be confirmed");

  current = structuredClone(base);
  mode = "lost-response";
  await ready();
  await openReview();
  await checkbox().check();
  await action().click();
  await page.getByText("Pro-forma und Rechnungsdaten sind für Änderungen gesperrt.").waitFor();
  assert.equal(await dialog().count(), 0);
  assert.equal(await launch().count(), 0);

  current = structuredClone(base);
  mode = "success";
  await page.setViewportSize({ width: 390, height: 844 });
  await ready();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await deliverySection().screenshot({ path: "/tmp/portal-invoice-button-mobile-20261023.png" });
  await openReview();
  assert.equal(await dialog().evaluate(element => element.scrollWidth > element.clientWidth), false);
  await dialog().screenshot({ path: "/tmp/portal-invoice-popup-mobile-20261023.png" });
  await checkbox().check();
  assert.equal(await action().isEnabled(), true);
  await action().scrollIntoViewIfNeeded();
  await dialog().getByRole("button", { name: "Abbrechen", exact: true }).click();
  assert.equal(await launch().evaluate(element => element === document.activeElement), true);

  current = structuredClone(base);
  current.readOnly = true;
  current.billingCase.invoice_requested_at = "2026-10-23T10:02:00.000Z";
  current.billingCase.status = "SYNC_BLOCKED";
  await page.reload();
  await page.getByText("Erstellung oder Versand benötigen eine Prüfung durch NEONTRIP.", { exact: false }).waitFor({ timeout: 5000 });
  assert.equal(await launch().count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: placement, review data, no request on open, consent/reset, modal focus/Escape, edit/pending/stale guards, response-loss recovery and responsive dialog.");
} finally {
  await browser.close();
}
