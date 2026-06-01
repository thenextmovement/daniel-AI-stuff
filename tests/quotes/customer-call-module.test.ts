import test from "node:test";
import assert from "node:assert/strict";
import type { CustomerSearchResult } from "../../src/lib/ops/customer-records";
import {
  advanceCadenceStateFromResult,
  buildSalesTaskFromCadence,
  buildSalesCallResultFromPreset,
  buildSalesCallVisualCandidates,
  decideSalesCallCompletion,
  deriveCadenceState,
  evaluateSalesCallGate,
  resolveRuntimeSalesCallState,
} from "../../src/lib/ops/customer-call-module";
import {
  addBusinessDaysIso,
  buildTaskFromInboundEmailSignal,
  classifyInboundEmailSignal,
  isActiveSalesTaskVisibleNow,
} from "../../src/lib/ops/sales-task-engine";
import { QuoteValidationError } from "../../src/lib/quotes/validation";

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoDateTimeFromNow(days: number, hour = 9) {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function buildRecord(overrides: Partial<CustomerSearchResult> = {}): CustomerSearchResult {
  return {
    masterCustomerId: "mc_1",
    requestId: "4423b374-e68c-4f55-8132-c6806cac687a",
    email: "kunde@example.com",
    billingEmail: null,
    ccEmails: [],
    firstName: "Max",
    lastName: "Muster",
    phone: "+49123456789",
    company: "NEONTRIP Test",
    displayName: "Max Muster",
    originalEmail: null,
    originalPhone: null,
    updatedAt: "2026-05-21T09:00:00.000Z",
    affectedRows: {
      followupQueue: 0,
      pendingFollowups: 0,
      nextPendingFollowupAt: null,
      leadFollowupPlans: 0,
      documentJourney: 0,
    },
    downstreamPreview: { followupEmails: [], followupNames: [], documentStatuses: [] },
    request: {
      title: "LED Anfrage",
      description: null,
      status: "open",
      acDealId: 12345,
      acDealStage: "new",
      dealStatus: "open",
      segment: null,
      estimatedValue: 1500,
      finalValue: null,
      size: null,
      colors: [],
      application: null,
      deliveryTime: null,
      customerType: null,
      country: null,
      formId: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      landingPageUrl: null,
      referrer: null,
      trelloCardUrl: null,
      createdAt: "2026-05-21T08:00:00.000Z",
      updatedAt: "2026-05-21T08:00:00.000Z",
    },
    quote: null,
    order: null,
    orderHistory: [],
    orderDiagnostic: { status: "unlinked", summary: "", details: [] },
    crmSales: [],
    crmQuote: null,
    followupMockups: [],
    callOps: {
      contactabilityStatus: null,
      nextCallbackAt: null,
      planningReason: null,
      liveCallLogCount: 0,
      auditCallLogCount: 0,
      liveVoiceCallCount: 0,
      totalCallCount: 0,
      latestLoggedCallAt: null,
      latestLoggedCallSummary: null,
      latestVoiceCallAt: null,
      latestVoiceCallSummary: null,
      recentCalls: [],
    },
    salesRecovery: {
      status: "not_started",
      startedAt: null,
      reason: null,
      actorLabel: null,
      viewedAt: null,
      nextCallbackAt: null,
      phoneAvailable: true,
      orderLinked: false,
    },
    specialCase: { kind: null, label: null, detail: null },
    caseCoordination: { status: "none", label: null, detail: null, ownerName: null, handoverNote: null, updatedAt: null },
    caseFlow: { state: "idle", label: null, detail: null, currentFlowKey: null, currentFlowLabel: null, completedKeys: [], totalSteps: null, updatedAt: null },
    opsState: { status: "open", label: null, detail: null, ownerName: null, handoverNote: null, updatedAt: null, isClosed: false, needsAttention: false },
    relatedRequests: [],
    trello: null,
    communications: [],
    timeline: [],
    notes: [],
    auditTrail: [],
    ...overrides,
  } as CustomerSearchResult;
}

test("buildSalesCallResultFromPreset maps callback and not-reached to dated callback next steps", () => {
  const callbackDate = isoDateFromNow(2);
  const retryDate = isoDateFromNow(3);
  const callback = buildSalesCallResultFromPreset({
    callListItemId: "item_1",
    requestId: "4423b374-e68c-4f55-8132-c6806cac687a",
    preset: "callback",
    callbackDate,
    notes: "Kunde erreicht, Rückruf am Freitag vereinbart, weil intern noch eine Freigabe fehlt.",
  });

  assert.equal(callback.callDone, "yes");
  assert.equal(callback.callOutcome, "reached_callback");
  assert.equal(callback.nextStep, `callback_${callbackDate}`);
  assert.equal(callback.validationUseful, "yes");

  const notReached = buildSalesCallResultFromPreset({
    callListItemId: "item_2",
    requestId: "4423b374-e68c-4f55-8132-c6806cac687b",
    preset: "not-reached",
    callbackDate: retryDate,
    notes: "Nicht erreicht, es klingelte mehrfach durch; nächster Versuch morgen Vormittag geplant.",
  });

  assert.equal(notReached.callOutcome, "not_reached");
  assert.equal(notReached.nextStep, `callback_${retryDate}`);
});

test("buildSalesCallResultFromPreset allows ad-hoc calls without a list item", () => {
  const result = buildSalesCallResultFromPreset({
    callListItemId: null,
    requestId: "4423b374-e68c-4f55-8132-c6806cac687a",
    preset: "interested",
    notes: "Kunde wurde außerhalb der Tagesliste angerufen und möchte ein angepasstes Angebot prüfen.",
  });

  assert.equal(result.callListItemId, null);
  assert.equal(result.requestId, "4423b374-e68c-4f55-8132-c6806cac687a");
  assert.equal(result.callOutcome, "reached_interested");
});

test("buildSalesCallResultFromPreset rejects weak or placeholder notes", () => {
  assert.throws(
    () =>
      buildSalesCallResultFromPreset({
        callListItemId: "item_1",
        requestId: "4423b374-e68c-4f55-8132-c6806cac687a",
        preset: "interested",
        notes: "Mailbox",
      }),
    QuoteValidationError,
  );

  assert.throws(
    () =>
      buildSalesCallResultFromPreset({
        callListItemId: "item_1",
        requestId: "4423b374-e68c-4f55-8132-c6806cac687a",
        preset: "callback",
        callbackDate: isoDateFromNow(-1),
        notes: "Kunde erreicht, Rueckruf geplant.",
      }),
    QuoteValidationError,
  );
});

test("evaluateSalesCallGate keeps green without concrete next step from being complete", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1,
    dealValueEur: 1200,
    latestResult: {
      id: `result_${index + 1}`,
      callListItemId: `item_${index + 1}`,
      rankAtTime: index + 1,
      requestId: `req_${index + 1}`,
      acDealId: null,
      preset: "review-useful" as const,
      callDone: "no" as const,
      callOutcome: "" as const,
      nextStep: "wait",
      validationUseful: "yes" as const,
      notes: `Fachliche Bewertung ${index + 1} mit echtem Kontext und konkreter Einordnung.`,
      operatorId: "Daniel",
      source: "test",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:00:00.000Z",
    },
  }));

  const gate = evaluateSalesCallGate(items);
  const completion = decideSalesCallCompletion("ok", gate);

  assert.equal(gate.gate, "green");
  assert.equal(gate.concreteNextSteps, 0);
  assert.equal(completion.complete, false);
  assert.equal(completion.reason, "sales_gate_green_without_sales_next_step");
});

