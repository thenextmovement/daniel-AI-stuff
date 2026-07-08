import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyBrainAnswer,
  buildActionProposals,
  buildCompanyBrainCrossChecks,
  buildIntegrationReadiness,
  buildCompanyBrainRetryAssessment,
  buildOutlookGraphSearchTerms,
  buildTrelloAutomationRuns,
  buildTrelloFailureDiagnosis,
  extractCompanyBrainIdentifiers,
  extractCompanyBrainSignals,
  findMissingOfferRequestIds,
  mapOutlookGraphMessageToEvidence,
  normalizeCompanyBrainQuery,
  resolveCoolifyApiConfig,
  resolveN8nApiConfig,
  resolveOutlookGraphConfig,
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

test("company brain classifies AI customer copy hard blocks", () => {
  const hint = classifyAutomationIssueText("ai_customer_copy_blocked: forbidden words after retry. E-Mail wurde BLOCKIERT.");

  assert.equal(hint.key, "ai_customer_copy_blocked");
  assert.match(hint.rootCause, /Inhaltsprüfung/);
  assert.match(hint.recommendedFix, /Keine Kundenmail automatisch senden/);
  assert.match(hint.retrySafety, /Retry blockiert/);
});

test("company brain classifies Outlook Graph auth failures", () => {
  const hint = classifyAutomationIssueText("Outlook Graph send failed: 403 Authorization_RequestDenied Mail.Send permission missing");

  assert.equal(hint.key, "outlook_auth_failed");
  assert.match(hint.rootCause, /Outlook\/Graph-Zugriff/);
  assert.match(hint.recommendedFix, /Graph App/);
  assert.match(hint.retrySafety, /Retry blockiert/);
});

test("company brain classifies offer API failures before send", () => {
  const hint = classifyAutomationIssueText("Offer API create snapshot failed with 500 validation schema error");

  assert.equal(hint.key, "offer_api_failed");
  assert.match(hint.rootCause, /Angebotsanlage/);
  assert.match(hint.recommendedFix, /Offer-API/);
  assert.match(hint.retrySafety, /Retry blockiert/);
});

test("company brain classifies source mapping conflicts before retry", () => {
  const hint = classifyAutomationIssueText("source_mapping_conflict: offer belongs to another request. request mismatch between offer_id and trello_card_id");

  assert.equal(hint.key, "source_mapping_conflict");
  assert.match(hint.rootCause, /Source-of-Truth/);
  assert.match(hint.recommendedFix, /Offer-Bridge/);
  assert.match(hint.retrySafety, /Retry blockiert/);
});

test("company brain classifies missing asset processing failures", () => {
  const hint = classifyAutomationIssueText("attachment_download_failed: mockup image not found for offer asset");

  assert.equal(hint.key, "asset_processing_failed");
  assert.match(hint.rootCause, /Assets/);
  assert.match(hint.recommendedFix, /Anhänge/);
  assert.match(hint.retrySafety, /Retry blockiert/);
});

