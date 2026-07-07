import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyBrainAnswer,
  buildCompanyBrainCrossChecks,
  buildCompanyBrainRetryAssessment,
  buildTrelloAutomationRuns,
  buildTrelloFailureDiagnosis,
  extractCompanyBrainIdentifiers,
  extractCompanyBrainSignals,
  normalizeCompanyBrainQuery,
  resolveCoolifyApiConfig,
  resolveN8nApiConfig,
  type CompanyBrainAutomationRun,
  type CompanyBrainEvidence,
  type CompanyBrainFinding,
  type CompanyBrainOfferSummary,
  type CompanyBrainRecordSummary,
  type CompanyBrainTrelloFailureDiagnosis,
} from "@/lib/ops/company-brain";
import { classifyAutomationIssueText } from "@/lib/ops/automation-issues";
import type { TrelloFailureContext } from "@/lib/quotes/trello";

function retryDiagnosis(): CompanyBrainTrelloFailureDiagnosis {
  return {
    requested: true,
    status: "loaded",
    severity: "critical",
    expectedAction: "offer_send",
    card: null,
    triggerMove: null,
    rootCauseKey: "automation_failed",
    rootCause: "Angebot wurde nicht rausgeschickt.",
    recommendedFix: "Retry nur nach Duplicate-Check.",
    evidenceStrength: "strong",
    duplicateRisk: "medium",
    safeFixes: [],
    blockedFixes: [],
    timeline: [],
    diagnostics: [],
  };
}

test("company brain extracts operational identifiers from a mixed support question", () => {
  const identifiers = extractCompanyBrainIdentifiers("Kunde max@example.com fragt zu AN-4798 und Trello 64b7f9e2aabbccddeeff0011");

  assert.deepEqual(
    identifiers.map((entry) => [entry.type, entry.value]),
    [
      ["email", "max@example.com"],
      ["offer_number", "AN-4798"],
      ["trello_card_id", "64b7f9e2aabbccddeeff0011"],
    ],
  );
});

test("company brain extracts exact Trello lookup hints", () => {
  const identifiers = extractCompanyBrainIdentifiers("Bitte Trello 64b7f9e2aabbccddeeff0011 prüfen");
  assert.equal(identifiers[0]?.type, "trello_card_id");
  assert.equal(identifiers[0]?.value, "64b7f9e2aabbccddeeff0011");
});

test("company brain keeps long pasted requests bounded", () => {
  const normalized = normalizeCompanyBrainQuery(`  ${"x".repeat(500)}  `);
  assert.equal(normalized.length, 240);
});

test("company brain extracts color, 3d and design count signals from support questions", () => {
  const signals = extractCompanyBrainSignals("Kunde sagt blau, es sollte ein 3D-Schild mit zwei Designs sein. Ist die Mail raus?");

  assert.deepEqual(signals.colors, ["blau"]);
  assert.equal(signals.designCount, 2);
  assert.equal(signals.mentions3d, true);
  assert.equal(signals.asksOfferSent, true);
});

test("company brain classifies invalid automation recipient email", () => {
  const hint = classifyAutomationIssueText("Offer send failed: invalid customer_email praxis@kurswechsel");

  assert.equal(hint.key, "customer_email_invalid");
  assert.match(hint.rootCause, /praxis@kurswechsel/);
  assert.match(hint.recommendedFix, /Kunden-E-Mail/);
  assert.match(hint.retrySafety, /Kein Retry/);
});

test("company brain classifies unavailable send guards as blocked automation issue", () => {
  const hint = classifyAutomationIssueText("send_guard_unavailable: invalid_guard_response");

  assert.equal(hint.key, "send_guard_unavailable");
  assert.match(hint.rootCause, /Versand-Guard/);
  assert.match(hint.recommendedFix, /Keinen Angebotsversand/);
  assert.match(hint.retrySafety, /Retry blockiert/);
});

test("company brain normalizes Coolify API config", () => {
  const config = resolveCoolifyApiConfig({
    COOLIFY_URL: "https://coolify.example.com/",
    COOLIFY_API_TOKEN: "secret-token",
    COOLIFY_APPLICATION_UUID: "app-123",
  });

  assert.deepEqual(config, {
    apiBaseUrl: "https://coolify.example.com/api/v1",
    apiToken: "secret-token",
    applicationUuid: "app-123",
  });
});

