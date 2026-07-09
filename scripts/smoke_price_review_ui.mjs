import { chromium } from "playwright";

function baseUrl() {
  return String(process.env.PRICE_REVIEW_UI_BASE_URL || process.argv[2] || "http://localhost:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function reviewItem(overrides = {}) {
  return {
    id: "prediction-qa-1",
    requestId: "REQ-PRICE-QA",
    trelloCardId: "trello-qa-1",
    sourceCode: "QA Preisanker",
    sourceLabel: "QA Preisanker",
    widthCm: 80,
    heightCm: 40,
    maxSideCm: 80,
    predictedProductionPrice: 120,
    predictedShippingPrice: 25,
    predictedTotalSupplierCost: 145,
    currency: "USD",
    modelKey: "qa_model",
    modelVersion: "v1",
    anchorWidthCm: 80,
    anchorHeightCm: 40,
    customerAutoQuoteEligible: true,
    decisionStatus: "pending_review",
    ...overrides,
  };
}

async function main() {
  const target = baseUrl();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const posts = [];
  const dialogs = [];
  const pageErrors = [];
  const consoleErrors = [];
  let items = [reviewItem()];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) consoleErrors.push(`${msg.type()}: ${msg.text()}`);
  });

  await page.route("**/api/ops/tasks?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, tasks: [], summary: { open: 0, urgent: 0, overdue: 0, dueToday: 0 } }),
    });
  });
  await page.route("**/api/ops/customer-records/price-predictions?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items, anchorItems: [] }) });
  });
  await page.route("**/api/ops/customer-records/price-predictions", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    posts.push(body);
    items = items.map((item) =>
      item.id === body.predictionId
        ? { ...item, decisionStatus: body.decision === "approve" ? "approved_for_quote" : body.decision === "reject" ? "rejected" : "needs_supplier_check" }
        : item,
    );
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items, anchorItems: [] }) });
  });

  await page.goto(`${target}/ops/customer-records/price-review`, { waitUntil: "networkidle" });
  const expandReview = page.locator("summary").filter({ hasText: "Modelltraining & Review" });
  if (await expandReview.count()) await expandReview.first().click();
  await page.getByText("QA Preisanker").waitFor({ timeout: 10_000 });

  const approveButton = page.getByRole("button", { name: "Freigeben" });
  page.once("dialog", async (dialog) => {
    dialogs.push({ action: "dismiss-approve", message: dialog.message() });
    await dialog.dismiss();
  });
  await approveButton.click();
  assert(posts.length === 0, `Abgebrochene Freigabe sendet trotzdem POST: ${JSON.stringify(posts)}`);

  page.once("dialog", async (dialog) => {
    dialogs.push({ action: "accept-approve", message: dialog.message() });
    await dialog.accept();
  });
  await approveButton.click();
  await page.getByText("Preisvorschlag aktualisiert.").waitFor({ timeout: 10_000 });

  const mobileLayout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  assert(posts.length === 1 && posts[0].action === "review" && posts[0].decision === "approve", `Unerwartete POSTs: ${JSON.stringify(posts)}`);
  assert(dialogs.length === 2 && dialogs.every((entry) => entry.message.includes("wirklich freigeben")), `Unerwartete Dialoge: ${JSON.stringify(dialogs)}`);
  assert(mobileLayout.noHorizontalOverflow, `Mobile horizontal overflow: ${mobileLayout.scrollWidth} > ${mobileLayout.clientWidth}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);

  await browser.close();
  console.log(JSON.stringify({ ok: true, baseUrl: target, posts: posts.map((entry) => entry.decision), dialogs, mobileLayout }, null, 2));
}

main().catch((error) => {
  console.error(`Price Review UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