test("evaluateSalesCallGate counts only reached callbacks and adjusted offers as concrete next steps", () => {
  const gate = evaluateSalesCallGate([
    {
      rank: 1,
      dealValueEur: 2500,
      latestResult: {
        id: "r1",
        callListItemId: "i1",
        rankAtTime: 1,
        requestId: "req_1",
        acDealId: null,
        preset: "callback",
        callDone: "yes",
        callOutcome: "reached_callback",
        nextStep: "callback_2026-05-22",
        validationUseful: "yes",
        notes: "Kunde erreicht, Rueckruftermin fuer Freitag fixiert, Entscheidung mit Partner steht noch aus.",
        operatorId: "Daniel",
        source: "test",
        createdAt: "2026-05-21T09:00:00.000Z",
        updatedAt: "2026-05-21T09:00:00.000Z",
      },
    },
    {
      rank: 2,
      dealValueEur: 1800,
      latestResult: {
        id: "r2",
        callListItemId: "i2",
        rankAtTime: 2,
        requestId: "req_2",
        acDealId: null,
        preset: "not-reached",
        callDone: "yes",
        callOutcome: "not_reached",
        nextStep: "callback_2026-05-22",
        validationUseful: "yes",
        notes: "Nicht erreicht, neuer Versuch fuer morgen Vormittag geplant.",
        operatorId: "Daniel",
        source: "test",
        createdAt: "2026-05-21T09:00:00.000Z",
        updatedAt: "2026-05-21T09:00:00.000Z",
      },
    },
    {
      rank: 3,
      dealValueEur: 3200,
      latestResult: {
        id: "r3",
        callListItemId: "i3",
        rankAtTime: 3,
        requestId: "req_3",
        acDealId: null,
        preset: "needs-adjustment",
        callDone: "yes",
        callOutcome: "reached_needs_adjustment",
        nextStep: "send_adjusted_offer",
        validationUseful: "yes",
        notes: "Kunde will groessere Variante und schwarzen Rahmen, neues Angebot ist der naechste klare Schritt.",
        operatorId: "Daniel",
        source: "test",
        createdAt: "2026-05-21T09:00:00.000Z",
        updatedAt: "2026-05-21T09:00:00.000Z",
      },
    },
    ...Array.from({ length: 7 }, (_, offset) => ({
      rank: offset + 4,
      dealValueEur: 1000,
      latestResult: {
        id: `rx_${offset}`,
        callListItemId: `ix_${offset}`,
        rankAtTime: offset + 4,
        requestId: `req_x_${offset}`,
        acDealId: null,
        preset: "review-useful" as const,
        callDone: "no" as const,
        callOutcome: "" as const,
        nextStep: "wait",
        validationUseful: "yes" as const,
        notes: `Zusatzkontext ${offset} mit echter Beobachtung zur Angebotslage und Prioritaet.`,
        operatorId: "Daniel",
        source: "test",
        createdAt: "2026-05-21T09:00:00.000Z",
        updatedAt: "2026-05-21T09:00:00.000Z",
      },
    })),
  ]);

  assert.equal(gate.concreteNextSteps, 2);
});