test("company brain accepts a Coolify API base URL that already includes api v1", () => {
  const config = resolveCoolifyApiConfig({
    COOLIFY_API_URL: "https://coolify.example.com/api/v1",
    COOLIFY_API_TOKEN: "secret-token",
  });

  assert.equal(config?.apiBaseUrl, "https://coolify.example.com/api/v1");
  assert.equal(config?.applicationUuid, null);
});

test("company brain normalizes n8n base URL to the public API root", () => {
  const config = resolveN8nApiConfig({
    N8N_BASE_URL: "https://n8n.example.com/",
    N8N_API_KEY: "secret-key",
  });

  assert.deepEqual(config, {
    apiBaseUrl: "https://n8n.example.com/api/v1",
    apiKey: "secret-key",
  });
});

test("company brain accepts an n8n API URL that already includes api v1", () => {
  const config = resolveN8nApiConfig({
    N8N_API_URL: "https://n8n.example.com/api/v1",
    N8N_API_KEY: "secret-key",
  });

  assert.deepEqual(config, {
    apiBaseUrl: "https://n8n.example.com/api/v1",
    apiKey: "secret-key",
  });
});

test("company brain cross checks flag offer color and design mismatches", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-1",
    displayName: "Max Muster",
    company: null,
    email: "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: ["blau"],
    trelloCardId: null,
    trelloCardUrl: null,
    latestOfferSentAt: null,
    latestOfferViewedAt: null,
    latestOfferSignedAt: null,
    latestOrderNumber: null,
    latestOrderStatus: null,
    latestOutboundAt: null,
    latestInboundAt: null,
    communicationsCount: 0,
    timelineCount: 0,
  }];
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-1",
    offerNumber: "AN-4798",
    documentReference: "AN-4798",
    publicUrl: null,
    status: "draft",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: null,
    updatedAt: "2026-07-02T10:00:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 1,
    selectedItemCount: 1,
    designEvidenceCount: 1,
    productHints: ["Schild"],
    colorHints: ["rot"],
    selectedItems: [],
    imageEvidence: [],
  }];
  const evidence: CompanyBrainEvidence[] = [{
    id: "mail-1",
    source: "customer_email_messages",
    title: "Kunde antwortet",
    detail: "Bitte in blau.",
    occurredAt: "2026-07-02T09:00:00.000Z",
    direction: "inbound",
    href: null,
    confidence: "high",
  }];

  const checks = buildCompanyBrainCrossChecks({
    records,
    offers,
    evidence,
    question: "Ist es blau mit zwei Designs?",
  });

  assert.equal(checks.find((check) => check.key === "color_match")?.status, "fail");
  assert.equal(checks.find((check) => check.key === "design_count")?.status, "fail");
});

test("company brain treats quote email log rows as sent offer proof", () => {
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-1",
    offerNumber: "A/N 14427",
    documentReference: "A/N 14427",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-1",
    updatedAt: "2026-07-07T08:55:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 1,
    selectedItemCount: 1,
    designEvidenceCount: 1,
    productHints: ["Schild"],
    colorHints: ["blau"],
    selectedItems: [],
    imageEvidence: [],
  }];
  const evidence: CompanyBrainEvidence[] = [{
    id: "quote-email-log:1",
    source: "quote_email_log",
    title: "Ihr NEONTRIP Angebot Nr. 14427",
    detail: "Empfänger: max@example.com · Angebot: A/N 14427 · Status: sent",
    occurredAt: "2026-07-07T09:00:00.000Z",
    direction: "outbound",
    href: null,
    confidence: "high",
  }];

  const checks = buildCompanyBrainCrossChecks({ records: [], offers, evidence, question: "Ist das Angebot rausgegangen?" });
  const sent = checks.find((check) => check.key === "offer_sent");

  assert.equal(sent?.status, "pass");
  assert.equal(sent?.actual, "2026-07-07T09:00:00.000Z");
  assert.match(sent?.summary || "", /Versand- oder Ausgangsbeleg/);
});

