import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyBrainAnswer,
  buildActionProposals,
  applyDeliveryAuditProofToCrossChecks,
  applyCaseVideoQcRetryState,
  applyVideoQcRetryState,
  buildCompanyBrainCrossChecks,
  buildIntegrationReadiness,
  buildCompanyBrainRetryAssessment,
  buildCompanyBrainEmployeeGuidance,
  buildOutlookGraphSearchTerms,
  buildTrelloAutomationRuns,
  buildTrelloFailureDiagnosis,
  dedupeAutomationRuns,
  extractCompanyBrainIdentifiers,
  extractCompanyBrainLooseRequestIds,
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

test("company brain keeps the richer audit fallback for duplicate n8n executions", () => {
  const auditRun: CompanyBrainAutomationRun = {
    id: "audit-3100049",
    workflowName: "KI-Video Generator v1.0",
    action: "offer_send",
    status: "error",
    error: "DESIGN_MORPH",
    createdAt: "2026-07-14T10:43:02.000Z",
    requestId: "REQ-VIDEO-QC",
    executionId: "3100049",
    correlationId: "card-video-qc",
    sourceEventId: null,
    targetRecordId: null,
    failedNode: "Analyze Video Content QC",
    idempotencyKey: "video-qc:card-video-qc",
    retrySafety: "blocked",
    summary: "Video-QC abgelehnt.",
    issueKey: "video_content_qc_failed",
    currentAttempt: 2,
    automaticVideoAttemptLimit: 2,
    retryPlanned: false,
    videoQcConfidence: 0.8,
  };
  const trelloFallback: CompanyBrainAutomationRun = {
    ...auditRun,
    id: "trello-action-3100049",
    currentAttempt: null,
    automaticVideoAttemptLimit: null,
    retryPlanned: null,
    videoQcConfidence: null,
  };

  const deduped = dedupeAutomationRuns([auditRun, trelloFallback]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, "audit-3100049");
  assert.equal(deduped[0]?.currentAttempt, 2);
  assert.equal(deduped[0]?.videoQcConfidence, 0.8);
});

test("company brain removes stale second-retry advice from exhausted video QC runs", () => {
  const run = applyVideoQcRetryState({
    id: "n8n-live-3100049",
    workflowName: "KI-Video Generator v1.0",
    action: "offer_send",
    status: "success",
    error: "DESIGN_MORPH",
    createdAt: "2026-07-14T10:43:02.000Z",
    requestId: "REQ-VIDEO-QC",
    executionId: "3100049",
    correlationId: "card-video-qc",
    sourceEventId: null,
    targetRecordId: null,
    failedNode: "Analyze Video Content QC",
    idempotencyKey: "video-qc:card-video-qc",
    retrySafety: "automatic_retry_once",
    summary: "Video-QC abgelehnt.",
    issueKey: "video_content_qc_failed",
    recommendedFix: "Einen automatischen Zweitversuch zulassen.",
    safeFix: "Automatischen Zweitversuch abwarten.",
    currentAttempt: 2,
    automaticVideoAttemptLimit: 2,
    retryPlanned: false,
    videoQcConfidence: 0.8,
  });

  assert.match(run.recommendedFix || "", /Keinen weiteren Lauf mit unverändertem Mockup/);
  assert.doesNotMatch(run.recommendedFix || "", /Zweitversuch.*zulassen/i);
  assert.match(run.retrySafety || "", /Retry blockiert/);
  assert.match(run.safeFix || "", /unveränderten Input nicht erneut starten/);
});

test("company brain marks earlier video retries as historical after attempt two", () => {
  const baseRun: CompanyBrainAutomationRun = {
    id: "n8n-live-3099960",
    workflowName: "KI-Video Generator v1.0",
    action: "offer_send",
    status: "success",
    error: "DESIGN_MORPH",
    createdAt: "2026-07-14T10:39:00.000Z",
    requestId: "REQ-VIDEO-QC",
    executionId: "3099960",
    correlationId: "card-video-qc",
    sourceEventId: null,
    targetRecordId: null,
    failedNode: "Analyze Video Content QC",
    idempotencyKey: "video-qc:card-video-qc",
    retrySafety: "automatic_retry_once",
    summary: "Video-QC abgelehnt.",
    issueKey: "video_content_qc_failed",
    recommendedFix: "Einen automatischen Zweitversuch zulassen.",
    safeFix: "Automatischen Zweitversuch abwarten.",
    currentAttempt: 1,
    automaticVideoAttemptLimit: 2,
    retryPlanned: true,
    videoQcConfidence: 0.8,
  };
  const finalRun: CompanyBrainAutomationRun = {
    ...baseRun,
    id: "n8n-live-3100049",
    executionId: "3100049",
    createdAt: "2026-07-14T10:43:02.000Z",
    currentAttempt: 2,
    retryPlanned: false,
  };

  const contextualized = applyCaseVideoQcRetryState([finalRun, baseRun]);

  assert.match(contextualized[0]?.recommendedFix || "", /Keinen weiteren Lauf mit unverändertem Mockup/);
  assert.match(contextualized[1]?.recommendedFix || "", /Historischer Video-QC-Versuch/);
  assert.doesNotMatch(contextualized[1]?.recommendedFix || "", /Zweitversuch.*zulassen/i);
  assert.match(contextualized[1]?.retrySafety || "", /keinen Retry aus diesem früheren Lauf/);
});