test("deriveCadenceState picks quote follow-up and important priority for higher-value offer cases", () => {
  const record = buildRecord({
    quote: {
      status: "sent",
      totalValue: 2200,
      currency: "EUR",
      shareLink: null,
      editLink: null,
      sentAt: isoDateTimeFromNow(-1, 9),
      viewedAt: isoDateTimeFromNow(-1, 10),
      signedAt: null,
      whatsappSentAt: null,
    },
  });

  const cadence = deriveCadenceState(record, null, null);
  assert.equal(cadence.currentStage, "quote_call");
  assert.equal(cadence.priorityTier, "important");
  assert.equal(cadence.queueBucket, "due_today");
});

test("deriveCadenceState schedules same-day first inquiry and same-day quote calls", () => {
  const inquiryRecord = buildRecord({
    request: {
      ...buildRecord().request!,
      createdAt: new Date().toISOString(),
    },
  });
  const inquiryCadence = deriveCadenceState(inquiryRecord, null, null);

  assert.equal(inquiryCadence.currentStage, "inquiry_call");
  assert.equal(inquiryCadence.queueBucket, "due_today");
  assert.ok(inquiryCadence.call1DueAt, "inquiry call due date is set");

  const quoteRecord = buildRecord({
    quote: {
      status: "sent",
      totalValue: 900,
      currency: "EUR",
      shareLink: null,
      editLink: null,
      sentAt: new Date().toISOString(),
      viewedAt: null,
      signedAt: null,
      whatsappSentAt: null,
    },
  });
  const quoteCadence = deriveCadenceState(quoteRecord, null, null);

  assert.equal(quoteCadence.currentStage, "quote_call");
  assert.equal(quoteCadence.queueBucket, "due_today");
  assert.ok(quoteCadence.call2DueAt, "quote call due date is set");
});