test("company brain blocks resend when a send proof already exists", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-SENT",
    displayName: "Max Muster",
    company: null,
    email: "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "card-sent",
    trelloCardUrl: null,
    latestOfferSentAt: null,
    latestOfferViewedAt: null,
    latestOfferSignedAt: null,
    latestOrderNumber: null,
    latestOrderStatus: null,
    latestOutboundAt: null,
    latestInboundAt: null,
    communicationsCount: 0,
    timelineCount: 0,
  }];
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-sent",
    offerNumber: "AN-5001",
    documentReference: "AN-5001",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-sent",
    updatedAt: "2026-07-06T08:00:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 1,
    selectedItemCount: 1,
    designEvidenceCount: 1,
    productHints: ["Schild"],
    colorHints: [],
    selectedItems: [],
    imageEvidence: [],
  }];
  const evidence: CompanyBrainEvidence[] = [{
    id: "quote-email-log:sent",
    source: "quote_email_log",
    title: "Ihr NEONTRIP Angebot Nr. 5001",
    detail: "Empfänger: max@example.com · Angebot: AN-5001 · Status: sent",
    occurredAt: "2026-07-06T08:05:00.000Z",
    direction: "outbound",
    href: null,
    confidence: "high",
  }];
  const crossChecks = buildCompanyBrainCrossChecks({
    records,
    offers,
    evidence,
    question: "Warum wurde das Angebot nicht geschickt?",
  });

  const retry = buildCompanyBrainRetryAssessment({
    records,
    offers,
    evidence,
    crossChecks,
    trelloFailureDiagnosis: retryDiagnosis(),
  });

  assert.equal(retry.status, "blocked");
  assert.equal(retry.canSendWithConfirmation, false);
  assert.ok(retry.blockers.some((blocker) => /Versand-\/Ausgangsbeleg/.test(blocker)));
  assert.ok(retry.safeFixes.some((fix) => /keinen Resend/.test(fix)));
});

test("company brain treats Outlook delivery failures as failed offer sends", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-BOUNCE",
    displayName: "Grüll",
    company: null,
    email: "praxis@kurswechsel.de",
    phone: null,
    status: "open",
    title: "Grüll",
    requestedSize: "100 cm",
    requestedColors: ["Wie im Logo"],
    trelloCardId: null,
    trelloCardUrl: null,
    latestOfferSentAt: null,
    latestOfferViewedAt: null,
    latestOfferSignedAt: null,
    latestOrderNumber: null,
    latestOrderStatus: null,
    latestOutboundAt: null,
    latestInboundAt: null,
    communicationsCount: 0,
    timelineCount: 0,
  }];
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-14427",
    offerNumber: "14427",
    documentReference: "A/N 14427",
    publicUrl: null,
    status: "SENT",
    customerName: "Grüll",
    customerEmail: "praxis@kurswechsel.de",
    projectTitle: "Leuchtschild",
    trelloCardId: null,
    updatedAt: "2026-07-06T07:39:11.809Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 33,
    imageCount: 6,
    selectedItemCount: 5,
    designEvidenceCount: 6,
    productHints: ["LED", "Schild"],
    colorHints: ["blau", "kaltweiß"],
    selectedItems: [],
    imageEvidence: [],
  }];
  const evidence: CompanyBrainEvidence[] = [{
    id: "bounce-1",
    source: "customer_email_messages",
    title: "Unzustellbar: Ihr NEONTRIP Angebot Nr. 14427",
    detail: "Ihre Nachricht an praxis@kurswechsel.de konnte nicht zugestellt werden. praxis wurde nicht in kurswechsel.de gefunden.",
    occurredAt: "2026-07-06T08:39:05.000Z",
    direction: "inbound",
    href: null,
    confidence: "high",
  }];

  const checks = buildCompanyBrainCrossChecks({
    records,
    offers,
    evidence,
    question: "Wieso wurde das Angebot nicht rausgeschickt?",
  });

  const offerSent = checks.find((check) => check.key === "offer_sent");
  assert.equal(offerSent?.status, "fail");
  assert.equal(offerSent?.severity, "critical");
  assert.match(offerSent?.summary || "", /Unzustellbarkeit/);
  assert.deepEqual(offerSent?.evidenceIds, ["bounce-1"]);
});