test("company brain classifies n8n workflow hard errors", () => {
  const hint = classifyAutomationIssueText("workflow_hard_error: Outlook: E-Mail senden failed in execution 2770420");

  assert.equal(hint.key, "workflow_hard_error");
  assert.match(hint.rootCause, /n8n-Automation/);
  assert.match(hint.recommendedFix, /n8n-Execution/);
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

test("company brain resolves Outlook Graph config without exposing secrets", () => {
  const config = resolveOutlookGraphConfig({
    AZURE_TENANT_ID: "tenant-123",
    MICROSOFT_GRAPH_CLIENT_ID: "client-123",
    MICROSOFT_GRAPH_CLIENT_SECRET: "secret-123",
    OUTLOOK_SHARED_MAILBOX: "support@neontrip.de",
  });

  assert.deepEqual(config, {
    tenantId: "tenant-123",
    clientId: "client-123",
    clientSecret: "secret-123",
    mailbox: "support@neontrip.de",
  });
  assert.equal(resolveOutlookGraphConfig({ AZURE_TENANT_ID: "tenant-123" }), null);
});

test("company brain integration readiness names missing runtime groups without secret values", () => {
  const readiness = buildIntegrationReadiness({
    MICROSOFT_GRAPH_TENANT_ID: "tenant-123",
    N8N_BASE_URL: "https://n8n.example.com",
    COOLIFY_DEPLOY_WEBHOOK: "https://coolify.example.com/webhook/secret",
  });

  const outlook = readiness.find((entry) => entry.key === "live_outlook");
  const n8n = readiness.find((entry) => entry.key === "n8n_live");
  const coolify = readiness.find((entry) => entry.key === "coolify");

  assert.equal(outlook?.status, "partial");
  assert.match(outlook?.detail || "", /MICROSOFT_GRAPH_CLIENT_ID oder AZURE_CLIENT_ID/);
  assert.match(outlook?.detail || "", /MICROSOFT_GRAPH_CLIENT_SECRET oder AZURE_CLIENT_SECRET/);
  assert.doesNotMatch(outlook?.detail || "", /tenant-123/);
  assert.equal(n8n?.status, "partial");
  assert.match(n8n?.detail || "", /N8N_API_KEY/);
  assert.doesNotMatch(n8n?.detail || "", /n8n\.example/);
  assert.equal(coolify?.status, "partial");
  assert.match(coolify?.detail || "", /COOLIFY_API_URL oder COOLIFY_URL/);
  assert.match(coolify?.detail || "", /COOLIFY_API_TOKEN/);
  assert.doesNotMatch(coolify?.detail || "", /webhook\/secret/);
});

test("company brain builds bounded Outlook Graph search terms", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-123",
    displayName: "Max Muster",
    company: null,
    email: "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
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
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: null,
    updatedAt: null,
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 0,
    selectedItemCount: 1,
    designEvidenceCount: 0,
    productHints: [],
    colorHints: [],
    selectedItems: [],
    imageEvidence: [],
  }];

  const terms = buildOutlookGraphSearchTerms({
    query: "Bitte AN-4798 und max@example.com prüfen",
    identifiers: extractCompanyBrainIdentifiers("Bitte AN-4798 und max@example.com prüfen"),
    records,
    offers,
  });

  assert.deepEqual(terms.slice(0, 4), ["max@example.com", "AN-4798", "REQ-123", "Bitte AN-4798 und max@example.com prüfen"]);
  assert.ok(terms.length <= 4);
});

test("company brain maps Outlook Graph messages to read-only evidence", () => {
  const outbound = mapOutlookGraphMessageToEvidence({
    id: "message-1",
    subject: "Ihr Angebot AN-4798",
    bodyPreview: "Hallo Max, hier ist das Angebot.",
    sentDateTime: "2026-07-07T09:00:00.000Z",
    webLink: "https://outlook.office.com/mail/message-1",
    from: { emailAddress: { address: "support@neontrip.de" } },
    toRecipients: [{ emailAddress: { address: "max@example.com" } }],
  }, "AN-4798");
  const inbound = mapOutlookGraphMessageToEvidence({
    id: "message-2",
    subject: "Re: Angebot",
    bodyPreview: "Bitte in blau.",
    receivedDateTime: "2026-07-07T10:00:00.000Z",
    from: { emailAddress: { address: "max@example.com" } },
    toRecipients: [{ emailAddress: { address: "support@neontrip.de" } }],
  }, "max@example.com");

  assert.equal(outbound.source, "outlook_graph_live");
  assert.equal(outbound.direction, "outbound");
  assert.equal(outbound.occurredAt, "2026-07-07T09:00:00.000Z");
  assert.equal(outbound.href, "https://outlook.office.com/mail/message-1");
  assert.equal(inbound.direction, "inbound");
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
  const originalBaseUrl = process.env.N8N_BASE_URL;
  process.env.N8N_BASE_URL = "https://n8n.neontrip.de";
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

  try {
    const runs = buildTrelloAutomationRuns(context);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].executionId, "2770420");
    assert.equal(runs[0].executionUrl, "https://n8n.neontrip.de/execution/2770420");
    assert.equal(runs[0].requestId, "b514ed9c-368d-4c37-9b33-f45534a0677e");
    assert.match(runs[0].error || "", /Offer-Erstellung ist fehlgeschlagen/);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.N8N_BASE_URL;
    else process.env.N8N_BASE_URL = originalBaseUrl;
  }
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
    issueKey: "customer_email_invalid",
    recommendedFix: "Audit-Fix: Kundenadresse in Postgres und Offer-Snapshot synchronisieren.",
    safeFix: "Audit-Safe-Fix: E-Mail belegen und Kundendatensatz korrigieren.",
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
  assert.match(diagnosis.recommendedFix, /Audit-Fix: Kundenadresse/);
  assert.ok(diagnosis.safeFixes.some((fix) => /Audit-Safe-Fix/.test(fix)));
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