test("deriveCadenceState promotes stale inquiry tasks when an offer has since been sent", () => {
  const inquiryRecord = buildRecord();
  const existing = deriveCadenceState(inquiryRecord, null, null);
  assert.equal(existing.currentStage, "inquiry_call");
  assert.equal(existing.standardCallCount, 0);

  const quoteRecord = buildRecord({
    quote: {
      status: "sent",
      totalValue: 1400,
      currency: "EUR",
      shareLink: null,
      editLink: null,
      sentAt: new Date().toISOString(),
      viewedAt: null,
      signedAt: null,
      whatsappSentAt: null,
    },
  });
  const promoted = deriveCadenceState(quoteRecord, null, existing);
  const task = buildSalesTaskFromCadence(promoted, "sales_call_candidate");

  assert.equal(promoted.currentStage, "quote_call");
  assert.equal(promoted.standardCallCount, 0);
  assert.equal(promoted.call1CompletedAt, null);
  assert.equal(task?.taskType, "call_quote_sent");
});

test("resolveRuntimeSalesCallState does not keep stale inquiry stage after offer is sent", () => {
  const inquiryRecord = buildRecord();
  const staleExisting = deriveCadenceState(inquiryRecord, null, null);
  assert.equal(staleExisting.currentStage, "inquiry_call");

  const quoteRecord = buildRecord({
    quote: {
      status: "sent",
      totalValue: 1400,
      currency: "EUR",
      shareLink: null,
      editLink: null,
      sentAt: new Date().toISOString(),
      viewedAt: null,
      signedAt: null,
      whatsappSentAt: null,
    },
  });

  const runtime = resolveRuntimeSalesCallState({
    record: quoteRecord,
    sourceKeys: [],
    latestResult: null,
    existingCadence: staleExisting,
    activeTasks: [
      {
        id: "stale_task_1",
        requestId: quoteRecord.requestId,
        taskType: "call_new_inquiry",
        status: "open",
        title: "Neue Anfrage anrufen",
        detail: null,
        dueAt: new Date().toISOString(),
        priorityTier: "standard",
        assigneeLabel: null,
        source: "sales_call_candidate",
        sourceRef: null,
        idempotencyKey: `call_new_inquiry:${quoteRecord.requestId}`,
        payload: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      },
    ],
  });

  assert.equal(runtime.cadence.currentStage, "quote_call");
  assert.equal(runtime.cadence.nextCallAction, "call_stage_2");
  assert.ok(runtime.sourceKeys.includes("due_followups"));
  assert.equal(runtime.activeTasks.length, 0);
});

test("advanceCadenceStateFromResult sends not-reached cases into retry bucket with next follow-up", () => {
  const record = buildRecord();
  const current = deriveCadenceState(record, null, null);
  const result = {
    id: "r1",
    callListItemId: "i1",
    rankAtTime: 1,
    requestId: record.requestId,
    acDealId: 12345,
    preset: "not-reached" as const,
    callDone: "yes" as const,
    callOutcome: "not_reached" as const,
    nextStep: "callback_2026-05-22",
    validationUseful: "yes" as const,
    notes: "Nicht erreicht, neuer Versuch für morgen geplant.",
    operatorId: "Daniel",
    source: "test",
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
  };

  const next = advanceCadenceStateFromResult(current, result, {
    priorityTier: null,
    priorityReason: null,
    purchaseSignal: null,
    postReminderDecision: null,
  });

  assert.equal(next.queueBucket, "not_reached");
  assert.equal(next.nextCallAction, "retry_next_day");
  assert.equal(next.cadenceFinished, false);
});

