"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Mail,
  Phone,
  RefreshCcw,
  Search,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import type {
  SalesCallPostReminderDecision,
  SalesCallPriorityTier,
  SalesCallQueueBucket,
  SalesCallListItem,
  SalesCallModuleState,
  SalesCallPreset,
  SalesCallProcessedTodayItem,
  SalesCallResultEntry,
  SalesCallVisualCandidate,
} from "@/lib/ops/customer-call-module";
import type { SalesTask } from "@/lib/ops/sales-task-engine";
import type { CustomerSearchResult, CustomerWorkboardSection } from "@/lib/ops/customer-records";
import { CUSTOMER_SEGMENT_OPTIONS, getCustomerSegmentOption } from "@/lib/ops/customer-segments";
import { OpsLoginCard } from "../../ops-login-card";
import { OpsAppSwitcher } from "../../ops-app-switcher";

type SalesCallApiResponse = {
  ok: boolean;
  state?: SalesCallModuleState;
  action?: string;
  error?: string;
  issues?: string[];
  gate?: SalesCallModuleState["gate"];
  completion?: SalesCallModuleState["completion"];
  record?: SalesCallListItem["record"];
  result?: SalesCallListItem["latestResult"];
};

type CustomerRecordsSearchResponse = {
  ok: boolean;
  results?: CustomerSearchResult[];
  error?: string;
  issues?: string[];
};

const presetOptions: Array<{
  key: SalesCallPreset;
  label: string;
  helper: string;
}> = [
  { key: "interested", label: "Interessiert", helper: "Konkrete Frage, Blocker oder nächster Bearbeitungsschritt." },
  { key: "needs-adjustment", label: "Anpassung nötig", helper: "Angebot bleibt relevant, muss aber angepasst werden." },
  { key: "needs-time", label: "Braucht noch Zeit", helper: "Kunde ist nicht raus, Wiedervorlage mit Datum." },
  { key: "wants-lower-price", label: "Günstigerer Preis", helper: "Preis-Einwand, Angebot oder Rabatt prüfen." },
  { key: "wants-offer", label: "Will Angebot", helper: "Kunde möchte ein Angebot oder neues Angebot erhalten." },
  { key: "wants-update", label: "Will Update", helper: "Kunde wartet auf Status, Mockup oder Angebotsupdate." },
  { key: "callback", label: "Rückruf vereinbart", helper: "Erreicht, mit festem Rückrufdatum." },
  { key: "not-reached", label: "Nicht erreicht", helper: "Nicht erreicht, nächster Versuch mit Datum." },
  { key: "bought", label: "Kauft / Auftrag", helper: "Call-Strecke beenden, weil der Fall gewonnen ist." },
  { key: "do-not-call", label: "Nicht mehr anrufen", helper: "Kontaktstopp für Calls: keine weiteren Anrufe." },
  { key: "not-interested", label: "Kein Interesse", helper: "Erreicht, aber aktuell kein Bedarf mehr." },
  { key: "wrong-number", label: "Falsche Nummer", helper: "Nummer passt nicht zum Fall." },
  { key: "review-useful", label: "Review sinnvoll", helper: "Nur fachlich geprüft, für die Liste relevant." },
  { key: "review-not-useful", label: "Review nicht sinnvoll", helper: "Nur fachlich geprüft, nicht listenrelevant." },
];

const bucketLabels: Record<"all" | SalesCallQueueBucket, string> = {
  all: "Alle",
  due_today: "Heute fällig",
  vip_today: "VIP heute",
  not_reached: "Nicht erreicht",
  callbacks: "Rückrufe",
  manual_followup: "Manuell weiterführen",
  offer_adjustment: "Angebot anpassen",
  data_issue: "Datenproblem",
  finished: "Beendet",
};

const priorityLabels: Record<SalesCallPriorityTier, string> = {
  standard: "Standard",
  important: "Wichtig",
  vip: "VIP",
};

type WorkTabKey = "new_inquiries" | "first_quotes" | "my_calls";
type WorkFilterKey = "all" | "priority" | "overdue" | "with_visuals" | "needs_segment";

const workTabs: Array<{
  key: WorkTabKey;
  title: string;
  helper: string;
}> = [
  {
    key: "new_inquiries",
    title: "Neue Anfragen",
    helper: "Ohne Angebot, erster Kontakt nach Anfrage.",
  },
  {
    key: "first_quotes",
    title: "Erste Angebote gesendet",
    helper: "Angebot raus, warmes Nachfassen.",
  },
  {
    key: "my_calls",
    title: "Fällige Anrufe",
    helper: "Rückrufe, Reminder, überfällige und manuelle Aufgaben.",
  },
];

const workFilters: Array<{ key: WorkFilterKey; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "priority", label: "VIP / wichtig" },
  { key: "overdue", label: "Überfällig" },
  { key: "with_visuals", label: "Mit Bild" },
  { key: "needs_segment", label: "Segment offen" },
];

const followupBuckets: SalesCallQueueBucket[] = [
  "callbacks",
  "manual_followup",
  "offer_adjustment",
  "data_issue",
  "finished",
];

const postReminderOptions: Array<{ value: SalesCallPostReminderDecision; label: string; helper: string }> = [
  {
    value: "manual_followup",
    label: "Manuell weiterführen",
    helper: "Der Fall bleibt nach Call 3 als manuelle Nachverfolgung offen.",
  },
  {
    value: "offer_adjustment",
    label: "Angebot anpassen",
    helper: "Es braucht nach dem dritten Anruf eine Angebots- oder Vertriebsanpassung.",
  },
  {
    value: "finished",
    label: "Standardstrecke beenden",
    helper: "Nach dem dritten Anruf soll kein weiterer Standard-Follow-up-Call laufen.",
  },
];

function formatSegmentConfidence(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function getSegmentStatusLabel(status: string | null | undefined) {
  switch (String(status || "").trim().toLowerCase()) {
    case "accepted":
      return "bestätigt";
    case "needs_review":
      return "prüfen";
    case "classified":
      return "KI-Vorschlag";
    default:
      return status || null;
  }
}

function getSegmentLabel(item: SalesCallListItem) {
  const request = item.record.request;
  if (!request) return "Nicht segmentiert";
  return request.segmentLabel || getCustomerSegmentOption(request.segment)?.label || request.segment || request.sKategorie || "Nicht segmentiert";
}

function getSegmentDetail(item: SalesCallListItem) {
  const request = item.record.request;
  if (!request) return "Kein Segment im Request";
  const parts = [
    request.segment ? request.segment : null,
    getSegmentStatusLabel(request.segmentStatus),
    formatSegmentConfidence(request.segmentConfidence),
  ].filter(Boolean);
  return parts.length ? parts.join(" • ") : "Segment noch nicht bestätigt";
}

function needsSegmentConfirmation(item: SalesCallListItem) {
  const status = item.record.request?.segmentStatus?.trim().toLowerCase();
  return !item.record.request?.segment || status === "needs_review" || status === "classified" || status === "pending";
}

function segmentTone(item: SalesCallListItem) {
  return needsSegmentConfirmation(item)
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function tomorrowDate() {
  const base = new Date();
  base.setDate(base.getDate() + 1);
  return base.toISOString().slice(0, 10);
}

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function gateTone(gate: SalesCallModuleState["gate"]["gate"]) {
  switch (gate) {
    case "green":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "yellow":
      return "text-amber-700 bg-amber-50 border-amber-200";
    case "red":
    case "invalid":
      return "text-rose-700 bg-rose-50 border-rose-200";
    default:
      return "text-slate-700 bg-slate-50 border-slate-200";
  }
}

function completionTone(complete: boolean) {
  return complete
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : "text-slate-700 bg-slate-50 border-slate-200";
}

function gateLabel(gate: SalesCallModuleState["gate"]["gate"] | null | undefined) {
  switch (gate) {
    case "green":
      return "Gut";
    case "yellow":
      return "Prüfen";
    case "red":
      return "Kritisch";
    case "invalid":
      return "Fehler";
    case "incomplete":
      return "Offen";
    default:
      return "…";
  }
}

function completionLabel(complete: boolean | null | undefined) {
  if (complete === undefined || complete === null) return "…";
  return complete ? "Vollständig" : "Offen";
}

function completionReasonLabel(reason: string | null | undefined) {
  switch (reason) {
    case "storage unavailable":
      return "Speicherung ist noch nicht aktiv.";
    case "not enough reviewed":
      return "Es sind noch nicht genug Fälle geprüft.";
    case "too few concrete next steps":
      return "Es fehlen konkrete nächste Schritte.";
    case "low useful rate":
      return "Die geprüften Fälle liefern zu wenig nutzbare Ergebnisse.";
    case "learning signal not stable":
      return "Die Notizen reichen noch nicht für ein stabiles Muster.";
    case "complete":
      return "Die Liste ist für heute ausreichend geprüft.";
    default:
      return reason || "Lade Status …";
  }
}

function stageLabel(item: SalesCallListItem) {
  switch (item.cadence.currentStage) {
    case "inquiry_call":
      return "Call 1 nach Anfrage";
    case "quote_call":
      return "Call 2 nach Angebot";
    case "no_response_call":
      return "Call 3 bei fehlender Reaktion";
    case "callback":
      return "Rückruf";
    case "manual_followup":
      return "Manuell weiterführen";
    case "offer_adjustment":
      return "Angebot anpassen";
    case "data_issue":
      return "Datenproblem";
    case "finished":
      return "Strecke beendet";
  }
}

function needsPostReminderDecision(item: SalesCallListItem | null, preset: SalesCallPreset) {
  if (!item || item.cadence.currentStage !== "no_response_call") return false;
  return ![
    "callback",
    "interested",
    "needs-adjustment",
    "needs-time",
    "wants-lower-price",
    "wants-offer",
    "wants-update",
    "bought",
    "do-not-call",
    "not-interested",
    "wrong-number",
  ].includes(preset);
}

function formatMoney(value: number | null | undefined, currency = "EUR") {
  if (value === null || value === undefined || Number.isNaN(value)) return "Kein Warenwert";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function parseSearchNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSearchPhone(value: string | null | undefined) {
  const normalized = String(value || "").replace(/[^\d+]/g, "");
  return normalized || null;
}

function phoneQualityFromRecord(record: CustomerSearchResult): SalesCallListItem["phoneQuality"] {
  const normalized = normalizeSearchPhone(record.phone || record.originalPhone);
  if (!normalized) return "missing";
  return normalized.replace(/\D/g, "").length < 7 ? "weak" : "ok";
}

function deriveSearchDealValue(record: CustomerSearchResult) {
  return parseSearchNumber(
    record.crmQuote?.customerLiveTotal ??
      record.crmQuote?.totalGross ??
      record.quote?.totalValue ??
      record.request?.finalValue ??
      record.request?.estimatedValue ??
      record.crmSales[0]?.totalPrice ??
      null,
  );
}

function getRecordQuoteSentAt(record: CustomerSearchResult) {
  return record.quote?.sentAt || record.crmQuote?.sentAt || null;
}

function getRecordQuoteViewedAt(record: CustomerSearchResult) {
  return record.quote?.viewedAt || record.crmQuote?.viewedAt || null;
}

function getRecordQuoteStatus(record: CustomerSearchResult) {
  return record.quote?.status || record.crmQuote?.status || null;
}

function daysSinceDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
}

function hoursSinceDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / (60 * 60 * 1000)));
}

