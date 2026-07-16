import { chromium } from "playwright";

const target = String(process.env.COMPANY_BRAIN_GOVERNANCE_UI_BASE_URL || process.argv[2] || "http://127.0.0.1:3117")
  .trim()
  .replace(/\/+$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const decisions = [
  {
    id: "123e4567-e89b-42d3-a456-426614174000",
    decisionKey: "offer-send-policy",
    versionNumber: 3,
    decisionType: "policy",
    status: "approved",
    title: "Angebotsversand absichern",
    scopeType: "process",
    scopeKey: "offer_send",
    ownerTeam: "Sales",
    objective: "Doppelte oder unbelegte Angebotsversendungen sicher verhindern.",
    problemStatement: "Versandstatus und Retry-Sicherheit waren nicht immer eindeutig belegt.",
    context: "Angebotsversand nutzt mehrere Systeme und braucht korrelierte Belege.",
    constraints: ["Trello ist Projektion"],
    options: ["Direkt senden", "Guarded Send"],
    chosenOption: "Guarded Send",
    rationale: "Der Guard prüft Duplikate vor jedem Kundenkontakt.",
    assumptions: [],
    expectedOutcomes: ["Weniger doppelte Mails"],
    risks: ["Falscher Block bei unvollständigen Belegen"],
    guardrails: ["Kein Versand ohne Duplicate Check"],
    consequences: [],
    rollbackPlan: "Guard deaktivieren und Versand manuell prüfen.",
    supersedesDecisionId: null,
    decidedAt: "2026-07-15T18:10:00.000Z",
    reviewAt: "2026-08-15T12:00:00.000Z",
    validFrom: "2026-07-15T18:10:00.000Z",
    validUntil: null,
    createdBy: "daniel@neontrip.de",
    submittedBy: "daniel@neontrip.de",
    submittedAt: "2026-07-15T18:05:00.000Z",
    approvedBy: "daniel@neontrip.de",
    approvedAt: "2026-07-15T18:10:00.000Z",
    reviewNote: "Geprüft",
    createdAt: "2026-07-15T18:00:00.000Z",
    updatedAt: "2026-07-15T18:10:00.000Z",
  },
  {
    id: "223e4567-e89b-42d3-a456-426614174000",
    decisionKey: "outlook-source-policy",
    versionNumber: 1,
    decisionType: "decision",
    status: "draft",
    title: "Outlook-Spiegel eindeutig verknüpfen",
    scopeType: "process",
    scopeKey: "customer_communication",
    ownerTeam: "Operations",
    objective: "Kundenkommunikation zuverlässig einer Anfrage zuordnen.",
    problemStatement: "Viele Nachrichten haben keine Request-ID.",
    context: "Die Zuordnung braucht deterministische Identifier.",
    constraints: [],
    options: ["Header-Korrelation", "Nur Freitextsuche"],
    chosenOption: null,
    rationale: null,
    assumptions: [],
    expectedOutcomes: [],
    risks: [],
    guardrails: [],
    consequences: [],
    rollbackPlan: null,
    supersedesDecisionId: null,
    decidedAt: null,
    reviewAt: "2026-08-20T12:00:00.000Z",
    validFrom: null,
    validUntil: null,
    createdBy: "ops@neontrip.de",
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    reviewNote: null,
    createdAt: "2026-07-16T08:00:00.000Z",
    updatedAt: "2026-07-16T08:00:00.000Z",
  },
];

const foundation = {
  generatedAt: "2026-07-16T09:00:00.000Z",
  sources: [
    {
      sourceKey: "postgres",
      displayName: "Ops Postgres",
      sourceKind: "database",
      authority: "authoritative",
      ownerTeam: "Operations",
      criticality: "critical",
      expectedFreshness: "realtime",
      containsPersonalData: true,
      active: true,
      description: "Source of Truth für operative Anfragen und Audit-Daten.",
      updatedAt: "2026-07-16T09:00:00.000Z",
    },
    {
      sourceKey: "trello",
      displayName: "Trello",
      sourceKind: "projection",
      authority: "projection",
      ownerTeam: "Operations",
      criticality: "high",
      expectedFreshness: "minutes",
      containsPersonalData: true,
      active: true,
      description: "Arbeitsprojektion, keine Source of Truth.",
      updatedAt: "2026-07-16T09:00:00.000Z",
    },
  ],
  correlationContracts: [],
  workflows: [
    {
      id: "workflow-row-1",
      sourceKey: "n8n",
      externalWorkflowId: "wf-1",
      workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
      lifecycleStatus: "unreviewed",
      active: true,
      ownerTeam: "Automation",
      nodeCount: 70,
      triggerCount: 1,
      warningCount: 18,
      maxAllowedNodes: 50,
      lastReviewedAt: null,
      lastSyncedAt: "2026-07-16T09:00:00.000Z",
    },
  ],
  workflowSummary: { total: 481, active: 133, unreviewed: 52, aboveNodeLimit: 2 },
  dataQualityIssues: [
    {
      id: "quality-1",
      issueKey: "outlook-request-linkage",
      issueType: "missing_identifier",
      severity: "critical",
      status: "open",
      title: "Outlook-Nachrichten ohne Kundenakte",
      detail: "Ein großer Teil der Outlook-Nachrichten hat keine eindeutige Request-ID.",
      sourceKey: "outlook_mirror",
      lastDetectedAt: "2026-07-16T09:00:00.000Z",
    },
  ],
};

async function setupRoutes(page) {
  await page.route("**/api/ops/company-brain/foundation", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, result: foundation }) });
  });
  await page.route("**/api/ops/company-brain/decisions", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, decision: { ...decisions[1], id: "323e4567-e89b-42d3-a456-426614174000", decisionKey: body.decisionKey, title: body.title } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, decisions }) });
  });
  await page.route("**/api/ops/company-brain/decisions/*/review", async (route) => {
    const body = route.request().postDataJSON();
    const source = decisions.find((decision) => route.request().url().includes(decision.id)) || decisions[1];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, decision: { ...source, status: body.action === "submit" ? "review" : body.action === "approve" ? "approved" : "draft" } }),
    });
  });
  await page.route("**/api/ops/company-brain/decisions/*/outcomes", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, outcome: { id: "outcome-new" } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        outcomes: [{
          id: "outcome-1",
          decisionId: decisions[0].id,
          outcomeKey: "quote-send-success",
          metricKey: "quote_send_success_rate",
          baselineValue: 92.5,
          targetValue: 98,
          actualValue: 99.1,
          unit: "%",
          evaluationStatus: "met",
          evaluationStart: "2026-07-16T00:00:00.000Z",
          evaluationEnd: "2026-08-16T00:00:00.000Z",
          observedAt: "2026-08-16T08:00:00.000Z",
          finding: "Ziel erreicht.",
          lessonsLearned: "Guarded Send beibehalten.",
          evidenceRefs: [],
          recordedBy: "daniel@neontrip.de",
          createdAt: "2026-08-16T08:00:00.000Z",
          updatedAt: "2026-08-16T08:00:00.000Z",
        }],
      }),
    });
  });
  await page.route("**/api/ops/company-brain/foundation/workflows/sync", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, result: { total: 481, active: 133 } }) });
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  assert(sizes.documentWidth <= sizes.viewportWidth + 1, `${label}: horizontal overflow ${sizes.documentWidth} > ${sizes.viewportWidth}`);
}