test("advanceCadenceStateFromResult promotes VIP purchase signals into manual follow-up", () => {
  const record = buildRecord();
  const current = deriveCadenceState(record, null, null);
  const result = {
    id: "r2",
    callListItemId: "i2",
    rankAtTime: 2,
    requestId: record.requestId,
    acDealId: 12345,
    preset: "interested" as const,
    callDone: "yes" as const,
    callOutcome: "reached_interested" as const,
    nextStep: "send_adjusted_offer",
    validationUseful: "yes" as const,
    notes: "Will kaufen, braucht nur noch eine kurze Abstimmung zur Farbe.",
    operatorId: "Daniel",
    source: "test",
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
  };

  const next = advanceCadenceStateFromResult(current, result, {
    priorityTier: "vip",
    priorityReason: "Klares Kaufsignal und hoher Warenwert.",
    purchaseSignal: true,
    postReminderDecision: null,
  });

  assert.equal(next.priorityTier, "vip");
  assert.equal(next.currentStage, "manual_followup");
  assert.equal(next.queueBucket, "manual_followup");
  assert.equal(next.cadenceFinished, true);
});

test("advanceCadenceStateFromResult routes needs-time and price objections into the right queues", () => {
  const record = buildRecord();
  const current = deriveCadenceState(record, null, null);
  const needsTime = advanceCadenceStateFromResult(
    current,
    {
      id: "r_needs_time",
      callListItemId: "i_needs_time",
      rankAtTime: 1,
      requestId: record.requestId,
      acDealId: 12345,
      preset: "needs-time",
      callDone: "yes",
      callOutcome: "reached_needs_time",
      nextStep: `callback_${isoDateFromNow(4)}`,
      validationUseful: "yes",
      notes: "Kunde braucht intern noch Freigabe, erneuter Anruf naechste Woche sinnvoll.",
      operatorId: "Daniel",
      source: "test",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:00:00.000Z",
    },
    {
      priorityTier: null,
      priorityReason: null,
      purchaseSignal: null,
      postReminderDecision: null,
    },
  );

  assert.equal(needsTime.currentStage, "callback");
  assert.equal(needsTime.nextCallAction, "await_callback");
  assert.equal(needsTime.cadenceFinished, false);

  const priceReview = advanceCadenceStateFromResult(
    current,
    {
      id: "r_price",
      callListItemId: "i_price",
      rankAtTime: 1,
      requestId: record.requestId,
      acDealId: 12345,
      preset: "wants-lower-price",
      callDone: "yes",
      callOutcome: "reached_price_objection",
      nextStep: "price_review",
      validationUseful: "yes",
      notes: "Kunde findet das Angebot zu teuer und will eine guenstigere Variante pruefen.",
      operatorId: "Daniel",
      source: "test",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:00:00.000Z",
    },
    {
      priorityTier: null,
      priorityReason: null,
      purchaseSignal: null,
      postReminderDecision: null,
    },
  );

  assert.equal(priceReview.currentStage, "offer_adjustment");
  assert.equal(priceReview.nextCallAction, "price_review");
  assert.equal(priceReview.queueBucket, "offer_adjustment");
});

test("advanceCadenceStateFromResult routes reminder call follow-up into manual bucket when requested", () => {
  const record = buildRecord({
    quote: {
      status: "sent",
      totalValue: 1200,
      currency: "EUR",
      shareLink: null,
      editLink: null,
      sentAt: "2026-05-17T09:00:00.000Z",
      viewedAt: null,
      signedAt: null,
      whatsappSentAt: null,
    },
  });
  const current = {
    ...deriveCadenceState(record, null, null),
    currentStage: "no_response_call" as const,
    standardCallCount: 2,
    cadenceFinished: false,
  };
  const result = {
    id: "r3",
    callListItemId: "i3",
    rankAtTime: 3,
    requestId: record.requestId,
    acDealId: 12345,
    preset: "not-reached" as const,
    callDone: "yes" as const,
    callOutcome: "not_reached" as const,
    nextStep: "callback_2026-05-22",
    validationUseful: "yes" as const,
    notes: "Dritter Versuch ohne Erfolg, Fall soll manuell weiter verfolgt werden.",
    operatorId: "Daniel",
    source: "test",
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
  };

  const next = advanceCadenceStateFromResult(current, result, {
    priorityTier: null,
    priorityReason: null,
    purchaseSignal: null,
    postReminderDecision: "manual_followup",
  });

  assert.equal(next.currentStage, "manual_followup");
  assert.equal(next.queueBucket, "manual_followup");
  assert.equal(next.cadenceFinished, true);
});