test("company brain retry assessment treats n8n invalid customer email as data fix", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-INVALID-EMAIL",
    displayName: "Kurswechsel",
    company: null,
    email: "praxis@kurswechsel.de",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "card-invalid-email",
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
    offerId: "offer-invalid-email",
    offerNumber: "AN-14427",
    documentReference: "AN-14427",
    publicUrl: null,
    status: "SENT",
    customerName: "Kurswechsel",
    customerEmail: "praxis@kurswechsel.de",
    projectTitle: "LED Flex",
    trelloCardId: "card-invalid-email",
    updatedAt: "2026-07-06T07:39:11.809Z",
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
    question: "Wieso wurde das Angebot nicht rausgeschickt?",
  });
  const trelloFailureDiagnosis = retryDiagnosis();
  trelloFailureDiagnosis.rootCause = "n8n-Execution fehlgeschlagen: invalid customer_email praxis@kurswechsel";
  trelloFailureDiagnosis.recommendedFix = "Korrekte Kunden-E-Mail belegen und Fall neu laden.";

  const retry = buildCompanyBrainRetryAssessment({
    records,
    offers,
    evidence: [],
    crossChecks,
    trelloFailureDiagnosis,
  });
  const actions = actionProposalFixture({ retry });
  const correctEmail = actions.find((action) => action.key === "correct_customer_email");
  const guardedResend = actions.find((action) => action.key === "guarded_offer_resend");

  assert.equal(retry.status, "needs_fix");
  assert.equal(retry.canSendWithConfirmation, false);
  assert.ok(retry.blockers.some((blocker) => /ungültige oder unvollständige Kunden-E-Mail/.test(blocker)));
  assert.ok(retry.safeFixes.some((fix) => /kein Retry an die alte Adresse/i.test(fix)));
  assert.equal(correctEmail?.enabled, true);
  assert.equal(guardedResend?.enabled, false);
});

test("company brain retry assessment blocks offer request mismatches before any email fix", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-CORRECT-CASE",
    displayName: "Max Muster",
    company: null,
    email: "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "card-correct-case",
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
    offerId: "offer-wrong-case",
    requestId: "REQ-WRONG-CASE",
    offerNumber: "AN-5001",
    documentReference: "AN-5001",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-correct-case",
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
  const actions = actionProposalFixture({ retry });
  const emailCorrection = actions.find((action) => action.key === "correct_customer_email");
  const prepareEmailCorrection = actions.find((action) => action.key === "prepare_email_correction");
  const guardedResend = actions.find((action) => action.key === "guarded_offer_resend");

  assert.equal(retry.status, "blocked");
  assert.equal(retry.canSendWithConfirmation, false);
  assert.ok(retry.blockers.some((blocker) => /REQ-WRONG-CASE/.test(blocker)));
  assert.ok(retry.safeFixes.some((fix) => /Offer-Bridge\/Request-Verknüpfung/.test(fix)));
  assert.equal(emailCorrection?.enabled, false);
  assert.equal(prepareEmailCorrection?.enabled, false);
  assert.equal(guardedResend?.enabled, false);
});

