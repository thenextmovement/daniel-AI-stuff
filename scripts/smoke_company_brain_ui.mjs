import { chromium } from "playwright";

function baseUrl() {
  return String(process.env.COMPANY_BRAIN_UI_BASE_URL || process.argv[2] || "http://localhost:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const actionProposals = [
  {
    key: "save_case_note",
    label: "Fallnotiz speichern",
    type: "prepared_task",
    riskLevel: "low",
    approvalRequired: true,
    enabled: true,
    summary: "Speichert die Fallanalyse als interne Notiz in der Kundenakte. Kein Kundenkontakt.",
    confirmationText: "Nur interne, belegbasierte Analyse speichern.",
    href: "/ops/customer-records?query=REQ-SMOKE",
    payloadPreview: ["Problemfall: Angebot nicht raus", "Empfehlung: E-Mail korrigieren"],
  },
  {
    key: "correct_customer_email",
    label: "Kunden-E-Mail korrigieren",
    type: "prepared_task",
    riskLevel: "high",
    approvalRequired: true,
    enabled: true,
    summary: "Ändert nach Eingabe und Freigabe die E-Mail in der Kundenakte. Kein Angebotsversand.",
    confirmationText: "Nur ausführen, wenn die neue E-Mail-Adresse fachlich belegt ist. Danach erneut prüfen.",
    href: "/ops/customer-records?query=REQ-SMOKE",
    payloadPreview: ["Aktuell: praxis@kurswechsel", "Neue E-Mail wird beim Ausführen abgefragt."],
  },
  {
    key: "guarded_offer_resend",
    label: "Angebot erneut senden",
    type: "prepared_task",
    riskLevel: "high",
    approvalRequired: true,
    enabled: true,
    summary: "Sendet erst nach serverseitigem Duplicate-, Bounce- und Empfängercheck. Kundenkontakt nur nach Freigabe.",
    confirmationText: "Kundenkontakt: nur ausführen, wenn Empfänger, Duplicate-Check und Bounce-Check sauber sind.",
    href: "https://angebote.neontrip.de/AN-14427",
    payloadPreview: ["Empfänger: praxis@kurswechsel.de", "Angebot: A/N 14427", "Idempotency: smoke-key"],
  },
  {
    key: "inspect_n8n_run",
    label: "n8n-Run untersuchen",
    type: "manual_check",
    riskLevel: "medium",
    approvalRequired: false,
    enabled: true,
    summary: "Ein fehlerhafter Automation-Beleg ist vorhanden.",
    confirmationText: "Keinen Workflow ohne Backup, Diff und Rollback ändern.",
    href: null,
    payloadPreview: ["Workflow: NEONTRIP Quote Ready SIMPLE v1.1", "Execution: 2770420"],
  },
];

function companyBrainPayload() {
  return {
    ok: true,
    result: {
      query: "https://trello.com/c/BiP93WuG/smoke",
      question: "Wieso wurde das Angebot nicht rausgeschickt?",
      problemType: "offer_not_sent",
      generatedAt: "2026-07-07T10:30:00.000Z",
      mode: "deterministic_read_only",
      identifiers: [{ type: "trello_card_id", label: "Trello-ID", value: "BiP93WuG", confidence: "high", href: null }],
      answer: {
        verdict: "found",
        confidence: "medium",
        headline: "Automation-Fehler erkannt.",
        bullets: ["Empfänger war unvollständig.", "Retry nur nach Korrektur und Duplicate-Check."],
      },
      records: [{
        requestId: "REQ-SMOKE",
        displayName: "Kurswechsel Travel Health",
        company: "Kurswechsel",
        email: "praxis@kurswechsel.de",
        phone: null,
        status: "open",
        title: "LED Flex Grüll",
        requestedSize: "100 cm",
        requestedColors: ["Color as logo"],
        trelloCardId: "BiP93WuG",
        trelloCardUrl: "https://trello.com/c/BiP93WuG/smoke",
        latestOfferSentAt: null,
        latestOfferViewedAt: null,
        latestOfferSignedAt: null,
        latestOrderNumber: null,
        latestOrderStatus: null,
        latestOutboundAt: null,
        latestInboundAt: null,
        communicationsCount: 0,
        timelineCount: 1,
      }],
      offers: [{
        offerId: "offer-smoke",
        offerNumber: "A/N 14427",
        documentReference: "AN-14427",
        publicUrl: "https://angebote.neontrip.de/AN-14427",
        status: "SENT",
        customerName: "Kurswechsel",
        customerEmail: "praxis@kurswechsel.de",
        projectTitle: "LED Flex Grüll",
        trelloCardId: "BiP93WuG",
        updatedAt: "2026-07-06T07:39:11.809Z",
        viewedAt: null,
        acceptedAt: null,
        itemCount: 33,
        imageCount: 6,
        selectedItemCount: 5,
        designEvidenceCount: 6,
        productHints: ["LED", "Schild"],
        colorHints: ["Blau", "Kaltweiß"],
        selectedItems: [],
        imageEvidence: [],
      }],
      caseEvents: [],
      assets: [],
      crossChecks: [],
      integrationReadiness: [
        { key: "live_outlook", label: "Live Outlook / Graph", status: "missing", summary: "Kein Graph", detail: null },
        { key: "n8n_live", label: "Live n8n", status: "configured", summary: "API bereit", detail: null },
        { key: "coolify", label: "Coolify", status: "configured", summary: "API bereit", detail: null },
      ],
      watchers: [],
      actionProposals,
      retryAssessment: {
        status: "ready",
        label: "Retry nach Freigabe möglich",
        summary: "Keine harten Blocker im Smoke-Fall.",
        recipientEmail: "praxis@kurswechsel.de",
        offerId: "offer-smoke",
        offerNumber: "A/N 14427",
        idempotencyKey: "smoke-key",
        canSendWithConfirmation: true,
        blockers: [],
        safeFixes: ["Serverseitigen Duplicate-Check direkt vor Versand ausführen."],
      },
      evidenceScore: { status: "medium", score: 72, summary: "Smoke", safeToAnswerCustomer: false, reasons: [] },
      problemResolution: {
        problemType: "offer_not_sent",
        label: "Angebot nicht raus",
        severity: "warning",
        confidence: "medium",
        specialCaseKind: "open_question",
        rootCause: "Kunden-E-Mail war unvollständig.",
        recommendedResolution: "Adresse korrigieren, erneut prüfen, dann guarded resend.",
        internalTaskTitle: "Angebot nicht raus: A/N 14427",
        internalTaskDescription: "Smoke-Fall für Company Brain.",
        customerReplyPolicy: ["Keine Schuldzusage ohne Beleg."],
        escalationPath: ["Sales prüft Angebot"],
        requiredEvidence: [],
        missingEvidence: [],
      },
      checks: [],
      sourceHealth: [],
      automationRuns: [{
        id: "run-smoke",
        workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
        action: "offer_send",
        status: "failed",
        error: "invalid customer_email praxis@kurswechsel",
        createdAt: "2026-07-06T07:41:13.408Z",
        requestId: "REQ-SMOKE",
        executionId: "2770420",
        correlationId: null,
        sourceEventId: null,
        targetRecordId: null,
        failedNode: "Offer Send",
        idempotencyKey: "smoke-key",
        retrySafety: "blocked",
        summary: "Kunden-E-Mail unvollständig.",
      }],
      trelloFailureDiagnosis: {
        requested: true,
        status: "loaded",
        severity: "warning",
        expectedAction: "offer_send",
        card: {
          id: "BiP93WuG",
          shortLink: "BiP93WuG",
          name: "FEHLER - LED Flex Grüll",
          descriptionPreview: "Request-ID: REQ-SMOKE",
          url: "https://trello.com/c/BiP93WuG/smoke",
          currentListName: "Quote Ready",
          dateLastActivity: "2026-07-06T07:41:13.408Z",
          attachmentsCount: 11,
          customFields: [],
        },
        triggerMove: { id: "move-smoke", occurredAt: "2026-07-06T07:41:13.408Z", fromListName: "Neue Angebote schicken", toListName: "Quote Ready" },
        rootCauseKey: "automation_failed",
        rootCause: "Automation meldete eine unvollständige Kunden-E-Mail.",
        recommendedFix: "Kunden-E-Mail korrigieren und danach erneut prüfen.",
        evidenceStrength: "medium",
        duplicateRisk: "low",
        safeFixes: ["Kunden-E-Mail belegen und korrigieren."],
        blockedFixes: [],
        timeline: [],
        diagnostics: [],
      },
      dossier: {
        title: "Fall-Dossier",
        generatedAt: "2026-07-07T10:30:00.000Z",
        confidence: "medium",
        sections: [],
        copyText: "Smoke-Fall-Dossier",
      },
      replyDraft: {
        title: "Interner Antwortentwurf",
        riskLevel: "medium",
        approvalRequired: true,
        canSendAutomatically: false,
        subject: "Prüfung zu A/N 14427",
        body: "Hallo,\n\nwir prüfen den Fall intern.",
        blockers: [],
        sourceEvidenceIds: [],
      },
      evidence: [],
      conflicts: [],
      gaps: [],
      diagnostics: [],
      nextActions: ["Adresse korrigieren", "Retry prüfen"],
    },
  };
}

async function setupRoutes(page) {
  await page.route("**/api/ops/company-brain/resolve**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(companyBrainPayload()),
    });
  });
  await page.route("**/api/ops/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

async function waitForBodyText(page, label, snippets) {
  const deadline = Date.now() + 30000;
  let body = "";
  while (Date.now() < deadline) {
    body = ((await page.textContent("body")) || "").replace(/\s+/g, " ");
    const missing = snippets.filter((snippet) => !body.includes(snippet));
    if (!missing.length) return;
    await page.waitForTimeout(250);
  }
  const missing = snippets.filter((snippet) => !body.includes(snippet));
  throw new Error(`${label}: missing ${missing.join(", ")}. Body: ${body.slice(0, 1400)}`);
}

async function runViewport(browser, target, viewport, label) {
  const page = await browser.newPage({ viewport });
  await setupRoutes(page);
  await page.goto(`${target}/ops/company-brain`, { waitUntil: "networkidle" });
  await page.getByLabel(/Fall, E-Mail, Angebotsnummer, Trello-ID/).fill("https://trello.com/c/BiP93WuG/smoke");
  await page.getByRole("button", { name: "Suchen" }).click();
  await waitForBodyText(page, `${label}: decision summary`, [
    "Entscheidung",
    "Kann nach Freigabe gelöst werden",
    "Guarded Fix",
    "Empfänger und Angebot im Fix Center prüfen",
    "System-Blocker",
    "Live Outlook / Graph",
  ]);
  await waitForBodyText(page, `${label}: action groups`, ["Intern sichern", "Daten korrigieren", "Kundenkontakt"]);
  await page.getByRole("button", { name: "Versand freigeben" }).click();
  await waitForBodyText(page, `${label}: confirmation panel`, ["Freigabe prüfen", "Diese Aktion kann Kundenkontakt auslösen"]);

  const layout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert(layout.noHorizontalOverflow, `${label}: horizontal overflow ${layout.scrollWidth} > ${layout.clientWidth}`);
  await page.screenshot({ path: `/tmp/company-brain-fix-center-${label}.png`, fullPage: true });
  await page.close();
}

async function main() {
  const target = baseUrl();
  const browser = await chromium.launch({ headless: true });
  await runViewport(browser, target, { width: 1440, height: 1000 }, "desktop");
  await runViewport(browser, target, { width: 390, height: 844 }, "mobile");
  await browser.close();
  console.log(JSON.stringify({ ok: true, baseUrl: target, screenshots: ["/tmp/company-brain-fix-center-desktop.png", "/tmp/company-brain-fix-center-mobile.png"] }, null, 2));
}

main().catch((error) => {
  console.error(`Company Brain UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