test("company brain extracts multiple request ids from dirty alias fields", () => {
  assert.deepEqual(
    extractCompanyBrainLooseRequestIds("8d6e931f-92e0-4e1b-ba81-9d60b03ac382; f611a1cd-3bcb-4c58-811a-02bd7549eda4"),
    ["8d6e931f-92e0-4e1b-ba81-9d60b03ac382", "f611a1cd-3bcb-4c58-811a-02bd7549eda4"],
  );
  assert.deepEqual(extractCompanyBrainLooseRequestIds("0441-25439-122457"), ["0441-25439-122457"]);
  assert.deepEqual(extractCompanyBrainLooseRequestIds(""), []);
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

test("company brain classifies rejected video content QC with an actionable bounded retry", () => {
  const hint = classifyAutomationIssueText(
    "KI-Video hat die Inhaltspruefung nicht bestanden (DESIGN_MORPH). Versand wurde gestoppt. failureType=video_content_qc_failed",
  );

  assert.equal(hint.key, "video_content_qc_failed");
  assert.match(hint.rootCause, /DESIGN_MORPH/);
  assert.match(hint.recommendedFix, /Zweitversuch/);
  assert.match(hint.retrySafety, /Genau ein automatischer Video-Neuversuch/);
});

test("company brain classifies unavailable video QC separately from a content rejection", () => {
  const hint = classifyAutomationIssueText(
    "video_content_qc_unavailable: KI-Video konnte nicht sicher geprueft werden. Versand wurde vorsorglich gestoppt.",
  );

  assert.equal(hint.key, "video_content_qc_unavailable");
  assert.match(hint.rootCause, /kein belastbares Ergebnis/);
  assert.match(hint.recommendedFix, /genau einen automatischen Video-QC-Neuversuch/i);
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

test("company brain verifies Trello sent labels against mail evidence", () => {
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-label-ok",
    offerNumber: "A/N 14510",
    documentReference: "A/N 14510",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-label-ok",
    updatedAt: "2026-07-07T08:55:00.000Z",
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
  const evidence: CompanyBrainEvidence[] = [
    {
      id: "trello-live-card-label-ok",
      source: "trello_live",
      title: "Trello-Karte: LED Flex",
      detail: "Aktuelle Liste: Quote Ready · Tags: Angebot gesendet, Video gesendet",
      occurredAt: "2026-07-07T09:01:00.000Z",
      direction: "system",
      href: null,
      confidence: "medium",
    },
    {
      id: "trello-live-label-offer",
      source: "trello_live.labels",
      title: "Trello-Tag: Angebot gesendet",
      detail: "Farbe: green",
      occurredAt: "2026-07-07T09:01:00.000Z",
      direction: "system",
      href: null,
      confidence: "medium",
    },
    {
      id: "trello-live-label-video",
      source: "trello_live.labels",
      title: "Trello-Tag: Video gesendet",
      detail: "Farbe: blue",
      occurredAt: "2026-07-07T09:01:00.000Z",
      direction: "system",
      href: null,
      confidence: "medium",
    },
    {
      id: "quote-email-log:label-ok",
      source: "quote_email_log",
      title: "Ihr NEONTRIP Angebot Nr. 14510",
      detail: "Empfänger: max@example.com · Angebot: A/N 14510 · Status: sent",
      occurredAt: "2026-07-07T09:00:00.000Z",
      direction: "outbound",
      href: null,
      confidence: "high",
    },
  ];

  const checks = buildCompanyBrainCrossChecks({ records: [], offers, evidence, question: "Ist das Angebot rausgegangen?" });
  const projection = checks.find((check) => check.key === "trello_projection");

  assert.equal(projection?.status, "pass");
  assert.match(projection?.summary || "", /passen zusammen/);
});

test("company brain warns when Trello sent label has no mail evidence", () => {
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-label-missing",
    offerNumber: "A/N 14511",
    documentReference: "A/N 14511",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-label-missing",
    updatedAt: "2026-07-07T08:55:00.000Z",
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
    id: "trello-live-label-offer-missing",
    source: "trello_live.labels",
    title: "Trello-Tag: Angebot gesendet",
    detail: "Farbe: green",
    occurredAt: "2026-07-07T09:01:00.000Z",
    direction: "system",
    href: null,
    confidence: "medium",
  }];

  const checks = buildCompanyBrainCrossChecks({ records: [], offers, evidence, question: "Ist das Angebot rausgegangen?" });
  const projection = checks.find((check) => check.key === "trello_projection");

  assert.equal(projection?.status, "review");
  assert.match(projection?.summary || "", /DB\/Mail-Beleg fehlt/);
});

test("company brain warns when Trello failure title is stale after send proof", () => {
  const offers: CompanyBrainOfferSummary[] = [{
    offerId: "offer-stale-failure",
    offerNumber: "A/N 14512",
    documentReference: "A/N 14512",
    publicUrl: null,
    status: "SENT",
    customerName: "Max Muster",
    customerEmail: "max@example.com",
    projectTitle: "Schild",
    trelloCardId: "card-stale-failure",
    updatedAt: "2026-07-07T08:55:00.000Z",
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
  const evidence: CompanyBrainEvidence[] = [
    {
      id: "trello-live-card-stale",
      source: "trello_live",
      title: "Trello-Karte: FEHLER - LED Flex",
      detail: "Aktuelle Liste: Quote Ready",
      occurredAt: "2026-07-07T09:01:00.000Z",
      direction: "system",
      href: null,
      confidence: "medium",
    },
    {
      id: "quote-email-log:stale-failure",
      source: "quote_email_log",
      title: "Ihr NEONTRIP Angebot Nr. 14512",
      detail: "Empfänger: max@example.com · Angebot: A/N 14512 · Status: sent",
      occurredAt: "2026-07-07T09:00:00.000Z",
      direction: "outbound",
      href: null,
      confidence: "high",
    },
  ];

  const checks = buildCompanyBrainCrossChecks({ records: [], offers, evidence, question: "Ist das Angebot rausgegangen?" });
  const projection = checks.find((check) => check.key === "trello_projection");

  assert.equal(projection?.status, "review");
  assert.match(projection?.summary || "", /veraltete Trello-Projektion/);
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
  assert.match(diagnosis.rootCause, /späterer erfolgreicher Zustellungsbeleg/);
  assert.match(diagnosis.recommendedFix, /Kein erneuter Versand/);
  assert.ok(diagnosis.safeFixes.some((fix) => /keinen erneuten Versand/.test(fix)));
});

test("company brain resolves handled video QC failures with a later offer send proof", () => {
  const diagnosis = buildTrelloFailureDiagnosis({
    requested: true,
    context: {
      card: {
        id: "card-video-qc",
        shortLink: "videoqc",
        name: "FEHLER - 3D Backlit",
        desc: "Request-ID: REQ-VIDEO-QC",
        idBoard: null,
        idList: null,
        currentListName: "Quote Ready",
        url: "https://trello.com/c/videoqc",
        shortUrl: "https://trello.com/c/videoqc",
        closed: false,
        dateLastActivity: "2026-07-14T09:40:00.000Z",
        createdAt: null,
        customFields: {},
        attachmentsCount: 2,
      },
      actions: [{
        id: "action-video-qc",
        type: "updateCard",
        date: "2026-07-14T09:40:00.000Z",
        text: "FEHLER: Video-QC DESIGN_MORPH. Execution: 3097709",
        fromListId: null,
        fromListName: "Neue Angebote schicken + KI-Video",
        toListId: null,
        toListName: "Quote Ready",
      }],
    },
    diagnostic: { source: "trello_live", ok: true, label: "Trello Live", detail: null, count: 1 },
    records: [],
    offers: [],
    crossChecks: [{
      key: "offer_sent",
      label: "Angebotsversand",
      status: "pass",
      severity: "info",
      expected: "Versandbeleg",
      actual: "2026-07-14T09:41:00.000Z",
      summary: "Ein späterer Angebotsversand ist belegt.",
      evidenceIds: [],
    }],
    automationRuns: [{
      id: "n8n-live-3097709",
      workflowName: "KI-Video Generator v1.0",
      action: "offer_send",
      status: "success",
      error: "KI-Video hat die Inhaltsprüfung wegen DESIGN_MORPH nicht bestanden.",
      createdAt: "2026-07-14T09:40:00.000Z",
      requestId: "REQ-VIDEO-QC",
      executionId: "3097709",
      correlationId: "card-video-qc",
      sourceEventId: "action-video-qc",
      targetRecordId: null,
      failedNode: "Analyze Video Content QC",
      idempotencyKey: "video-qc:card-video-qc",
      retrySafety: "automatic_retry_once",
      summary: "Das Video wurde wegen DESIGN_MORPH abgelehnt.",
      issueKey: "video_content_qc_failed",
      safeFix: "Mockup prüfen oder ersetzen.",
    }],
    question: "Warum wurden Video und Angebot nicht versendet?",
    problemType: "offer_not_sent",
  });

  assert.equal(diagnosis.rootCauseKey, "sent");
  assert.equal(diagnosis.severity, "info");
  assert.match(diagnosis.rootCause, /späterer erfolgreicher Zustellungsbeleg/i);
  assert.match(diagnosis.recommendedFix, /keine Mockup-Korrektur/i);
  assert.ok(!diagnosis.safeFixes.some((fix) => /Mockup/i.test(fix)));
  assert.ok(!diagnosis.blockedFixes.some((fix) => /Video-Retry/i.test(fix)));
});

test("company brain uses a later initial delivery audit to resolve an older video QC failure", () => {
  const failedRun: CompanyBrainAutomationRun = {
    id: "audit-3100049",
    workflowName: "ki_video_generator_v1",
    action: "video_content_qc",
    status: "failed",
    error: "KI-Video hat die Inhaltsprüfung wegen DESIGN_MORPH nicht bestanden.",
    createdAt: "2026-07-14T10:43:02.000Z",
    requestId: "000ff1ce-2fde-4129-8c30-de142f31de15",
    executionId: "3100049",
    correlationId: "6a55f38cb34bbcdc7a140559",
    sourceEventId: null,
    targetRecordId: "cmrkl1mg40000o43gn62tbyjq",
    failedNode: "Analyze Video Content QC",
    idempotencyKey: "video-qc:6a55f38cb34bbcdc7a140559",
    retrySafety: "blocked",
    summary: "Video-QC abgelehnt.",
    issueKey: "video_content_qc_failed",
    safeFix: "Mockup prüfen oder ersetzen.",
    currentAttempt: 2,
    automaticVideoAttemptLimit: 2,
    retryPlanned: false,
  };
  const successfulDelivery: CompanyBrainAutomationRun = {
    id: "audit-3101931",
    workflowName: "ki_video_generator_v1",
    action: "initial_delivery_complete",
    status: "success",
    error: null,
    createdAt: "2026-07-14T11:47:37.200Z",
    requestId: "000ff1ce-2fde-4129-8c30-de142f31de15",
    executionId: "3101931",
    correlationId: "offer:cmrkl1mg40000o43gn62tbyjq:initial-delivery:3101931",
    sourceEventId: null,
    targetRecordId: "cmrkl1mg40000o43gn62tbyjq",
    failedNode: null,
    idempotencyKey: "offer:cmrkl1mg40000o43gn62tbyjq:initial-delivery:v1",
    retrySafety: "blocked",
    summary: "Initiale Angebotszustellung wurde abgeschlossen.",
  };
  const crossChecks = applyDeliveryAuditProofToCrossChecks([{
    key: "offer_sent",
    label: "Angebotsversand",
    status: "review",
    severity: "warning",
    expected: "Versandbeleg",
    actual: null,
    summary: "Angebot existiert, aber ein eindeutiger Versandbeleg fehlt.",
    evidenceIds: [],
  }], [failedRun, successfulDelivery]);

  const diagnosis = buildTrelloFailureDiagnosis({
    requested: true,
    context: {
      card: {
        id: "6a55f38cb34bbcdc7a140559",
        shortLink: "O4CNCCZW",
        name: "3D Backlit · Nils Manthey",
        desc: "Request-ID: 000ff1ce-2fde-4129-8c30-de142f31de15",
        idBoard: null,
        idList: null,
        currentListName: "Quote Ready",
        url: "https://trello.com/c/O4CNCCZW",
        shortUrl: "https://trello.com/c/O4CNCCZW",
        closed: false,
        dateLastActivity: "2026-07-14T11:47:37.200Z",
        createdAt: null,
        customFields: {},
        attachmentsCount: 7,
      },
      actions: [{
        id: "action-qc-failed",
        type: "updateCard",
        date: "2026-07-14T10:43:02.000Z",
        text: "FEHLER: Video-QC DESIGN_MORPH. Execution: 3100049",
        fromListId: null,
        fromListName: "Neue Angebote schicken + KI-Video",
        toListId: null,
        toListName: "Quote Ready",
      }],
    },
    diagnostic: { source: "trello_live", ok: true, label: "Trello Live", detail: null, count: 1 },
    records: [],
    offers: [],
    crossChecks,
    automationRuns: [failedRun, successfulDelivery],
    question: "Warum wurden Video und Angebot nicht versendet?",
    problemType: "offer_not_sent",
  });

  assert.equal(crossChecks[0]?.status, "pass");
  assert.match(crossChecks[0]?.summary || "", /Execution 3101931/);
  assert.equal(diagnosis.rootCauseKey, "sent");
  assert.equal(diagnosis.duplicateRisk, "low");
  assert.match(diagnosis.rootCause, /Execution 3101931/);
  assert.ok(!diagnosis.safeFixes.some((fix) => /Mockup/i.test(fix)));
  assert.ok(!diagnosis.blockedFixes.some((fix) => /2\/2|Retry/i.test(fix)));
});

test("company brain does not override an Outlook delivery failure with workflow success", () => {
  const failedDeliveryCheck = {
    key: "offer_sent" as const,
    label: "Angebotsversand",
    status: "fail" as const,
    severity: "critical" as const,
    expected: "Versandbeleg",
    actual: "2026-07-14T12:00:00.000Z",
    summary: "Outlook meldet Unzustellbarkeit.",
    evidenceIds: ["outlook:bounce"],
  };
  const successfulWorkflowRun: CompanyBrainAutomationRun = {
    id: "delivery-success-before-bounce",
    workflowName: "ki_video_generator_v1",
    action: "initial_delivery_complete",
    status: "success",
    error: null,
    createdAt: "2026-07-14T11:47:37.200Z",
    requestId: "REQ-BOUNCE",
    executionId: "3101931",
    correlationId: null,
    sourceEventId: null,
    targetRecordId: "offer-bounce",
    failedNode: null,
    idempotencyKey: "offer:offer-bounce:initial-delivery:v1",
    retrySafety: "blocked",
    summary: "Initiale Angebotszustellung wurde abgeschlossen.",
  };

  const [result] = applyDeliveryAuditProofToCrossChecks([failedDeliveryCheck], [successfulWorkflowRun]);

  assert.equal(result?.status, "fail");
  assert.equal(result?.summary, "Outlook meldet Unzustellbarkeit.");
});

test("company brain stops suggesting another video retry after attempt two", () => {
  const diagnosis = buildTrelloFailureDiagnosis({
    requested: true,
    context: {
      card: {
        id: "card-video-qc-final",
        shortLink: "videoqcfinal",
        name: "FEHLER - 3D Backlit",
        desc: "Request-ID: REQ-VIDEO-QC-FINAL",
        idBoard: null,
        idList: null,
        currentListName: "Quote Ready",
        url: "https://trello.com/c/videoqcfinal",
        shortUrl: "https://trello.com/c/videoqcfinal",
        closed: false,
        dateLastActivity: "2026-07-14T10:43:03.000Z",
        createdAt: null,
        customFields: {},
        attachmentsCount: 7,
      },
      actions: [{
        id: "action-video-qc-final",
        type: "updateCard",
        date: "2026-07-14T10:43:03.000Z",
        text: "FEHLER: Video-QC DESIGN_MORPH. Execution: 3100049",
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
    automationRuns: [{
      id: "n8n-live-3100049",
      workflowName: "KI-Video Generator v1.0",
      action: "offer_send",
      status: "success",
      error: "KI-Video hat die Inhaltsprüfung wegen DESIGN_MORPH nicht bestanden.",
      createdAt: "2026-07-14T10:43:02.000Z",
      requestId: "REQ-VIDEO-QC-FINAL",
      executionId: "3100049",
      correlationId: "card-video-qc-final",
      sourceEventId: "action-video-qc-final",
      targetRecordId: null,
      failedNode: "Analyze Video Content QC",
      idempotencyKey: "video-qc:card-video-qc-final",
      retrySafety: "blocked",
      summary: "Das Video wurde wegen DESIGN_MORPH abgelehnt.",
      issueKey: "video_content_qc_failed",
      safeFix: "Automatischen Zweitversuch abwarten.",
      currentAttempt: 2,
      nextAttempt: null,
      automaticVideoAttemptLimit: 2,
      retryPlanned: false,
      videoQcConfidence: 0.8,
      videoQcIssues: ["DESIGN_MORPH"],
    }],
    question: "Warum ist der zweite Versuch wieder fehlgeschlagen?",
    problemType: "automation_failed",
  });

  assert.equal(diagnosis.rootCauseKey, "automation_failed");
  assert.match(diagnosis.rootCause, /Versuch 2\/2/);
  assert.match(diagnosis.rootCause, /QC-Konfidenz 0\.8/);
  assert.match(diagnosis.recommendedFix, /Keinen weiteren Lauf mit unverändertem Mockup/);
  assert.doesNotMatch(diagnosis.recommendedFix, /Zweitversuch.*zulassen/i);
  assert.ok(diagnosis.safeFixes.some((fix) => /keinen weiteren Video-Lauf mit unverändertem Input/.test(fix)));
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

test("company brain employee guidance turns invalid email cases into guided data fixes", () => {
  const retry = {
    status: "needs_fix" as const,
    label: "Fix vor Retry nötig",
    summary: "Die Automation hatte eine ungültige oder unvollständige Kunden-E-Mail-Adresse.",
    recipientEmail: "praxis@kurswechsel.de",
    offerId: "offer-invalid-email",
    offerNumber: "AN-14427",
    idempotencyKey: null,
    canSendWithConfirmation: false,
    blockers: ["Die Automation hatte eine ungültige oder unvollständige Kunden-E-Mail-Adresse."],
    safeFixes: ["Ungültige Kunden-E-Mail korrigieren oder verifizieren; kein Retry an die alte Adresse."],
  };
  const actions = actionProposalFixture({ retry });
  const guidance = buildCompanyBrainEmployeeGuidance({
    problemResolution: {
      problemType: "offer_not_sent",
      label: "Angebot nicht raus",
      severity: "warning",
      confidence: "medium",
      specialCaseKind: "open_question",
      rootCause: "Kunden-E-Mail ist unvollständig.",
      recommendedResolution: "E-Mail korrigieren und Fall neu prüfen.",
      internalTaskTitle: "Angebot nicht raus: AN-14427",
      internalTaskDescription: "Test",
      customerReplyPolicy: [],
      escalationPath: [],
      requiredEvidence: [],
      missingEvidence: [],
    },
    retryAssessment: retry,
    evidenceScore: { status: "medium", score: 60, summary: "Beweise teilweise geladen.", safeToAnswerCustomer: false, reasons: [] },
    actionProposals: actions,
    trelloFailureDiagnosis: {
      ...retryDiagnosis(),
      rootCauseKey: "automation_failed",
      rootCause: "n8n-Execution ist wegen invalid customer_email fehlgeschlagen.",
    },
    automationRuns: [{
      id: "run-invalid-email",
      workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
      action: "offer_send",
      status: "failed",
      error: "invalid customer_email praxis@kurswechsel",
      createdAt: "2026-07-06T07:41:13.408Z",
      requestId: "REQ-INVALID-EMAIL",
      executionId: "2770420",
      correlationId: null,
      sourceEventId: null,
      targetRecordId: null,
      failedNode: "Offer Send",
      idempotencyKey: null,
      retrySafety: "blocked",
      summary: "Kunden-E-Mail unvollständig.",
      issueKey: "customer_email_invalid",
    }],
    sourceHealth: [],
    crossChecks: [],
    records: [{
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
    }],
    offers: [],
  });

  assert.equal(guidance.resolutionStatus, "needs_data_fix");
  assert.equal(guidance.customerContactPolicy, "internal_only");
  assert.equal(guidance.nextBestActionKey, "correct_customer_email");
  assert.equal(guidance.steps.find((step) => step.key === "fix_data")?.status, "ready");
  assert.ok(guidance.forbiddenActions.some((entry) => /Keinen Angebots-Resend/.test(entry)));
});

test("company brain employee guidance allows only guarded self service when retry is ready", () => {
  const retry = {
    status: "ready" as const,
    label: "Retry bereit",
    summary: "Der Retry kann nach erneuter serverseitiger Duplicate-Prüfung und Freigabe ausgeführt werden.",
    recipientEmail: "max@example.com",
    offerId: "offer-ready",
    offerNumber: "AN-5001",
    idempotencyKey: "company-brain-offer-resend:offer-ready:max@example.com",
    canSendWithConfirmation: true,
    blockers: [],
    safeFixes: ["Serverseitigen Duplicate-Check ausführen und erst danach senden."],
  };
  const guidance = buildCompanyBrainEmployeeGuidance({
    problemResolution: {
      problemType: "offer_not_sent",
      label: "Angebot nicht raus",
      severity: "warning",
      confidence: "medium",
      specialCaseKind: "open_question",
      rootCause: "Angebot wurde noch nicht versendet.",
      recommendedResolution: "Guarded Retry ausführen.",
      internalTaskTitle: "Angebot nicht raus: AN-5001",
      internalTaskDescription: "Test",
      customerReplyPolicy: [],
      escalationPath: [],
      requiredEvidence: [],
      missingEvidence: [],
    },
    retryAssessment: retry,
    evidenceScore: { status: "strong", score: 84, summary: "Beweise stark.", safeToAnswerCustomer: true, reasons: [] },
    actionProposals: actionProposalFixture({ retry }),
    trelloFailureDiagnosis: { ...retryDiagnosis(), rootCauseKey: "offer_exists_no_send_proof" },
    automationRuns: [],
    sourceHealth: [],
    crossChecks: [],
    records: [{
      requestId: "REQ-READY",
      displayName: "Max Muster",
      company: null,
      email: "max@example.com",
      phone: null,
      status: "open",
      title: "Schild",
      requestedSize: null,
      requestedColors: [],
      trelloCardId: "card-ready",
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
    }],
    offers: [{
      offerId: "offer-ready",
      offerNumber: "AN-5001",
      documentReference: "AN-5001",
      publicUrl: null,
      status: "SENT",
      customerName: "Max Muster",
      customerEmail: "max@example.com",
      projectTitle: "Schild",
      trelloCardId: "card-ready",
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
    }],
  });

  assert.equal(guidance.resolutionStatus, "self_service");
  assert.equal(guidance.customerContactPolicy, "guarded_only");
  assert.equal(guidance.nextBestActionKey, "guarded_offer_resend");
  assert.equal(guidance.steps.find((step) => step.key === "clear_send")?.status, "ready");
  assert.ok(guidance.forbiddenActions.some((entry) => /ohne explizite Freigabe/.test(entry)));
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

test("company brain retry assessment accepts different Trello cards when alias group proves the same request", () => {
  const records: CompanyBrainRecordSummary[] = [{
    requestId: "REQ-ALIAS",
    displayName: "Lisa",
    company: null,
    email: "lisa@example.com",
    phone: null,
    status: "open",
    title: "LED Flex",
    requestedSize: null,
    requestedColors: [],
    trelloCardId: "6a4cbfae6410de928e0f00fc",
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
    offerId: "offer-alias",
    offerNumber: "AN-14474",
    documentReference: "AN-14474",
    publicUrl: null,
    status: "SENT",
    customerName: "Lisa",
    customerEmail: "lisa@example.com",
    projectTitle: "LED Flex",
    trelloCardId: "6a4df2a72573e6bdc1c654fb",
    updatedAt: "2026-07-08T08:20:00.000Z",
    viewedAt: null,
    acceptedAt: null,
    itemCount: 1,
    imageCount: 1,
    selectedItemCount: 1,
    designEvidenceCount: 1,
    productHints: ["LED"],
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
    relatedTrelloCardIds: ["6a4cbfae6410de928e0f00fc", "6a4df2a72573e6bdc1c654fb"],
  });

  assert.equal(retry.status, "ready");
  assert.equal(retry.canSendWithConfirmation, true);
  assert.ok(!retry.blockers.some((blocker) => /Trello-Karte/.test(blocker)));
  assert.ok(retry.safeFixes.some((fix) => /Aliasgruppe/.test(fix)));
});

function actionProposalFixture(options: {
  retry: ReturnType<typeof buildCompanyBrainRetryAssessment>;
  automationRuns?: CompanyBrainAutomationRun[];
  withoutRecord?: boolean;
  trelloFailureDiagnosis?: CompanyBrainTrelloFailureDiagnosis;
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
    trelloFailureDiagnosis: options.trelloFailureDiagnosis || retryDiagnosis(),
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

test("company brain routes video QC failures to mockup review and blocks direct resend", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "ready",
    label: "Guarded Retry bereit",
    summary: "Kein Versandbeleg vorhanden.",
    recipientEmail: "max@example.com",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: "retry-video-qc",
    canSendWithConfirmation: true,
    blockers: [],
    safeFixes: [],
  };
  const videoQcRun: CompanyBrainAutomationRun = {
    id: "video-qc-run",
    workflowName: "ki_video_generator_v1",
    action: "create_and_send_offer",
    status: "error",
    error: "KI-Video hat die Inhaltspruefung nicht bestanden (DESIGN_MORPH).",
    createdAt: "2026-07-14T09:32:00.000Z",
    requestId: "REQ-ACTIONS",
    executionId: "3097709",
    executionUrl: "https://n8n.example/execution/3097709",
    correlationId: "card-actions",
    sourceEventId: null,
    targetRecordId: null,
    failedNode: "Analyze Video Content QC",
    idempotencyKey: "video-qc:card-actions",
    retrySafety: "automatic_retry_once",
    summary: "Das Video wurde wegen DESIGN_MORPH abgelehnt.",
    issueKey: "video_content_qc_failed",
    safeFix: "Mockup prüfen oder ersetzen.",
  };
  const actions = actionProposalFixture({ retry, automationRuns: [videoQcRun] });

  const mockupReview = actions.find((action) => action.key === "collect_design_assets");
  const guardedResend = actions.find((action) => action.key === "guarded_offer_resend");
  const retryTask = actions.find((action) => action.key === "prepare_offer_retry");

  assert.equal(mockupReview?.label, "Mockup für Video prüfen");
  assert.equal(mockupReview?.enabled, true);
  assert.equal(mockupReview?.href, "https://trello.com/c/actions");
  assert.equal(guardedResend?.enabled, false);
  assert.match(guardedResend?.summary || "", /Video-Inhaltsprüfung/);
  assert.equal(retryTask?.enabled, false);

  const guidance = buildCompanyBrainEmployeeGuidance({
    problemResolution: {
      problemType: "offer_not_sent",
      label: "Angebot nicht raus",
      severity: "critical",
      confidence: "high",
      specialCaseKind: "open_question",
      rootCause: "Video-QC fehlgeschlagen.",
      recommendedResolution: "Mockup prüfen.",
      internalTaskTitle: "Video-QC prüfen",
      internalTaskDescription: "Test",
      customerReplyPolicy: [],
      escalationPath: [],
      requiredEvidence: [],
      missingEvidence: [],
    },
    retryAssessment: retry,
    evidenceScore: { status: "medium", score: 72, summary: "Video-QC belegt.", safeToAnswerCustomer: false, reasons: [] },
    actionProposals: actions,
    trelloFailureDiagnosis: {
      ...retryDiagnosis(),
      rootCause: "Video-QC hat das Video wegen DESIGN_MORPH abgelehnt.",
    },
    automationRuns: [videoQcRun],
    sourceHealth: [],
    crossChecks: [],
    records: [],
    offers: [],
  });

  assert.equal(guidance.rootCauseCode, "video_content_qc_failed");
  assert.equal(guidance.nextBestActionKey, "collect_design_assets");
  assert.equal(guidance.nextBestActionLabel, "Mockup für Video prüfen");
  assert.match(guidance.plainLanguageSummary, /DESIGN_MORPH/);
});

test("company brain hides historical video QC fixes after successful delivery", () => {
  const retry: ReturnType<typeof buildCompanyBrainRetryAssessment> = {
    status: "blocked",
    label: "Versand bereits belegt",
    summary: "Ein erfolgreicher Zustellungs-Audit ist vorhanden.",
    recipientEmail: "nils@example.com",
    offerId: "offer-actions",
    offerNumber: "AN-5010",
    idempotencyKey: "company-brain-offer-resend:offer-actions:nils@example.com",
    canSendWithConfirmation: false,
    blockers: ["Es gibt bereits einen Versand-/Ausgangsbeleg; keinen erneuten Versand auslösen."],
    safeFixes: ["Status-/Trello-Projektion prüfen, aber keinen Resend starten."],
  };
  const historicalFailure: CompanyBrainAutomationRun = {
    id: "video-qc-old",
    workflowName: "ki_video_generator_v1",
    action: "video_content_qc",
    status: "failed",
    error: "DESIGN_MORPH",
    createdAt: "2026-07-14T10:43:02.000Z",
    requestId: "REQ-ACTIONS",
    executionId: "3100049",
    correlationId: "card-actions",
    sourceEventId: null,
    targetRecordId: "offer-actions",
    failedNode: "Analyze Video Content QC",
    idempotencyKey: "video-qc:card-actions",
    retrySafety: "blocked",
    summary: "Video-QC abgelehnt.",
    issueKey: "video_content_qc_failed",
    safeFix: "Mockup prüfen oder ersetzen.",
    currentAttempt: 2,
    automaticVideoAttemptLimit: 2,
    retryPlanned: false,
  };
  const successfulDelivery: CompanyBrainAutomationRun = {
    id: "delivery-success",
    workflowName: "ki_video_generator_v1",
    action: "initial_delivery_complete",
    status: "success",
    error: null,
    createdAt: "2026-07-14T11:47:37.200Z",
    requestId: "REQ-ACTIONS",
    executionId: "3101931",
    correlationId: "offer:offer-actions:initial-delivery:3101931",
    sourceEventId: null,
    targetRecordId: "offer-actions",
    failedNode: null,
    idempotencyKey: "offer:offer-actions:initial-delivery:v1",
    retrySafety: "blocked",
    summary: "Initiale Angebotszustellung wurde abgeschlossen.",
  };
  const resolvedDiagnosis: CompanyBrainTrelloFailureDiagnosis = {
    ...retryDiagnosis(),
    severity: "info",
    rootCauseKey: "sent",
    rootCause: "Ein späterer erfolgreicher Zustellungs-Audit löst den alten Video-QC-Fehler auf.",
    recommendedFix: "Kein erneuter Versand und keine Mockup-Korrektur.",
    duplicateRisk: "low",
    blockedFixes: [],
  };
  const actions = actionProposalFixture({
    retry,
    automationRuns: [historicalFailure, successfulDelivery],
    trelloFailureDiagnosis: resolvedDiagnosis,
  });

  assert.equal(actions.find((action) => action.key === "inspect_n8n_run")?.enabled, false);
  assert.equal(actions.find((action) => action.key === "guarded_offer_resend")?.enabled, false);
  assert.equal(actions.find((action) => action.key === "open_problem_case")?.enabled, false);
  assert.equal(actions.find((action) => action.key === "create_internal_task")?.enabled, false);
  assert.equal(actions.find((action) => action.key === "collect_design_assets")?.label, "Design-Assets sammeln");
  assert.equal(actions.find((action) => action.key === "collect_design_assets")?.enabled, false);
  assert.ok(!actions.some((action) => action.enabled && action.label === "Mockup für Video prüfen"));

  const guidance = buildCompanyBrainEmployeeGuidance({
    problemResolution: {
      problemType: "offer_not_sent",
      label: "Angebot nicht raus",
      severity: "warning",
      confidence: "high",
      specialCaseKind: "open_question",
      rootCause: "Historischer Video-QC-Fehler.",
      recommendedResolution: "Versandstatus prüfen.",
      internalTaskTitle: "Versand prüfen",
      internalTaskDescription: "Test",
      customerReplyPolicy: [],
      escalationPath: [],
      requiredEvidence: [],
      missingEvidence: [],
    },
    retryAssessment: retry,
    evidenceScore: { status: "strong", score: 92, summary: "Zustellung belegt.", safeToAnswerCustomer: false, reasons: [] },
    actionProposals: actions,
    trelloFailureDiagnosis: resolvedDiagnosis,
    automationRuns: [historicalFailure, successfulDelivery],
    sourceHealth: [],
    crossChecks: [{
      key: "offer_sent",
      label: "Angebotsversand",
      status: "pass",
      severity: "info",
      expected: "Versandbeleg",
      actual: successfulDelivery.createdAt,
      summary: "Erfolgreiche Zustellung ist belegt.",
      evidenceIds: [],
    }],
    records: [],
    offers: [],
  });

  assert.equal(guidance.rootCauseCode, "sent");
  assert.equal(guidance.resolutionStatus, "resolved");
  assert.equal(guidance.resolutionLabel, "Erfolgreich abgeschlossen");
  assert.equal(guidance.nextBestActionKey, null);
  assert.equal(guidance.blockerBullets.length, 0);
  assert.equal(guidance.steps.find((step) => step.key === "clear_send")?.status, "done");
  assert.match(guidance.plainLanguageSummary, /Kein weiterer Versand nötig/);
  assert.ok(!/Mockup prüfen/i.test(guidance.plainLanguageSummary));
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
