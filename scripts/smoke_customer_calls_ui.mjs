import { chromium } from "playwright";

const now = "2026-06-16T12:00:00.000Z";

function baseUrl() {
  return String(process.env.CUSTOMER_CALLS_UI_BASE_URL || process.argv[2] || "http://localhost:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function statePayload() {
  return {
    ok: true,
    state: {
      storageReady: true,
      run: {
        id: "run_calls_qa",
        runKey: "2026-06-16",
        date: "2026-06-16",
        timezone: "Europe/Berlin",
        status: "preview",
        startedAt: now,
        finishedAt: null,
        candidateCount: 0,
        eligibleCount: 0,
        blockedCount: 0,
      },
      items: [],
      processedToday: [],
      gate: {
        gate: "green",
        topN: 10,
        reviewed: 10,
        remainingToReview: 0,
        remainingReviewRanks: [],
        useful: 10,
        notUseful: 0,
        usefulRate: 1,
        concreteNextSteps: 10,
        concreteNextStepValue: 0,
        informativeUseful: 10,
        distinctInformativeNotes: 10,
        clearLearningSignal: true,
        usefulNeededForGreen: 0,
        concreteNextStepsNeededForGreen: 0,
        informativeUsefulNeededForLearningSignal: 0,
        distinctInformativeNotesNeededForLearningSignal: 0,
        criticalDataErrors: 0,
        wrongNumbers: 0,
        validationErrors: [],
      },
      completion: {
        technicalStatus: "ok",
        complete: true,
        reason: "complete",
        nextRequiredAction: null,
      },
      bucketCounts: {
        due_today: 0,
        vip_today: 0,
        not_reached: 0,
        callbacks: 0,
        manual_followup: 0,
        offer_adjustment: 0,
        data_issue: 0,
        finished: 0,
      },
      taskCounts: {
        open: 0,
        waiting: 0,
        blocked: 0,
        overdue: 0,
        emailDriven: 0,
      },
    },
  };
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

  await page.route("**/api/ops/customer-records/calls", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statePayload()) });
  });
  await page.route("**/api/ops/tasks?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, tasks: [], summary: { open: 0, urgent: 0, overdue: 0, dueToday: 0 } }),
    });
  });
  await page.route("**/api/ops/customer-records?**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query") || "";
    searchQueries.push(query);
    if (query === "timeout") {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: [] }) });
  });

  await page.goto(`${target}/ops/customer-records/calls`, { waitUntil: "networkidle" });
  await page.getByText("Kontakt außerhalb der Liste finden").waitFor({ timeout: 10_000 });

  const searchInput = page.getByLabel("Kontakt suchen");
  const searchButton = page.getByRole("button", { name: /^Suchen$/ });

  await searchInput.fill("timeout");
  await searchButton.click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.some((button) => button.textContent?.trim() === "Suchen" && !button.disabled);
  });
  assert(await page.getByText(/Failed to fetch|Anfrage fehlgeschlagen|Die Anfrage hat zu lange gedauert/).isVisible(), "Suchfehler wird nicht sichtbar angezeigt");

  await searchInput.fill("qa");
  await searchButton.click();
  await page.getByText("Keine Suchtreffer für die aktuelle Eingabe.").waitFor({ timeout: 10_000 });

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
  console.error(`Customer Calls UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
