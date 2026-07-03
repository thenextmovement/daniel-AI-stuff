import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyBrainAnswer,
  buildCompanyBrainCrossChecks,
  extractCompanyBrainIdentifiers,
  extractCompanyBrainSignals,
  normalizeCompanyBrainQuery,
  type CompanyBrainEvidence,
  type CompanyBrainFinding,
  type CompanyBrainOfferSummary,
  type CompanyBrainRecordSummary,
  type CompanyBrainTrelloFailureDiagnosis,
} from "@/lib/ops/company-brain";

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