test("company brain answers with Trello-only diagnostics when source records are missing", () => {
  const trelloDiagnosis: CompanyBrainTrelloFailureDiagnosis = {
    requested: true,
    status: "loaded",
    severity: "warning",
    expectedAction: "offer_send",
    card: {
      id: "64b7f9e2aabbccddeeff0011",
      shortLink: "FYXcIQ9K",
      name: "LED Flex Samuele Micacchioni",
      descriptionPreview: "Kunde wartet seit Tagen auf Angebot.",
      url: "https://trello.com/c/FYXcIQ9K",
      currentListName: "Anfrage Management",
      dateLastActivity: "2026-07-03T08:00:00.000Z",
      attachmentsCount: 2,
      customFields: [{ name: "Usage", value: "Shopfront" }],
    },
    triggerMove: {
      id: "move-1",
      occurredAt: "2026-07-03T08:00:00.000Z",
      fromListName: "Neue Anfrage",
      toListName: "Anfrage Management",
    },
    rootCauseKey: "no_source_record",
    rootCause: "Die Trello-Karte ist live lesbar, aber es wurde keine verknüpfte Kundenakte als Source of Truth gefunden.",
    recommendedFix: "Karte mit Request-ID/Kundenakte verknüpfen; keinen Versand-Retry aus Trello allein starten.",
    evidenceStrength: "weak",
    duplicateRisk: "high",
    safeFixes: ["Karte manuell mit Request-ID/Kundenakte verknüpfen."],
    blockedFixes: ["Kein automatischer Angebotsversand ohne Outlook-Duplicate-Check."],
    timeline: [],
    diagnostics: [],
  };
  const gaps: CompanyBrainFinding[] = [
    {
      severity: "warning",
      title: "Keine Kundenakte eindeutig gefunden",
      detail: "Die Suche hat keinen verknüpften Request geliefert.",
      source: "customer_records",
    },
  ];

  const answer = buildCompanyBrainAnswer([], [], [], gaps, [], "Trello-Karte gezogen, aber Angebot nicht raus", trelloDiagnosis);

  assert.equal(answer.verdict, "partial");
  assert.match(answer.headline, /Trello-Karte gelesen/);
  assert.ok(answer.bullets.some((bullet) => bullet.includes("LED Flex Samuele Micacchioni")));
  assert.ok(answer.bullets.some((bullet) => bullet.includes("Keine verknüpfte Kundenakte")));
  assert.ok(answer.bullets.some((bullet) => bullet.includes("Kein Angebotssnapshot")));
});

test("company brain turns Trello execution failures into automation evidence", () => {
  const context: TrelloFailureContext = {
    card: {
      id: "6a4b53ee91f140e2ecd67e2f",
      shortLink: "BiP93WuG",
      name: "FEHLER - LED Flex",
      desc: "Request-ID: b514ed9c-368d-4c37-9b33-f45534a0677e",
      idBoard: null,
      idList: null,
      currentListName: "Quote Ready",
      url: "https://trello.com/c/BiP93WuG",
      shortUrl: "https://trello.com/c/BiP93WuG",
      closed: false,
      dateLastActivity: "2026-07-06T07:41:13.459Z",
      createdAt: null,
      customFields: { "Nerdy-Forms_ID": "b514ed9c-368d-4c37-9b33-f45534a0677e" },
      attachmentsCount: 11,
    },
    actions: [{
      id: "action-1",
      type: "updateCard",
      date: "2026-07-06T07:41:13.408Z",
      text: "FEHLER: KI-Video-Angebot wurde nicht versendet.\\n\\nGrund: Angebot wurde nicht rausgeschickt. Die Offer-Erstellung ist fehlgeschlagen.\\n\\nExecution: 2770420",
      fromListId: null,
      fromListName: "Neue Angebote schicken + KI-Video",
      toListId: null,
      toListName: "Quote Ready",
    }],
  };

  const runs = buildTrelloAutomationRuns(context);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].executionId, "2770420");
  assert.equal(runs[0].requestId, "b514ed9c-368d-4c37-9b33-f45534a0677e");
  assert.match(runs[0].error || "", /Offer-Erstellung ist fehlgeschlagen/);
});