test("company brain retry assessment blocks n8n source mapping conflicts", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-MAPPING",
    displayName: "Max Muster",
    company: null,
    email: "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "card-mapping",
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
    offerId: "offer-mapping",
    requestId: "REQ-MAPPING",
    offerNumber: "AN-5003",
    documentReference: "AN-5003",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-mapping",
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
    question: "Wieso wurde das Angebot nicht rausgeschickt?",
  });
  const trelloFailureDiagnosis = retryDiagnosis();
  trelloFailureDiagnosis.rootCause = "source_mapping_conflict: offer belongs to another request";
  trelloFailureDiagnosis.recommendedFix = "Offer-Bridge und Request-ID prüfen.";

  const retry = buildCompanyBrainRetryAssessment({
    records,
    offers,
    evidence: [],
    crossChecks,
    trelloFailureDiagnosis,
  });
  const actions = actionProposalFixture({ retry });
  const emailCorrection = actions.find((action) => action.key === "correct_customer_email");
  const guardedResend = actions.find((action) => action.key === "guarded_offer_resend");

  assert.equal(retry.status, "blocked");
  assert.equal(retry.canSendWithConfirmation, false);
  assert.ok(retry.blockers.some((blocker) => /Source-of-Truth/.test(blocker)));
  assert.ok(retry.safeFixes.some((fix) => /Postgres/.test(fix)));
  assert.equal(emailCorrection?.enabled, false);
  assert.equal(guardedResend?.enabled, false);
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

function actionProposalFixture(options: {
  retry: ReturnType<typeof buildCompanyBrainRetryAssessment>;
  automationRuns?: CompanyBrainAutomationRun[];
  withoutRecord?: boolean;
}) {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-ACTIONS",
    displayName: "Max Muster",
    company: null,
    email: options.retry.recipientEmail || "max@example.com",
    phone: null,
    status: "open",
    title: "Schild",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "card-actions",
    trelloCardUrl: "https://trello.com/c/actions",
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
    offerId: options.retry.offerId || "offer-actions",
    offerNumber: options.retry.offerNumber || "AN-5010",
    documentReference: options.retry.offerNumber || "AN-5010",
    publicUrl: "https://angebote.example/AN-5010",
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: options.retry.recipientEmail || "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-actions",
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

  return buildActionProposals({
    records: options.withoutRecord ? [] : records,
    offers,
    evidenceScore: { status: "medium", score: 70, summary: "teilweise belegt", safeToAnswerCustomer: false, reasons: [] },
    problemResolution: {
      problemType: "offer_not_sent",
      label: "Angebot nicht raus",
      severity: "warning",
      confidence: "medium",
      specialCaseKind: "open_question",
      rootCause: "Versand unklar.",
      recommendedResolution: "Korrektur prüfen.",
      internalTaskTitle: "Angebot prüfen",
      internalTaskDescription: "Interne Prüfung.",
      customerReplyPolicy: [],
      escalationPath: [],
      requiredEvidence: [],
      missingEvidence: [],
    },
    replyDraft: {
      title: "Antwort",
      riskLevel: "medium",
      approvalRequired: true,
      canSendAutomatically: false,
      subject: "Prüfung",
      body: "Interner Entwurf",
      blockers: [],
      sourceEvidenceIds: [],
    },
    watchers: [],
    automationRuns: options.automationRuns || [],
    integrationReadiness: [
      { key: "live_outlook", label: "Live Outlook", status: "missing", summary: "fehlt", detail: null },
      { key: "n8n_live", label: "Live n8n", status: "configured", summary: "bereit", detail: null },
      { key: "coolify", label: "Coolify", status: "configured", summary: "bereit", detail: null },
    ],
    assets: [],
    retryAssessment: options.retry,
    trelloFailureDiagnosis: retryDiagnosis(),
  });
}

