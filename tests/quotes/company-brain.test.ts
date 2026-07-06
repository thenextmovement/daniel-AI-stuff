import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyBrainAnswer,
  buildCompanyBrainCrossChecks,
  buildTrelloAutomationRuns,
  buildTrelloFailureDiagnosis,
  extractCompanyBrainIdentifiers,
  extractCompanyBrainSignals,
  normalizeCompanyBrainQuery,
  type CompanyBrainAutomationRun,
  type CompanyBrainEvidence,
  type CompanyBrainFinding,
  type CompanyBrainOfferSummary,
  type CompanyBrainRecordSummary,
  type CompanyBrainTrelloFailureDiagnosis,
} from "@/lib/ops/company-brain";
import type { TrelloFailureContext } from "@/lib/quotes/trello";

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