test("company brain prioritizes automation failures over missing customer records", () => {
  const automationRuns: CompanyBrainAutomationRun[] = [{
    id: "run-1",
    workflowName: "Trello Triggerdiagnose",
    action: "offer_send",
    status: "failed",
    error: "Trello-Historie meldet Automation-Fehler: Angebot wurde nicht rausgeschickt.",
    createdAt: "2026-07-06T07:41:13.408Z",
    requestId: "b514ed9c-368d-4c37-9b33-f45534a0677e",
    executionId: "2770420",
    correlationId: "6a4b53ee91f140e2ecd67e2f",
    sourceEventId: "action-1",
    targetRecordId: null,
    failedNode: null,
    idempotencyKey: null,
    retrySafety: "Nur nach Duplicate-Check.",
    summary: "Aus Trello rekonstruiert.",
  }];
  const diagnosis = buildTrelloFailureDiagnosis({
    requested: true,
    context: {
      card: {
        id: "6a4b53ee91f140e2ecd67e2f",
        shortLink: "BiP93WuG",
        name: "FEHLER - LED Flex",
        desc: null,
        idBoard: null,
        idList: null,
        currentListName: "Quote Ready",
        url: "https://trello.com/c/BiP93WuG",
        shortUrl: "https://trello.com/c/BiP93WuG",
        closed: false,
        dateLastActivity: "2026-07-06T07:41:13.459Z",
        createdAt: null,
        customFields: {},
        attachmentsCount: 11,
      },
      actions: [{
        id: "action-1",
        type: "updateCard",
        date: "2026-07-06T07:41:13.408Z",
        text: "FEHLER: KI-Video-Angebot wurde nicht versendet. Execution: 2770420",
        fromListId: null,
        fromListName: "Neue Angebote schicken + KI-Video",
        toListId: null,
        toListName: "Quote Ready",
      }],
    },
    diagnostic: { source: "trello_live", ok: true, label: "Trello Live", detail: null, count: 1 },
    records: [],
    offers: [],
    crossChecks: [],
    automationRuns,
    question: "Wieso wurde das Angebot nicht rausgeschickt?",
    problemType: "offer_not_sent",
  });

  assert.equal(diagnosis.rootCauseKey, "automation_failed");
  assert.equal(diagnosis.severity, "critical");
  assert.match(diagnosis.rootCause, /Angebot wurde nicht rausgeschickt/);
  assert.match(diagnosis.recommendedFix, /2770420/);
});

test("company brain explains automation failures caused by invalid customer email", () => {
  const automationRuns: CompanyBrainAutomationRun[] = [{
    id: "run-invalid-email",
    workflowName: "Trello Triggerdiagnose",
    action: "offer_send",
    status: "failed",
    error: "Offer send failed: invalid customer_email praxis@kurswechsel",
    createdAt: "2026-07-06T07:41:13.408Z",
    requestId: "REQ-1",
    executionId: "2770420",
    correlationId: "card-1",
    sourceEventId: "action-1",
    targetRecordId: null,
    failedNode: "Offer Send",
    idempotencyKey: null,
    retrySafety: "Nur nach Duplicate-Check.",
    summary: "Aus Trello rekonstruiert.",
  }];
  const diagnosis = buildTrelloFailureDiagnosis({
    requested: true,
    context: {
      card: {
        id: "card-1",
        shortLink: "BiP93WuG",
        name: "FEHLER - LED Flex",
        desc: "Request-ID: REQ-1",
        idBoard: null,
        idList: null,
        currentListName: "Quote Ready",
        url: "https://trello.com/c/BiP93WuG",
        shortUrl: "https://trello.com/c/BiP93WuG",
        closed: false,
        dateLastActivity: "2026-07-06T07:41:13.459Z",
        createdAt: null,
        customFields: {},
        attachmentsCount: 0,
      },
      actions: [{
        id: "action-1",
        type: "updateCard",
        date: "2026-07-06T07:41:13.408Z",
        text: "FEHLER: Angebot nicht verschickt. Grund: invalid customer_email praxis@kurswechsel. Execution: 2770420",
        fromListId: null,
        fromListName: "Neue Angebote schicken + KI-Video",
        toListId: null,
        toListName: "Quote Ready",
      }],
    },
    diagnostic: { source: "trello_live", ok: true, label: "Trello Live", detail: null, count: 1 },
    records: [],
    offers: [],
    crossChecks: [],
    automationRuns,
    question: "Warum wurde das Angebot nicht geschickt?",
    problemType: "offer_not_sent",
  });

  assert.equal(diagnosis.rootCauseKey, "automation_failed");
  assert.match(diagnosis.rootCause, /praxis@kurswechsel/);
  assert.match(diagnosis.recommendedFix, /Korrekte Kunden-E-Mail/);
  assert.ok(diagnosis.safeFixes.some((fix) => /Ungültige Kunden-E-Mail/.test(fix)));
  assert.ok(diagnosis.blockedFixes.some((fix) => /Kein Retry an die alte Adresse/.test(fix)));
});