test("advanceCadenceStateFromResult routes reminder review into finished bucket when requested", () => {
  const record = buildRecord({
    quote: {
      status: "sent",
      totalValue: 1200,
      currency: "EUR",
      shareLink: null,
      editLink: null,
      sentAt: "2026-05-17T09:00:00.000Z",
      viewedAt: null,
      signedAt: null,
      whatsappSentAt: null,
    },
  });
  const current = {
    ...deriveCadenceState(record, null, null),
    currentStage: "no_response_call" as const,
    standardCallCount: 2,
    cadenceFinished: false,
  };
  const result = {
    id: "r4",
    callListItemId: "i4",
    rankAtTime: 4,
    requestId: record.requestId,
    acDealId: 12345,
    preset: "review-useful" as const,
    callDone: "no" as const,
    callOutcome: "" as const,
    nextStep: "wait",
    validationUseful: "yes" as const,
    notes: "Dritter Call bewertet, danach soll die Standardstrecke enden.",
    operatorId: "Daniel",
    source: "test",
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
  };

  const next = advanceCadenceStateFromResult(current, result, {
    priorityTier: null,
    priorityReason: null,
    purchaseSignal: null,
    postReminderDecision: "finished",
  });

  assert.equal(next.currentStage, "finished");
  assert.equal(next.queueBucket, "finished");
  assert.equal(next.cadenceFinished, true);
});

test("buildSalesTaskFromCadence creates persistent call and callback tasks", () => {
  const record = buildRecord();
  const inquiry = deriveCadenceState(record, null, null);
  const inquiryTask = buildSalesTaskFromCadence(inquiry, "sales_call_candidate");

  assert.equal(inquiryTask?.taskType, "call_new_inquiry");
  assert.equal(inquiryTask?.idempotencyKey, `call_new_inquiry:${record.requestId}`);

  const callbackResult = {
    id: "callback_result",
    callListItemId: "item_1",
    rankAtTime: 1,
    requestId: record.requestId,
    acDealId: 12345,
    preset: "needs-time" as const,
    callDone: "yes" as const,
    callOutcome: "reached_needs_time" as const,
    nextStep: `callback_${isoDateFromNow(14)}`,
    validationUseful: "yes" as const,
    notes: "Kunde braucht intern noch Zeit und möchte in zwei Wochen wieder angerufen werden.",
    operatorId: "Daniel",
    source: "test",
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
  };
  const callback = advanceCadenceStateFromResult(inquiry, callbackResult, {
    priorityTier: null,
    priorityReason: null,
    purchaseSignal: null,
    postReminderDecision: null,
  });
  const callbackTask = buildSalesTaskFromCadence(callback, "sales_call_result", callbackResult.id);

  assert.equal(callbackTask?.taskType, "callback_scheduled");
  assert.equal(callbackTask?.status, "waiting");
  assert.equal(callbackTask?.sourceRef, "callback_result");
});

test("isActiveSalesTaskVisibleNow keeps open and due tasks visible but hides future waiting tasks", () => {
  assert.equal(isActiveSalesTaskVisibleNow({ status: "open", dueAt: null }), true);
  assert.equal(isActiveSalesTaskVisibleNow({ status: "blocked", dueAt: null }), true);
  assert.equal(isActiveSalesTaskVisibleNow({ status: "waiting", dueAt: isoDateTimeFromNow(-1) }), true);
  assert.equal(isActiveSalesTaskVisibleNow({ status: "waiting", dueAt: isoDateTimeFromNow(7) }), false);
  assert.equal(isActiveSalesTaskVisibleNow({ status: "done", dueAt: isoDateTimeFromNow(-1) }), false);
});