test("company brain action proposals do not duplicate prepared email correction tasks", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "needs_fix",
    label: "Fix vor Retry nötig",
    summary: "Empfängeradresse ist syntaktisch ungültig.",
    recipientEmail: "praxis@kurswechsel",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: null,
    canSendWithConfirmation: false,
    blockers: ["Empfängeradresse ist syntaktisch ungültig."],
    safeFixes: ["Korrekte Kunden-E-Mail in der Kundenakte hinterlegen."],
  };
  const actions = actionProposalFixture({
    retry,
    automationRuns: [{
      id: "fix-prepared",
      workflowName: "company_brain_fix_center",
      action: "prepare_email_correction",
      status: "prepared",
      error: null,
      createdAt: "2026-07-07T10:45:00.000Z",
      requestId: "REQ-ACTIONS",
      executionId: null,
      correlationId: null,
      sourceEventId: "task-1",
      targetRecordId: "task-1",
      failedNode: null,
      idempotencyKey: "company-brain:prepare_email_correction:REQ-ACTIONS:offer_not_sent:v1",
      retrySafety: "safe_after_review",
      summary: "E-Mail-Korrektur vorbereitet.",
    }],
  });

  const prepareEmail = actions.find((action) => action.key === "prepare_email_correction");
  const correctEmail = actions.find((action) => action.key === "correct_customer_email");
  const inspectN8n = actions.find((action) => action.key === "inspect_n8n_run");

  assert.equal(prepareEmail?.enabled, false);
  assert.match(prepareEmail?.summary || "", /bereits vorbereitet/);
  assert.equal(correctEmail?.enabled, true);
  assert.equal(inspectN8n?.enabled, false);
});

test("company brain action proposals enable internal tasks once per case", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "blocked",
    label: "Retry blockiert",
    summary: "Erst Belege prüfen.",
    recipientEmail: "max@example.com",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: null,
    canSendWithConfirmation: false,
    blockers: ["Kein eindeutiger Versandbeleg."],
    safeFixes: ["Interne Aufgabe mit Belegen anlegen."],
  };
  const actions = actionProposalFixture({ retry });
  const task = actions.find((action) => action.key === "create_internal_task");

  assert.equal(task?.enabled, true);
  assert.match(task?.summary || "", /interne Aufgabe/i);
  assert.match(task?.payloadPreview.join("\n") || "", /Blocker: Kein eindeutiger Versandbeleg/);
  assert.match(task?.payloadPreview.join("\n") || "", /Sicherer Fix: Interne Aufgabe mit Belegen/);

  const duplicateActions = actionProposalFixture({
    retry,
    automationRuns: [{
      id: "task-created",
      workflowName: "company_brain_fix_center",
      action: "create_internal_task",
      status: "prepared",
      error: null,
      createdAt: "2026-07-07T11:15:00.000Z",
      requestId: "REQ-ACTIONS",
      executionId: null,
      correlationId: null,
      sourceEventId: "task-2",
      targetRecordId: "task-2",
      failedNode: null,
      idempotencyKey: "company-brain:create_internal_task:REQ-ACTIONS:offer_not_sent:v1",
      retrySafety: "safe_after_review",
      summary: "Interne Aufgabe vorbereitet.",
    }],
  });
  const duplicateTask = duplicateActions.find((action) => action.key === "create_internal_task");

  assert.equal(duplicateTask?.enabled, false);
  assert.match(duplicateTask?.summary || "", /bereits vorbereitet/);
});

test("company brain action proposals block retry preparation for hard blockers", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "blocked",
    label: "Retry blockiert",
    summary: "Ein Versandbeleg oder harter Automationsblocker verhindert den Retry.",
    recipientEmail: "max@example.com",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: null,
    canSendWithConfirmation: false,
    blockers: ["Versand-/Ausgangsbeleg gefunden; keinen Resend auslösen."],
    safeFixes: ["Interne Aufgabe/Fallnotiz mit Belegen anlegen."],
  };
  const actions = actionProposalFixture({ retry });
  const prepareRetry = actions.find((action) => action.key === "prepare_offer_retry");
  const internalTask = actions.find((action) => action.key === "create_internal_task");

  assert.equal(prepareRetry?.enabled, false);
  assert.match(prepareRetry?.summary || "", /Retry bleibt blockiert/);
  assert.equal(internalTask?.enabled, true);
});