function deriveSearchSourceKeys(record: CustomerSearchResult): CustomerWorkboardSection["key"][] {
  const sourceKeys: CustomerWorkboardSection["key"][] = [];
  if (record.callOps.nextCallbackAt || record.salesRecovery.nextCallbackAt) sourceKeys.push("callbacks");
  if (record.affectedRows.pendingFollowups > 0 || record.affectedRows.nextPendingFollowupAt) sourceKeys.push("due_followups");
  if (record.salesRecovery.status === "active" || getRecordQuoteViewedAt(record) || getRecordQuoteSentAt(record)) sourceKeys.push("sales_recovery");
  return [...new Set(sourceKeys)];
}

function buildAdHocCallItem(record: CustomerSearchResult): SalesCallListItem {
  const dealValueEur = deriveSearchDealValue(record);
  const phoneQuality = phoneQualityFromRecord(record);
  const sourceKeys = deriveSearchSourceKeys(record);
  const blockedReason =
    record.opsState.status === "do_not_contact" || record.callOps.contactabilityStatus === "do_not_contact"
      ? "Kontaktstopp aktiv"
      : record.opsState.isClosed || Boolean(record.order)
        ? "Fall bereits abgeschlossen"
        : phoneQuality === "missing"
          ? "Keine Telefonnummer"
          : null;
  const priorityTier: SalesCallPriorityTier =
    dealValueEur >= 2500 || getRecordQuoteViewedAt(record) ? "vip" : dealValueEur >= 1000 || record.salesRecovery.status === "active" ? "important" : "standard";
  const sentAt = getRecordQuoteSentAt(record);
  const viewedAt = getRecordQuoteViewedAt(record);
  const currentStage: SalesCallListItem["cadence"]["currentStage"] = sentAt
    ? (daysSinceDate(sentAt) ?? 0) >= 3
      ? "no_response_call"
      : "quote_call"
    : "inquiry_call";
  const priorityReason =
    viewedAt
      ? "Suchtreffer: Angebot angesehen."
      : dealValueEur >= 1000
        ? "Suchtreffer: hoher Warenwert."
        : "Manuell gesuchter Fall außerhalb der Tagesliste.";
  const dueAt = record.callOps.nextCallbackAt || record.salesRecovery.nextCallbackAt || record.affectedRows.nextPendingFollowupAt || null;

  return {
    id: null,
    runId: null,
    rank: 0,
    requestId: record.requestId,
    acDealId: record.request?.acDealId ?? null,
    priorityGroup: "ad_hoc_search",
    priorityScore: dealValueEur,
    recommendedAction: "call_ad_hoc_search_result",
    dealValueEur,
    reasons: [priorityReason],
    contextPreview: [getRecordQuoteStatus(record) ? `Angebotsstatus: ${getRecordQuoteStatus(record)}` : null, record.request?.acDealStage ? `AC-Phase: ${record.request.acDealStage}` : null]
      .filter(Boolean)
      .join(" • "),
    phoneRaw: record.phone || record.originalPhone || null,
    phoneNormalized: normalizeSearchPhone(record.phone || record.originalPhone),
    phoneQuality,
    email: record.email || null,
    contactName: record.displayName || [record.firstName, record.lastName].filter(Boolean).join(" ") || null,
    companyName: record.company || record.request?.title || null,
    daysSinceSent: daysSinceDate(sentAt),
    hoursSinceView: hoursSinceDate(viewedAt),
    pandadocStatus: getRecordQuoteStatus(record),
    acLiveDecision: record.request?.dealStatus || null,
    acLiveStatus: record.request?.status || null,
    acLiveStage: record.request?.acDealStage || null,
    blockedReason,
    guard: {
      allowed: !blockedReason,
      blockedReason,
      attentionReasons: blockedReason ? [blockedReason] : ["Manuell aus der Suche geöffnet."],
      notBefore: null,
      phoneQuality,
    },
    sourceKeys,
    visualCandidates: [],
    topTen: false,
    record,
    latestResult: null,
    cadence: {
      requestId: record.requestId,
      currentStage: blockedReason === "Keine Telefonnummer" ? "data_issue" : blockedReason ? "finished" : currentStage,
      nextCallDueAt: dueAt,
      call1DueAt: record.request?.createdAt || null,
      call2DueAt: sentAt,
      call3DueAt: sentAt,
      call1CompletedAt: null,
      call2CompletedAt: null,
      call3CompletedAt: null,
      standardCallCount: 0,
      retryCount: 0,
      cadenceFinished: Boolean(blockedReason && blockedReason !== "Keine Telefonnummer"),
      blocked: Boolean(blockedReason),
      blockingReason: blockedReason,
      pendingCallbackAt: record.callOps.nextCallbackAt || record.salesRecovery.nextCallbackAt || null,
      lastResultPreset: null,
      nextCallAction: blockedReason ? "blocked_wrong_number" : currentStage === "no_response_call" ? "call_stage_3" : currentStage === "quote_call" ? "call_stage_2" : "call_stage_1",
      queueBucket: record.callOps.nextCallbackAt || record.salesRecovery.nextCallbackAt ? "callbacks" : blockedReason === "Keine Telefonnummer" ? "data_issue" : "due_today",
      priorityTier,
      priorityReason,
      vipManual: false,
      purchaseSignal: false,
      updatedAt: null,
    },
  };
}

function getLiveRecordVisualCandidates(item: SalesCallListItem): SalesCallVisualCandidate[] {
  const sortedMockups = [...(item.record.trello?.mockups || [])].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();
    const score = (name: string) => {
      const normalized = name.toLowerCase();
      const match =
        normalized.match(/\bmoc\s*ab[\s_-]*(0?[123])(?:\D|$)/) ||
        normalized.match(/\bmockup[\s_-]*(0?[123])(?:\D|$)/);
      if (match?.[1]) return Number(match[1]) - 1;
      return 9;
    };
    const leftScore = score(leftName);
    const rightScore = score(rightName);
    if (leftScore !== rightScore) return leftScore - rightScore;
    return leftName.localeCompare(rightName);
  });
  const crmCandidates = (item.record.crmQuote?.latestVersionImages || [])
    .filter((image) => image.url)
    .map((image, index) => ({
      url: image.url as string,
      label: `Angebotsbild ${index + 1}`,
      source: "crm_quote_image" as const,
    }));
  const followupCandidates: SalesCallVisualCandidate[] = (item.record.followupMockups || []).map((image) => ({
    url: image.url,
    label: image.label,
    source: "followup_mockup" as const,
  }));
  const trelloCandidates: SalesCallVisualCandidate[] = sortedMockups.map((asset) => ({
    url: asset.proxyUrl,
    label: asset.name,
    source: "trello_mockup" as const,
  }));
  if (item.record.trello?.referenceImage) {
    trelloCandidates.push({
      url: item.record.trello.referenceImage.proxyUrl,
      label: item.record.trello.referenceImage.name,
      source: "trello_reference" as const,
    });
  }
  return [...followupCandidates, ...trelloCandidates, ...crmCandidates];
}