test("company brain treats later send proof as resolved automation failure", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-RESOLVED",
    displayName: "Max Muster",
    company: null,
    email: "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "card-resolved",
    trelloCardUrl: null,
    latestOfferSentAt: null,
    latestOfferViewedAt: null,
    latestOfferSignedAt: null,
    latestOrderNumber: null,
    latestOrderStatus: null,
    latestOutboundAt: null,
    latestInboundAt: null,
    communicationsCount: 0,
    timelineCount: 0,
  }];
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-resolved",
    offerNumber: "AN-5002",
    documentReference: "AN-5002",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-resolved",
    updatedAt: "2026-07-06T08:00:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 1,
    selectedItemCount: 1,
    designEvidenceCount: 1,
    productHints: ["Schild"],
    colorHints: [],
    selectedItems: [],
    imageEvidence: [],
  }];
  const evidence: CompanyBrainEvidence[] = [{
    id: "quote-email-log:resolved",
    source: "quote_email_log",
    title: "Ihr NEONTRIP Angebot Nr. 5002",
    detail: "Empfänger: max@example.com · Angebot: AN-5002 · Status: sent",
    occurredAt: "2026-07-06T08:05:00.000Z",
    direction: "outbound",
    href: null,
    confidence: "high",
  }];
  const automationRuns: CompanyBrainAutomationRun[] = [{
    id: "run-resolved",
    workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "failed",
    error: "Offer send failed: invalid customer_email max@example",
    createdAt: "2026-07-06T08:00:00.000Z",
    requestId: "REQ-RESOLVED",
    executionId: "2770420",
    correlationId: "card-resolved",
    sourceEventId: "action-1",
    targetRecordId: null,
    failedNode: "Offer Send",
    idempotencyKey: "offer-send:offer-resolved",
    retrySafety: "Kein Retry ohne Duplicate-Check.",
    summary: "Alter Fehler, später manuell versendet.",
  }];
  const crossChecks = buildCompanyBrainCrossChecks({
    records,
    offers,
    evidence,
    question: "Warum wurde das Angebot nicht geschickt?",
  });

  const diagnosis = buildTrelloFailureDiagnosis({
    requested: true,
    context: {
      card: {
        id: "card-resolved",
        shortLink: "resolved",
        name: "FEHLER - LED Flex",
        desc: "Request-ID: REQ-RESOLVED",
        idBoard: null,
        idList: null,
        currentListName: "Quote Ready",
        url: "https://trello.com/c/resolved",
        shortUrl: "https://trello.com/c/resolved",
        closed: false,
        dateLastActivity: "2026-07-06T08:00:00.000Z",
        createdAt: null,
        customFields: {},
        attachmentsCount: 0,
      },
      actions: [{
        id: "action-1",
        type: "updateCard",
        date: "2026-07-06T08:00:00.000Z",
        text: "FEHLER: Angebot nicht verschickt. Execution: 2770420",
        fromListId: null,
        fromListName: "Neue Angebote schicken + KI-Video",
        toListId: null,
        toListName: "Quote Ready",
      }],
    },
    diagnostic: { source: "trello_live", ok: true, label: "Trello Live", detail: null, count: 1 },
    records,
    offers,
    crossChecks,
    automationRuns,
    question: "Warum wurde das Angebot nicht geschickt?",
    problemType: "offer_not_sent",
  });

  assert.equal(diagnosis.rootCauseKey, "sent");
  assert.equal(diagnosis.severity, "info");
  assert.equal(diagnosis.duplicateRisk, "low");
  assert.match(diagnosis.rootCause, /späterer Versand-\/Ausgangsbeleg/);
  assert.match(diagnosis.recommendedFix, /Kein erneuter Versand/);
  assert.ok(diagnosis.safeFixes.some((fix) => /keinen erneuten Versand/.test(fix)));
});

