import { chromium } from "playwright";

function baseUrl() {
  return String(process.env.OPS_MENU_UI_BASE_URL || process.argv[2] || "http://localhost:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const appLabels = [
  "Kundenakte",
  "Schildgrößen & Preise",
  "Anrufe",
  "Aufgaben",
  "Company Brain",
  "Angebote",
  "Sales-Vergabe",
  "Versand",
  "Wareneingang",
  "Management",
];

const localPages = [
  "/ops/customer-records",
  "/ops/customer-records/price-review",
  "/ops/customer-records/calls",
  "/ops/tasks",
  "/ops/company-brain",
  "/ops/sales-vergabe",
  "/ops/customer-records/shipping",
  "/ops/customer-records/inbound-shipping",
  "/ops/management",
];

const emptyTaskPayload = {
  ok: true,
  tasks: [],
  summary: { open: 0, urgent: 0, overdue: 0, dueToday: 0 },
};

function callsPayload() {
  return {
    ok: true,
    state: {
      storageReady: true,
      run: {
        id: "run-menu-qa",
        runKey: "2026-06-17",
        date: "2026-06-17",
        timezone: "Europe/Berlin",
        status: "preview",
        startedAt: null,
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
      completion: { technicalStatus: "ok", complete: true, reason: "complete", nextRequiredAction: null },
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
      taskCounts: { open: 0, waiting: 0, blocked: 0, overdue: 0, emailDriven: 0 },
    },
  };
}

function shippingBoardPayload() {
  return {
    ok: true,
    board: {
      counts: {
        actionRequired: 0,
        watch: 0,
        labelCreated: 0,
        inTransit: 0,
        delivered: 0,
        returning: 0,
        stale: 0,
        withOpenTask: 0,
      },
      items: [],
    },
  };
}

function inboundBoardPayload() {
  return {
    ok: true,
    board: {
      counts: {
        labelCreated: 0,
        acceptedByCarrier: 0,
        actionRequired: 0,
        clearance: 0,
        outForDelivery: 0,
        exception: 0,
        delivered: 0,
      },
      items: [],
    },
  };
}

function supplierSalesPayload() {
  return {
    ok: true,
    board: {
      items: [],
      counts: {
        total: 0,
        readyToAssign: 0,
        paymentOpen: 0,
        assigned: 0,
        dueSoon: 0,
        overdue: 0,
        quentinRecommended: 0,
        saidRecommended: 0,
        syncIssues: 0,
      },
      diagnostics: { ready: true, missing: [], items: [] },
    },
  };
}

function managementPayload() {
  return {
    ok: true,
    dashboard: {
      range: { label: "7 Tage", preset: "7d", from: "2026-06-10T00:00:00.000Z", to: "2026-06-17T23:59:59.999Z", timezone: "Europe/Berlin" },
      generatedAt: "2026-06-17T12:00:00.000Z",
      summary: [
        { key: "revenue", label: "Umsatz", value: "0 EUR", detail: "QA", tone: "neutral" },
        { key: "pipeline", label: "Pipeline", value: "0 EUR", detail: "QA", tone: "neutral" },
        { key: "tasks", label: "Aufgaben", value: "0", detail: "QA", tone: "good" },
        { key: "risks", label: "Risiken", value: "0", detail: "QA", tone: "good" },
      ],
      sales: {
        newRequests: 0,
        quoteCreated: 0,
        quoteSent: 0,
        quoteViewed: 0,
        quoteSigned: 0,
        orders: 0,
        topSources: [],
        topSegments: [],
      },
      operations: {
        completedCalls: 0,
        openSalesTasks: 0,
        overdueSalesTasks: 0,
        openShippingIncidents: 0,
        openInboundIncidents: 0,
        riskFeed: [],
      },
      costs: {
        knownAdSpend: 0,
        knownAiSpendUsd: 0,
        knownVoiceSpendUsd: 0,
        knownInboundProductionSpendUsd: 0,
        knownInboundShippingSpendUsd: 0,
        missingSources: [],
      },
      dataQuality: [],
    },
  };
}

async function setupRoutes(page) {
  await page.route("**/api/ops/tasks**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyTaskPayload) });
  });
  await page.route("**/api/ops/company-brain/resolve**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          query: "QA",
          question: null,
          problemType: "other",
          generatedAt: "2026-06-17T12:00:00.000Z",
          mode: "deterministic_read_only",
          identifiers: [],
          answer: { verdict: "not_found", confidence: "low", headline: "Kein belastbarer Falltreffer.", bullets: [] },
          records: [],
          offers: [],
          caseEvents: [],
          assets: [],
          crossChecks: [],
          integrationReadiness: [
            { key: "live_outlook", label: "Live Outlook / Graph", status: "missing", summary: "QA", detail: null },
            { key: "n8n_live", label: "Live n8n", status: "missing", summary: "QA", detail: null },
            { key: "coolify", label: "Coolify", status: "missing", summary: "QA", detail: null },
          ],
          watchers: [],
          actionProposals: [],
          evidenceScore: {
            status: "weak",
            score: 0,
            summary: "QA",
            safeToAnswerCustomer: false,
            reasons: [],
          },
          problemResolution: {
            problemType: "other",
            label: "Sonstiger Problemfall",
            severity: "info",
            confidence: "low",
            specialCaseKind: "other",
            rootCause: "QA",
            recommendedResolution: "QA",
            internalTaskTitle: "QA",
            internalTaskDescription: "QA",
            customerReplyPolicy: [],
            escalationPath: [],
            requiredEvidence: [],
            missingEvidence: [],
          },
          checks: [],
          sourceHealth: [],
          automationRuns: [],
          dossier: {
            title: "Fall-Dossier",
            generatedAt: "2026-06-17T12:00:00.000Z",
            confidence: "low",
            sections: [],
            copyText: "Fall-Dossier",
          },
          replyDraft: {
            title: "Interner Antwortentwurf",
            riskLevel: "low",
            approvalRequired: true,
            canSendAutomatically: false,
            subject: "Prüfung",
            body: "Nur mit Freigabe.",
            blockers: [],
            sourceEvidenceIds: [],
          },
          evidence: [],
          conflicts: [],
          gaps: [],
          diagnostics: [],
          nextActions: [],
        },
      }),
    });
  });
  await page.route("**/api/ops/customer-records/views", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/ops/customer-records/calls", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(callsPayload()) });
  });
  await page.route("**/api/ops/customer-records/price-predictions?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [], anchorItems: [] }) });
  });
  await page.route("**/api/ops/customer-records/shipping**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(shippingBoardPayload()) });
  });
  await page.route("**/api/ops/customer-records/inbound-shipping**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inboundBoardPayload()) });
  });
  await page.route("**/api/ops/supplier-sales**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(supplierSalesPayload()) });
  });
  await page.route("**/api/ops/management-kpis**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(managementPayload()) });
  });
  await page.route("**/api/ops/customer-records?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("mode") === "workboard") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sections: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: [] }) });
  });
}