function visualCandidateOrder(candidate: SalesCallVisualCandidate) {
  const sourceRank: Record<SalesCallVisualCandidate["source"], number> = {
    followup_mockup: 0,
    trello_mockup: 1,
    crm_quote_image: 2,
    trello_reference: 3,
  };
  const normalized = candidate.label.toLowerCase();
  const match =
    normalized.match(/\bmoc\s*ab[\s_-]*(0?[123])(?:\D|$)/) ||
    normalized.match(/\bmockup[\s_-]*(0?[123])(?:\D|$)/);
  const mockupOrder = match?.[1] ? Number(match[1]) - 1 : 9;
  return sourceRank[candidate.source] * 20 + mockupOrder;
}

function getCardVisualCandidates(item: SalesCallListItem) {
  const candidates = item.visualCandidates?.length ? item.visualCandidates : getLiveRecordVisualCandidates(item);
  return [...candidates].sort((left, right) => {
    const orderDiff = visualCandidateOrder(left) - visualCandidateOrder(right);
    if (orderDiff !== 0) return orderDiff;
    return left.label.localeCompare(right.label);
  });
}

function getCardVisual(item: SalesCallListItem) {
  return getCardVisualCandidates(item)[0] || null;
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "Kein Datum";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Kein Datum";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function formatDateTimeLabel(value: string | null | undefined) {
  if (!value) return "Kein Datum";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Kein Datum";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function callStatusLabel(item: SalesCallListItem) {
  const count = item.record.callOps.totalCallCount || 0;
  if (count > 0) {
    const date = item.record.callOps.latestLoggedCallAt ? formatDateLabel(item.record.callOps.latestLoggedCallAt) : null;
    return date ? `${count} Anruf${count === 1 ? "" : "e"} • zuletzt ${date}` : `${count} Anruf${count === 1 ? "" : "e"}`;
  }
  if (item.latestResult?.preset) return "Ergebnis im Modul gespeichert";
  return "Noch nicht angerufen";
}

function getNextCallName(item: SalesCallListItem) {
  switch (item.cadence.currentStage) {
    case "inquiry_call":
      return "Call 1";
    case "quote_call":
      return "Call 2";
    case "no_response_call":
      return "Call 3";
    case "callback":
      return "Rückruf";
    case "manual_followup":
      return "manuelle Nachverfolgung";
    case "offer_adjustment":
      return "Angebotsanpassung";
    case "data_issue":
      return "Datenprüfung";
    case "finished":
      return "beendet";
  }
}

function getCallOutcomeLabel(item: SalesCallListItem) {
  return getResultOutcomeLabel(item.latestResult?.preset || null);
}

function getResultOutcomeLabel(preset: SalesCallResultEntry["preset"] | null | undefined) {
  switch (preset) {
    case "not-reached":
      return "nicht erreicht";
    case "callback":
      return "Rückruf vereinbart";
    case "interested":
      return "interessiert";
    case "needs-adjustment":
      return "Anpassung nötig";
    case "needs-time":
      return "braucht noch Zeit";
    case "wants-lower-price":
      return "Preis-Einwand";
    case "wants-offer":
      return "will Angebot";
    case "wants-update":
      return "will Update";
    case "bought":
      return "kauft / Auftrag";
    case "do-not-call":
      return "keine weiteren Anrufe";
    case "not-interested":
      return "kein Interesse";
    case "wrong-number":
      return "falsche Nummer";
    case "review-useful":
      return "Review sinnvoll";
    case "review-not-useful":
      return "Review nicht sinnvoll";
    default:
      return null;
  }
}

function getCallStageSummary(item: SalesCallListItem) {
  const nextCallName = getNextCallName(item);
  const outcome = getCallOutcomeLabel(item);
  const missed: string[] = [];
  if ((item.cadence.currentStage === "quote_call" || item.cadence.currentStage === "no_response_call") && !item.cadence.call1CompletedAt) {
    missed.push("Call 1 nicht erledigt");
  }
  if (item.cadence.currentStage === "no_response_call" && !item.cadence.call2CompletedAt) {
    missed.push("Call 2 nicht erledigt");
  }
  if (item.cadence.cadenceFinished) {
    return outcome ? `Strecke beendet • zuletzt ${outcome}` : "Strecke beendet";
  }
  if (item.latestResult?.preset === "not-reached") {
    return `${item.cadence.standardCallCount}. Anruf nicht erreicht • jetzt ${nextCallName}`;
  }
  if (item.cadence.standardCallCount > 0) {
    return outcome
      ? `${item.cadence.standardCallCount}/3 erledigt • zuletzt ${outcome} • jetzt ${nextCallName}`
      : `${item.cadence.standardCallCount}/3 erledigt • jetzt ${nextCallName}`;
  }
  if (missed.length) return `${nextCallName} steht an • ${missed.join(" • ")}`;
  return `${nextCallName} steht an • noch kein Ergebnis`;
}

function getCallStageDetail(item: SalesCallListItem) {
  const due = item.cadence.nextCallDueAt ? `fällig ab ${item.cadence.nextCallDueAt.slice(0, 16).replace("T", " ")}` : null;
  const bucket = bucketLabels[item.cadence.queueBucket];
  return [bucket, due, item.cadence.priorityReason].filter(Boolean).join(" • ");
}

function taskStatusLabel(task: SalesTask) {
  switch (task.status) {
    case "open":
      return "offen";
    case "waiting":
      return "wartet";
    case "blocked":
      return "blockiert";
    case "done":
      return "erledigt";
    case "closed":
      return "geschlossen";
  }
}