test("company brain retry assessment blocks resend after current recipient bounce", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-BOUNCE",
    displayName: "Grüll",
    company: null,
    email: "praxis@kurswechsel.de",
    phone: null,
    status: "open",
    title: "Grüll",
    requestedSize: "100 cm",
    requestedColors: ["Wie im Logo"],
    trelloCardId: "6a4b53ee91f140e2ecd67e2f",
    trelloCardUrl: "https://trello.com/c/BiP93WuG",
    latestOfferSentAt: null,
    latestOfferViewedAt: null,
    latestOfferSignedAt: null,
    latestOrderNumber: null,
    latestOrderStatus: null,
    latestOutboundAt: null,
    latestInboundAt: null,
    communicationsCount: 0,
    timelineCount: 0,
  }];
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-14427",
    offerNumber: "14427",
    documentReference: "A/N 14427",
    publicUrl: null,
    status: "SENT",
    customerName: "Grüll",
    customerEmail: "praxis@kurswechsel.de",
    projectTitle: "Leuchtschild",
    trelloCardId: "6a4b53ee91f140e2ecd67e2f",
    updatedAt: "2026-07-06T07:39:11.809Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 33,
    imageCount: 6,
    selectedItemCount: 5,
    designEvidenceCount: 6,
    productHints: ["LED", "Schild"],
    colorHints: ["blau", "kaltweiß"],
    selectedItems: [],
    imageEvidence: [],
  }];
  const evidence: CompanyBrainEvidence[] = [{
    id: "bounce-1",
    source: "customer_email_messages",
    title: "Unzustellbar: Ihr NEONTRIP Angebot Nr. 14427",
    detail: "Ihre Nachricht an praxis@kurswechsel.de konnte nicht zugestellt werden.",
    occurredAt: "2026-07-06T08:39:05.000Z",
    direction: "inbound",
    href: null,
    confidence: "high",
  }];
  const crossChecks = buildCompanyBrainCrossChecks({
    records,
    offers,
    evidence,
    question: "Wieso wurde das Angebot nicht rausgeschickt?",
  });

  const retry = buildCompanyBrainRetryAssessment({
    records,
    offers,
    evidence,
    crossChecks,
    trelloFailureDiagnosis: retryDiagnosis(),
  });

  assert.equal(retry.status, "needs_fix");
  assert.equal(retry.canSendWithConfirmation, false);
  assert.ok(retry.blockers.some((blocker) => blocker.includes("Outlook-Bounce")));
  assert.ok(retry.safeFixes.some((fix) => fix.includes("Kunden-E-Mail")));
});

test("company brain retry assessment allows guarded resend when no hard blocker exists", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-READY",
    displayName: "Max Muster",
    company: null,
    email: "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "64b7f9e2aabbccddeeff0011",
    trelloCardUrl: null,
    latestOfferSentAt: null,
    latestOfferViewedAt: null,
    latestOfferSignedAt: null,
    latestOrderNumber: null,
    latestOrderStatus: null,
    latestOutboundAt: null,
    latestInboundAt: null,
    communicationsCount: 0,
    timelineCount: 0,
  }];
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-ready",
    offerNumber: "AN-5000",
    documentReference: "AN-5000",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "64b7f9e2aabbccddeeff0011",
    updatedAt: "2026-07-06T08:00:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 1,
    selectedItemCount: 1,
    designEvidenceCount: 1,
    productHints: ["Schild"],
    colorHints: [],
    selectedItems: [],
    imageEvidence: [],
  }];
  const crossChecks = buildCompanyBrainCrossChecks({
    records,
    offers,
    evidence: [],
    question: "Trello-Karte gezogen, Angebot nicht raus: warum?",
  });

  const retry = buildCompanyBrainRetryAssessment({
    records,
    offers,
    evidence: [],
    crossChecks,
    trelloFailureDiagnosis: retryDiagnosis(),
  });

  assert.equal(retry.status, "ready");
  assert.equal(retry.canSendWithConfirmation, true);
  assert.equal(retry.recipientEmail, "max@example.com");
  assert.equal(retry.idempotencyKey, "company-brain-offer-resend:offer-ready:max@example.com");
});
