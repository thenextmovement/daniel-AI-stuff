"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  ClipboardCopy,
  Clock3,
  ExternalLink,
  FileSearch,
  GitBranch,
  History,
  ListChecks,
  MailCheck,
  MessageSquareText,
  Network,
  PackageSearch,
  PlugZap,
  RefreshCcw,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { CompanyBrainProblemType, CompanyBrainResolveResult } from "@/lib/ops/company-brain";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../ops-design";

type ResolveApiResponse = {
  ok: boolean;
  result?: CompanyBrainResolveResult;
  error?: string;
  issues?: string[];
};

type CompanyBrainActionProposalView = CompanyBrainResolveResult["actionProposals"][number];
type CompanyBrainActionGroupKey = "internal" | "fix" | "customer" | "manual";

const ACTION_GROUPS: Array<{ key: CompanyBrainActionGroupKey; title: string; detail: string }> = [
  {
    key: "internal",
    title: "Intern sichern",
    detail: "Notizen, Problemfälle und Aufgaben. Kein Kundenkontakt.",
  },
  {
    key: "fix",
    title: "Daten korrigieren",
    detail: "Kundenakte, E-Mail und Trello-Projektion nur mit Freigabe.",
  },
  {
    key: "customer",
    title: "Kundenkontakt",
    detail: "Versand nur nach serverseitigem Duplicate-, Bounce- und Empfängercheck.",
  },
  {
    key: "manual",
    title: "Manuell prüfen",
    detail: "Links und Prüfschritte ohne direkte Änderung.",
  },
];

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function formatDateTime(value: string | null) {
  if (!value) return "Kein Zeitpunkt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function directionLabel(direction: string) {
  switch (direction) {
    case "inbound":
      return "Eingang";
    case "outbound":
      return "Ausgang";
    case "system":
      return "System";
    default:
      return "Intern";
  }
}