test("advanceCadenceStateFromResult closes task creation for won and do-not-call outcomes", () => {
  const record = buildRecord();
  const current = deriveCadenceState(record, null, null);
  const bought = advanceCadenceStateFromResult(
    current,
    {
      id: "won_result",
      callListItemId: "item_1",
      rankAtTime: 1,
      requestId: record.requestId,
      acDealId: 12345,
      preset: "bought",
      callDone: "yes",
      callOutcome: "reached_bought",
      nextStep: "close_won",
      validationUseful: "yes",
      notes: "Kunde bestätigt den Auftrag, weitere Sales-Calls sind nicht mehr nötig.",
      operatorId: "Daniel",
      source: "test",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:00:00.000Z",
    },
    {
      priorityTier: null,
      priorityReason: null,
      purchaseSignal: null,
      postReminderDecision: null,
    },
  );

  assert.equal(bought.currentStage, "finished");
  assert.equal(bought.nextCallAction, "closed_won");
  assert.equal(buildSalesTaskFromCadence(bought, "sales_call_result", "won_result"), null);

  const doNotCall = advanceCadenceStateFromResult(
    current,
    {
      id: "stop_result",
      callListItemId: "item_1",
      rankAtTime: 1,
      requestId: record.requestId,
      acDealId: 12345,
      preset: "do-not-call",
      callDone: "yes",
      callOutcome: "do_not_call_requested",
      nextStep: "do_not_contact",
      validationUseful: "yes",
      notes: "Kontakt bittet darum, keine weiteren Anrufe zu erhalten.",
      operatorId: "Daniel",
      source: "test",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:00:00.000Z",
    },
    {
      priorityTier: null,
      priorityReason: null,
      purchaseSignal: null,
      postReminderDecision: null,
    },
  );

  assert.equal(doNotCall.currentStage, "finished");
  assert.equal(doNotCall.nextCallAction, "blocked_do_not_call");
  assert.equal(buildSalesTaskFromCadence(doNotCall, "sales_call_result", "stop_result"), null);
});

test("classifyInboundEmailSignal turns customer will-respond emails into waiting tasks", () => {
  const signal = classifyInboundEmailSignal({
    subject: "Re: Angebot",
    body: "Danke, wir melden uns nach interner Abstimmung wieder.",
  });

  assert.equal(signal?.kind, "customer_will_respond");

  const task = signal
    ? buildTaskFromInboundEmailSignal({
        requestId: "req_email_1",
        signal,
        sourceRef: "message_1",
        priorityTier: "important",
        preview: "Danke, wir melden uns nach interner Abstimmung wieder.",
      })
    : null;

  assert.equal(task?.taskType, "waiting_customer_response");
  assert.equal(task?.status, "waiting");
  assert.equal(task?.idempotencyKey, "email-waiting:req_email_1:message_1");
  assert.equal(task?.priorityTier, "important");
});

test("addBusinessDaysIso moves weekend follow-ups to Monday", () => {
  const saturday = addBusinessDaysIso(1, new Date("2026-05-29T12:00:00.000Z"));
  const sunday = addBusinessDaysIso(2, new Date("2026-05-29T12:00:00.000Z"));
  const monday = addBusinessDaysIso(3, new Date("2026-05-29T12:00:00.000Z"));

  assert.equal(saturday.slice(0, 10), "2026-06-01");
  assert.equal(sunday.slice(0, 10), "2026-06-01");
  assert.equal(monday.slice(0, 10), "2026-06-01");
});

