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
    key: "repair_trello_projection",
    label: "Trello-Projektion bereinigen",
    type: "prepared_task",
    riskLevel: "medium",
    approvalRequired: true,
    enabled: true,
    summary: "Entfernt nach serverseitigem Versandbeleg-Check einen stale FEHLER-Titel und setzt fehlenden 'Angebot gesendet'-Tag. Kein Kundenkontakt.",
    confirmationText: "Nur Trello-Projektion reparieren; Source of Truth bleibt Kundenakte/Angebot/Outlook/Audit.",
    href: "https://trello.com/c/BiP93WuG/smoke",
    payloadPreview: ["Karte: BiP93WuG", "Server prüft vor Änderung erneut einen Versandbeleg.", "Mögliche Änderung: FEHLER-Prefix entfernen und Tag 'Angebot gesendet' setzen."],
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
      operationalVerdict: {
        status: "action_required",
        headline: "Kunden-E-Mail ist ungültig",
        cause: "Die Empfängeradresse praxis@kurswechsel ist unvollständig. Deshalb wurde kein Angebot verschickt.",
        causeCode: "customer_email_invalid",
        confidence: "high",
        failedStep: "Offer Send",
        executionId: "2770420",
        executionUrl: null,
        technicalDetail: "Empfänger: praxis@kurswechsel",
        retryLabel: null,
        nextActionKey: "correct_customer_email",
        nextActionLabel: "Kunden-E-Mail korrigieren",
        customerContactAllowed: false,
      },
      identifiers: [{ type: "trello_card_id", label: "Trello-ID", value: "BiP93WuG", confidence: "high", href: null }],
      answer: {
        verdict: "found",
        confidence: "medium",
        headline: "Automation-Fehler erkannt.",
        bullets: ["Empfänger war unvollständig.", "Retry nur nach Korrektur und Duplicate-Check."],
      },
      intelligenceBrief: {
        status: "generated",
        headline: "Lösbar nach Freigabe",
        diagnosis: "Die Automation wurde durch eine unvollständige Kunden-E-Mail gestoppt.",
        why: ["Execution 2770420 belegt den Empfängerfehler.", "Kundenakte und Angebot sind demselben Fall zugeordnet."],
        uncertainties: ["Der erneute Versand braucht weiterhin den serverseitigen Duplicate-Check."],
        evidenceIds: [],
        nextAction: {
          key: "repair_trello_projection",
          label: "Trello-Projektion bereinigen",
          summary: "Stale Trello-Projektion nach Versandbeleg korrigieren.",
          riskLevel: "medium",
          approvalRequired: true,
        },
        customerContactPolicy: "guarded_only",
        model: "smoke-model",
        generatedAt: "2026-07-07T10:30:00.000Z",
        warning: null,
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
      employeeGuidance: {
        playbookKey: "offer_not_sent",
        playbookTitle: "Angebot nicht raus",
        rootCauseCode: "customer_email_invalid",
        resolutionStatus: "self_service",
        resolutionLabel: "Mitarbeiter kann nach Freigabe lösen",
        canEmployeeResolve: true,
        customerContactPolicy: "guarded_only",
        plainLanguageSummary: "Problemtyp: Angebot nicht raus. Ursache: Kunden-E-Mail war unvollständig. Nächster sicherer Schritt: Trello-Projektion bereinigen. Kundenkontakt ist nur über die guarded Aktion erlaubt.",
        evidenceBullets: [
          "Trello-Karte gelesen: FEHLER - LED Flex Grüll.",
          "Automation-Beleg: NEONTRIP Quote Ready SIMPLE v1.1 · Execution 2770420 · Node Offer Send.",
          "Kundenakte: REQ-SMOKE.",
          "Angebot: A/N 14427 · Status SENT.",
        ],
        blockerBullets: [],
        forbiddenActions: [
          "Keine Kundenmail aus Company Brain ohne explizite Freigabe.",
          "Trello nicht als Source of Truth verwenden.",
          "Keinen n8n-Workflow ohne Backup, Diff, Test und Rollback ändern.",
        ],
        nextBestActionKey: "repair_trello_projection",
        nextBestActionLabel: "Trello-Projektion bereinigen",
        steps: [
          { key: "understand_card", label: "1. Fall verstehen", status: "done", summary: "Quote Ready · erwartete Aktion: offer_send.", actionKey: null, actionLabel: null, riskLevel: "none" },
          { key: "prove_cause", label: "2. Ursache belegen", status: "done", summary: "Automation meldete eine unvollständige Kunden-E-Mail.", actionKey: "inspect_n8n_run", actionLabel: "n8n-Run prüfen", riskLevel: "medium" },
          { key: "fix_data", label: "3. Daten/Projektion reparieren", status: "ready", summary: "Stale Trello-Projektion bereinigen.", actionKey: "repair_trello_projection", actionLabel: "Trello-Projektion bereinigen", riskLevel: "medium" },
          { key: "clear_send", label: "4. Versand klären", status: "ready", summary: "Guarded Retry nach Duplicate-Check.", actionKey: "guarded_offer_resend", actionLabel: "Angebot erneut senden", riskLevel: "high" },
        ],
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
      }, {
        id: "fix-smoke",
        workflowName: "company_brain_fix_center",
        action: "prepare_email_correction",
        status: "prepared",
        error: null,
        createdAt: "2026-07-07T10:45:00.000Z",
        requestId: "REQ-SMOKE",
        executionId: null,
        correlationId: null,
        sourceEventId: "task-smoke",
        targetRecordId: "task-smoke",
        failedNode: null,
        idempotencyKey: "company-brain:prepare_email_correction:REQ-SMOKE:offer_not_sent:v1",
        retrySafety: "safe_after_review",
        summary: "E-Mail-Korrektur wurde intern vorbereitet. Kein Kundenkontakt.",
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
  await page.route("**/api/ops/company-brain/actions**", async (route) => {
    const body = route.request().postDataJSON();
    const actionKey = body?.actionKey;
    const responseBody = actionKey === "repair_trello_projection"
      ? {
          ok: true,
          actionKey,
          customerCommunicationSent: false,
          trelloProjectionRepair: {
            renamed: true,
            addedOfferSentLabel: true,
            trelloComment: { id: "comment-smoke" },
          },
        }
      : { ok: true, sent: true, duplicate: false };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseBody),
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
    body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const missing = snippets.filter((snippet) => !body.includes(snippet));
    if (!missing.length) return;
    await page.waitForTimeout(250);
  }
  const missing = snippets.filter((snippet) => !body.includes(snippet));
  throw new Error(`${label}: missing ${missing.join(", ")}. Body: ${body.slice(0, 1400)}`);
}

async function waitForEnabled(locator, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if ((await locator.count()) > 0 && !(await locator.first().isDisabled())) return locator.first();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label}: button not enabled`);
}

async function runViewport(browser, target, viewport, label) {
  const page = await browser.newPage({ viewport });
  await setupRoutes(page);
  await page.goto(`${target}/ops/company-brain`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  const queryInput = page.getByLabel(/Fall, E-Mail, Angebotsnummer, Trello-ID/);
  await queryInput.click();
  await queryInput.fill("https://trello.com/c/BiP93WuG/smoke");
  await (await waitForEnabled(page.getByRole("button", { name: "Suchen" }), `${label}: search`)).click();
  await waitForBodyText(page, `${label}: compact summary`, [
    "ERGEBNIS",
    "Ursache und nächster Schritt",
    "URSACHE",
    "Systembeleg",
    "Kunden-E-Mail ist ungültig",
    "NÄCHSTER SCHRITT",
    "JETZT TUN",
    "Kunden-E-Mail korrigieren",
    "Diagnoseweg, Belege und Quellen anzeigen",
    "FIX CENTER",
  ]);
  await page.locator("summary").filter({ hasText: "Diagnoseweg, Belege und Quellen anzeigen" }).first().click({ force: true });
  await waitForBodyText(page, `${label}: expanded diagnosis`, [
    "SOFORTBILD",
    "ENTSCHEIDUNG",
    "Kann nach Freigabe gelöst werden",
    "Guarded Fix",
    "FALL-ROUTE",
    "Vom Kartenfehler zur sicheren Aktion",
    "Trello-Karte gelesen",
    "Kunden-E-Mail korrigieren",
    "Trello-Projektion bereinigen",
    "Projektion freigeben",
    "Guarded Retry möglich",
    "Schon erledigt",
    "E-Mail-Korrektur vorbereitet",
    "n8n Execution 2770420",
    "Empfänger und Angebot im Fix Center prüfen",
    "System-Blocker",
    "Live Outlook / Graph",
    "BENÖTIGTE RUNTIME-VARIABLEN",
    "MICROSOFT_GRAPH_TENANT_ID",
    "OUTLOOK_SHARED_MAILBOX",
    "Setup-Paket kopieren",
    "FEHLERKARTE-CHECK",
    "Kann Company Brain diesen Trello-Fehler erklären und lösen?",
    "KARTE VERSTEHEN",
    "URSACHE FINDEN",
    "FEHLER BEHEBEN",
    "VERSAND KLÄREN",
    "MITARBEITERFÜHRUNG",
    "Mitarbeiter kann nach Freigabe lösen",
    "Root Cause: customer_email_invalid",
    "Nächster Klick: Trello-Projektion bereinigen",
    "BELEGE, DIE ZÄHLEN",
    "NICHT TUN",
  ]);
  await page.locator("summary").filter({ hasText: "Diagnoseweg, Belege und Quellen anzeigen" }).first().click({ force: true });
  await waitForBodyText(page, `${label}: action groups`, ["Intern sichern", "Daten korrigieren", "Kundenkontakt"]);
  const fixCenter = page.locator("#company-brain-fix-center");
  await (await waitForEnabled(fixCenter.getByRole("button", { name: "Projektion freigeben" }), `${label}: projection repair`)).click();
  await waitForBodyText(page, `${label}: projection confirmation panel`, ["Freigabe prüfen", "Diese Aktion bleibt intern"]);
  await fixCenter.locator('input[placeholder="Freigabe"]:visible').first().fill("Freigabe");
  await (await waitForEnabled(fixCenter.getByRole("button", { name: "Jetzt ausführen" }), `${label}: projection execute`)).click();
  await waitForBodyText(page, `${label}: projection repair reload`, ["Ausgeführt: Trello-Projektion bereinigt, Trello-Kommentar geschrieben. Fall neu geladen."]);
  await (await waitForEnabled(fixCenter.getByRole("button", { name: "Versand freigeben" }), `${label}: guarded resend`)).click();
  await waitForBodyText(page, `${label}: confirmation panel`, ["Freigabe prüfen", "Diese Aktion kann Kundenkontakt auslösen"]);
  await fixCenter.locator('input[placeholder="Freigabe"]:visible').first().fill("Freigabe");
  await (await waitForEnabled(fixCenter.getByRole("button", { name: "Jetzt ausführen" }), `${label}: guarded resend execute`)).click();
  await waitForBodyText(page, `${label}: action reload`, ["Ausgeführt: Angebot erneut gesendet. Fall neu geladen."]);

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