test("company brain action proposals allow internal handling for trello-only cases", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "blocked",
    label: "Source of Truth fehlt",
    summary: "Trello allein reicht nicht.",
    recipientEmail: "max@example.com",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: null,
    canSendWithConfirmation: false,
    blockers: ["Keine Kundenakte als Source of Truth."],
    safeFixes: ["Request/Kundenakte verknüpfen."],
  };
  const actions = actionProposalFixture({ retry, withoutRecord: true });
  const trelloComment = actions.find((action) => action.key === "post_trello_status_comment");
  const internalTask = actions.find((action) => action.key === "create_internal_task");

  assert.equal(internalTask?.enabled, true);
  assert.match(internalTask?.summary || "", /Automation-Fix-Aufgabe/);
  assert.match(internalTask?.summary || "", /Keine Kundenakte/);
  assert.equal(internalTask?.payloadPreview.includes("Request: nicht verknüpft"), true);
  assert.equal(internalTask?.payloadPreview.includes("Trello: card-actions"), true);
  assert.equal(trelloComment?.enabled, true);
  assert.match(trelloComment?.summary || "", /Trello bleibt Projektion/);
  assert.match(trelloComment?.summary || "", /Keine Kundenakte/);
});

test("company brain action proposals link failed n8n executions read-only", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "blocked",
    label: "Automation fehlgeschlagen",
    summary: "Execution prüfen.",
    recipientEmail: "max@example.com",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: null,
    canSendWithConfirmation: false,
    blockers: ["n8n-Fehlerlauf vorhanden."],
    safeFixes: ["n8n-Execution read-only prüfen."],
  };
  const actions = actionProposalFixture({
    retry,
    automationRuns: [{
      id: "n8n-run",
      workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
      action: "offer_send",
      status: "failed",
      error: "Outlook Graph send failed.",
      createdAt: "2026-07-07T11:20:00.000Z",
      requestId: "REQ-ACTIONS",
      executionId: "2770420",
      executionUrl: "https://n8n.neontrip.de/execution/2770420",
      correlationId: null,
      sourceEventId: "trello-action",
      targetRecordId: null,
      failedNode: "Outlook: E-Mail senden",
      idempotencyKey: "quote-ready-send:REQ-ACTIONS:offer-actions",
      retrySafety: "blocked",
      summary: "Outlook-Berechtigung fehlt.",
      issueKey: "outlook_auth_failed",
      recommendedFix: "Graph App und Mail.Send-Berechtigung prüfen.",
      safeFix: "Outlook-/Graph-Konfiguration intern prüfen.",
    }],
  });
  const inspect = actions.find((action) => action.key === "inspect_n8n_run");

  assert.equal(inspect?.enabled, true);
  assert.equal(inspect?.href, "https://n8n.neontrip.de/execution/2770420");
  assert.ok(inspect?.payloadPreview.some((line) => line.includes("Execution-Link: https://n8n.neontrip.de/execution/2770420")));
  assert.ok(inspect?.payloadPreview.some((line) => line.includes("Issue: outlook_auth_failed")));
  assert.ok(inspect?.payloadPreview.some((line) => line.includes("Empfohlener Fix: Graph App und Mail.Send-Berechtigung prüfen.")));
});

test("company brain action proposals block duplicate retry actions after guarded resend audit", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "ready",
    label: "Retry bereit",
    summary: "Guarded Retry möglich.",
    recipientEmail: "max@example.com",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: "company-brain-offer-resend:offer-actions:max@example.com",
    canSendWithConfirmation: true,
    blockers: [],
    safeFixes: ["Serverseitigen Duplicate-Check ausführen."],
  };
  const actions = actionProposalFixture({
    retry,
    automationRuns: [{
      id: "retry-sent",
      workflowName: "company_brain_fix_center",
      action: "guarded_offer_resend",
      status: "sent",
      error: null,
      createdAt: "2026-07-07T11:00:00.000Z",
      requestId: "REQ-ACTIONS",
      executionId: null,
      correlationId: null,
      sourceEventId: "mail-event-1",
      targetRecordId: null,
      failedNode: null,
      idempotencyKey: "company-brain-offer-resend:offer-actions:max@example.com",
      retrySafety: "safe_after_review",
      summary: "Angebot erneut gesendet.",
    }],
  });

  const prepareRetry = actions.find((action) => action.key === "prepare_offer_retry");
  const guardedResend = actions.find((action) => action.key === "guarded_offer_resend");

  assert.equal(prepareRetry?.enabled, false);
  assert.match(prepareRetry?.summary || "", /bereits protokolliert/);
  assert.equal(guardedResend?.enabled, false);
  assert.match(guardedResend?.summary || "", /Kein erneuter Versand/);
});