function taskTone(task: SalesTask) {
  if (task.status === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  if (task.source === "inbound_email_signal") return "border-sky-200 bg-sky-50 text-sky-800";
  if (task.status === "waiting") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-stone-200 bg-stone-50 text-stone-800";
}

function getDesignStatus(item: SalesCallListItem) {
  const candidates = getCardVisualCandidates(item);
  if (candidates.length) {
    const crmCount = candidates.filter((candidate) => candidate.source === "crm_quote_image").length;
    const followupMockupCount = candidates.filter((candidate) => candidate.source === "followup_mockup").length;
    const mockupCount = candidates.filter((candidate) => candidate.source === "trello_mockup").length;
    const referenceCount = candidates.filter((candidate) => candidate.source === "trello_reference").length;
    if (followupMockupCount) return `${followupMockupCount} Follow-up-Mockup${followupMockupCount === 1 ? "" : "s"}`;
    if (mockupCount) return `${mockupCount} Mockup${mockupCount === 1 ? "" : "s"}`;
    if (crmCount) return `${crmCount} Angebotsbild${crmCount === 1 ? "" : "er"}`;
    if (referenceCount) return "Referenzbild";
  }
  if (item.record.followupMockups?.length) return `${item.record.followupMockups.length} Follow-up-Mockup${item.record.followupMockups.length === 1 ? "" : "s"}`;
  if (item.record.trello?.mockups.length) return `${item.record.trello.mockups.length} Mockup${item.record.trello.mockups.length === 1 ? "" : "s"}`;
  if (item.record.trello?.referenceImage) return "Referenzbild";
  if (item.record.crmQuote?.latestVersionImages.length) return `${item.record.crmQuote.latestVersionImages.length} Angebotsbild${item.record.crmQuote.latestVersionImages.length === 1 ? "" : "er"}`;
  return "Kein Designbild";
}

function getPriceSourceLabel(item: SalesCallListItem) {
  if (item.record.crmQuote?.customerLiveTotal !== null && item.record.crmQuote?.customerLiveTotal !== undefined) {
    return "Preis aus Live-Angebot";
  }
  if (item.record.crmQuote?.totalGross !== null && item.record.crmQuote?.totalGross !== undefined) {
    return "Preis aus Angebot";
  }
  if (item.record.quote?.totalValue !== null && item.record.quote?.totalValue !== undefined) {
    return "Preis aus Quote";
  }
  if (item.record.request?.finalValue !== null && item.record.request?.finalValue !== undefined) {
    return "Preis aus Fall";
  }
  if (item.record.request?.estimatedValue !== null && item.record.request?.estimatedValue !== undefined) {
    return "Preis aus Schätzung";
  }
  if (item.record.crmSales?.[0]?.totalPrice !== null && item.record.crmSales?.[0]?.totalPrice !== undefined) {
    return "Preis aus Auftrag";
  }
  return "Preisquelle fehlt";
}

function getSimpleCallStatus(item: SalesCallListItem) {
  return getCallStageSummary(item);
}

function stageTone(stage: SalesCallListItem["cadence"]["currentStage"]) {
  switch (stage) {
    case "inquiry_call":
      return "bg-sky-100 text-sky-700";
    case "quote_call":
      return "bg-amber-100 text-amber-800";
    case "no_response_call":
      return "bg-violet-100 text-violet-700";
    case "callback":
      return "bg-emerald-100 text-emerald-700";
    case "manual_followup":
      return "bg-stone-200 text-stone-800";
    case "offer_adjustment":
      return "bg-orange-100 text-orange-700";
    case "data_issue":
      return "bg-rose-100 text-rose-700";
    case "finished":
      return "bg-stone-200 text-stone-700";
  }
}

function priorityTone(tier: SalesCallPriorityTier) {
  switch (tier) {
    case "vip":
      return "bg-amber-400 text-stone-950";
    case "important":
      return "bg-stone-900 text-white";
    default:
      return "bg-stone-100 text-stone-700";
  }
}

function isPriorityItem(item: SalesCallListItem) {
  return (
    item.cadence.priorityTier === "vip" ||
    item.cadence.priorityTier === "important" ||
    item.cadence.purchaseSignal ||
    item.cadence.queueBucket === "vip_today" ||
    item.dealValueEur >= 1000 ||
    Boolean(getRecordQuoteViewedAt(item.record))
  );
}

function getPriorityReason(item: SalesCallListItem) {
  const visibleTask = getVisibleTask(item);
  if (visibleTask) return `Offene Aufgabe: ${visibleTask.title}`;
  if (item.cadence.priorityReason) return item.cadence.priorityReason;
  if (item.cadence.purchaseSignal) return "Kaufsignal im Gespräch";
  if (getRecordQuoteViewedAt(item.record)) return "Angebot angesehen";
  if (item.dealValueEur >= 1000) return "Hoher Warenwert";
  if (item.cadence.queueBucket === "callbacks") return "Rückruf fällig";
  return "Priorisiert";
}

function getVisibleTask(item: SalesCallListItem) {
  return (item.activeTasks || []).find((task) => {
    if (task.status === "open" || task.status === "blocked") return true;
    if (task.status !== "waiting" || !task.dueAt) return false;
    const due = new Date(task.dueAt).getTime();
    return Number.isFinite(due) && due <= Date.now();
  }) || null;
}

function isOverdue(item: SalesCallListItem) {
  const visibleTask = getVisibleTask(item);
  if (visibleTask?.dueAt) {
    const due = new Date(visibleTask.dueAt).getTime();
    if (Number.isFinite(due) && due < Date.now()) return true;
  }
  if (!item.cadence.nextCallDueAt) return false;
  const due = new Date(item.cadence.nextCallDueAt).getTime();
  return Number.isFinite(due) && due < Date.now();
}

function getWorkTabForItem(item: SalesCallListItem): WorkTabKey {
  if (item.cadence.currentStage === "inquiry_call") return "new_inquiries";
  if (item.cadence.currentStage === "quote_call") return "first_quotes";
  return "my_calls";
}

function tabAccentClasses(tab: WorkTabKey) {
  switch (tab) {
    case "new_inquiries":
      return "border-sky-300 bg-sky-100 text-sky-950";
    case "first_quotes":
      return "border-amber-300 bg-amber-100 text-amber-950";
    case "my_calls":
      return "border-violet-300 bg-violet-100 text-violet-950";
  }
}

function workCardTone(item: SalesCallListItem) {
  if (!item.guard.allowed) return "border-rose-200 bg-rose-50";
  if (item.cadence.priorityTier === "vip") return "border-amber-300 bg-amber-50";
  if (item.cadence.priorityTier === "important" || item.dealValueEur >= 1000) return "border-stone-300 bg-stone-50";
  switch (item.cadence.currentStage) {
    case "inquiry_call":
      return "border-sky-200 bg-sky-50/70";
    case "quote_call":
      return "border-amber-200 bg-amber-50/70";
    case "no_response_call":
      return "border-violet-200 bg-violet-50/70";
    case "callback":
      return "border-emerald-200 bg-emerald-50/70";
    case "offer_adjustment":
      return "border-orange-200 bg-orange-50/70";
    default:
      return "border-stone-200 bg-white";
  }
}

function matchesWorkFilter(item: SalesCallListItem, filter: WorkFilterKey) {
  switch (filter) {
    case "priority":
      return isPriorityItem(item);
    case "overdue":
      return isOverdue(item);
    case "with_visuals":
      return getCardVisualCandidates(item).length > 0;
    case "needs_segment":
      return needsSegmentConfirmation(item);
    default:
      return true;
  }
}

function CallVisual({
  item,
  className,
  imgClassName,
  emptyLabel,
}: {
  item: SalesCallListItem;
  className: string;
  imgClassName: string;
  emptyLabel: string;
}) {
  const candidates = useMemo(() => getCardVisualCandidates(item), [item]);
  const signature = candidates.map((candidate) => candidate.url).join("|");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [signature]);

  const candidate = candidates[index] || null;
  if (!candidate) {
    return (
      <div className={className}>
        <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs font-medium text-stone-500">
          {emptyLabel}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={candidate.url}
        alt={candidate.label}
        className={imgClassName}
        loading="lazy"
        onError={() => {
          setIndex((current) => (current + 1 < candidates.length ? current + 1 : candidates.length));
        }}
      />
    </div>
  );
}

function SegmentConfirmControl({
  item,
  running,
  onApply,
}: {
  item: SalesCallListItem;
  running: boolean;
  onApply: (segment: string) => Promise<void>;
}) {
  const currentSegment = getCustomerSegmentOption(item.record.request?.segment)?.segment || "";
  const [selectedSegment, setSelectedSegment] = useState(currentSegment);
  const selectedOption = getCustomerSegmentOption(selectedSegment);
  const needsReview = needsSegmentConfirmation(item);
  const changed = Boolean(selectedSegment && selectedSegment !== currentSegment);
  const canApply = Boolean(selectedSegment) && !running && (changed || needsReview);

  useEffect(() => {
    setSelectedSegment(currentSegment);
  }, [currentSegment]);

  return (
    <div className={`rounded-[1.6rem] border p-4 ${segmentTone(item)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-70">Segment</p>
          <p className="mt-1 text-base font-semibold">{getSegmentLabel(item)}</p>
          <p className="mt-1 text-xs leading-5 opacity-75">
            {needsReview ? "Bitte Segment für spätere Auswertung bestätigen oder ändern." : getSegmentDetail(item)}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <select
            value={selectedSegment}
            onChange={(event) => setSelectedSegment(event.target.value)}
            className="h-11 min-w-[230px] rounded-2xl border border-black/10 bg-white px-3 text-sm font-medium text-stone-950 outline-none transition focus:border-stone-900"
            aria-label="Segment auswählen"
          >
            <option value="">Segment wählen</option>
            {CUSTOMER_SEGMENT_OPTIONS.map((option) => (
              <option key={option.segment} value={option.segment}>
                {option.segment} · {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!canApply}
            onClick={() => selectedOption ? onApply(selectedOption.segment) : undefined}
            className="h-11 min-w-[118px] whitespace-nowrap rounded-2xl border border-stone-950 bg-stone-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-white disabled:text-stone-900 disabled:shadow-none"
          >
            {running ? "Speichert..." : changed ? "Speichern" : needsReview ? "Bestätigen" : "Bestätigt"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomerSalesCallsClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const sharedOperatorNameKey = "neontrip-ops-operator";
  const operatorNameKey = "neontrip-sales-calls-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [state, setState] = useState<SalesCallModuleState | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [preset, setPreset] = useState<SalesCallPreset>("interested");
  const [notes, setNotes] = useState("");
  const [callbackDate, setCallbackDate] = useState(tomorrowDate());
  const [priorityTier, setPriorityTier] = useState<SalesCallPriorityTier>("standard");
  const [priorityReason, setPriorityReason] = useState("");
  const [purchaseSignal, setPurchaseSignal] = useState(false);
  const [postReminderDecision, setPostReminderDecision] = useState<SalesCallPostReminderDecision | "">("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [segmentSaving, setSegmentSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkTabKey>("new_inquiries");
  const [activeFilter, setActiveFilter] = useState<WorkFilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasRun, setSearchHasRun] = useState(false);
  const [adHocItem, setAdHocItem] = useState<SalesCallListItem | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const query = (params.get("q") || params.get("query") || "").trim();
      if (query.length >= 2) {
        setSearchQuery(query);
        void runSearchFor(query);
      }
    } catch {
      // ignore malformed browser URLs
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(sharedOperatorNameKey) || window.localStorage.getItem(operatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // ignore local storage issues
    }
  }, []);

  useEffect(() => {
    if (operatorName) {
      window.localStorage.setItem(sharedOperatorNameKey, operatorName);
      window.localStorage.setItem(operatorNameKey, operatorName);
    }
  }, [operatorName]);

  useEffect(() => {
    if ((!opsEnabled || hasSession || localMode) && !state && !loading) {
      void loadState();
    }
  }, [hasSession, localMode, opsEnabled, state, loading]);

  useEffect(() => {
    if (!selectedItemId || !state?.items.length) return;
    if (adHocItem && selectedItemId === `ad-hoc:${adHocItem.requestId}`) return;
    if (state.items.some((item) => (item.id || item.requestId) === selectedItemId)) return;
    setSelectedItemId(null);
    setDetailOpen(false);
  }, [adHocItem, state, selectedItemId]);

  useEffect(() => {
    if ((preset === "callback" || preset === "not-reached" || preset === "needs-time") && !callbackDate) {
      setCallbackDate(tomorrowDate());
    }
  }, [preset, callbackDate]);

  const selectedItem = useMemo(() => {
    if (adHocItem && selectedItemId === `ad-hoc:${adHocItem.requestId}`) return adHocItem;
    return state?.items.find((item) => (item.id || item.requestId) === selectedItemId) || null;
  }, [adHocItem, state, selectedItemId]);

  const secondaryBucketItems = useMemo(() => {
    const grouped: Record<SalesCallQueueBucket, SalesCallListItem[]> = {
      due_today: [],
      vip_today: [],
      not_reached: [],
      callbacks: [],
      manual_followup: [],
      offer_adjustment: [],
      data_issue: [],
      finished: [],
    };
    for (const item of state?.items || []) {
      grouped[item.cadence.queueBucket].push(item);
    }
    return grouped;
  }, [state]);

  const tabItems = useMemo(() => {
    const grouped: Record<WorkTabKey, SalesCallListItem[]> = {
      new_inquiries: [],
      first_quotes: [],
      my_calls: [],
    };
    for (const item of state?.items || []) {
      grouped[getWorkTabForItem(item)].push(item);
    }
    return grouped;
  }, [state]);

  const priorityItems = useMemo(
    () =>
      (state?.items || [])
        .filter((item) => item.guard.allowed && isPriorityItem(item))
        .sort((left, right) => {
          if (left.cadence.priorityTier !== right.cadence.priorityTier) {
            const order: Record<SalesCallPriorityTier, number> = { vip: 0, important: 1, standard: 2 };
            return order[left.cadence.priorityTier] - order[right.cadence.priorityTier];
          }
          if (getRecordQuoteViewedAt(left.record) && !getRecordQuoteViewedAt(right.record)) return -1;
          if (!getRecordQuoteViewedAt(left.record) && getRecordQuoteViewedAt(right.record)) return 1;
          return right.dealValueEur - left.dealValueEur;
        })
        .slice(0, 8),
    [state],
  );

  const visibleWorkItems = useMemo(
    () => tabItems[activeTab].filter((item) => matchesWorkFilter(item, activeFilter)),
    [activeFilter, activeTab, tabItems],
  );

  useEffect(() => {
    if (!selectedItem) return;
    setPriorityTier(selectedItem.cadence.priorityTier);
    setPriorityReason(selectedItem.cadence.priorityReason || "");
    setPurchaseSignal(selectedItem.cadence.purchaseSignal);
    setPostReminderDecision(selectedItem.cadence.currentStage === "no_response_call" ? "" : "finished");
  }, [selectedItem]);

  function openItem(itemId: string) {
    setAdHocItem(null);
    setSelectedItemId(itemId);
    setDetailOpen(true);
    setError(null);
    setMessage(null);
  }

  function openSearchResult(record: CustomerSearchResult) {
    const item = buildAdHocCallItem(record);
    setAdHocItem(item);
    setSelectedItemId(`ad-hoc:${record.requestId}`);
    setDetailOpen(true);
    setError(null);
    setMessage(null);
  }

  function openProcessedToday(entry: SalesCallProcessedTodayItem) {
    if (!entry.record) {
      setMessage("Der bearbeitete Fall kann gerade nicht vollständig geöffnet werden.");
      return;
    }
    const baseItem = buildAdHocCallItem(entry.record);
    const item = {
      ...baseItem,
      latestResult: entry.latestResult,
      cadence: entry.cadence || baseItem.cadence,
    };
    setAdHocItem(item);
    setSelectedItemId(`ad-hoc:${entry.requestId}`);
    setDetailOpen(true);
    setError(null);
    setMessage(null);
  }

  async function runSearchFor(queryInput: string) {
    const query = queryInput.trim();
    if (query.length < 2) {
      setError("Bitte mindestens zwei Zeichen für die Suche eingeben.");
      return;
    }
    setSearchLoading(true);
    setSearchHasRun(true);
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/ops/customer-records?query=${encodeURIComponent(query)}`);
    const payload = (await response.json().catch(() => null)) as CustomerRecordsSearchResponse | null;
    if (!response.ok || !payload?.ok) {
      setError(formatApiError(payload));
      setSearchLoading(false);
      return;
    }
    const results = payload.results || [];
    setSearchResults(results);
    if (results.length === 1) {
      openSearchResult(results[0]);
    }
    setSearchLoading(false);
  }

  async function runSearch() {
    await runSearchFor(searchQuery);
  }

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; issues?: string[] } | null;
    if (!response.ok) {
      setError(formatApiError(payload));
      return;
    }
    setHasSession(true);
    setToken("");
    setMessage("Zugang aktiv.");
    void loadState();
  }

  async function loadState() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/ops/customer-records/calls");
    const payload = (await response.json().catch(() => null)) as SalesCallApiResponse | null;

    if (response.status === 401) {
      setHasSession(false);
      setLoading(false);
      return;
    }
    if (!response.ok || !payload?.ok || !payload.state) {
      setError(formatApiError(payload));
      setLoading(false);
      return;
    }
    setState(payload.state);
    setLoading(false);
  }

  async function refreshList() {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/ops/customer-records/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "refresh_list",
        operatorName: operatorName || null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as SalesCallApiResponse | null;
    if (!response.ok || !payload?.ok || !payload.state) {
      setError(formatApiError(payload));
      setRefreshing(false);
      return;
    }
    setState(payload.state);
    setMessage("Tagesliste neu erzeugt.");
    setRefreshing(false);
  }

  async function saveResult() {
    if (!selectedItem?.requestId) {
      setError("Bitte zuerst einen Fall öffnen.");
      return;
    }
    if (!notes.trim()) {
      setError("Bitte eine Pflichtnotiz eintragen.");
      return;
    }
    if (needsPostReminderDecision(selectedItem, preset) && !postReminderDecision) {
      setError("Bitte nach dem Reminder-Call festlegen, wie der Fall weiterlaufen soll.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/ops/customer-records/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record_result",
        operatorName: operatorName || null,
        callListItemId: selectedItem.id || null,
        requestId: selectedItem.requestId,
        preset,
        notes,
        callbackDate: preset === "callback" || preset === "not-reached" || preset === "needs-time" ? callbackDate : null,
        postReminderDecision: needsPostReminderDecision(selectedItem, preset) ? postReminderDecision : null,
        priorityTier,
        priorityReason,
        purchaseSignal,
        expectedLatestResultId: selectedItem.latestResult?.id || null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as SalesCallApiResponse | null;
    if (!response.ok || !payload?.ok) {
      setError(formatApiError(payload));
      setSaving(false);
      return;
    }

    setNotes("");
    if (adHocItem && payload.result) {
      setAdHocItem({
        ...adHocItem,
        latestResult: payload.result,
      });
    }
    setState((current) => {
      if (!current || !payload.gate || !payload.completion) return current;
      return {
        ...current,
        gate: payload.gate,
        completion: payload.completion,
      };
    });
    setMessage("Ergebnis gespeichert. Die Call-Liste wurde aktualisiert.");
    setSaving(false);
    void loadState();
  }

  async function applySegment(segment: string) {
    if (!selectedItem) return;
    setSegmentSaving(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/ops/customer-records/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_request_segment",
        requestId: selectedItem.requestId,
        segment,
        operatorName: operatorName || null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as SalesCallApiResponse | null;
    if (!response.ok || !payload?.ok || !payload.record) {
      setError(formatApiError(payload));
      setSegmentSaving(false);
      return;
    }

    setState((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) =>
          item.requestId === payload.record?.requestId
            ? {
                ...item,
                record: payload.record,
              }
            : item,
        ),
      };
    });
    setAdHocItem((current) =>
      current && payload.record && current.requestId === payload.record.requestId
        ? {
            ...current,
            record: payload.record,
          }
        : current,
    );
    setMessage("Segment wurde bestätigt.");
    setSegmentSaving(false);
  }

  if (opsEnabled && !hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Sales Calls"
        title="Call-Zentrale anmelden"
        description="Melde dich für die interne Call-Liste an. Ergebnisse, Notizen und Aufgaben werden danach serverseitig gespeichert."
        activeApp="calls"
        operatorName={operatorName}
        password={token}
        error={error}
        onOperatorNameChange={setOperatorName}
        onPasswordChange={setToken}
        onSubmit={login}
      />
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-[2rem] bg-stone-950 px-8 py-8 text-white shadow-xl shadow-stone-950/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.3em] text-stone-400">Sales Calls</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Call-Zentrale</h1>
              <p className="mt-4 text-base leading-7 text-stone-300">
                Zeigt neue Anfragen, heute gesendete Angebote und fällige Rückrufe. Gespeicherte Ergebnisse
                verschieben oder schließen Fälle automatisch.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <OpsAppSwitcher active="calls" tone="dark" />
              <input
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-400"
                placeholder="Operator"
              />
              <button
                onClick={() => void refreshList()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-medium text-stone-950 transition hover:bg-stone-100 disabled:opacity-60"
              >
                <RefreshCcw className="h-4 w-4" />
                {refreshing ? "Aktualisiere…" : "Liste aktualisieren"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">{error}</div>
        ) : null}
        {message ? (
          <div role="status" className="rounded-3xl border border-emerald-300 bg-emerald-50 px-6 py-4 text-sm text-emerald-900 shadow-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Gespeichert.</div>
                <div className="mt-1 text-emerald-900/75">{message}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-4">
          <div className={`rounded-3xl border px-5 py-4 ${state ? gateTone(state.gate.gate) : "border-stone-200 bg-white text-stone-700"}`}>
            <p className="text-xs uppercase tracking-[0.24em]">Listenprüfung</p>
            <p className="mt-3 text-2xl font-semibold">{gateLabel(state?.gate.gate)}</p>
            <p className="mt-2 text-sm">
              {state ? `${state.gate.reviewed}/${state.gate.topN} geprüft • ${state.gate.concreteNextSteps} nächste Schritte` : "Lade Status …"}
            </p>
          </div>
          <div className={`rounded-3xl border px-5 py-4 ${state ? completionTone(state.completion.complete) : "border-stone-200 bg-white text-stone-700"}`}>
            <p className="text-xs uppercase tracking-[0.24em]">Arbeitsstand</p>
            <p className="mt-3 text-2xl font-semibold">{completionLabel(state?.completion.complete)}</p>
            <p className="mt-2 text-sm">{completionReasonLabel(state?.completion.reason)}</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white px-5 py-4 text-stone-700">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Lauf</p>
            <p className="mt-3 text-2xl font-semibold">
              {state?.run.status === "preview" ? "Vorschau" : state?.run.date || "—"}
            </p>
            <p className="mt-2 text-sm">
              {state ? `${state.run.eligibleCount} anrufbar • ${state.run.blockedCount} geblockt` : "Lade Lauf …"}
            </p>
          </div>
          <div className="rounded-3xl border border-sky-200 bg-sky-50 px-5 py-4 text-sky-800">
            <p className="text-xs uppercase tracking-[0.24em]">Aufgaben</p>
            <p className="mt-3 text-2xl font-semibold">
              {state ? state.taskCounts.open + state.taskCounts.waiting + state.taskCounts.blocked : "…"}
            </p>
            <p className="mt-2 text-sm">
              {state ? `${state.taskCounts.overdue} überfällig • ${state.taskCounts.emailDriven} aus E-Mail` : "Lade Aufgaben …"}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Suche</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-950">Kontakt außerhalb der Liste finden</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                  Für spontane Anrufe: Name, Firma, E-Mail, Telefon, Request-ID, AC-Deal oder Trello-Link suchen und den Fall direkt im Call-Fenster öffnen.
                </p>
              </div>
            </div>

            <form
              className="mt-5 flex flex-col gap-3 lg:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch();
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchHasRun(false);
                    setSearchResults([]);
                  }}
                  className="h-12 w-full rounded-2xl border border-stone-300 bg-white pl-11 pr-4 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-stone-900"
                  placeholder="Name, Firma, E-Mail, Telefon, Request-ID, AC-Deal oder Trello-Link"
                />
              </div>
              <button
                type="submit"
                disabled={searchLoading}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-60"
              >
                <Search className="h-4 w-4" />
                {searchLoading ? "Sucht..." : "Suchen"}
              </button>
            </form>

            {searchResults.length ? (
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {searchResults.map((record) => {
                  const item = buildAdHocCallItem(record);
                  return (
                    <button
                      key={`search-${record.requestId}`}
                      type="button"
                      onClick={() => openSearchResult(record)}
                      className={`grid w-full gap-3 rounded-3xl border p-4 text-left transition hover:border-stone-500 hover:bg-white sm:grid-cols-[88px_minmax(0,1fr)_140px] ${workCardTone(item)}`}
                    >
                      <CallVisual
                        item={item}
                        className="h-20 w-20 overflow-hidden rounded-2xl border border-black/10 bg-white"
                        imgClassName="h-full w-full object-cover"
                        emptyLabel="Kein Bild"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${stageTone(item.cadence.currentStage)}`}>
                            {stageLabel(item)}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${priorityTone(item.cadence.priorityTier)}`}>
                            {priorityLabels[item.cadence.priorityTier]}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${segmentTone(item)}`}>
                            {needsSegmentConfirmation(item) ? "Segment prüfen" : "Segment ok"}
                          </span>
                        </div>
                        <p className="mt-3 truncate text-lg font-semibold text-stone-950">{item.contactName || item.requestId}</p>
                        <p className="truncate text-sm text-stone-600">{item.companyName || item.email || "Ohne Firma"}</p>
                        <p className="mt-1 truncate text-xs text-stone-500">{record.phone || record.originalPhone || "Keine Telefonnummer"} · {record.email || "keine E-Mail"}</p>
                      </div>
                      <div className="rounded-2xl border border-black/10 bg-white/80 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Warenwert</p>
                        <p className="mt-1 text-base font-semibold text-stone-950">
                          {formatMoney(item.dealValueEur, record.quote?.currency || "EUR")}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">{record.request?.acDealId ? `AC ${record.request.acDealId}` : "Ad-hoc"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : searchHasRun && !searchLoading ? (
              <p className="mt-4 rounded-2xl border border-dashed border-stone-300 px-4 py-4 text-sm text-stone-500">
                Keine Suchtreffer für die aktuelle Eingabe.
              </p>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Priorität</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-950">Wichtige offene Fälle</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                  Diese Spur ist ein Prioritätsfilter: hohe Werte, angesehene Angebote, Kaufsignale und fällige
                  Aufgaben. Neue Tagesfälle bleiben separat in den Tabs.
                </p>
              </div>
              <button
                onClick={() => void loadState()}
                disabled={loading}
                className="rounded-2xl border border-stone-300 px-4 py-2 text-sm text-stone-700 transition hover:border-stone-900 hover:text-stone-950 disabled:opacity-60"
              >
                Aktualisieren
              </button>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
              {loading && !state ? (
                <div className="rounded-3xl border border-dashed border-stone-300 px-5 py-8 text-sm text-stone-500">
                  Prioritäten werden geladen...
                </div>
              ) : priorityItems.length ? (
                priorityItems.map((item) => (
                  <button
                    key={`priority-${item.id || item.requestId}`}
                    onClick={() => openItem(item.id || item.requestId)}
                    className={`w-full rounded-[1.6rem] border p-3 text-left transition hover:border-stone-500 hover:bg-white ${workCardTone(item)}`}
                  >
                    <div className="flex gap-3">
                      <CallVisual
                        item={item}
                        className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-black/10 bg-white"
                        imgClassName="h-full w-full object-cover"
                        emptyLabel="Kein Bild"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${priorityTone(item.cadence.priorityTier)}`}>
                            {priorityLabels[item.cadence.priorityTier]}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${stageTone(item.cadence.currentStage)}`}>
                            {stageLabel(item)}
                          </span>
                        </div>
                        <p className="mt-2 truncate text-base font-semibold text-stone-950">{item.contactName || item.requestId}</p>
                        <p className="mt-1 text-sm font-medium text-stone-900">
                          {formatMoney(item.dealValueEur, item.record.quote?.currency || "EUR")}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-600">{getPriorityReason(item)}</p>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-stone-300 px-5 py-8 text-sm text-stone-500">
                  Keine wichtigen offenen Fälle in der aktuellen Liste.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Arbeitsliste</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-950">Anrufsteuerung in drei Tabs</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                  Neue Anfragen, erste Angebote und persönliche Wiedervorlagen sind getrennt. Farben zeigen Phase und
                  Dringlichkeit auf einen Blick.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {workTabs.map((tab) => {
                const selected = activeTab === tab.key;
                const count = tabItems[tab.key]?.length || 0;
                return (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key);
                      setActiveFilter("all");
                    }}
                    className={`rounded-[1.5rem] border px-4 py-4 text-left transition ${
                      selected ? tabAccentClasses(tab.key) : "border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-400"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold">{tab.title}</p>
                        <p className="mt-1 text-xs leading-5 opacity-75">{tab.helper}</p>
                      </div>
                      <span className="rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-semibold">
                        {count}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {workFilters.map((filter) => {
                const selected = activeFilter === filter.key;
                return (
                  <button
                    key={filter.key}
                    onClick={() => setActiveFilter(filter.key)}
                    className={`rounded-2xl border px-3 py-2 text-xs font-medium transition ${
                      selected
                        ? "border-stone-900 bg-stone-950 text-white"
                        : "border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-950"
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 space-y-3">
              {loading && !state ? (
                <div className="rounded-3xl border border-dashed border-stone-300 px-5 py-8 text-sm text-stone-500">
                  Tagesliste wird geladen...
                </div>
              ) : state ? (
                visibleWorkItems.length ? (
                  visibleWorkItems.map((item) => (
                    <button
                      key={`work-${activeTab}-${item.id || item.requestId}`}
                      onClick={() => openItem(item.id || item.requestId)}
                      className={`grid w-full gap-3 rounded-3xl border px-4 py-4 text-left transition hover:border-stone-500 hover:bg-white lg:grid-cols-[minmax(0,1.5fr)_150px_150px_190px_150px] ${workCardTone(item)}`}
                    >
                      <div className="min-w-0">
                        <div className="flex gap-3">
                          <CallVisual
                            item={item}
                            className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-black/10 bg-white"
                            imgClassName="h-full w-full object-cover"
                            emptyLabel="Kein Bild"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${stageTone(item.cadence.currentStage)}`}>
                                {stageLabel(item)}
                              </span>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${priorityTone(item.cadence.priorityTier)}`}>
                                {priorityLabels[item.cadence.priorityTier]}
                              </span>
                              {isOverdue(item) ? (
                                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-medium text-rose-700">
                                  überfällig
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-3 truncate text-lg font-semibold text-stone-950">{item.contactName || item.requestId}</p>
                            <p className="truncate text-sm text-stone-600">{item.companyName || "Ohne Firma"}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{getPriorityReason(item)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white/80 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Warenwert</p>
                        <p className="mt-1 text-lg font-semibold text-stone-950">
                          {formatMoney(item.dealValueEur, item.record.quote?.currency || "EUR")}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-black/10 bg-white/80 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Anfrage</p>
                        <p className="mt-1 text-sm font-medium text-stone-900">
                          {item.record.request?.createdAt ? formatDateLabel(item.record.request.createdAt) : "Kein Datum"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-black/10 bg-white/80 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Anrufstatus</p>
                        <p className="mt-1 text-sm font-medium leading-5 text-stone-900">{getSimpleCallStatus(item)}</p>
                      </div>
                      <div className="rounded-2xl border border-black/10 bg-white/80 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Segment</p>
                        <p className="mt-1 text-sm font-medium text-stone-900">{getSegmentLabel(item)}</p>
                        <p className="mt-1 text-xs text-stone-500">{needsSegmentConfirmation(item) ? "Bestätigung offen" : "bestätigt"}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-stone-300 px-5 py-8 text-sm text-stone-500">
                    Keine Fälle für diesen Tab und Filter.
                  </div>
                )
              ) : (
                <div className="rounded-3xl border border-dashed border-stone-300 px-5 py-8 text-sm text-stone-500">
                  Noch keine Liste vorhanden. Klicke zuerst auf „Liste aktualisieren“.
                </div>
              )}
            </div>
          </div>

          {state?.processedToday?.length ? (
            <details className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-emerald-700">Heute bearbeitet</p>
                    <h2 className="mt-2 text-xl font-semibold text-stone-950">
                      Gespeicherte Ergebnisse nachprüfen
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-emerald-900/70">
                      Diese Fälle sind nicht weg, sondern wurden heute verarbeitet oder auf einen späteren Schritt verschoben.
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-800">
                    {state.processedToday.length}
                  </span>
                </div>
              </summary>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {state.processedToday.slice(0, 12).map((entry) => (
                  <button
                    key={entry.latestResult.id}
                    type="button"
                    onClick={() => openProcessedToday(entry)}
                    className="rounded-2xl border border-emerald-200 bg-white px-4 py-4 text-left transition hover:border-emerald-400"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-stone-950">
                          {entry.contactName || entry.requestId}
                        </p>
                        <p className="mt-1 truncate text-xs text-stone-500">{entry.companyName || entry.email || "Ohne Firma"}</p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                        {getResultOutcomeLabel(entry.latestResult.preset) || "gespeichert"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-5 text-stone-700">
                      {entry.latestResult.nextStep || "Kein nächster Schritt"}
                    </p>
                    <p className="mt-2 text-xs text-stone-500">
                      {entry.latestResult.operatorId ? `${entry.latestResult.operatorId} • ` : ""}
                      {formatDateTimeLabel(entry.latestResult.createdAt)}
                    </p>
                  </button>
                ))}
              </div>
            </details>
          ) : null}

          {state ? (
            <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Weitere Arbeitslisten</p>
                  <h2 className="mt-2 text-xl font-semibold text-stone-950">Rückrufe, Anpassungen und Abschluss</h2>
                </div>
                <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600">
                  {followupBuckets.reduce((sum, bucket) => sum + (secondaryBucketItems[bucket]?.length || 0), 0)}
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {followupBuckets.map((bucket) => {
                  const items = secondaryBucketItems[bucket];
                  return (
                    <div key={bucket} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-stone-900">{bucketLabels[bucket]}</p>
                        <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500">
                          {items.length}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {items.length ? (
                          items.slice(0, 5).map((item) => (
                            <button
                              key={item.id || item.requestId}
                              onClick={() => openItem(item.id || item.requestId)}
                              className="w-full rounded-2xl border border-stone-200 bg-white px-3 py-3 text-left text-sm transition hover:border-stone-400"
                            >
                              <p className="truncate font-medium text-stone-900">{item.contactName || item.requestId}</p>
                              <p className="mt-1 text-xs leading-5 text-stone-500">{getSimpleCallStatus(item)}</p>
                              <p className="mt-1 text-[11px] text-stone-400">{formatMoney(item.dealValueEur, item.record.quote?.currency || "EUR")}</p>
                            </button>
                          ))
                        ) : (
                          <p className="rounded-2xl border border-dashed border-stone-300 bg-white px-3 py-4 text-xs text-stone-500">
                            Keine Fälle.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {selectedItem && detailOpen ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-stone-950/55 px-4 py-6 backdrop-blur-sm">
            <div className="max-h-[calc(100vh-3rem)] w-full max-w-6xl overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-2xl shadow-stone-950/20">
              <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Detail & Ergebnis</p>
                  <h2 className="mt-1 truncate text-2xl font-semibold text-stone-950">
                    {selectedItem.contactName || selectedItem.requestId}
                  </h2>
                  <p className="mt-1 truncate text-sm text-stone-500">{selectedItem.companyName || "Ohne Firma"}</p>
                </div>
                <button
                  onClick={() => setDetailOpen(false)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
                  aria-label="Detailfenster schließen"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid max-h-[calc(100vh-7rem)] overflow-y-auto lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="border-b border-stone-200 bg-stone-50 p-5 lg:border-b-0 lg:border-r">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${stageTone(selectedItem.cadence.currentStage)}`}>
                      {stageLabel(selectedItem)}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${priorityTone(selectedItem.cadence.priorityTier)}`}>
                      {priorityLabels[selectedItem.cadence.priorityTier]}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${selectedItem.guard.allowed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                      {selectedItem.guard.allowed ? "Call freigegeben" : selectedItem.guard.blockedReason || "Gesperrt"}
                    </span>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-[1.6rem] border border-black/10 bg-white">
                    <CallVisual
                      item={selectedItem}
                      className="aspect-[4/3] w-full bg-stone-100"
                      imgClassName="h-full w-full object-cover"
                      emptyLabel="Kein Designbild im Fall"
                    />
                  </div>

                  <div className="mt-5">
                    <SegmentConfirmControl
                      item={selectedItem}
                      running={segmentSaving}
                      onApply={applySegment}
                    />
                  </div>

                  <div className="mt-5 rounded-[1.6rem] bg-amber-100 px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-amber-900/70">Warenwert</p>
                    <p className="mt-2 text-3xl font-semibold text-stone-950">
                      {formatMoney(selectedItem.dealValueEur, selectedItem.record.quote?.currency || "EUR")}
                    </p>
                    <p className="mt-1 text-sm text-stone-600">{getPriceSourceLabel(selectedItem)}</p>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 sm:col-span-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Aktueller Anruf</p>
                      <p className="mt-1 text-base font-semibold leading-6 text-stone-900">{getCallStageSummary(selectedItem)}</p>
                      <p className="mt-1 text-xs leading-5 text-stone-500">{getCallStageDetail(selectedItem)}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Anfrage</p>
                      <p className="mt-1 text-sm font-medium text-stone-900">
                        {selectedItem.record.request?.createdAt ? formatDateLabel(selectedItem.record.request.createdAt) : "Kein Datum"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Anrufstatus</p>
                      <p className="mt-1 text-sm font-medium text-stone-900">{callStatusLabel(selectedItem)}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Design</p>
                      <p className="mt-1 text-sm font-medium text-stone-900">{getDesignStatus(selectedItem)}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Preisquelle</p>
                      <p className="mt-1 text-sm font-medium text-stone-900">{getPriceSourceLabel(selectedItem)}</p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3 rounded-[1.6rem] border border-stone-200 bg-white p-4">
                    <p className="text-sm font-medium text-stone-900">Fallkontext</p>
                    <div className="space-y-2 text-sm text-stone-700">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-stone-400" />
                        {selectedItem.phoneRaw ? (
                          <a className="hover:underline" href={`tel:${selectedItem.phoneNormalized || selectedItem.phoneRaw}`}>
                            {selectedItem.phoneRaw}
                          </a>
                        ) : (
                          <span>Keine Telefonnummer</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-stone-400" />
                        <span>{selectedItem.email || "Keine E-Mail"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-stone-400" />
                        <span>Request-ID: {selectedItem.requestId}</span>
                      </div>
                      {selectedItem.acDealId ? (
                        <div className="flex items-center gap-2">
                          <ExternalLink className="h-4 w-4 text-stone-400" />
                          <span>AC Deal: {selectedItem.acDealId}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 rounded-[1.6rem] border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                    <p className="font-medium text-stone-900">Call-Cadence</p>
                    <p className="mt-2">
                      {selectedItem.cadence.nextCallDueAt
                        ? `Nächster Anruf ab ${selectedItem.cadence.nextCallDueAt.slice(0, 16).replace("T", " ")}`
                        : "Keine automatische nächste Fälligkeit."}
                    </p>
                    <p className="mt-1">
                      {selectedItem.cadence.cadenceFinished
                        ? "Die 3er-Strecke ist beendet."
                        : `${selectedItem.cadence.standardCallCount}/3 Standard-Anrufe verbraucht.`}
                    </p>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                      <div className="rounded-xl bg-stone-50 px-3 py-2">
                        <div className="font-medium text-stone-900">Call 1</div>
                        <div className="mt-1 text-stone-500">
                          {selectedItem.cadence.call1CompletedAt ? "erledigt" : selectedItem.cadence.call1DueAt ? formatDateLabel(selectedItem.cadence.call1DueAt) : "offen"}
                        </div>
                      </div>
                      <div className="rounded-xl bg-stone-50 px-3 py-2">
                        <div className="font-medium text-stone-900">Call 2</div>
                        <div className="mt-1 text-stone-500">
                          {selectedItem.cadence.call2CompletedAt ? "erledigt" : selectedItem.cadence.call2DueAt ? formatDateLabel(selectedItem.cadence.call2DueAt) : "offen"}
                        </div>
                      </div>
                      <div className="rounded-xl bg-stone-50 px-3 py-2">
                        <div className="font-medium text-stone-900">Call 3</div>
                        <div className="mt-1 text-stone-500">
                          {selectedItem.cadence.call3CompletedAt ? "erledigt" : selectedItem.cadence.call3DueAt ? formatDateLabel(selectedItem.cadence.call3DueAt) : "offen"}
                        </div>
                      </div>
                    </div>
                    {selectedItem.cadence.blockingReason ? (
                      <p className="mt-1 text-rose-700">{selectedItem.cadence.blockingReason}</p>
                    ) : null}
                  </div>

                  {selectedItem.latestResult ? (
                    <div className="mt-5 rounded-[1.6rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                      <p className="font-medium">Letztes Ergebnis</p>
                      <p className="mt-2">
                        {getResultOutcomeLabel(selectedItem.latestResult.preset) || selectedItem.latestResult.preset || "ohne Preset"} • {selectedItem.latestResult.nextStep}
                      </p>
                      <p className="mt-1 text-xs text-emerald-800/70">
                        {selectedItem.latestResult.operatorId ? `${selectedItem.latestResult.operatorId} • ` : ""}
                        {formatDateTimeLabel(selectedItem.latestResult.createdAt)}
                      </p>
                      <p className="mt-2">{selectedItem.latestResult.notes}</p>
                    </div>
                  ) : null}

                  {selectedItem.activeTasks?.length ? (
                    <div className="mt-5 space-y-2">
                      <p className="text-sm font-medium text-stone-900">Aktive Aufgaben</p>
                      {selectedItem.activeTasks.map((task) => (
                        <div key={task.id} className={`rounded-[1.2rem] border px-4 py-3 text-sm ${taskTone(task)}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{task.title}</p>
                            <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium">
                              {taskStatusLabel(task)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 opacity-80">
                            {[task.dueAt ? `fällig ${formatDateLabel(task.dueAt)}` : null, task.source === "inbound_email_signal" ? "aus E-Mail" : null, task.detail]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="p-5">
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-stone-900">Preset wählen</p>
                    <div className="grid gap-2">
                      {presetOptions.map((option) => (
                        <button
                          key={option.key}
                          onClick={() => setPreset(option.key)}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            preset === option.key
                              ? "border-stone-950 bg-stone-950 text-white"
                              : "border-stone-200 bg-white text-stone-900 hover:border-stone-300"
                          }`}
                        >
                          <p className="text-sm font-medium">{option.label}</p>
                          <p className={`mt-1 text-xs ${preset === option.key ? "text-stone-300" : "text-stone-500"}`}>{option.helper}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-stone-900">Priorität</label>
                      <select
                        value={priorityTier}
                        onChange={(event) => setPriorityTier(event.target.value as SalesCallPriorityTier)}
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-950 outline-none transition focus:border-stone-900"
                      >
                        <option value="standard">Standard</option>
                        <option value="important">Wichtig</option>
                        <option value="vip">VIP</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-800">
                      <input
                        type="checkbox"
                        checked={purchaseSignal}
                        onChange={(event) => setPurchaseSignal(event.target.checked)}
                        className="h-4 w-4 rounded border-stone-300"
                      />
                      Gutes Kaufsignal im Gespräch markieren
                    </label>
                  </div>

                  <div className="mt-5 space-y-2">
                    <label className="text-sm font-medium text-stone-900">Prioritätsgrund</label>
                    <input
                      value={priorityReason}
                      onChange={(event) => setPriorityReason(event.target.value)}
                      className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-stone-900"
                      placeholder="z. B. will kaufen, hoher Warenwert, Entscheidung noch diese Woche"
                    />
                  </div>

                  {(preset === "callback" || preset === "not-reached" || preset === "needs-time") ? (
                    <div className="mt-5 space-y-2">
                      <label className="text-sm font-medium text-stone-900">Rückrufdatum</label>
                      <input
                        type="date"
                        value={callbackDate}
                        onChange={(event) => setCallbackDate(event.target.value)}
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-950 outline-none transition focus:border-stone-900"
                      />
                    </div>
                  ) : null}

                  {needsPostReminderDecision(selectedItem, preset) ? (
                    <div className="mt-5 space-y-3 rounded-3xl border border-stone-200 bg-stone-50 p-4">
                      <div>
                        <p className="text-sm font-medium text-stone-900">Wie geht es nach Call 3 weiter?</p>
                        <p className="mt-1 text-xs leading-5 text-stone-500">
                          Nach dem Reminder-Call endet die Standardstrecke. Lege fest, ob der Fall manuell offen bleibt,
                          eine Angebotsanpassung braucht oder beendet wird.
                        </p>
                      </div>
                      <div className="grid gap-2">
                        {postReminderOptions.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => setPostReminderDecision(option.value)}
                            className={`rounded-2xl border px-4 py-3 text-left transition ${
                              postReminderDecision === option.value
                                ? "border-stone-950 bg-stone-950 text-white"
                                : "border-stone-200 bg-white text-stone-900 hover:border-stone-300"
                            }`}
                          >
                            <p className="text-sm font-medium">{option.label}</p>
                            <p className={`mt-1 text-xs ${postReminderDecision === option.value ? "text-stone-300" : "text-stone-500"}`}>
                              {option.helper}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5 space-y-2">
                    <label className="text-sm font-medium text-stone-900">Pflichtnotiz</label>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="min-h-36 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-stone-900"
                      placeholder="Echten Gesprächs- oder Prüfkontext eintragen. Keine Kurzform wie Mailbox, interessiert oder Rückruf vereinbart."
                    />
                  </div>

                  {!selectedItem.guard.allowed && preset !== "review-useful" && preset !== "review-not-useful" ? (
                    <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                      Für gesperrte Fälle sind nur Review-Presets sinnvoll. Ein echter Call wird serverseitig blockiert.
                    </div>
                  ) : null}

                  {selectedItem.guard.attentionReasons.length ? (
                    <div className="mt-5 space-y-2">
                      {selectedItem.guard.attentionReasons.map((reason) => (
                        <div key={reason} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                          {reason}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      onClick={() => void saveResult()}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-2xl bg-stone-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {saving ? "Speichert Ergebnis…" : "Ergebnis jetzt speichern"}
                    </button>
                    <button
                      onClick={() => setDetailOpen(false)}
                      className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-950"
                    >
                      Schließen
                    </button>
                  </div>

                  {message ? (
                    <div role="status" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <div className="font-semibold">Gespeichert.</div>
                          <div className="mt-1 text-emerald-900/75">{message}</div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {error ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {state ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              <div className="flex items-center gap-2 text-stone-900">
                <ShieldAlert className="h-4 w-4" />
                Gemeinsame Guards
              </div>
              <p className="mt-3 leading-6">
                Kontaktstopp, Reply-Lage, Abschluss, Rückruf-Not-before und fehlende Telefonnummer blockieren hier serverseitig dieselbe Fallrealität wie im bestehenden Follow-up-System.
              </p>
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              <div className="flex items-center gap-2 text-stone-900">
                <AlertTriangle className="h-4 w-4" />
                Keine Mail-Mutation
              </div>
              <p className="mt-3 leading-6">
                Iteration 1 schreibt nur in das neue Call-Modul. Laufende E-Mail-Workflows und `followup_queue` bleiben unverändert.
              </p>
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              <div className="flex items-center gap-2 text-stone-900">
                <Clock3 className="h-4 w-4" />
                Nächster Schritt
              </div>
              <p className="mt-3 leading-6">{state.completion.nextRequiredAction}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