test("classifyInboundEmailSignal routes price and update emails into action tasks", () => {
  const priceSignal = classifyInboundEmailSignal({
    body: "Das ist uns leider zu teuer. Gibt es einen Rabatt?",
  });
  const updateSignal = classifyInboundEmailSignal({
    body: "Gibt es schon ein Update zum Mockup?",
  });

  assert.equal(priceSignal?.kind, "price_objection");
  assert.equal(updateSignal?.kind, "wants_update");

  assert.equal(
    priceSignal
      ? buildTaskFromInboundEmailSignal({
          requestId: "req_price",
          signal: priceSignal,
          sourceRef: "message_price",
        }).taskType
      : null,
    "price_review",
  );
  assert.equal(
    updateSignal
      ? buildTaskFromInboundEmailSignal({
          requestId: "req_update",
          signal: updateSignal,
          sourceRef: "message_update",
        }).taskType
      : null,
    "send_update",
  );
});

test("buildSalesCallVisualCandidates snapshots ordered follow-up mockups before Trello and CRM images", () => {
  const record = buildRecord({
    followupMockups: [
      {
        url: "https://trelloimages.s3.eu-central-1.amazonaws.com/req-Mockup02.jpg",
        label: "Mockup 2",
        followupId: "followup_1",
        followupNumber: 2,
        status: "sent",
        scheduledFor: null,
        sentAt: null,
      },
      {
        url: "https://trelloimages.s3.eu-central-1.amazonaws.com/req-Mockup01.jpg",
        label: "Mockup 1",
        followupId: "followup_1",
        followupNumber: 2,
        status: "sent",
        scheduledFor: null,
        sentAt: null,
      },
    ],
    crmQuote: {
      id: "quote_1",
      quoteNumber: "Q-1",
      status: "sent",
      validUntil: null,
      sentAt: null,
      viewedAt: null,
      acceptedAt: null,
      rejectedAt: null,
      createdAt: null,
      updatedAt: null,
      totalGross: 1200,
      customerLiveTotal: null,
      lastCustomerEventType: null,
      lastCustomerEventAt: null,
      notesInternal: null,
      notesCustomer: null,
      projectNumber: null,
      contactEmail: null,
      contactPhone: null,
      shopifySyncStatus: null,
      easybillSyncStatus: null,
      easybillInvoiceNumber: null,
      versions: [],
      latestVersionImages: [
        {
          id: "image_1",
          versionId: "version_1",
          itemIndex: 0,
          imageIndex: 0,
          url: "https://crm.example.com/live.webp",
          copyStatus: "copied",
        },
      ],
    },
    trello: {
      cards: [],
      referenceImage: {
        attachmentId: "ref_1",
        cardId: "card_1",
        cardName: "Card",
        cardUrl: "https://trello.example.com/card",
        boardName: "Design",
        boardKey: "design",
        name: "referenz.jpg",
        mimeType: "image/jpeg",
        kind: "reference",
        proxyUrl: "https://trello.example.com/ref.jpg",
      },
      mockups: [
        {
          attachmentId: "mock_3",
          cardId: "card_1",
          cardName: "Card",
          cardUrl: "https://trello.example.com/card",
          boardName: "Design",
          boardKey: "design",
          name: "MOC ab 03.jpg",
          mimeType: "image/png",
          kind: "mockup",
          proxyUrl: "https://trello.example.com/mockup03.png",
        },
        {
          attachmentId: "mock_1",
          cardId: "card_1",
          cardName: "Card",
          cardUrl: "https://trello.example.com/card",
          boardName: "Design",
          boardKey: "design",
          name: "MOC ab 01.jpg",
          mimeType: "image/png",
          kind: "mockup",
          proxyUrl: "https://trello.example.com/mockup01.png",
        },
      ],
      videoLinks: [],
      editableCards: [],
    },
  });

  const candidates = buildSalesCallVisualCandidates(record);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.source, candidate.url]),
    [
      ["followup_mockup", "https://trelloimages.s3.eu-central-1.amazonaws.com/req-Mockup01.jpg"],
      ["followup_mockup", "https://trelloimages.s3.eu-central-1.amazonaws.com/req-Mockup02.jpg"],
      ["trello_mockup", "https://trello.example.com/mockup01.png"],
      ["trello_mockup", "https://trello.example.com/mockup03.png"],
      ["crm_quote_image", "https://crm.example.com/live.webp"],
      ["trello_reference", "https://trello.example.com/ref.jpg"],
    ],
  );
});