test("company brain retry assessment blocks resend when the send guard is unavailable", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-GUARD",
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
    offerId: "offer-guard",
    offerNumber: "AN-5003",
    documentReference: "AN-5003",
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
  const trelloFailureDiagnosis = retryDiagnosis();
  trelloFailureDiagnosis.rootCause = "NEONTRIP Quote Ready SIMPLE v1.1 ist bei Node \"Evaluate Guard\" fehlgeschlagen. send_guard_unavailable: invalid_guard_response";
  trelloFailureDiagnosis.recommendedFix = "Keinen Angebotsversand wiederholen; Guard-/Supabase-Erreichbarkeit und bestehende Versandbelege prüfen.";
  trelloFailureDiagnosis.blockedFixes = ["Retry blockiert, solange der Send-Guard keine eindeutige Freigabe liefert."];

  const retry = buildCompanyBrainRetryAssessment({
    records,
    offers,
    evidence: [],
    crossChecks,
    trelloFailureDiagnosis,
  });

  assert.equal(retry.status, "blocked");
  assert.equal(retry.canSendWithConfirmation, false);
  assert.ok(retry.blockers.some((blocker) => /Versand-Guard/.test(blocker)));
  assert.ok(retry.safeFixes.some((fix) => /Guard-\/Supabase/.test(fix)));
});

test("company brain retry assessment blocks resend after hard n8n workflow errors", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-WORKFLOW-ERROR",
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
    offerId: "offer-workflow-error",
    offerNumber: "AN-5004",
    documentReference: "AN-5004",
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
  const trelloFailureDiagnosis = retryDiagnosis();
  trelloFailureDiagnosis.rootCause = "workflow_hard_error: Outlook: E-Mail senden failed in execution 2770420";
  trelloFailureDiagnosis.recommendedFix = "n8n-Execution und Versandbelege prüfen.";

  const retry = buildCompanyBrainRetryAssessment({
    records,
    offers,
    evidence: [],
    crossChecks,
    trelloFailureDiagnosis,
  });

  assert.equal(retry.status, "blocked");
  assert.equal(retry.canSendWithConfirmation, false);
  assert.ok(retry.blockers.some((blocker) => /n8n-Automation/.test(blocker)));
  assert.ok(retry.safeFixes.some((fix) => /n8n-Execution/.test(fix)));
});

test("company brain answer surfaces request id from offer snapshots", () => {
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-request-anchor",
    requestId: "REQ-OFFER-ANCHOR",
    offerNumber: "AN-6001",
    documentReference: "AN-6001",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-offer-anchor",
    updatedAt: "2026-07-07T09:00:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 0,
    selectedItemCount: 1,
    designEvidenceCount: 0,
    productHints: ["Schild"],
    colorHints: [],
    selectedItems: [],
    imageEvidence: [],
  }];

  const answer = buildCompanyBrainAnswer([], offers, [], [], [], "Was ist mit dem Angebot?");

  assert.equal(answer.verdict, "found");
  assert.match(answer.bullets.join("\n"), /Request-ID laut Angebot: REQ-OFFER-ANCHOR/);
});

test("company brain finds customer records missing from offer request ids", () => {
  const missing = findMissingOfferRequestIds(
    [{ requestId: "REQ-EXISTING" }],
    [
      { requestId: "REQ-EXISTING" },
      { requestId: "REQ-FROM-OFFER" },
      { requestId: "REQ-FROM-OFFER" },
      { requestId: "REQ-SECOND" },
    ],
  );

  assert.deepEqual(missing, ["REQ-FROM-OFFER", "REQ-SECOND"]);
});