async function runViewport(browser, viewport, label) {
  const page = await browser.newPage({ viewport });
  await setupRoutes(page);
  await page.goto(`${target}/ops/company-brain/governance`, { waitUntil: "networkidle" });

  await page.getByRole("heading", { name: "Wissen, das Entscheidungen erklärt." }).waitFor();
  await page.getByText("Angebotsversand absichern", { exact: true }).waitFor();
  await page.getByText("Outlook-Spiegel eindeutig verknüpfen", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page, `${label}: initial`);

  await page.getByRole("button", { name: "Neue Entscheidung" }).click();
  await page.getByRole("heading", { name: "Entscheidung dokumentieren" }).waitFor();
  assert(await page.getByLabel("Titel").evaluate((element) => element === document.activeElement), `${label}: decision title did not receive focus`);
  await page.getByLabel("Titel").fill("Smoke Entscheidung");
  await page.getByLabel("Formular schließen").click();

  const approvedCard = page.locator("article").filter({ hasText: "Angebotsversand absichern" }).first();
  await approvedCard.getByText("Begründung, Leitplanken und Ergebnisse").click();
  await approvedCard.getByText("Ziel erreicht.").waitFor();
  await assertNoHorizontalOverflow(page, `${label}: expanded decision`);

  const draftCard = page.locator("article").filter({ hasText: "Outlook-Spiegel eindeutig verknüpfen" }).first();
  await draftCard.getByRole("button", { name: "Zur Prüfung" }).click();
  await page.getByRole("heading", { name: "Zur Prüfung einreichen" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Zur Prüfung einreichen" }).waitFor({ state: "detached" });
  await draftCard.getByRole("button", { name: "Zur Prüfung" }).click();
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await page.getByText(/wurde zur Prüfung eingereicht/).waitFor();

  await page.getByRole("button", { name: "Systemwissen" }).click();
  await page.getByRole("heading", { name: "Offene Wissenslücken" }).waitFor();
  await page.getByText("Outlook-Nachrichten ohne Kundenakte", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Automationen im Überblick" }).waitFor();
  await page.getByText("NEONTRIP Quote Ready SIMPLE v1.1", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Welche Quelle entscheidet?" }).waitFor();
  await assertNoHorizontalOverflow(page, `${label}: system knowledge`);

  await page.screenshot({ path: `/tmp/company-brain-governance-${label}.png`, fullPage: true });
  await page.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await runViewport(browser, { width: 1440, height: 1000 }, "desktop");
  await runViewport(browser, { width: 820, height: 1180 }, "tablet");
  await runViewport(browser, { width: 390, height: 844 }, "mobile");
  console.log("Company Brain governance UI smoke passed.");
} finally {
  await browser.close();
}