function findingClass(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return "border-rose-300 bg-rose-50 text-rose-900";
  if (severity === "warning") return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function compactList(values: string[]) {
  return values.length ? values.join(", ") : "Keine Angabe";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

const DEFAULT_OFFER_RETRY_SUBJECT = "Ihr aktualisiertes NEONTRIP Angebot";
const DEFAULT_OFFER_RETRY_MESSAGE = [
  "Hallo,",
  "",
  "wie besprochen haben wir Ihr Angebot aktualisiert. Sie können es über den Angebotslink erneut öffnen.",
  "",
  "Viele Grüße",
  "NEONTRIP",
].join("\n");

function normalizeInitialProblemType(value: string | null): CompanyBrainProblemType | "" {
  if (
    value === "color_dispute" ||
    value === "damaged_sign" ||
    value === "offer_not_sent" ||
    value === "customer_waiting" ||
    value === "design_unclear" ||
    value === "delivery_problem" ||
    value === "payment_order_unclear" ||
    value === "automation_failed" ||
    value === "other"
  ) {
    return value;
  }
  return "";
}

function checkClass(status: string) {
  if (status === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "warning") return "border-amber-300 bg-amber-50 text-amber-900";
  if (status === "missing") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function statusLabel(status: string) {
  if (status === "verified") return "Belegt";
  if (status === "warning") return "Prüfen";
  if (status === "missing") return "Fehlt";
  return "Unklar";
}

function sourceHealthClass(status: string) {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "partial") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "error") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function sourceHealthLabel(status: string) {
  if (status === "ok") return "OK";
  if (status === "partial") return "Teilweise";
  if (status === "error") return "Fehler";
  return "Fehlt";
}

function crossCheckClass(status: string) {
  if (status === "pass") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "fail") return "border-rose-200 bg-rose-50 text-rose-900";
  if (status === "review") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function crossCheckLabel(status: string) {
  if (status === "pass") return "Passt";
  if (status === "fail") return "Konflikt";
  if (status === "review") return "Prüfen";
  return "Unklar";
}

function caseCategoryLabel(category: string) {
  if (category === "customer_message") return "Kunde/Mail";
  if (category === "offer") return "Angebot";
  if (category === "order") return "Bestellung";
  if (category === "automation") return "Automation";
  if (category === "trello") return "Trello";
  if (category === "design") return "Design";
  return "Intern";
}

function riskClass(riskLevel: string) {
  if (riskLevel === "high") return "border-rose-200 bg-rose-50 text-rose-900";
  if (riskLevel === "medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function evidenceScoreClass(status: string) {
  if (status === "strong") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "conflicting") return "border-rose-200 bg-rose-50 text-rose-900";
  if (status === "medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function readinessClass(status: string) {
  if (status === "configured") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "partial") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function readinessLabel(status: string) {
  if (status === "configured") return "bereit";
  if (status === "partial") return "teilweise";
  return "fehlt";
}

function watcherClass(status: string, severity: string) {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (severity === "critical") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function trelloFailureClass(severity: string) {
  if (severity === "critical") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function verdictClass(verdict: string) {
  if (verdict === "found") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (verdict === "not_found") return "border-rose-200 bg-rose-50 text-rose-950";
  return "border-amber-200 bg-amber-50 text-amber-950";
}

function severityBadgeClass(severity: string) {
  if (severity === "critical" || severity === "high") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "warning" || severity === "medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function retryAssessmentClass(status: string) {
  if (status === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-950";
  if (status === "needs_fix") return "border-amber-300 bg-amber-50 text-amber-950";
  if (status === "blocked") return "border-rose-300 bg-rose-50 text-rose-950";
  return "border-stone-200 bg-stone-50 text-stone-800";
}

function retryAssessmentLabel(status: string) {
  if (status === "ready") return "Fix nach Freigabe möglich";
  if (status === "needs_fix") return "Erst Daten korrigieren";
  if (status === "blocked") return "Automatisch blockiert";
  return "Nur prüfen";
}

function operatorDecisionClass(tone: "success" | "warning" | "danger" | "neutral") {
  if (tone === "success") return "border-emerald-300 bg-emerald-50 text-emerald-950";
  if (tone === "warning") return "border-amber-300 bg-amber-50 text-amber-950";
  if (tone === "danger") return "border-rose-300 bg-rose-50 text-rose-950";
  return "border-stone-200 bg-stone-50 text-stone-800";
}

function routeStepClass(tone: "ok" | "warning" | "blocked" | "neutral") {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  if (tone === "blocked") return "border-rose-200 bg-rose-50 text-rose-950";
  return "border-stone-200 bg-stone-50 text-stone-800";
}

function routeStepBadge(tone: "ok" | "warning" | "blocked" | "neutral") {
  if (tone === "ok") return "OK";
  if (tone === "warning") return "Prüfen";
  if (tone === "blocked") return "Blockiert";
  return "Unklar";
}

function routeStepToneFromSeverity(severity: string): "ok" | "warning" | "blocked" | "neutral" {
  if (severity === "critical") return "blocked";
  if (severity === "warning") return "warning";
  if (severity === "info") return "ok";
  return "neutral";
}

function isCompanyBrainFixRun(run: CompanyBrainResolveResult["automationRuns"][number]) {
  return run.workflowName === "company_brain_fix_center";
}

function fixHistoryLabel(action: string | null) {
  if (action === "open_problem_case") return "Problemfall/Aufgabe angelegt";
  if (action === "create_internal_task") return "Interne Aufgabe angelegt";
  if (action === "save_case_note") return "Fallnotiz gespeichert";
  if (action === "prepare_email_correction") return "E-Mail-Korrektur vorbereitet";
  if (action === "correct_customer_email") return "Kunden-E-Mail korrigiert";
  if (action === "post_trello_status_comment") return "Trello-Status kommentiert";
  if (action === "prepare_offer_retry") return "Angebots-Retry vorbereitet";
  if (action === "guarded_offer_resend") return "Guarded Retry";
  return action || "Fix-Center-Aktion";
}

function runStatusClass(status: string | null, retrySafety?: string | null) {
  const text = `${status || ""} ${retrySafety || ""}`.toLowerCase();
  if (/blocked|failed|error|unsafe/.test(text)) return "border-rose-200 bg-rose-50 text-rose-950";
  if (/prepared|waiting|unknown|review/.test(text)) return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-emerald-200 bg-emerald-50 text-emerald-950";
}

function buildOperatorDecision(result: CompanyBrainResolveResult) {
  const executableFixes = result.actionProposals.filter((action) => action.enabled && executableAction(action.key));
  const dataFixAvailable = executableFixes.some((action) =>
    ["correct_customer_email", "prepare_email_correction", "save_case_note", "create_internal_task"].includes(action.key),
  );
  const hasHardBlocker = result.retryAssessment.status === "blocked" || result.retryAssessment.blockers.length > 0;
  const missingCoreSources = result.sourceHealth.filter((source) =>
    ["customer_records", "outlook_mirror", "workflow_audit"].includes(source.key) && source.status !== "ok",
  );

  if (result.retryAssessment.canSendWithConfirmation) {
    return {
      tone: "success" as const,
      title: "Kann nach Freigabe gelöst werden",
      summary: "Der Fall hat genug Belege für einen guarded Fix. Der Server prüft Empfänger, Duplicate-Belege und Bounce-Signale direkt vor der Aktion erneut.",
      steps: [
        "Empfänger und Angebot im Fix Center prüfen.",
        "Freigabe eingeben.",
        "Guarded Action ausführen und danach Fall erneut laden.",
      ],
    };
  }

  if (dataFixAvailable && !hasHardBlocker) {
    return {
      tone: "warning" as const,
      title: "Datenfix möglich, Versand noch nicht",
      summary: "Company Brain kann interne Korrekturen oder Aufgaben vorbereiten. Kundenkontakt bleibt blockiert, bis die Kernchecks sauber sind.",
      steps: [
        "Belegte Datenkorrektur im Fix Center vorbereiten.",
        "Fall danach neu prüfen.",
        "Erst bei grünem Retry-Status senden.",
      ],
    };
  }

  if (hasHardBlocker) {
    return {
      tone: "danger" as const,
      title: "Nicht automatisch lösen",
      summary: "Es gibt harte Blocker. Company Brain darf den Fall erklären und intern sichern, aber keinen Kundenkontakt oder Retry auslösen.",
      steps: result.retryAssessment.blockers.slice(0, 3),
    };
  }

  if (missingCoreSources.length) {
    return {
      tone: "warning" as const,
      title: "Erst Quellen vervollständigen",
      summary: "Die Diagnose ist noch nicht beweisfest, weil mindestens eine Kernquelle fehlt oder nur teilweise verfügbar ist.",
      steps: missingCoreSources.slice(0, 3).map((source) => `${source.label}: ${source.summary}`),
    };
  }

  return {
    tone: "neutral" as const,
    title: "Nur Diagnose",
    summary: "Es ist keine sichere ausführbare Aktion aus den geladenen Belegen ableitbar.",
    steps: result.nextActions.slice(0, 3),
  };
}

function buildCaseRoute(result: CompanyBrainResolveResult) {
  const dataFixPriority = ["correct_customer_email", "prepare_email_correction", "post_trello_status_comment", "create_internal_task", "save_case_note"];
  const dataFix = dataFixPriority
    .map((key) => result.actionProposals.find((action) => action.enabled && action.key === key))
    .find((action): action is CompanyBrainActionProposalView => Boolean(action));
  const customerAction = result.actionProposals.find((action) => action.key === "guarded_offer_resend");
  const automationRun = result.automationRuns
    .filter((run) => !isCompanyBrainFixRun(run))
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())[0] || null;
  const triggerTone: "ok" | "warning" | "blocked" | "neutral" = result.trelloFailureDiagnosis.requested
    ? result.trelloFailureDiagnosis.status === "loaded" ? "ok" : routeStepToneFromSeverity(result.trelloFailureDiagnosis.severity)
    : "neutral";
  const causeTone: "ok" | "warning" | "blocked" | "neutral" =
    result.evidenceScore.status === "strong"
      ? "ok"
      : result.evidenceScore.status === "conflicting"
        ? "blocked"
        : result.evidenceScore.status === "medium"
          ? "warning"
          : "neutral";
  const dataTone: "ok" | "warning" | "blocked" | "neutral" = dataFix
    ? dataFix.riskLevel === "high" ? "warning" : "ok"
    : result.retryAssessment.blockers.length ? "blocked" : "neutral";
  const sendTone: "ok" | "warning" | "blocked" | "neutral" = result.retryAssessment.canSendWithConfirmation
    ? "ok"
    : result.retryAssessment.status === "needs_fix"
      ? "warning"
      : result.retryAssessment.status === "blocked"
        ? "blocked"
        : "neutral";

  return [
    {
      key: "trigger",
      label: "1. Trigger",
      title: result.trelloFailureDiagnosis.requested ? "Trello-Karte gelesen" : "Fall geladen",
      detail: result.trelloFailureDiagnosis.requested
        ? `${result.trelloFailureDiagnosis.card?.currentListName || "Liste unbekannt"} · ${result.trelloFailureDiagnosis.expectedAction}`
        : result.identifiers[0]?.value || result.query,
      tone: triggerTone,
    },
    {
      key: "cause",
      label: "2. Ursache",
      title: result.trelloFailureDiagnosis.rootCauseKey === "not_requested" ? result.problemResolution.label : result.trelloFailureDiagnosis.rootCause,
      detail: automationRun?.executionId
        ? `n8n Execution ${automationRun.executionId} · ${automationRun.status || "Status unbekannt"}`
        : result.evidenceScore.summary,
      tone: causeTone,
    },
    {
      key: "fix",
      label: "3. Datenfix",
      title: dataFix?.label || "Kein direkter Datenfix",
      detail: dataFix ? shortText(dataFix.summary, 120) : (result.retryAssessment.safeFixes[0] || result.problemResolution.recommendedResolution),
      tone: dataTone,
    },
    {
      key: "send",
      label: "4. Versand",
      title: result.retryAssessment.canSendWithConfirmation ? "Guarded Retry möglich" : "Kundenkontakt gesperrt",
      detail: customerAction?.summary || result.retryAssessment.summary,
      tone: sendTone,
    },
  ];
}

function buildOperatorBrief(result: CompanyBrainResolveResult, readyActions: CompanyBrainActionProposalView[]) {
  const primaryAction = readyActions[0] || null;
  const criticalConflict = result.conflicts.find((finding) => finding.severity === "critical") || null;
  const firstGap = result.gaps.find((finding) => finding.severity !== "info") || null;
  const firstBlocker = result.retryAssessment.blockers[0] || result.trelloFailureDiagnosis.blockedFixes[0] || criticalConflict?.detail || firstGap?.detail || null;
  const sourceOfTruth = buildSourceOfTruthStatus(result);
  const canSend = result.retryAssessment.canSendWithConfirmation;
  const needsFix = result.retryAssessment.status === "needs_fix";
  const blocked = result.retryAssessment.status === "blocked" || Boolean(criticalConflict);
  const title = canSend
    ? "Lösbar nach Freigabe"
    : needsFix
      ? "Datenfix nötig"
      : blocked
        ? "Nicht automatisch lösen"
        : "Prüfung nötig";
  const subtitle = canSend
    ? "Company Brain hat genug Belege für eine guarded Aktion. Der Server prüft direkt vor Ausführung erneut."
    : needsFix
      ? "Der Fall ist erklärbar, aber ein Datenpunkt muss zuerst sauber korrigiert werden."
      : blocked
        ? "Es gibt harte Blocker. Keine Kundenmail und kein Retry aus Company Brain."
        : "Die Diagnose ist noch nicht beweisfest genug für eine ausführende Aktion.";
  const cause = result.trelloFailureDiagnosis.requested && result.trelloFailureDiagnosis.rootCauseKey !== "not_requested"
    ? result.trelloFailureDiagnosis.rootCause
    : result.problemResolution.rootCause;
  const nextStep = primaryAction
    ? primaryAction.label
    : result.retryAssessment.safeFixes[0] || result.problemResolution.recommendedResolution || result.nextActions[0] || "Fall mit konkreter Frage neu prüfen";

  return {
    tone: canSend ? "success" as const : needsFix ? "warning" as const : blocked ? "danger" as const : "neutral" as const,
    title,
    subtitle,
    cause,
    nextStep,
    firstBlocker,
    primaryAction,
    evidenceLine: `${result.evidenceScore.score}/100 · ${evidenceScoreLabel(result.evidenceScore.status)}`,
    sourceLine: sourceOfTruth.title,
    customerContactLine: canSend ? "Nur guarded nach Freigabe" : "Kein Kundenkontakt",
  };
}

function buildSourceOfTruthStatus(result: CompanyBrainResolveResult) {
  const hasRecord = result.records.length > 0;
  const hasOffer = result.offers.length > 0;
  const hasTrello = Boolean(result.trelloFailureDiagnosis.card);
  const offerRequestId = result.offers.find((offer) => offer.requestId)?.requestId || null;
  const requestIdentifier = result.identifiers.find((identifier) => identifier.type === "request_id") || null;
  const trelloIdentifier = result.identifiers.find((identifier) => identifier.type === "trello_card_id") || null;
  const requestId = result.records[0]?.requestId || offerRequestId || requestIdentifier?.value || null;
  const trelloId = result.trelloFailureDiagnosis.card?.shortLink || result.trelloFailureDiagnosis.card?.id || trelloIdentifier?.value || null;
  const customerLookupHref = requestId
    ? `/ops/customer-records?query=${encodeURIComponent(requestId)}`
    : trelloId
      ? `/ops/customer-records?query=${encodeURIComponent(`trello:${trelloId}`)}`
      : null;

  if (hasRecord && hasOffer) {
    return {
      tone: "ok" as const,
      title: "Fix-Kontext vollständig",
      summary: "Kundenakte und Angebot sind geladen. Interne Fixes können nach Freigabe gegen die Kundenakte ausgeführt werden.",
      detail: `Request: ${result.records[0]?.requestId || "unbekannt"} · Angebot: ${result.offers[0]?.offerNumber || result.offers[0]?.offerId || "unbekannt"}`,
      actionHref: `/ops/customer-records?query=${encodeURIComponent(result.records[0]?.requestId || "")}`,
      actionLabel: "Kundenakte öffnen",
    };
  }

  if (hasOffer && !hasRecord) {
    return {
      tone: "warning" as const,
      title: "Angebot gefunden, Kundenakte fehlt",
      summary: "Company Brain kann Angebot und Trello-Belege erklären, aber keine Datenkorrektur oder interne Aufgabe sauber gegen die Kundenakte schreiben.",
      detail: offerRequestId
        ? `Request-ID laut Angebot: ${offerRequestId}. Kundenakte per Request-ID prüfen/verknüpfen.`
        : "Im Angebot ist keine belastbare Request-ID sichtbar. Offer-Bridge oder Anfrage-Zuordnung prüfen.",
      actionHref: customerLookupHref,
      actionLabel: offerRequestId ? "Kundenakte prüfen" : "Zuordnung prüfen",
    };
  }

  if (hasTrello && !hasRecord && !hasOffer) {
    return {
      tone: "blocked" as const,
      title: "Nur Trello gelesen",
      summary: "Trello reicht nicht als Source of Truth. Company Brain darf den Fehler erklären, aber keine Korrektur oder Versandaktion ausführen.",
      detail: [
        requestId ? `Request-ID aus Trello/Identifier: ${requestId}.` : null,
        trelloId ? `Trello: ${trelloId}.` : null,
        "Kundenakte oder Angebot verknüpfen und danach erneut prüfen.",
      ].filter(Boolean).join(" "),
      actionHref: customerLookupHref,
      actionLabel: requestId ? "Kundenakte prüfen" : "Mit Trello-ID suchen",
    };
  }

  if (!hasRecord) {
    return {
      tone: "warning" as const,
      title: "Kundenakte fehlt",
      summary: "Ohne eindeutige Kundenakte bleiben schreibende Fixes gesperrt.",
      detail: "Mit E-Mail, A/N, Request-ID oder Trello-ID erneut suchen.",
      actionHref: customerLookupHref,
      actionLabel: requestId ? "Kundenakte prüfen" : trelloId ? "Mit Trello-ID suchen" : "Erneut suchen",
    };
  }

  return {
    tone: "warning" as const,
    title: "Angebotskontext fehlt",
    summary: "Kundenakte ist geladen, aber das passende Angebot ist nicht eindeutig gefunden.",
    detail: "Angebotsnummer oder Trello-Link ergänzen, bevor Versandstatus oder Retry bewertet wird.",
    actionHref: `/ops/company-brain?query=${encodeURIComponent(result.records[0]?.requestId || result.query)}&problemType=offer_not_sent`,
    actionLabel: "Mit Request neu prüfen",
  };
}

function setupActionForIntegration(key: string, status: string) {
  if (status === "configured") return "Kein Setup-Blocker.";
  if (key === "live_outlook") return "Graph Tenant, Client, Secret und Mailbox in der Runtime setzen; danach Fall erneut laden.";
  if (key === "n8n_live") return "N8N_API_URL oder N8N_BASE_URL plus N8N_API_KEY in der Runtime setzen.";
  if (key === "coolify") return "COOLIFY_URL oder COOLIFY_API_URL plus COOLIFY_API_TOKEN setzen; App-UUID optional ergänzen.";
  return "Runtime-Konfiguration vervollständigen und erneut prüfen.";
}

function setupChecklistForIntegration(key: string, status: string) {
  if (status === "configured") return [];
  if (key === "live_outlook") {
    return [
      "MICROSOFT_GRAPH_TENANT_ID oder AZURE_TENANT_ID",
      "MICROSOFT_GRAPH_CLIENT_ID oder AZURE_CLIENT_ID",
      "MICROSOFT_GRAPH_CLIENT_SECRET oder AZURE_CLIENT_SECRET",
      "MICROSOFT_GRAPH_MAILBOX oder OUTLOOK_SHARED_MAILBOX",
    ];
  }
  if (key === "n8n_live") {
    return [
      "N8N_API_URL oder N8N_BASE_URL",
      "N8N_API_KEY",
      "workflow_audit_log schreibt weiterhin als Fallback",
    ];
  }
  if (key === "coolify") {
    return [
      "COOLIFY_URL oder COOLIFY_API_URL",
      "COOLIFY_API_TOKEN",
      "COOLIFY_APPLICATION_UUID optional für App-Details",
    ];
  }
  return ["Runtime-Variablen prüfen und Fall neu laden"];
}

function evidenceScoreLabel(status: string) {
  if (status === "strong") return "stark belegt";
  if (status === "medium") return "teilweise belegt";
  if (status === "conflicting") return "widersprüchlich";
  return "schwach belegt";
}

function shortText(value: string | null | undefined, max = 180) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function actionGroupKey(action: CompanyBrainActionProposalView): CompanyBrainActionGroupKey {
  if (["open_problem_case", "save_case_note", "create_internal_task", "prepare_offer_retry"].includes(action.key)) return "internal";
  if (["prepare_email_correction", "correct_customer_email", "post_trello_status_comment"].includes(action.key)) return "fix";
  if (action.key === "guarded_offer_resend") return "customer";
  return "manual";
}

function executableAction(actionKey: string) {
  return [
    "open_problem_case",
    "create_internal_task",
    "save_case_note",
    "prepare_email_correction",
    "correct_customer_email",
    "post_trello_status_comment",
    "prepare_offer_retry",
    "guarded_offer_resend",
  ].includes(actionKey);
}

function actionStateLabel(action: CompanyBrainActionProposalView) {
  if (action.key === "copy_reply_draft") return "Kopieren";
  if (action.href && !action.approvalRequired) return "Öffnen";
  if (!action.enabled) return "Nicht bereit";
  if (action.riskLevel === "high") return "Freigabe + Guard";
  if (action.approvalRequired) return "Freigabe";
  return "Bereit";
}

function actionButtonLabel(action: CompanyBrainActionProposalView) {
  if (action.key === "guarded_offer_resend") return "Versand freigeben";
  if (action.key === "correct_customer_email") return "E-Mail-Korrektur freigeben";
  if (action.key === "post_trello_status_comment") return "Kommentar freigeben";
  if (action.key === "save_case_note") return "Notiz speichern";
  if (action.key === "open_problem_case") return "Problemfall anlegen";
  return "Mit Freigabe ausführen";
}

export function OpsCompanyBrainClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [problemType, setProblemType] = useState<CompanyBrainProblemType | "">("");
  const [result, setResult] = useState<CompanyBrainResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [draftCopyMessage, setDraftCopyMessage] = useState<string | null>(null);
  const [actionCopyMessage, setActionCopyMessage] = useState<string | null>(null);
  const [actionResultMessage, setActionResultMessage] = useState<string | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pendingNewCustomerEmail, setPendingNewCustomerEmail] = useState("");
  const [pendingConfirmationText, setPendingConfirmationText] = useState("");
  const sharedOperatorNameKey = "neontrip-ops-operator";
  const initialUrlHandled = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(sharedOperatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // local storage is optional
    }
  }, []);

  useEffect(() => {
    if (operatorName) window.localStorage.setItem(sharedOperatorNameKey, operatorName);
  }, [operatorName]);

  const stats = useMemo(() => ({
    records: result?.records.length || 0,
    offers: result?.offers.length || 0,
    evidence: result?.evidence.length || 0,
    findings: (result?.gaps.length || 0) + (result?.conflicts.length || 0),
    automations: result?.automationRuns.length || 0,
    events: result?.caseEvents.length || 0,
    assets: result?.assets.length || 0,
    openWatchers: result?.watchers.filter((watcher) => watcher.status === "open").length || 0,
  }), [result]);
  const operatorView = useMemo(() => {
    if (!result) {
      return {
        readyActions: [],
        blockedFixes: [],
        sourceWarnings: [],
        decisionItems: [],
        setupBlockers: [],
        fixHistory: [],
        automationHistory: [],
        decision: null,
        brief: null,
        caseRoute: [],
        sourceOfTruth: null,
        primaryRun: null,
      };
    }
    const readyActions = result.actionProposals
      .filter((action) => action.enabled && executableAction(action.key))
      .slice(0, 3);
    const blockedFixes = uniqueStrings([
      ...result.retryAssessment.blockers,
      ...result.trelloFailureDiagnosis.blockedFixes,
    ]).slice(0, 5);
    const sourceWarnings = result.sourceHealth
      .filter((source) => source.status !== "ok")
      .slice(0, 4);
    const setupBlockers = result.integrationReadiness
      .filter((entry) => entry.status !== "configured")
      .map((entry) => ({
        key: entry.key,
        label: entry.label,
        status: entry.status,
        summary: entry.summary,
        nextStep: setupActionForIntegration(entry.key, entry.status),
        setupItems: setupChecklistForIntegration(entry.key, entry.status),
      }))
      .slice(0, 3);
    const fixHistory = result.automationRuns
      .filter(isCompanyBrainFixRun)
      .slice(0, 5);
    const automationHistory = result.automationRuns
      .filter((run) => !isCompanyBrainFixRun(run));
    const decisionItems = [
      ...result.checks
        .filter((check) => check.status === "warning" || check.status === "missing")
        .map((check) => ({ key: `check-${check.key}`, label: check.label, summary: check.summary, status: check.status })),
      ...result.crossChecks
        .filter((check) => check.status === "fail" || check.status === "review")
        .map((check) => ({ key: `cross-${check.key}`, label: check.label, summary: check.summary, status: check.status })),
    ].slice(0, 5);
    const primaryRun = [...automationHistory]
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())[0] || null;
    return {
      readyActions,
      blockedFixes,
      sourceWarnings,
      decisionItems,
      setupBlockers,
      fixHistory,
      automationHistory,
      decision: buildOperatorDecision(result),
      brief: buildOperatorBrief(result, readyActions),
      caseRoute: buildCaseRoute(result),
      sourceOfTruth: buildSourceOfTruthStatus(result),
      primaryRun,
    };
  }, [result]);
  const actionGroups = useMemo(() => {
    const proposals = result?.actionProposals || [];
    return ACTION_GROUPS.map((group) => ({
      ...group,
      actions: proposals.filter((action) => actionGroupKey(action) === group.key),
    })).filter((group) => group.actions.length);
  }, [result]);

  const quickQuestions = [
    "Ist das Angebot rausgegangen?",
    "Trello-Karte gezogen, aber Angebot nicht raus: warum?",
    "Welche Farbe ist belegt?",
    "Ist es ein 3D-Schild mit zwei Designs?",
    "Gab es eine Kundenbestätigung?",
  ];
  const problemTypeOptions: Array<{ value: CompanyBrainProblemType | ""; label: string }> = [
    { value: "", label: "Automatisch erkennen" },
    { value: "color_dispute", label: "Farbe falsch" },
    { value: "damaged_sign", label: "Schild beschädigt" },
    { value: "offer_not_sent", label: "Angebot nicht raus" },
    { value: "customer_waiting", label: "Kunde wartet" },
    { value: "design_unclear", label: "Design unklar" },
    { value: "delivery_problem", label: "Lieferproblem" },
    { value: "payment_order_unclear", label: "Zahlung/Bestellung" },
    { value: "automation_failed", label: "Automation Fehler" },
    { value: "other", label: "Sonstiges" },
  ];

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
  }

  async function resolveWith(
    values: { query: string; question: string; problemType: CompanyBrainProblemType | "" },
    options?: { actionResultMessage?: string | null },
  ) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/company-brain/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: values.query,
          question: values.question,
          problemType: values.problemType || null,
          limit: 5,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ResolveApiResponse | null;
      if (response.status === 401) {
        setHasSession(false);
        return false;
      }
      if (!response.ok || !payload?.ok || !payload.result) {
        setError(formatApiError(payload));
        return false;
      }
      setResult(payload.result);
      setCopyMessage(null);
      setDraftCopyMessage(null);
      setActionCopyMessage(null);
      setActionResultMessage(options?.actionResultMessage || null);
      setPendingActionKey(null);
      setPendingNewCustomerEmail("");
      setPendingConfirmationText("");
      return true;
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Fallprüfung konnte nicht geladen werden.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function resolve(event?: FormEvent) {
    event?.preventDefault();
    await resolveWith({ query, question, problemType });
  }

  useEffect(() => {
    if (initialUrlHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const initialQuery = params.get("query") || params.get("q") || "";
    const initialQuestion = params.get("question") || "";
    const initialProblemType = normalizeInitialProblemType(params.get("problemType"));
    const autoRun = params.get("auto") === "1";
    if (initialQuery) setQuery(initialQuery);
    if (initialQuestion) setQuestion(initialQuestion);
    if (initialProblemType) setProblemType(initialProblemType);
    if (!autoRun) {
      initialUrlHandled.current = true;
      return;
    }
    if (initialQuery.trim().length >= 2 && (hasSession || localMode || !opsEnabled)) {
      initialUrlHandled.current = true;
      void resolveWith({ query: initialQuery, question: initialQuestion, problemType: initialProblemType });
    }
  }, [hasSession, localMode, opsEnabled]);

  async function copyDossier() {
    if (!result?.dossier.copyText) return;
    try {
      await navigator.clipboard.writeText(result.dossier.copyText);
      setCopyMessage("Dossier kopiert.");
    } catch {
      setCopyMessage("Kopieren nicht möglich.");
    }
  }

  async function copyReplyDraft() {
    if (!result?.replyDraft.body) return;
    try {
      await navigator.clipboard.writeText(`Betreff: ${result.replyDraft.subject}\n\n${result.replyDraft.body}`);
      setDraftCopyMessage("Entwurf kopiert.");
    } catch {
      setDraftCopyMessage("Kopieren nicht möglich.");
    }
  }

  async function copyActionProposal(actionKey: string) {
    const action = result?.actionProposals.find((entry) => entry.key === actionKey);
    if (!action) return;
    try {
      await navigator.clipboard.writeText([
        action.label,
        action.summary,
        `Freigabe: ${action.approvalRequired ? "ja" : "nein"}`,
        `Risiko: ${action.riskLevel}`,
        "",
        ...action.payloadPreview,
      ].join("\n"));
      setActionCopyMessage(`${action.label} kopiert.`);
    } catch {
      setActionCopyMessage("Kopieren nicht möglich.");
    }
  }

  async function copyIntegrationSetup(entry: {
    label: string;
    status: string;
    summary: string;
    nextStep: string;
    setupItems: string[];
  }) {
    try {
      await navigator.clipboard.writeText([
        `Company Brain Setup: ${entry.label}`,
        `Status: ${entry.status}`,
        `Befund: ${entry.summary}`,
        `Nächster Schritt: ${entry.nextStep}`,
        "",
        "Benötigte Runtime-Variablen / Checks:",
        ...entry.setupItems.map((item) => `- ${item}`),
        "",
        "Hinweis: Nur Variablennamen/Checks, keine Secret-Werte im Chat oder Ticket posten.",
      ].join("\n"));
      setActionCopyMessage(`${entry.label} Setup-Paket kopiert.`);
    } catch {
      setActionCopyMessage("Kopieren nicht möglich.");
    }
  }

  function buildTrelloStatusComment() {
    if (!result) return null;
    return [
      "NEONTRIP Company Brain - interne Fallprüfung",
      "",
      `Status: ${result.retryAssessment.label}`,
      `Ursache: ${result.trelloFailureDiagnosis.rootCause || result.problemResolution.rootCause}`,
      `Nächster sicherer Schritt: ${result.retryAssessment.safeFixes[0] || result.trelloFailureDiagnosis.recommendedFix || result.problemResolution.recommendedResolution}`,
      result.retryAssessment.blockers.length ? `Blocker: ${result.retryAssessment.blockers.slice(0, 3).join(" | ")}` : null,
      "",
      "Hinweis: Trello ist nur Projektion. Source of Truth bleibt Kundenakte/Angebot/Outlook/Audit. Kein Kundenkontakt durch diesen Kommentar.",
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  function startActionProposal(actionKey: string) {
    setPendingActionKey(actionKey);
    setPendingNewCustomerEmail("");
    setPendingConfirmationText("");
    setActionResultMessage(null);
    window.setTimeout(() => {
      document.getElementById("company-brain-fix-center")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function cancelActionProposal() {
    setPendingActionKey(null);
    setPendingNewCustomerEmail("");
    setPendingConfirmationText("");
  }

  async function executeActionProposal(actionKey: string) {
    const action = result?.actionProposals.find((entry) => entry.key === actionKey);
    const primaryRecord = result?.records[0] || null;
    const primaryOffer = result?.offers[0] || null;
    if (!action || !result?.problemResolution) return;
    if (!primaryRecord) {
      setActionResultMessage("Aktion blockiert: keine Kundenakte/Request-ID als Source of Truth gefunden.");
      return;
    }
    const newCustomerEmail = actionKey === "correct_customer_email" ? pendingNewCustomerEmail.trim() : null;
    if (actionKey === "correct_customer_email" && !newCustomerEmail) {
      setActionResultMessage("Aktion abgebrochen: neue E-Mail fehlt.");
      return;
    }
    if (pendingConfirmationText.trim() !== "Freigabe") {
      setActionResultMessage("Aktion abgebrochen: Bestätigungstext fehlt.");
      return;
    }

    setActionLoadingKey(actionKey);
    setActionResultMessage(null);
    try {
      const response = await fetch("/api/ops/company-brain/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          requestId: primaryRecord.requestId,
          problemType: result.problemResolution.problemType,
          specialCaseKind: result.problemResolution.specialCaseKind,
          title: result.problemResolution.internalTaskTitle,
          description: result.problemResolution.internalTaskDescription,
          note: result.dossier.copyText,
          operatorName,
          assigneeLabel: operatorName || null,
          urgent: result.problemResolution.severity === "critical",
          offerId: result.retryAssessment.offerId || primaryOffer?.offerId || null,
          offerNumber: result.retryAssessment.offerNumber || primaryOffer?.offerNumber || null,
          recipientEmail: result.retryAssessment.recipientEmail || primaryRecord.email || primaryOffer?.customerEmail || null,
          trelloCardId:
            result.trelloFailureDiagnosis.card?.id ||
            primaryRecord.trelloCardId ||
            primaryOffer?.trelloCardId ||
            null,
          idempotencyKey: result.retryAssessment.idempotencyKey || null,
          subject: DEFAULT_OFFER_RETRY_SUBJECT,
          message: DEFAULT_OFFER_RETRY_MESSAGE,
          newCustomerEmail: newCustomerEmail?.trim() || null,
          trelloCommentText: actionKey === "post_trello_status_comment" ? buildTrelloStatusComment() : null,
          confirmed: true,
          confirmationText: pendingConfirmationText,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        issues?: string[];
        task?: { id?: string };
        note?: { id?: string };
        specialCase?: unknown;
        sent?: boolean;
        duplicate?: boolean;
        blockers?: string[];
        changedTables?: Record<string, number>;
        trelloComment?: { id?: string } | null;
      } | null;
      if (!response.ok || !payload?.ok) {
        setActionResultMessage(payload?.blockers?.length ? payload.blockers.join(" ") : formatApiError(payload));
        return;
      }
      const created = [
        payload.sent ? (payload.duplicate ? "Versand bereits idempotent vorhanden" : "Angebot erneut gesendet") : null,
        payload.changedTables ? "Kunden-E-Mail aktualisiert" : null,
        payload.trelloComment?.id ? "Trello-Kommentar geschrieben" : null,
        payload.task?.id ? `Aufgabe ${payload.task.id}` : null,
        payload.note?.id ? `Notiz ${payload.note.id}` : null,
        payload.specialCase ? "Problemfall-Audit" : null,
      ].filter(Boolean).join(", ");
      const successMessage = created ? `Ausgeführt: ${created}.` : "Aktion ausgeführt.";
      cancelActionProposal();
      const refreshed = await resolveWith(
        { query, question, problemType },
        { actionResultMessage: `${successMessage} Fall neu geladen.` },
      );
      if (!refreshed) {
        setActionResultMessage(`${successMessage} Fall konnte nicht automatisch neu geladen werden.`);
      }
    } catch (executeError) {
      setActionResultMessage(executeError instanceof Error ? executeError.message : "Aktion konnte nicht ausgeführt werden.");
    } finally {
      setActionLoadingKey(null);
    }
  }

  if (opsEnabled && !hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Company Brain"
        title="Company Brain anmelden"
        description="Fallprüfung, Angebotsstatus und Kommunikationsbelege bleiben im geschützten Ops-Bereich."
        activeApp="companyBrain"
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
    <div className={`${opsPageShellClass} px-4 py-6 md:px-6`}>
      <div className={`${opsPageContainerClass} space-y-6`}>
        <OpsPageHeader active="companyBrain" label="Company Brain" />

        <OpsPageIntro
          eyebrow="Fallprüfung"
          title="Company Brain"
          description="Kundenakte, Angebote, Outlook-Spiegel und operative Timeline in einer read-only Prüfung."
        >
          <input
            value={operatorName}
            onChange={(event) => setOperatorName(event.target.value)}
            className="h-12 w-full rounded-2xl border border-white/12 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-white/[0.42] focus:border-white/35 sm:w-52"
            placeholder="Operator"
            aria-label="Operator"
          />
          <button
            type="button"
            onClick={() => void resolve()}
            disabled={loading || query.trim().length < 2}
            className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-medium text-stone-950 transition hover:bg-[#f7f2ea] disabled:opacity-60"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Prüft..." : "Prüfen"}
          </button>
        </OpsPageIntro>

        {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">{error}</div> : null}

        <form onSubmit={resolve} className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(220px,0.55fr)_auto] lg:items-end">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-stone-800">Fall, E-Mail, Angebotsnummer, Trello-ID</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 rounded-2xl border border-stone-300 px-4 text-sm outline-none focus:border-stone-950"
                placeholder="AN-4798, kunde@domain.de, Request-ID..."
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-stone-800">Frage</span>
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="h-12 rounded-2xl border border-stone-300 px-4 text-sm outline-none focus:border-stone-950"
                placeholder="Ist das Angebot raus? Welche Farbe war bestätigt?"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-stone-800">Problemfall</span>
              <select
                value={problemType}
                onChange={(event) => setProblemType(event.target.value as CompanyBrainProblemType | "")}
                className="h-12 rounded-2xl border border-stone-300 bg-white px-4 text-sm outline-none focus:border-stone-950"
              >
                {problemTypeOptions.map((option) => (
                  <option key={option.value || "auto"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={loading || query.trim().length < 2}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-60"
            >
              <Search className="h-4 w-4" />
              Suchen
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {quickQuestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setQuestion(prompt)}
                className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-950 hover:text-stone-950"
              >
                {prompt}
              </button>
            ))}
          </div>
        </form>

        {result ? (
          <>
            <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <OpsStatCard label="Kundenakten" value={stats.records} icon={<BrainCircuit className="h-5 w-5" />} />
              <OpsStatCard label="Angebote" value={stats.offers} tone="info" icon={<FileSearch className="h-5 w-5" />} />
              <OpsStatCard label="Belege" value={stats.evidence} tone="success" icon={<MailCheck className="h-5 w-5" />} />
              <OpsStatCard label="Fallakte" value={stats.events} tone="info" icon={<History className="h-5 w-5" />} />
              <OpsStatCard label="Assets" value={stats.assets} tone="neutral" icon={<PackageSearch className="h-5 w-5" />} />
              <OpsStatCard label="Watcher" value={stats.openWatchers} tone={stats.openWatchers ? "warning" : "success"} icon={<Bell className="h-5 w-5" />} />
            </section>

            <section className="overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-sm">
              <div className="border-b border-stone-200 bg-stone-950 px-5 py-5 text-white md:px-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-4xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Fall-Kommandostand</p>
                    <h2 className="mt-2 text-2xl font-semibold leading-tight">Was ist passiert und was darf jetzt sicher passieren?</h2>
                    <p className="mt-2 text-sm leading-6 text-white/70">{result.answer.headline}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${verdictClass(result.answer.verdict)}`}>
                      {result.answer.verdict === "found" ? "Belegt" : result.answer.verdict === "not_found" ? "Nicht gefunden" : "Prüfen"}
                    </span>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${evidenceScoreClass(result.evidenceScore.status)}`}>
                      {result.evidenceScore.score}/100 · {evidenceScoreLabel(result.evidenceScore.status)}
                    </span>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${retryAssessmentClass(result.retryAssessment.status)}`}>
                      {retryAssessmentLabel(result.retryAssessment.status)}
                    </span>
                  </div>
                </div>
              </div>

              {operatorView.brief ? (
                <div className="border-b border-stone-200 bg-white px-5 py-5 md:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 max-w-3xl">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Sofortbild</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-2xl font-semibold leading-tight text-stone-950">{operatorView.brief.title}</h3>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${operatorDecisionClass(operatorView.brief.tone)}`}>
                          {operatorView.brief.customerContactLine}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-stone-600">{operatorView.brief.subtitle}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-600">
                        {operatorView.brief.evidenceLine}
                      </span>
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-600">
                        {operatorView.brief.sourceLine}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(280px,0.82fr)]">
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Ursache in Klartext</p>
                      <p className="mt-2 text-sm font-medium leading-6 text-stone-900">{operatorView.brief.cause}</p>
                    </div>
                    <div className={`rounded-2xl border px-4 py-3 ${operatorDecisionClass(operatorView.brief.tone)}`}>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-65">Erlaubter nächster Schritt</p>
                      <p className="mt-2 text-sm font-semibold leading-6">{operatorView.brief.nextStep}</p>
                      {operatorView.brief.firstBlocker ? (
                        <p className="mt-2 text-xs leading-5 opacity-80">Blocker: {operatorView.brief.firstBlocker}</p>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Direktaktion</p>
                      {operatorView.brief.primaryAction ? (
                        <>
                          <p className="mt-2 text-sm font-semibold leading-5 text-stone-950">{operatorView.brief.primaryAction.label}</p>
                          <p className="mt-1 text-xs leading-5 text-stone-500">{shortText(operatorView.brief.primaryAction.summary, 120)}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void copyActionProposal(operatorView.brief?.primaryAction?.key || "")}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-[11px] font-semibold text-stone-700 transition hover:border-stone-950"
                            >
                              <ClipboardCopy className="h-3.5 w-3.5" />
                              Paket
                            </button>
                            <button
                              type="button"
                              onClick={() => operatorView.brief?.primaryAction ? startActionProposal(operatorView.brief.primaryAction.key) : undefined}
                              disabled={!operatorView.brief.primaryAction.enabled || actionLoadingKey === operatorView.brief.primaryAction.key}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-stone-950 px-2.5 text-[11px] font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50"
                            >
                              Freigeben
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 text-sm leading-6 text-stone-600">Keine ausführbare Aktion. Erst offene Quellen oder Blocker klären.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="border-b border-stone-200 bg-stone-50 px-5 py-5 md:px-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Fall-Route</p>
                    <h3 className="mt-1 text-lg font-semibold text-stone-950">Vom Kartenfehler zur sicheren Aktion</h3>
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-stone-600">
                    Diese vier Schritte trennen Beleglage, Datenkorrektur und Kundenkontakt. Trello bleibt nur Projektion; Fixes laufen erst nach Freigabe und Server-Guard.
                  </p>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-4">
                  {operatorView.caseRoute.map((step) => (
                    <div key={step.key} className={`rounded-2xl border px-4 py-3 ${routeStepClass(step.tone)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-65">{step.label}</p>
                        <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold">{routeStepBadge(step.tone)}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold leading-5">{step.title}</p>
                      <p className="mt-1 text-xs leading-5 opacity-80">{step.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-0 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
                <div className="border-b border-stone-200 p-5 md:p-6 xl:border-b-0 xl:border-r">
                  <div className="grid gap-3">
                    {operatorView.decision ? (
                      <div className={`rounded-2xl border px-4 py-3 ${operatorDecisionClass(operatorView.decision.tone)}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-65">Entscheidung</p>
                            <h3 className="mt-2 text-lg font-semibold leading-6">{operatorView.decision.title}</h3>
                            <p className="mt-2 text-sm leading-6 opacity-85">{operatorView.decision.summary}</p>
                          </div>
                          <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold">
                            {result.retryAssessment.canSendWithConfirmation ? "Guarded Fix" : result.retryAssessment.status}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          {(operatorView.decision.steps.length ? operatorView.decision.steps : ["Fall erneut mit konkreter Frage laden."]).slice(0, 3).map((step, index) => (
                            <div key={`${index}-${step}`} className="rounded-xl border border-current/15 bg-white/45 px-3 py-2 text-xs leading-5">
                              <span className="font-semibold">{index + 1}. </span>{step}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-start gap-3">
                        {result.answer.verdict === "found" ? <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-600" />}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Kurzfazit</p>
                          <div className="mt-2 grid gap-1.5">
                            {result.answer.bullets.slice(0, 3).map((bullet) => (
                              <p key={bullet} className="text-sm leading-6 text-stone-800">{bullet}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {result.trelloFailureDiagnosis.requested ? (
                      <div className={`rounded-2xl border px-4 py-3 text-sm ${trelloFailureClass(result.trelloFailureDiagnosis.severity)}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">Trello-/n8n-Fehler</p>
                            <p className="mt-2 font-semibold leading-6">{result.trelloFailureDiagnosis.rootCause}</p>
                            <p className="mt-1 leading-6 opacity-80">{result.trelloFailureDiagnosis.recommendedFix}</p>
                          </div>
                          <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold">
                            Duplicate: {result.trelloFailureDiagnosis.duplicateRisk}
                          </span>
                        </div>
                        <dl className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                          <div className="rounded-xl border border-current/15 bg-white/40 px-3 py-2">
                            <dt className="opacity-65">Karte</dt>
                            <dd className="mt-1 font-medium">{result.trelloFailureDiagnosis.card?.currentListName || "Liste unbekannt"} · {result.trelloFailureDiagnosis.card?.id || "keine ID"}</dd>
                          </div>
                          <div className="rounded-xl border border-current/15 bg-white/40 px-3 py-2">
                            <dt className="opacity-65">Letzter Move</dt>
                            <dd className="mt-1 font-medium">
                              {result.trelloFailureDiagnosis.triggerMove
                                ? `${result.trelloFailureDiagnosis.triggerMove.fromListName || "unbekannt"} -> ${result.trelloFailureDiagnosis.triggerMove.toListName || "unbekannt"}`
                                : "nicht gefunden"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Ursache</p>
                        <p className="mt-2 text-sm leading-6 text-stone-800">{result.problemResolution.rootCause}</p>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Sicherer nächster Schritt</p>
                        <p className="mt-2 text-sm leading-6 text-stone-800">{result.retryAssessment.safeFixes[0] || result.problemResolution.recommendedResolution}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Automation</p>
                        <p className="mt-2 text-sm font-semibold text-stone-950">
                          {operatorView.primaryRun?.status || result.trelloFailureDiagnosis.rootCauseKey || "unbekannt"}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-stone-500">
                          {operatorView.primaryRun?.executionId ? `Execution ${operatorView.primaryRun.executionId}` : shortText(operatorView.primaryRun?.summary || result.trelloFailureDiagnosis.rootCause, 110)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Beweislage</p>
                        <p className="mt-2 text-sm font-semibold text-stone-950">{result.evidenceScore.score}/100</p>
                        <p className="mt-1 text-xs leading-5 text-stone-500">{result.evidenceScore.summary}</p>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Kundenkontakt</p>
                        <p className="mt-2 text-sm font-semibold text-stone-950">
                          {result.retryAssessment.canSendWithConfirmation ? "nur guarded" : "gesperrt"}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-stone-500">
                          {result.replyDraft.approvalRequired ? "Antwort/Versand bleibt freigabepflichtig." : "Kein Kundenkontakt vorbereitet."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${retryAssessmentClass(result.retryAssessment.status)}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{result.retryAssessment.label}</p>
                        <p className="mt-1 leading-6 opacity-80">{result.retryAssessment.summary}</p>
                      </div>
                      <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold">
                        {result.retryAssessment.canSendWithConfirmation ? "Versand-Action guarded" : "Versand blockiert"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <p className="rounded-xl border border-current/15 bg-white/40 px-3 py-2 text-xs">Empfänger: {result.retryAssessment.recipientEmail || "unbekannt"}</p>
                      <p className="rounded-xl border border-current/15 bg-white/40 px-3 py-2 text-xs">Angebot: {result.retryAssessment.offerNumber || result.retryAssessment.offerId || "unbekannt"}</p>
                    </div>
                  </div>
                </div>

                <aside className="p-5 md:p-6 xl:pr-28">
                  {operatorView.sourceOfTruth ? (
                    <div className={`rounded-2xl border px-4 py-3 ${routeStepClass(operatorView.sourceOfTruth.tone)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-65">Source of Truth</p>
                          <h3 className="mt-2 text-sm font-semibold leading-5">{operatorView.sourceOfTruth.title}</h3>
                          <p className="mt-1 text-xs leading-5 opacity-85">{operatorView.sourceOfTruth.summary}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold">
                          {routeStepBadge(operatorView.sourceOfTruth.tone)}
                        </span>
                      </div>
                      <p className="mt-3 rounded-xl border border-current/15 bg-white/45 px-3 py-2 text-xs leading-5">
                        {operatorView.sourceOfTruth.detail}
                      </p>
                      {operatorView.sourceOfTruth.actionHref ? (
                        <a href={operatorView.sourceOfTruth.actionHref} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 bg-white/45 px-2.5 text-xs font-semibold transition hover:bg-white/70">
                          {operatorView.sourceOfTruth.actionLabel}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-stone-950">Jetzt möglich</p>
                      <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-500">
                        {operatorView.readyActions.length} Aktion(en)
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {operatorView.readyActions.length ? operatorView.readyActions.map((action) => (
                        <div key={`ready-${action.key}`} className={`rounded-xl border px-3 py-2 text-sm ${severityBadgeClass(action.riskLevel)}`}>
                          <p className="font-semibold">{action.label}</p>
                          <p className="mt-1 text-xs leading-5 opacity-80">{shortText(action.summary, 150)}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void copyActionProposal(action.key)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 px-2.5 text-[11px] font-semibold transition hover:bg-white/60"
                            >
                              <ClipboardCopy className="h-3.5 w-3.5" />
                              Paket
                            </button>
                            <button
                              type="button"
                              onClick={() => startActionProposal(action.key)}
                              disabled={!action.enabled || actionLoadingKey === action.key}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 bg-white/50 px-2.5 text-[11px] font-semibold transition hover:bg-white disabled:opacity-50"
                            >
                              {actionLoadingKey === action.key ? "läuft..." : "Freigeben"}
                            </button>
                          </div>
                        </div>
                      )) : (
                        <p className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm leading-6 text-stone-600">Kein direkter Fix freigegeben. Erst die Blocker unten klären.</p>
                      )}
                    </div>
                    {actionCopyMessage ? <p className="mt-3 text-xs font-medium text-stone-500">{actionCopyMessage}</p> : null}
                    {actionResultMessage ? <p className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700">{actionResultMessage}</p> : null}
                  </div>

                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-950">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">Nicht automatisch machen</p>
                      <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold">{operatorView.blockedFixes.length}</span>
                    </div>
                    <div className="mt-3 grid gap-1.5">
                      {(operatorView.blockedFixes.length ? operatorView.blockedFixes : ["Keine harten Blocker im geladenen Ergebnis."]).map((blocker) => (
                        <p key={blocker} className="text-xs leading-5 opacity-85">{blocker}</p>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-stone-950">System-Blocker</p>
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-500">
                        {operatorView.setupBlockers.length}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {operatorView.setupBlockers.length ? operatorView.setupBlockers.map((entry) => (
                        <div key={`setup-${entry.key}`} className={`rounded-xl border px-3 py-2 text-sm ${readinessClass(entry.status)}`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold">{entry.label}</p>
                            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium">{readinessLabel(entry.status)}</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 opacity-80">{shortText(entry.summary, 140)}</p>
                          <p className="mt-2 rounded-lg border border-current/15 bg-white/50 px-2.5 py-1.5 text-xs leading-5">{entry.nextStep}</p>
                          {entry.setupItems.length ? (
                            <div className="mt-2 rounded-lg border border-current/15 bg-white/50 px-2.5 py-1.5">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-60">Benötigte Runtime-Variablen</p>
                              <div className="mt-1 grid gap-1">
                                {entry.setupItems.map((item) => (
                                  <p key={item} className="text-xs leading-5 opacity-80">{item}</p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {entry.setupItems.length ? (
                            <button
                              type="button"
                              onClick={() => void copyIntegrationSetup(entry)}
                              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 bg-white/50 px-2.5 text-[11px] font-semibold transition hover:bg-white"
                            >
                              <ClipboardCopy className="h-3.5 w-3.5" />
                              Setup-Paket kopieren
                            </button>
                          ) : null}
                        </div>
                      )) : (
                        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">Alle Live-Integrationen sind als konfiguriert erkannt.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-stone-950">Schon erledigt</p>
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-500">
                        {operatorView.fixHistory.length}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {operatorView.fixHistory.length ? operatorView.fixHistory.map((run) => (
                        <div key={`fix-history-${run.id}`} className={`rounded-xl border px-3 py-2 text-sm ${runStatusClass(run.status, run.retrySafety)}`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold">{fixHistoryLabel(run.action)}</p>
                            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium">{run.status || "ok"}</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 opacity-80">{run.summary || "Interne Company-Brain-Aktion wurde protokolliert. Kein Kundenkontakt."}</p>
                          <p className="mt-1 text-[11px] opacity-65">{formatDateTime(run.createdAt)}</p>
                        </div>
                      )) : (
                        <p className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm leading-6 text-stone-600">Noch keine Fix-Center-Aktion für diesen Fall protokolliert.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-stone-950">Offen zu prüfen</p>
                        <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-500">{operatorView.decisionItems.length}</span>
                      </div>
                      <div className="mt-2 grid gap-2">
                        {operatorView.decisionItems.length ? operatorView.decisionItems.map((item) => (
                          <div key={item.key} className={`rounded-xl border px-3 py-2 text-sm ${item.status === "fail" || item.status === "missing" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
                            <p className="font-semibold">{item.label}</p>
                            <p className="mt-1 text-xs leading-5 opacity-80">{shortText(item.summary, 145)}</p>
                          </div>
                        )) : (
                          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">Keine offenen Kernchecks.</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-stone-950">Quellen-Ampel</p>
                      <div className="mt-2 grid gap-2">
                        {operatorView.sourceWarnings.length ? operatorView.sourceWarnings.map((source) => (
                          <div key={`source-${source.key}`} className={`rounded-xl border px-3 py-2 text-sm ${sourceHealthClass(source.status)}`}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold">{source.label}</p>
                              <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium">{sourceHealthLabel(source.status)}</span>
                            </div>
                            <p className="mt-1 text-xs leading-5 opacity-80">{shortText(source.summary, 145)}</p>
                          </div>
                        )) : (
                          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">Alle Kernquellen melden OK.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </section>

            <section id="company-brain-fix-center" className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Fix Center</p>
                  <h2 className="mt-2 text-xl font-semibold text-stone-950">Was kann jetzt wirklich ausgeführt werden?</h2>
                  <p className="mt-2 text-sm leading-6 text-stone-600">Interne Sicherung, Datenkorrektur und Kundenkontakt sind getrennt. Jede ausführende Aktion braucht die sichtbare Freigabe.</p>
                </div>
                <ClipboardList className="h-6 w-6 text-stone-500" />
              </div>
              {actionCopyMessage ? <p className="mt-3 text-xs font-medium text-stone-500">{actionCopyMessage}</p> : null}
              {actionResultMessage ? <p className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-medium text-stone-700">{actionResultMessage}</p> : null}
              <div className="mt-4 grid gap-4 xl:grid-cols-4">
                {actionGroups.map((group) => (
                  <div key={`visible-${group.key}`} className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-stone-950">{group.title}</h3>
                        <p className="mt-1 text-xs leading-5 text-stone-500">{group.detail}</p>
                      </div>
                      <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500">{group.actions.length}</span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {group.actions.map((action) => {
                        const pending = pendingActionKey === action.key;
                        const highRiskCustomerContact = action.key === "guarded_offer_resend";
                        return (
                          <div key={`visible-${action.key}`} className={`rounded-xl border px-3 py-2 text-xs ${riskClass(action.riskLevel)}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold">{action.label}</p>
                                <p className="mt-1 leading-5 opacity-80">{shortText(action.summary, 120)}</p>
                              </div>
                              <span className="shrink-0 rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-medium opacity-80">{actionStateLabel(action)}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void copyActionProposal(action.key)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 px-2.5 font-semibold transition hover:bg-white/60"
                              >
                                <ClipboardCopy className="h-3.5 w-3.5" />
                                Paket
                              </button>
                              {action.href ? (
                                <a href={action.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 px-2.5 font-semibold transition hover:bg-white/60">
                                  Öffnen <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                              {executableAction(action.key) ? (
                                <button
                                  type="button"
                                  onClick={() => startActionProposal(action.key)}
                                  disabled={!action.enabled || actionLoadingKey === action.key}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 bg-white/50 px-2.5 font-semibold transition hover:bg-white disabled:opacity-50"
                                >
                                  {actionLoadingKey === action.key ? "läuft..." : actionButtonLabel(action)}
                                </button>
                              ) : null}
                            </div>
                            {pending ? (
                              <div className="mt-3 rounded-xl border border-current/20 bg-white/70 p-3 leading-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-semibold">Freigabe prüfen</p>
                                  <button type="button" onClick={cancelActionProposal} className="rounded-lg border border-current/20 px-2 py-1 font-medium transition hover:bg-white">
                                    Abbrechen
                                  </button>
                                </div>
                                {highRiskCustomerContact ? (
                                  <p className="mt-2 font-medium">Diese Aktion kann Kundenkontakt auslösen. Der Server prüft Empfänger, Duplicate-Belege und Bounces direkt vor dem Versand erneut.</p>
                                ) : (
                                  <p className="mt-2 opacity-80">Diese Aktion bleibt intern, sofern die Serverantwort nichts anderes meldet.</p>
                                )}
                                {action.key === "correct_customer_email" ? (
                                  <label className="mt-3 grid gap-1">
                                    <span className="font-medium">Neue Kunden-E-Mail</span>
                                    <input
                                      value={pendingNewCustomerEmail}
                                      onChange={(event) => setPendingNewCustomerEmail(event.target.value)}
                                      className="h-10 rounded-xl border border-current/20 bg-white px-3 text-sm text-stone-950 outline-none focus:border-stone-950"
                                      placeholder="kunde@example.de"
                                    />
                                  </label>
                                ) : null}
                                <label className="mt-3 grid gap-1">
                                  <span className="font-medium">Bestätigung</span>
                                  <input
                                    value={pendingConfirmationText}
                                    onChange={(event) => setPendingConfirmationText(event.target.value)}
                                    className="h-10 rounded-xl border border-current/20 bg-white px-3 text-sm text-stone-950 outline-none focus:border-stone-950"
                                    placeholder="Freigabe"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => void executeActionProposal(action.key)}
                                  disabled={actionLoadingKey === action.key}
                                  className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50"
                                >
                                  {actionLoadingKey === action.key ? "Führt aus..." : "Jetzt ausführen"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <details className="group rounded-[2rem] border border-stone-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-stone-950 marker:hidden md:px-6">
                <span>Alle Belege, Quellen und Detailmatrizen anzeigen</span>
                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-500 group-open:hidden">öffnen</span>
                <span className="hidden rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-500 group-open:inline">schließen</span>
              </summary>
              <div className="border-t border-stone-200 p-5 md:p-6">
            <section className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="space-y-6">
                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Antwort</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">{result.answer.headline}</h2>
                    </div>
                    {result.answer.verdict === "found" ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-amber-600" />}
                  </div>
                  <div className="mt-4 grid gap-3">
                    {result.answer.bullets.map((bullet) => (
                      <p key={bullet} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
                        {bullet}
                      </p>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Problemfall-Modus</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">{result.problemResolution.label}</h2>
                    </div>
                    <span className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${evidenceScoreClass(result.evidenceScore.status)}`}>
                      Beweis: {result.evidenceScore.score}/100
                    </span>
                  </div>
                  <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${evidenceScoreClass(result.evidenceScore.status)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold">{result.evidenceScore.summary}</span>
                      <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium">
                        Kundenantwort: {result.evidenceScore.safeToAnswerCustomer ? "möglich" : "erst prüfen"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-1 text-xs leading-5 opacity-80">
                      {result.evidenceScore.reasons.slice(0, 5).map((reason) => <p key={reason}>{reason}</p>)}
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Ursache</dt>
                      <dd className="mt-2 leading-6 text-stone-700">{result.problemResolution.rootCause}</dd>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Empfohlene Lösung</dt>
                      <dd className="mt-2 leading-6 text-stone-700">{result.problemResolution.recommendedResolution}</dd>
                    </div>
                  </dl>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                      <p className="font-semibold text-stone-950">Fehlende Belege</p>
                      <div className="mt-2 grid gap-1 text-xs leading-5 text-stone-600">
                        {(result.problemResolution.missingEvidence.length ? result.problemResolution.missingEvidence : ["Keine kritischen Lücken aus dem Playbook."]).map((entry) => <p key={entry}>{entry}</p>)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                      <p className="font-semibold text-stone-950">Eskalation</p>
                      <div className="mt-2 grid gap-1 text-xs leading-5 text-stone-600">
                        {result.problemResolution.escalationPath.map((entry) => <p key={entry}>{entry}</p>)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                    <p className="font-semibold text-stone-950">Kundenantwort-Guardrails</p>
                    <div className="mt-2 grid gap-1 text-xs leading-5 text-stone-600">
                      {result.problemResolution.customerReplyPolicy.map((entry) => <p key={entry}>{entry}</p>)}
                    </div>
                  </div>
                </article>

                {result.trelloFailureDiagnosis.requested ? (
                  <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Trello-Triggerdiagnose</p>
                        <h2 className="mt-2 text-xl font-semibold text-stone-950">
                          {result.trelloFailureDiagnosis.card?.name || "Kartenbewegung prüfen"}
                        </h2>
                      </div>
                      <span className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${trelloFailureClass(result.trelloFailureDiagnosis.severity)}`}>
                        {result.trelloFailureDiagnosis.status}
                      </span>
                    </div>
                    <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${trelloFailureClass(result.trelloFailureDiagnosis.severity)}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{result.trelloFailureDiagnosis.rootCause}</p>
                          <p className="mt-2 leading-6 opacity-80">{result.trelloFailureDiagnosis.recommendedFix}</p>
                        </div>
                        <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium">
                          Duplicate: {result.trelloFailureDiagnosis.duplicateRisk}
                        </span>
                      </div>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Karte</dt>
                        <dd className="mt-2 leading-6 text-stone-700">
                          {result.trelloFailureDiagnosis.card
                            ? `${result.trelloFailureDiagnosis.card.currentListName || "Liste unbekannt"} · ${result.trelloFailureDiagnosis.card.id}`
                            : "Nicht geladen"}
                        </dd>
                        {result.trelloFailureDiagnosis.card?.url ? (
                          <a href={result.trelloFailureDiagnosis.card.url} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-stone-800 hover:text-stone-950">
                            Karte öffnen <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Letzter Move</dt>
                        <dd className="mt-2 leading-6 text-stone-700">
                          {result.trelloFailureDiagnosis.triggerMove
                            ? `${result.trelloFailureDiagnosis.triggerMove.fromListName || "unbekannt"} -> ${result.trelloFailureDiagnosis.triggerMove.toListName || "unbekannt"}`
                            : "Kein Listenwechsel im geladenen Fenster"}
                        </dd>
                        <p className="mt-1 text-xs text-stone-500">{formatDateTime(result.trelloFailureDiagnosis.triggerMove?.occurredAt || null)}</p>
                      </div>
                    </dl>
                    {result.trelloFailureDiagnosis.card?.descriptionPreview || result.trelloFailureDiagnosis.card?.customFields.length ? (
                      <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                        {result.trelloFailureDiagnosis.card.descriptionPreview ? (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Beschreibung</p>
                            <p className="mt-2 leading-6 text-stone-700">{result.trelloFailureDiagnosis.card.descriptionPreview}</p>
                          </div>
                        ) : null}
                        {result.trelloFailureDiagnosis.card.customFields.length ? (
                          <div className={result.trelloFailureDiagnosis.card.descriptionPreview ? "mt-4" : ""}>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Kartenfelder</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {result.trelloFailureDiagnosis.card.customFields.slice(0, 8).map((field) => (
                                <div key={`${field.name}-${field.value}`} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
                                  <p className="text-[11px] font-medium text-stone-400">{field.name}</p>
                                  <p className="mt-1 text-xs font-medium text-stone-700">{field.value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        <p className="font-semibold">Sichere Fixes</p>
                        <div className="mt-2 grid gap-1 text-xs leading-5 opacity-80">
                          {(result.trelloFailureDiagnosis.safeFixes.length ? result.trelloFailureDiagnosis.safeFixes : ["Kein automatischer Fix ohne weitere Belege."]).map((entry) => <p key={entry}>{entry}</p>)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                        <p className="font-semibold">Blockiert</p>
                        <div className="mt-2 grid gap-1 text-xs leading-5 opacity-80">
                          {result.trelloFailureDiagnosis.blockedFixes.map((entry) => <p key={entry}>{entry}</p>)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-stone-950">
                        <GitBranch className="h-4 w-4" />
                        Karten-Timeline
                      </div>
                      <div className="mt-3 grid gap-2">
                        {result.trelloFailureDiagnosis.timeline.length ? result.trelloFailureDiagnosis.timeline.slice(0, 6).map((entry) => (
                          <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
                            <span className="font-medium text-stone-900">{entry.label}</span>
                            <span>{formatDateTime(entry.occurredAt)}</span>
                          </div>
                        )) : (
                          <p className="text-xs text-stone-600">Keine Trello-Aktionen geladen.</p>
                        )}
                      </div>
                    </div>
                  </article>
                ) : null}

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Fall-Dossier</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">{result.dossier.title}</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyDossier()}
                      className="inline-flex h-10 items-center gap-2 rounded-2xl border border-stone-200 px-3 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                    >
                      <ClipboardCopy className="h-4 w-4" />
                      Kopieren
                    </button>
                  </div>
                  {copyMessage ? <p className="mt-3 text-xs font-medium text-stone-500">{copyMessage}</p> : null}
                  <div className="mt-4 max-h-80 overflow-auto rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-stone-700">{result.dossier.copyText}</pre>
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Prüfmatrix</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Belegstatus</h2>
                    </div>
                    <ShieldCheck className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {(result.checks || []).map((check) => (
                      <div key={check.key} className={`rounded-2xl border px-4 py-3 text-sm ${checkClass(check.status)}`}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold">{check.label}</p>
                          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                            {statusLabel(check.status)}
                          </span>
                        </div>
                        <p className="mt-2 leading-6 opacity-80">{check.summary}</p>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Konfliktmatrix</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Erwartet vs. belegt</h2>
                    </div>
                    <ListChecks className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {(result.crossChecks || []).map((check) => (
                      <div key={check.key} className={`rounded-2xl border px-4 py-3 text-sm ${crossCheckClass(check.status)}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{check.label}</p>
                            <p className="mt-1 leading-6 opacity-80">{check.summary}</p>
                          </div>
                          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                            {crossCheckLabel(check.status)}
                          </span>
                        </div>
                        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="opacity-60">Erwartet</dt>
                            <dd className="font-medium">{check.expected || "Keine Angabe"}</dd>
                          </div>
                          <div>
                            <dt className="opacity-60">Belegt</dt>
                            <dd className="font-medium">{check.actual || "Keine Angabe"}</dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Antwortentwurf</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Nur mit Freigabe</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <MessageSquareText className="h-5 w-5 text-stone-500" />
                      <button
                        type="button"
                        onClick={() => void copyReplyDraft()}
                        className="inline-flex h-10 items-center gap-2 rounded-2xl border border-stone-200 px-3 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                      >
                        <ClipboardCopy className="h-4 w-4" />
                        Entwurf kopieren
                      </button>
                    </div>
                  </div>
                  <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${riskClass(result.replyDraft.riskLevel)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold">Freigabe erforderlich</span>
                      <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium">
                        Risiko: {result.replyDraft.riskLevel}
                      </span>
                    </div>
                    <p className="mt-2 leading-6 opacity-80">Dieser Entwurf wird nicht automatisch versendet und darf vor Kundenkontakt fachlich angepasst werden.</p>
                  </div>
                  {draftCopyMessage ? <p className="mt-3 text-xs font-medium text-stone-500">{draftCopyMessage}</p> : null}
                  <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <p className="text-sm font-semibold text-stone-950">{result.replyDraft.subject}</p>
                    <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-stone-700">{result.replyDraft.body}</pre>
                  </div>
                  {result.replyDraft.blockers.length ? (
                    <div className="mt-4 grid gap-2">
                      {result.replyDraft.blockers.map((blocker) => (
                        <p key={blocker} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
                          {blocker}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Action Center</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Vorbereitete Aktionen</h2>
                    </div>
                    <ClipboardList className="h-6 w-6 text-stone-500" />
                  </div>
                  {actionCopyMessage ? <p className="mt-3 text-xs font-medium text-stone-500">{actionCopyMessage}</p> : null}
                  {actionResultMessage ? <p className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-medium text-stone-700">{actionResultMessage}</p> : null}
                  <div className="mt-4 grid gap-4">
                    {actionGroups.map((group) => (
                      <section key={group.key} className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2 px-1">
                          <div>
                            <h3 className="text-sm font-semibold text-stone-950">{group.title}</h3>
                            <p className="mt-1 text-xs leading-5 text-stone-500">{group.detail}</p>
                          </div>
                          <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500">
                            {group.actions.length}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-3">
                          {group.actions.map((action) => {
                            const pending = pendingActionKey === action.key;
                            const highRiskCustomerContact = action.key === "guarded_offer_resend";
                            return (
                              <div key={action.key} className={`rounded-2xl border px-4 py-3 text-sm ${riskClass(action.riskLevel)}`}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-semibold">{action.label}</p>
                                    <p className="mt-1 leading-6 opacity-80">{action.summary}</p>
                                  </div>
                                  <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                                    {actionStateLabel(action)}
                                  </span>
                                </div>
                                <p className="mt-2 text-xs leading-5 opacity-70">{action.confirmationText}</p>
                                {action.payloadPreview.length ? (
                                  <div className="mt-3 rounded-xl border border-current/15 bg-white/40 p-3 text-xs leading-5">
                                    {action.payloadPreview.slice(0, 5).map((line) => <p key={line}>{line}</p>)}
                                  </div>
                                ) : null}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void copyActionProposal(action.key)}
                                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-current/20 px-3 text-xs font-medium transition hover:bg-white/60"
                                  >
                                    <ClipboardCopy className="h-3.5 w-3.5" />
                                    Paket kopieren
                                  </button>
                                  {action.href ? (
                                    <a href={action.href} className="inline-flex h-9 items-center gap-2 rounded-xl border border-current/20 px-3 text-xs font-medium transition hover:bg-white/60">
                                      Öffnen <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  ) : null}
                                  {executableAction(action.key) ? (
                                    <button
                                      type="button"
                                      onClick={() => startActionProposal(action.key)}
                                      disabled={!action.enabled || actionLoadingKey === action.key}
                                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-current/20 bg-white/50 px-3 text-xs font-semibold transition hover:bg-white disabled:opacity-50"
                                    >
                                      {actionLoadingKey === action.key ? "Führt aus..." : actionButtonLabel(action)}
                                    </button>
                                  ) : null}
                                </div>
                                {pending ? (
                                  <div className="mt-4 rounded-xl border border-current/20 bg-white/70 p-3 text-xs leading-5">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="font-semibold">Freigabe prüfen</p>
                                      <button
                                        type="button"
                                        onClick={cancelActionProposal}
                                        className="rounded-lg border border-current/20 px-2 py-1 font-medium transition hover:bg-white"
                                      >
                                        Abbrechen
                                      </button>
                                    </div>
                                    {highRiskCustomerContact ? (
                                      <p className="mt-2 font-medium">
                                        Diese Aktion kann Kundenkontakt auslösen. Der Server prüft Empfänger, Duplicate-Belege und Bounces direkt vor dem Versand erneut.
                                      </p>
                                    ) : (
                                      <p className="mt-2 opacity-80">Diese Aktion bleibt intern, sofern die Serverantwort nichts anderes meldet.</p>
                                    )}
                                    {action.key === "correct_customer_email" ? (
                                      <label className="mt-3 grid gap-1">
                                        <span className="font-medium">Neue Kunden-E-Mail</span>
                                        <input
                                          value={pendingNewCustomerEmail}
                                          onChange={(event) => setPendingNewCustomerEmail(event.target.value)}
                                          className="h-10 rounded-xl border border-current/20 bg-white px-3 text-sm text-stone-950 outline-none focus:border-stone-950"
                                          placeholder="kunde@example.de"
                                        />
                                      </label>
                                    ) : null}
                                    <label className="mt-3 grid gap-1">
                                      <span className="font-medium">Bestätigung</span>
                                      <input
                                        value={pendingConfirmationText}
                                        onChange={(event) => setPendingConfirmationText(event.target.value)}
                                        className="h-10 rounded-xl border border-current/20 bg-white px-3 text-sm text-stone-950 outline-none focus:border-stone-950"
                                        placeholder="Freigabe"
                                      />
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => void executeActionProposal(action.key)}
                                      disabled={actionLoadingKey === action.key}
                                      className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50"
                                    >
                                      {actionLoadingKey === action.key ? "Führt aus..." : "Jetzt ausführen"}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Identifier</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.identifiers.map((identifier) => (
                      <span key={`${identifier.type}-${identifier.value}`} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700">
                        {identifier.label}: {identifier.value}
                      </span>
                    ))}
                  </div>
                </article>

                {result.records.map((record) => (
                  <article key={record.requestId} className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Kundenakte</p>
                        <h2 className="mt-2 text-xl font-semibold text-stone-950">{record.displayName || record.company || record.email || record.requestId}</h2>
                        <p className="mt-1 text-sm text-stone-500">{record.requestId}</p>
                      </div>
                      <a
                        href={`/ops/customer-records?query=${encodeURIComponent(record.requestId)}`}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-stone-200 text-stone-600 transition hover:border-stone-950 hover:text-stone-950"
                        aria-label="Kundenakte öffnen"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                    <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-stone-400">Farbe</dt><dd className="font-medium text-stone-800">{compactList(record.requestedColors)}</dd></div>
                      <div><dt className="text-stone-400">Größe</dt><dd className="font-medium text-stone-800">{record.requestedSize || "Keine Angabe"}</dd></div>
                      <div><dt className="text-stone-400">Angebot raus</dt><dd className="font-medium text-stone-800">{formatDateTime(record.latestOfferSentAt || record.latestOutboundAt)}</dd></div>
                      <div><dt className="text-stone-400">Letzter Eingang</dt><dd className="font-medium text-stone-800">{formatDateTime(record.latestInboundAt)}</dd></div>
                      <div><dt className="text-stone-400">Bestellung</dt><dd className="font-medium text-stone-800">{record.latestOrderNumber || "Nicht verknüpft"}</dd></div>
                      <div><dt className="text-stone-400">Status</dt><dd className="font-medium text-stone-800">{record.latestOrderStatus || record.status || "Offen"}</dd></div>
                    </dl>
                  </article>
                ))}

                {result.offers.map((offer) => (
                  <article key={offer.offerId} className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Angebot</p>
                        <h2 className="mt-2 text-xl font-semibold text-stone-950">{offer.offerNumber || offer.documentReference}</h2>
                        <p className="mt-1 text-sm text-stone-500">{offer.projectTitle || offer.customerEmail || offer.offerId}</p>
                      </div>
                      {offer.publicUrl ? (
                        <a
                          href={offer.publicUrl}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-stone-200 text-stone-600 transition hover:border-stone-950 hover:text-stone-950"
                          aria-label="Angebot öffnen"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : null}
                    </div>
                    <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-stone-400">Status</dt><dd className="font-medium text-stone-800">{offer.status}</dd></div>
                      <div><dt className="text-stone-400">Positionen</dt><dd className="font-medium text-stone-800">{offer.itemCount}</dd></div>
                      <div><dt className="text-stone-400">Design/Bild-Hinweise</dt><dd className="font-medium text-stone-800">{offer.designEvidenceCount}</dd></div>
                      <div><dt className="text-stone-400">Produkt</dt><dd className="font-medium text-stone-800">{compactList(offer.productHints)}</dd></div>
                      <div><dt className="text-stone-400">Farben</dt><dd className="font-medium text-stone-800">{compactList(offer.colorHints)}</dd></div>
                      <div><dt className="text-stone-400">Angenommen</dt><dd className="font-medium text-stone-800">{formatDateTime(offer.acceptedAt)}</dd></div>
                    </dl>
                    {offer.selectedItems.length ? (
                      <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Ausgewählt</p>
                        <div className="mt-3 grid gap-2">
                          {offer.selectedItems.slice(0, 5).map((item) => (
                            <div key={`${offer.offerId}-${item.title}`} className="text-sm text-stone-700">
                              <span className="font-semibold text-stone-950">{item.title}</span>
                              {item.description ? <span className="text-stone-500"> · {item.description}</span> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>

              <div className="space-y-6">
                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Integrationen</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Readiness</h2>
                    </div>
                    <PlugZap className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {result.integrationReadiness.map((entry) => (
                      <div key={entry.key} className={`rounded-2xl border px-4 py-3 text-sm ${readinessClass(entry.status)}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{entry.label}</p>
                            <p className="mt-1 leading-6 opacity-80">{entry.summary}</p>
                            {entry.detail ? <p className="mt-1 text-xs leading-5 opacity-65">{entry.detail}</p> : null}
                          </div>
                          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                            {entry.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Proaktive Wächter</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Offene Risiken</h2>
                    </div>
                    <Bell className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {result.watchers.map((watcher) => (
                      <div key={watcher.key} className={`rounded-2xl border px-4 py-3 text-sm ${watcherClass(watcher.status, watcher.severity)}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{watcher.title}</p>
                            <p className="mt-1 leading-6 opacity-80">{watcher.detail}</p>
                          </div>
                          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                            {watcher.status === "ok" ? "OK" : watcher.severity}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Source Health</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Quellenlage</h2>
                    </div>
                    <Network className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {(result.sourceHealth || []).map((source) => (
                      <div key={source.key} className={`rounded-2xl border px-4 py-3 text-sm ${sourceHealthClass(source.status)}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{source.label}</p>
                            <p className="mt-1 leading-6 opacity-80">{source.summary}</p>
                            {source.detail ? <p className="mt-1 text-xs leading-5 opacity-65">{source.detail}</p> : null}
                          </div>
                          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                            {sourceHealthLabel(source.status)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs opacity-65">
                          <span>Treffer: {source.count}</span>
                          <span>Letzter Beleg: {formatDateTime(source.lastSeenAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Assets / Anhänge</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Design-Inventar</h2>
                    </div>
                    <PackageSearch className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {result.assets.length ? result.assets.slice(0, 12).map((asset) => (
                      <div key={asset.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-stone-950">{asset.label}</p>
                            <p className="mt-1 text-stone-600">{asset.kind} · {asset.source}{asset.linkedTo ? ` · ${asset.linkedTo}` : ""}</p>
                          </div>
                          <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-500">
                            {asset.status}
                          </span>
                        </div>
                        {asset.href ? (
                          <a href={asset.href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-stone-800 hover:text-stone-950">
                            Asset öffnen <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    )) : (
                      <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">Keine Assets im geladenen Fall gefunden.</p>
                    )}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Fix-Historie</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Interne Aktionen</h2>
                    </div>
                    <ClipboardList className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {operatorView.fixHistory.length ? operatorView.fixHistory.map((run) => (
                      <div key={`fix-detail-${run.id}`} className={`rounded-2xl border px-4 py-3 text-sm ${runStatusClass(run.status, run.retrySafety)}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{fixHistoryLabel(run.action)}</p>
                            <p className="mt-1 leading-6 opacity-80">{run.summary || "Interne Company-Brain-Aktion wurde protokolliert."}</p>
                          </div>
                          <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold">
                            {run.status || "ok"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-1 text-xs opacity-70">
                          <span>Zeitpunkt: {formatDateTime(run.createdAt)}</span>
                          {run.targetRecordId ? <span>Target: {run.targetRecordId}</span> : null}
                          {run.sourceEventId ? <span>Source Event: {run.sourceEventId}</span> : null}
                          {run.idempotencyKey ? <span>Idempotency: {run.idempotencyKey}</span> : null}
                          <span>Kundenkontakt: nein</span>
                        </div>
                      </div>
                    )) : (
                      <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">Noch keine internen Fix-Center-Aktionen für diesen Fall protokolliert.</p>
                    )}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">n8n / Automation</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Run-Status</h2>
                    </div>
                    <Workflow className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {operatorView.automationHistory.length ? operatorView.automationHistory.slice(0, 10).map((run) => (
                      <div key={run.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-stone-950">{run.workflowName || "Workflow"}</p>
                            <p className="mt-1 text-stone-600">{run.action || "Aktion unbekannt"} · {run.status || "Status unbekannt"}</p>
                            {run.summary ? <p className="mt-1 text-stone-600">{run.summary}</p> : null}
                            {run.error ? <p className="mt-1 text-rose-700">{run.error}</p> : null}
                          </div>
                          <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-500">
                            {formatDateTime(run.createdAt)}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-1 text-xs text-stone-500">
                          {run.failedNode ? <span>Failed Node: {run.failedNode}</span> : null}
                          {run.executionId ? <span>Execution: {run.executionId}</span> : null}
                          {run.correlationId ? <span>Correlation: {run.correlationId}</span> : null}
                          {run.sourceEventId ? <span>Source Event: {run.sourceEventId}</span> : null}
                          {run.targetRecordId ? <span>Target: {run.targetRecordId}</span> : null}
                          {run.idempotencyKey ? <span>Idempotency: {run.idempotencyKey}</span> : null}
                          {run.retrySafety ? <span>Retry-Sicherheit: {run.retrySafety}</span> : null}
                        </div>
                        {run.executionUrl ? (
                          <a href={run.executionUrl} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-stone-800 hover:text-stone-950">
                            Execution öffnen <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    )) : (
                      <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">Keine n8n-/Workflow-Fehlerläufe für diesen Fall.</p>
                    )}
                  </div>
                </article>

                {(result.conflicts.length || result.gaps.length) ? (
                  <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Lücken & Konflikte</p>
                    <div className="mt-4 grid gap-3">
                      {[...result.conflicts, ...result.gaps].map((finding) => (
                        <div key={`${finding.source}-${finding.title}`} className={`rounded-2xl border px-4 py-3 text-sm ${findingClass(finding.severity)}`}>
                          <p className="font-semibold">{finding.title}</p>
                          <p className="mt-1 leading-6 opacity-80">{finding.detail}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                ) : null}

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Fallakte</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Chronologie</h2>
                    </div>
                    <History className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {result.caseEvents.length ? result.caseEvents.slice(0, 14).map((event) => (
                      <div key={event.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-stone-950">{event.label}</p>
                            <p className="mt-1 text-sm leading-6 text-stone-600">{event.summary}</p>
                          </div>
                          <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-500">
                            {caseCategoryLabel(event.category)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
                          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatDateTime(event.occurredAt)}</span>
                          <span>{event.source}</span>
                          {event.href ? <a href={event.href} className="inline-flex items-center gap-1 font-medium text-stone-800 hover:text-stone-950">Quelle <ExternalLink className="h-3 w-3" /></a> : null}
                        </div>
                      </div>
                    )) : (
                      <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">Keine Fallereignisse geladen.</p>
                    )}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Evidenz-Zeitstrahl</p>
                  <div className="mt-4 grid gap-3">
                    {result.evidence.length ? result.evidence.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-stone-950">{entry.title}</p>
                            {entry.detail ? <p className="mt-1 text-sm leading-6 text-stone-600">{entry.detail}</p> : null}
                          </div>
                          <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-500">
                            {directionLabel(entry.direction)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
                          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatDateTime(entry.occurredAt)}</span>
                          <span>{entry.source}</span>
                          {entry.href ? <a href={entry.href} className="inline-flex items-center gap-1 font-medium text-stone-800 hover:text-stone-950">Quelle <ExternalLink className="h-3 w-3" /></a> : null}
                        </div>
                      </div>
                    )) : (
                      <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">Keine Belege geladen.</p>
                    )}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Nächste Schritte</p>
                  <div className="mt-4 grid gap-2">
                    {result.nextActions.map((action) => (
                      <p key={action} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">{action}</p>
                    ))}
                  </div>
                </article>

                <article className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Quellenstatus</p>
                  <div className="mt-4 grid gap-2">
                    {result.diagnostics.map((diagnostic) => (
                      <div key={`${diagnostic.source}-${diagnostic.label}`} className="flex items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                        <div>
                          <p className="font-semibold text-stone-900">{diagnostic.label}</p>
                          {diagnostic.detail ? <p className="mt-1 leading-5 text-stone-500">{diagnostic.detail}</p> : null}
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${diagnostic.ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                          {diagnostic.ok ? `${diagnostic.count}` : "Fehler"}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </section>
              </div>
            </details>
          </>
        ) : (
          <section className="rounded-[2rem] border border-stone-200 bg-white p-8 text-center shadow-sm">
            <BrainCircuit className="mx-auto h-10 w-10 text-stone-400" />
            <p className="mt-4 text-sm font-medium text-stone-700">Bereit für die erste Fallprüfung.</p>
          </section>
        )}
      </div>
    </div>
  );
}
