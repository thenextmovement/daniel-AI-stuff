import { chromium } from "playwright";

function baseUrl() {
  return String(process.env.CUSTOMER_RECORDS_UI_BASE_URL || process.argv[2] || "http://localhost:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const target = baseUrl();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  const consoleErrors = [];
  const searchQueries = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (msg) => {
    const text = msg.text();
    const expectedAbortedSearchRequest = text.includes("Failed to load resource: net::ERR_FAILED");
    if (["error", "warning"].includes(msg.type()) && !expectedAbortedSearchRequest) {
      consoleErrors.push(`${msg.type()}: ${text}`);
    }
  });

  await page.route("**/api/ops/customer-records?**", async (route) => {
    const url = new URL(route.request().url());
    const mode = url.searchParams.get("mode");
    const query = url.searchParams.get("query");

    if (mode === "inbox") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: [] }) });
      return;
    }

    if (mode === "workboard") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sections: [] }) });
      return;
    }

    searchQueries.push(query || "");
    if (query === "timeout") {
      await route.abort("failed");
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: [] }) });
  });
  await page.route("**/api/ops/tasks?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, tasks: [], summary: { open: 0, urgent: 0, overdue: 0, dueToday: 0 } }),
    });
  });
  await page.route("**/api/ops/customer-records/views", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto(`${target}/ops/customer-records`, { waitUntil: "networkidle" });
  await page.getByText("Fall-ID, Name, Telefon oder Verkaufsfall").waitFor({ timeout: 10_000 });

  const searchInput = page.getByPlaceholder("Fall-ID, E-Mail oder Name");
  const searchButton = page.getByRole("button", { name: /^Fall laden$/ });

  await searchInput.fill("timeout");
  await searchButton.click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.some((button) => button.textContent?.trim() === "Fall laden" && !button.disabled);
  });
  await page.getByText("Suche fehlgeschlagen. Bitte erneut versuchen.").waitFor({ timeout: 10_000 });

  await searchInput.fill("qa");
  await searchButton.click();
  await page.getByText("Kein Fall gefunden.").waitFor({ timeout: 10_000 });

  const mobileLayout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  assert(searchQueries.join(",") === "timeout,qa", `Unerwartete Suchabfragen: ${searchQueries.join(",")}`);
  assert(mobileLayout.noHorizontalOverflow, `Mobile horizontal overflow: ${mobileLayout.scrollWidth} > ${mobileLayout.clientWidth}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);

  await browser.close();
  console.log(JSON.stringify({ ok: true, baseUrl: target, searchQueries, mobileLayout }, null, 2));
}

main().catch((error) => {
  console.error(`Customer Records UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