async function assertMenuLabels(page, path, mode) {
  const nav = page.getByRole("navigation", { name: "Ops-Bereiche" }).first();
  await nav.waitFor({ timeout: 10_000 });
  for (const label of appLabels) {
    const link = nav.locator("a").filter({ hasText: label }).first();
    await link.waitFor({ timeout: 5_000 });
    assert(await link.isVisible(), `${mode}: ${path} zeigt Menüeintrag "${label}" nicht sichtbar`);
  }

  const layout = await page.evaluate((labels) => {
    const clipped = [];
    for (const label of labels) {
      const element = [...document.querySelectorAll(`[data-ops-app-label="${label}"]`)].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!element) {
        clipped.push(`${label}: missing label span`);
        continue;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0) clipped.push(`${label}: not rendered`);
      if (element.scrollWidth > element.clientWidth + 1 && style.whiteSpace === "nowrap") clipped.push(`${label}: clipped`);
    }
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      clipped,
    };
  }, appLabels);

  assert(layout.noHorizontalOverflow, `${mode}: ${path} hat horizontalen Overflow ${layout.scrollWidth} > ${layout.clientWidth}`);
  assert(layout.clipped.length === 0, `${mode}: ${path} hat abgeschnittene Menülabels: ${layout.clipped.join(" | ")}`);
}

async function runForViewport(browser, target, viewport, mode) {
  const page = await browser.newPage({ viewport });
  await setupRoutes(page);
  const checked = [];
  for (const path of localPages) {
    await page.goto(`${target}${path}`, { waitUntil: "networkidle" });
    if (mode === "mobile") {
      const toggle = page.getByRole("button", { name: /Bereiche/ });
      await toggle.waitFor({ timeout: 10_000 });
      await toggle.click();
    }
    await assertMenuLabels(page, path, mode);
    checked.push(path);
  }
  await page.close();
  return checked;
}

async function main() {
  const target = baseUrl();
  const browser = await chromium.launch({ headless: true });
  const desktop = await runForViewport(browser, target, { width: 1440, height: 1000 }, "desktop");
  const mobile = await runForViewport(browser, target, { width: 390, height: 844 }, "mobile");
  await browser.close();
  console.log(JSON.stringify({ ok: true, baseUrl: target, appLabels, desktop, mobile }, null, 2));
}

main().catch((error) => {
  console.error(`Ops Menu UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
