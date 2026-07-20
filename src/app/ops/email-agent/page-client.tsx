"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  MailCheck,
  Paperclip,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import type {
  EmailAgentLearningStatus,
  EmailAgentReviewCase,
  EmailAgentReviewFilter,
  EmailAgentReviewPriority,
  EmailAgentReviewReasonCode,
} from "@/lib/ops/email-agent-review";
import type {
  EmailAgentOperationalQuality,
  EmailAgentRolloutGate,
} from "@/lib/ops/email-agent-quality";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../ops-design";

type ReviewsResponse = {
  ok: boolean;
  items?: EmailAgentReviewCase[];
  error?: string;
  details?: unknown;
};

type QualityResponse = {
  ok: boolean;
  quality?: EmailAgentOperationalQuality;
  error?: string;
};

const filterOptions: Array<{ value: EmailAgentReviewFilter; label: string }> = [
  { value: "pending", label: "Vergleichsfälle" },
  { value: "awaiting_send", label: "Entwurf noch offen" },
  { value: "approved", label: "Freigegeben" },
  { value: "rejected", label: "Nicht lernen" },
  { value: "ignored", label: "Ignoriert" },
  { value: "all", label: "Alle" },
];

const labelNames: Record<string, string> = {
  unchanged: "Unverändert gesendet",
  minor_formatting: "Nur Formatierung",
  shortened: "Deutlich gekürzt",
  expanded: "Erweitert",
  greeting_changed: "Anrede geändert",
  closing_changed: "Grußformel geändert",
  question_added: "Rückfrage ergänzt",
  question_removed: "Rückfrage entfernt",
  amount_changed: "Betrag korrigiert",
  date_changed: "Datum korrigiert",
  attachment_reference_changed: "Anhangsbezug korrigiert",
  commitment_changed: "Zusage geändert",
  internal_detail_removed: "Interne Info entfernt",
  tone_changed: "Ton geändert",
  factual_correction: "Faktische Korrektur",
  manual_rewrite: "Neu formuliert",
  whatsapp_style: "WhatsApp-Stil",
  needs_human_review: "Menschliche Prüfung wichtig",
};

const reviewReasonOptions: Array<{
  code: EmailAgentReviewReasonCode;
  label: string;
  kind: "style" | "improvement";
}> = [
  { code: "too_long", label: "Zu ausführlich", kind: "style" },
  { code: "too_short", label: "Zu knapp", kind: "style" },
  { code: "wrong_tone", label: "Falscher Ton", kind: "style" },
  { code: "wrong_greeting", label: "Falsche Anrede", kind: "style" },
  { code: "wrong_closing", label: "Falscher Abschluss", kind: "style" },
  { code: "poor_structure", label: "Schlecht gegliedert", kind: "style" },
  { code: "direct_answer_first", label: "Antwort muss zuerst kommen", kind: "style" },
  { code: "avoid_repetition", label: "Kundenfrage nicht wiederholen", kind: "style" },
  { code: "minor_formatting", label: "Nur Formatierung", kind: "style" },
  { code: "insufficient_research", label: "Nicht ausreichend recherchiert", kind: "improvement" },
  { code: "factual_error", label: "Falscher Sachverhalt", kind: "improvement" },
  { code: "attachment_missed", label: "Anhang übersehen", kind: "improvement" },
  { code: "price_or_offer_error", label: "Preis/Angebot falsch", kind: "improvement" },
  { code: "unnecessary_internal_deferral", label: "Unnötig intern abklären", kind: "improvement" },
  { code: "missing_customer_question", label: "Wichtige Rückfrage fehlt", kind: "improvement" },
  { code: "unsupported_commitment", label: "Unbelegte Zusage", kind: "improvement" },
  { code: "other", label: "Anderer Grund", kind: "improvement" },
];

const styleOnlyReasonCodes = new Set(
  reviewReasonOptions.filter((option) => option.kind === "style").map((option) => option.code),
);

function formatDateTime(value: string | null | undefined) {
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

function riskLabel(value: string | null) {
  if (value === "high") return "Hohes Risiko";
  if (value === "medium") return "Mittleres Risiko";
  return "Niedriges Risiko";
}

function riskClass(value: string | null) {
  if (value === "high") return "border-rose-200 bg-rose-50 text-rose-900";
  if (value === "medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function priorityClass(value: EmailAgentReviewPriority | null) {
  if (value === "high") return "border-rose-200 bg-rose-50 text-rose-900";
  if (value === "normal") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function learningLabel(value: EmailAgentLearningStatus | null) {
  if (value === "approved") return "Als Ausnahme bestätigt";
  if (value === "rejected") return "Vom Lernen ausgeschlossen";
  if (value === "ignored") return "Ignoriert";
  if (value === "pending") return "Automatisch eingeordnet";
  return "Noch nicht gesendet";
}

function learningClass(value: EmailAgentLearningStatus | null) {
  if (value === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (value === "rejected") return "border-rose-200 bg-rose-50 text-rose-900";
  if (value === "ignored") return "border-stone-200 bg-stone-50 text-stone-700";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function channelLabel(value: string) {
  if (value === "whatsapp_relay") return "WhatsApp";
  if (value === "customer_form_relay") return "Chat/Formular";
  return "E-Mail";
}

function percent(value: number) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function rolloutStageLabel(value: EmailAgentRolloutGate["effective_stage"]) {
  if (value === "routing_gate") return "Routing-Gate aktiv";
  if (value === "shadow") return "Nur Schattenbetrieb";
  return "Entwürfe mit Pflichtprüfung";
}

const automaticDefectLabels: Record<string, string> = {
  unnecessary_internal_deferral: "unnötige interne Rückfrage",
  missing_customer_question: "notwendige Kundenfrage fehlt",
  unnecessary_customer_question: "unnötige Kundenfrage",
  attachment_missed: "Anhang übersehen",
  attachment_reference_changed: "Anhang falsch zugeordnet",
  price_or_offer_error: "Preis oder Angebot korrigiert",
  date_or_timeline_error: "Termin korrigiert",
  unsupported_commitment: "unbelegte Zusage",
  internal_information_exposed: "interne Information entfernt",
  factual_change: "Sachverhalt korrigiert",
  large_rewrite_unclassified: "starke Umschreibung",
  high_risk_change: "Änderung mit hohem Risiko",
  invalid_feedback_match: "Vergleich nicht eindeutig",
};

function QualityGatePanel({ quality }: { quality: EmailAgentOperationalQuality }) {
  const decision = quality.decision_gate;
  const drafts = quality.draft_quality_gate;
  const retry = quality.retry_health;
  const retryOpen = retry.due_retry_count + retry.stale_processing_count;
  const learning = quality.learning_quality;
  const topDefect = learning.automatic_analysis.top_defects[0];
  const decisionTone = decision.passed ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50";
  const draftTone = drafts.passed
    ? "border-emerald-200 bg-emerald-50"
    : drafts.status === "observing"
      ? "border-sky-200 bg-sky-50"
      : "border-rose-200 bg-rose-50";

  return (
    <section className="grid gap-3 xl:grid-cols-6">
      <div className="rounded-[22px] border border-stone-900 bg-stone-950 p-5 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Produktionsstufe</p>
        <div className="mt-3 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          <div>
            <h2 className="text-lg font-semibold">{rolloutStageLabel(quality.effective_stage)}</h2>
            <p className="mt-1 text-sm leading-6 text-stone-300">
              Kein automatischer Versand. Jede Kundenantwort bleibt bis zur manuellen Prüfung ein Outlook-Entwurf.
            </p>
          </div>
        </div>
      </div>

      <div className={`rounded-[22px] border p-5 ${decisionTone}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">50-Fälle-Entscheidungstest</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-950">{decision.passed ? "Bestanden" : "Noch gesperrt"}</h2>
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-stone-800">{decision.evaluated_count} Fälle</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          Routing {percent(decision.routing_accuracy)} · gefährliche No-Reply-Fehler {decision.unsafe_no_reply_count}
        </p>
      </div>

      <div className={`rounded-[22px] border p-5 ${draftTone}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Aktuelle Facts-Package-Version</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-950">
            {drafts.passed ? "Bestanden" : drafts.status === "observing" ? "Beobachtung läuft" : "Qualitätsgrenze verfehlt"}
          </h2>
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-stone-800">{drafts.current_samples}/{drafts.minimum_samples}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          Faktenkorrekturen {drafts.safety_correction_count} · starke Umschreibungen {drafts.manual_rewrite_count}
        </p>
      </div>

      <div className={`rounded-[22px] border p-5 ${retryOpen ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Fehler-Wiederholung</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-950">{retryOpen ? "Wiederholung läuft" : "Bereit"}</h2>
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-stone-800">{retryOpen} fällig</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          Letzte 24 h gerettet {retry.recovered_24h} · endgültig gesperrt {retry.failed_final_count}
        </p>
      </div>

      <div className={`rounded-[22px] border p-5 ${learning.style_profile.eligible ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-sky-50"}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Automatisches Stilprofil</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-950">{learning.style_profile.eligible ? "Aktiv" : "Sammelt sichere Beispiele"}</h2>
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-stone-800">
            {learning.style_profile.safe_sample_count}/{learning.style_profile.minimum_safe_samples}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          {learning.passive_learning.automatic_samples} automatisch sicher · {learning.passive_learning.blocked_samples} vorsorglich ausgeschlossen
        </p>
      </div>

      <div className={`rounded-[22px] border p-5 ${topDefect?.implementation_signal_ready ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-stone-50"}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Automatische Fehleranalyse</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-950">
            {topDefect ? automaticDefectLabels[topDefect.defect_code] || topDefect.defect_code : "Noch kein Muster"}
          </h2>
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-stone-800">
            {topDefect?.occurrence_count || 0}×
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          {learning.automatic_analysis.evaluated} Änderungen automatisch ausgewertet · keine Kundeninhalte übernommen
        </p>
      </div>
    </section>
  );
}

function outlookHref(messageId: string) {
  return `https://outlook.cloud.microsoft/mail/0/id/${encodeURIComponent(messageId)}`;
}

function recordText(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number") return String(candidate);
  }
  return null;
}

function EvidenceOverview({ item }: { item: EmailAgentReviewCase }) {
  const card = item.evidenceCard;
  const actualAttachments = card.attachments?.actual || [];
  const missingAttachments = card.attachments?.missing_claimed || [];
  const order = card.commerce?.selected_shopify_order;
  const offer = card.commerce?.signed_offer;
  const financial = card.commerce?.financial_reconciliation;
  const organization = card.customer_match?.organization;
  const relatedCount = Number(card.customer_match?.related_email_count || 0);
  const financialStatus = recordText(financial, ["status"]);

  const checks = [
    {
      icon: ShieldCheck,
      title: "Verlauf & Organisation",
      detail: organization
        ? `${organization} · ${relatedCount} passende Adresse${relatedCount === 1 ? "" : "n"}`
        : relatedCount > 1
          ? `${relatedCount} zeitlich passende Kontakte geprüft`
          : "Absender und E-Mail-Verlauf geprüft",
      ok: true,
    },
    {
      icon: Paperclip,
      title: "Anhänge",
      detail: missingAttachments.length
        ? `${missingAttachments.map((entry) => entry.label || entry.type || "Datei").join(", ")} fehlt`
        : actualAttachments.length
          ? `${actualAttachments.length} Datei${actualAttachments.length === 1 ? "" : "en"} verifiziert`
          : "Keine relevanten Dateien vorhanden",
      ok: missingAttachments.length === 0,
    },
    {
      icon: ShoppingBag,
      title: "Shopify & Angebot",
      detail: order
        ? `Bestellung ${recordText(order, ["order_number", "name", "id"]) || "gefunden"}`
        : offer
          ? `Angebot ${recordText(offer, ["offer_number", "document_reference"]) || "gefunden"}`
          : "Kein passender Commerce-Beleg nötig oder gefunden",
      ok: Boolean(order || offer) || financialStatus === "not_applicable",
    },
    {
      icon: FileCheck2,
      title: "Preisabgleich",
      detail: financialStatus === "balanced"
        ? "Beträge rechnerisch abgeglichen"
        : financialStatus === "not_applicable"
          ? "Für diesen Fall nicht erforderlich"
          : financialStatus
            ? `Status: ${financialStatus}`
            : "Kein Preisfall",
      ok: financialStatus === "balanced" || financialStatus === "not_applicable" || !financialStatus,
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {checks.map(({ icon: Icon, title, detail, ok }) => (
        <div key={title} className={`rounded-2xl border p-3.5 ${ok ? "border-stone-200 bg-stone-50" : "border-amber-300 bg-amber-50"}`}>
          <div className="flex items-start gap-2.5">
            {ok ? <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-stone-900">{title}</p>
              <p className="mt-1 text-xs leading-5 text-stone-600">{detail}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagePanel({ label, value, tone }: { label: string; value: string | null; tone: "draft" | "sent" }) {
  return (
    <section className={`rounded-2xl border p-4 ${tone === "draft" ? "border-sky-200 bg-sky-50/70" : "border-emerald-200 bg-emerald-50/70"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <div className="mt-3 min-h-28 whitespace-pre-wrap text-sm leading-6 text-stone-800">
        {value || "Noch keine gesendete Antwort zum Vergleichen vorhanden."}
      </div>
    </section>
  );
}

function ReviewCard({
  item,
  operatorName,
  note,
  saving,
  selectedReasons,
  onNoteChange,
  onReasonToggle,
  onDecision,
}: {
  item: EmailAgentReviewCase;
  operatorName: string;
  note: string;
  saving: boolean;
  selectedReasons: EmailAgentReviewReasonCode[];
  onNoteChange: (value: string) => void;
  onReasonToggle: (value: EmailAgentReviewReasonCode) => void;
  onDecision: (decision: Exclude<EmailAgentLearningStatus, "pending">) => Promise<void>;
}) {
  const percent = item.editRatio === null ? null : Math.round(item.editRatio * 100);
  const learningReady = item.feedbackId !== null;
  const reviewReady = operatorName.trim().length >= 2 && note.trim().length >= 8 && selectedReasons.length > 0;
  const containsImprovementReason = selectedReasons.some((reason) => !styleOnlyReasonCodes.has(reason));

  return (
    <article className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(24,20,16,0.07)]">
      <div className="border-b border-stone-200 px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${riskClass(item.riskLevel)}`}>{riskLabel(item.riskLevel)}</span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${learningClass(item.learningStatus)}`}>{learningLabel(item.learningStatus)}</span>
              {item.reviewPriority ? <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${priorityClass(item.reviewPriority)}`}>Review {item.reviewPriority === "high" ? "wichtig" : item.reviewPriority === "normal" ? "normal" : "niedrig"}</span> : null}
              <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">{channelLabel(item.channel)}</span>
              {item.improvementCandidateStatus === "pending" ? (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-900">
                  Verbesserungsprüfung: {item.improvementCandidateType || "offen"}
                </span>
              ) : null}
            </div>
            <h2 className="mt-3 break-words text-xl font-semibold tracking-tight text-stone-950">{item.subject || "Ohne Betreff"}</h2>
            <p className="mt-1 text-sm text-stone-600">
              {item.fromName || item.fromEmail} · {formatDateTime(item.draftCreatedAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {percent !== null ? <span className="rounded-xl bg-stone-950 px-3 py-2 text-xs font-semibold text-white">{percent}% geändert</span> : null}
            <a href={outlookHref(item.sourceMessageId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950/30">
              In Outlook öffnen <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 md:px-6">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-stone-700" />
            <h3 className="text-sm font-semibold text-stone-950">Beweisübersicht vor dem Entwurf</h3>
          </div>
          <EvidenceOverview item={item} />
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <MessagePanel label="KI-Entwurf" value={item.draftBodyText} tone="draft" />
          <MessagePanel label="Tatsächlich gesendet" value={item.sentBodyText} tone="sent" />
        </div>

        {item.editLabels.length ? (
          <div className="flex flex-wrap gap-2">
            {item.editLabels.map((label) => (
              <span key={label} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${["amount_changed", "date_changed", "commitment_changed", "internal_detail_removed", "factual_correction"].includes(label) ? "border-rose-200 bg-rose-50 text-rose-900" : "border-stone-200 bg-stone-50 text-stone-700"}`}>
                {labelNames[label] || label}
              </span>
            ))}
          </div>
        ) : null}

        {learningReady ? (
          <section className="rounded-2xl border border-stone-200 bg-[#fffdf9] p-4">
            <div className="mb-4">
              <p className="text-xs font-semibold text-stone-700">Optionale Ausnahmeprüfung: Nur nutzen, wenn die automatische Einordnung falsch ist.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {reviewReasonOptions.map((option) => {
                  const selected = selectedReasons.includes(option.code);
                  return (
                    <button
                      key={option.code}
                      type="button"
                      aria-pressed={selected}
                      disabled={saving}
                      onClick={() => onReasonToggle(option.code)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selected
                        ? option.kind === "style"
                          ? "border-stone-950 bg-stone-950 text-white"
                          : "border-amber-700 bg-amber-700 text-white"
                        : option.kind === "style"
                          ? "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                          : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {containsImprovementReason ? (
                <p className="mt-2 text-xs leading-5 text-amber-800">
                  Dieser Grund darf nicht als Stil gelernt werden. Bei „Nicht lernen“ oder „Ignorieren“ wird automatisch eine separate Wissens-, Resolver- oder Regelprüfung vorgemerkt – ohne Kundeninhalt zu kopieren.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="flex-1 text-xs font-semibold text-stone-700">
                Interne Ausnahmenotiz
                <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} maxLength={2000} rows={2} placeholder="Nur für eine manuelle Ausnahme erforderlich" className="mt-2 w-full resize-y rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal text-stone-900 outline-none transition focus:border-stone-600 focus:ring-2 focus:ring-stone-950/10" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={saving || !reviewReady || containsImprovementReason} onClick={() => void onDecision("approved")} className="inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50">
                  <Check className="h-4 w-4" /> Stil ausdrücklich bestätigen
                </button>
                <button type="button" disabled={saving || !reviewReady} onClick={() => void onDecision("rejected")} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-900 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
                  <X className="h-4 w-4" /> Nicht lernen
                </button>
                <button type="button" disabled={saving || !reviewReady} onClick={() => void onDecision("ignored")} className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50">
                  Ignorieren
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-stone-500">
              Sichere Stiländerungen lernt der Agent bereits automatisch als anonyme Statistik. Hier kann eine Person nur im Ausnahmefall bestätigen oder ausschließen; Kundenfakten, Beträge, Termine, Anhänge, Zusagen und Formulierungen werden nie übernommen. Für eine manuelle Ausnahme bleiben Prüfer, Grund und Notiz Pflicht. {operatorName ? `Prüfer: ${operatorName}` : "Bitte oben erneut mit Prüfername anmelden."}
            </p>
          </section>
        ) : (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            Der Entwurf ist noch offen oder wurde nicht als gesendete Antwort erkannt. Erst nach dem tatsächlichen Versand kann ein sicherer Stilvergleich entstehen.
          </div>
        )}
      </div>
    </article>
  );
}

export function EmailAgentReviewClient({
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
  const [items, setItems] = useState<EmailAgentReviewCase[]>([]);
  const [quality, setQuality] = useState<EmailAgentOperationalQuality | null>(null);
  const [filter, setFilter] = useState<EmailAgentReviewFilter>("pending");
  const [priority, setPriority] = useState<EmailAgentReviewPriority | "all">("all");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [reasonCodes, setReasonCodes] = useState<Record<number, EmailAgentReviewReasonCode[]>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      setOperatorName(window.localStorage.getItem("neontrip-email-agent-reviewer") || "");
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    if (!operatorName) return;
    try {
      window.localStorage.setItem("neontrip-email-agent-reviewer", operatorName);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, [operatorName]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/email-agent/reviews?status=all&limit=180", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as ReviewsResponse | null;
      if (!response.ok || !payload?.ok || !payload.items) throw new Error(payload?.error || "E-Mail-Reviews konnten nicht geladen werden.");
      setItems(payload.items);
      setNotes(Object.fromEntries(payload.items.filter((item) => item.feedbackId !== null).map((item) => [item.feedbackId!, item.humanReviewNote || ""])));
      setReasonCodes(Object.fromEntries(payload.items.filter((item) => item.feedbackId !== null).map((item) => [item.feedbackId!, item.reviewReasonCodes])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "E-Mail-Reviews konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQuality = useCallback(async () => {
    try {
      const response = await fetch("/api/ops/email-agent/quality", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as QualityResponse | null;
      if (!response.ok || !payload?.ok || !payload.quality) throw new Error(payload?.error || "Qualitätsstatus konnte nicht geladen werden.");
      setQuality(payload.quality);
    } catch (qualityError) {
      setError(qualityError instanceof Error ? qualityError.message : "Qualitätsstatus konnte nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    if (hasSession || localMode) {
      void loadItems();
      void loadQuality();
    }
  }, [hasSession, localMode, loadItems, loadQuality]);

  const visibleItems = useMemo(() => items.filter((item) => {
    const statusMatches = filter === "all"
      || (filter === "awaiting_send" ? item.feedbackId === null : item.learningStatus === filter);
    const priorityMatches = priority === "all" || item.reviewPriority === priority;
    return statusMatches && priorityMatches;
  }), [filter, items, priority]);

  const stats = useMemo(() => ({
    pending: items.filter((item) => item.learningStatus === "pending").length,
    high: items.filter((item) => item.learningStatus === "pending" && item.reviewPriority === "high").length,
    unchanged: items.filter((item) => item.editLabels.includes("unchanged")).length,
    awaiting: items.filter((item) => item.feedbackId === null).length,
  }), [items]);

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setError("Ops-Login fehlgeschlagen.");
      return;
    }
    setHasSession(true);
    setToken("");
  }

  async function decide(item: EmailAgentReviewCase, decision: Exclude<EmailAgentLearningStatus, "pending">) {
    if (item.feedbackId === null) return;
    if (decision === "approved" && !window.confirm("Diese Bearbeitung wirklich als geprüftes Lernsignal freigeben?")) return;
    setSavingId(item.feedbackId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/email-agent/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackId: item.feedbackId,
          decision,
          note: notes[item.feedbackId] || null,
          operatorName: operatorName || null,
          idempotencyKey: crypto.randomUUID(),
          reasonCodes: reasonCodes[item.feedbackId] || [],
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewsResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Review konnte nicht gespeichert werden.");
      setMessage(decision === "approved" ? "Als geprüftes Lernsignal freigegeben." : decision === "rejected" ? "Vom Lernen ausgeschlossen." : "Review ignoriert.");
      await loadItems();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Review konnte nicht gespeichert werden.");
    } finally {
      setSavingId(null);
    }
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="E-Mail Agent"
        title="E-Mail-Review anmelden"
        description="Entwürfe, gesendete Antworten und interne Belege bleiben geschützt. Kein Inhalt wird automatisch an Kunden gesendet."
        activeApp="emailAgent"
        operatorName={operatorName}
        password={token}
        error={error}
        buttonLabel="Einloggen"
        onOperatorNameChange={setOperatorName}
        onPasswordChange={setToken}
        onSubmit={login}
      />
    );
  }

  return (
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} px-4 py-4 md:px-6 md:py-6`}>
        <OpsPageHeader active="emailAgent" label="E-Mail Agent · Entwürfe, Belege und sicheres Lernen" />

        <div className="mt-4 grid gap-4">
          <OpsPageIntro
            eyebrow="Passiver, kontrollierter Lernkreislauf"
            title="Lernt im Hintergrund – nur aus sicheren Stiländerungen."
            description="Der Agent vergleicht Entwurf und tatsächlich gesendete Antwort automatisch. Er übernimmt ausschließlich anonyme Stilstatistiken wie Kürze und Absatzstruktur; Inhaltsänderungen werden ausgeschlossen. Jede Kundenantwort bleibt weiterhin ein Outlook-Entwurf mit menschlicher Versandprüfung."
          >
            <button type="button" onClick={() => { void loadItems(); void loadQuality(); }} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
            </button>
          </OpsPageIntro>

          {quality ? <QualityGatePanel quality={quality} /> : null}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OpsStatCard label="Automatisch ausgewertet" value={quality?.learning_quality.passive_learning.evaluated || stats.pending} tone="info" icon={<Sparkles className="h-5 w-5" />} detail="Gesendete Antworten mit sicherem Vergleich" />
            <OpsStatCard label="Wichtige Reviews" value={stats.high} tone={stats.high ? "danger" : "success"} icon={<AlertTriangle className="h-5 w-5" />} detail="Fakten, Beträge oder starke Änderungen" />
            <OpsStatCard label="Unverändert gesendet" value={stats.unchanged} tone="success" icon={<CheckCircle2 className="h-5 w-5" />} detail="Entwurf wurde praktisch übernommen" />
            <OpsStatCard label="Entwurf noch offen" value={stats.awaiting} tone="neutral" icon={<Clock3 className="h-5 w-5" />} detail="Noch kein gesendeter Vergleich" />
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row">
              <label className="text-xs font-semibold text-stone-700">
                Ansicht
                <select value={filter} onChange={(event) => setFilter(event.target.value as EmailAgentReviewFilter)} className="mt-1.5 w-full min-w-56 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal text-stone-900 outline-none focus:border-stone-600 focus:ring-2 focus:ring-stone-950/10">
                  {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-stone-700">
                Priorität
                <select value={priority} onChange={(event) => setPriority(event.target.value as EmailAgentReviewPriority | "all")} className="mt-1.5 w-full min-w-44 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal text-stone-900 outline-none focus:border-stone-600 focus:ring-2 focus:ring-stone-950/10">
                  <option value="all">Alle Prioritäten</option>
                  <option value="high">Wichtig</option>
                  <option value="normal">Normal</option>
                  <option value="low">Niedrig</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-stone-700">
                Prüfername (nur für Ausnahmen)
                <input value={operatorName} onChange={(event) => setOperatorName(event.target.value.slice(0, 160))} placeholder="Optional, solange keine Ausnahme geprüft wird" className="mt-1.5 w-full min-w-52 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal text-stone-900 outline-none focus:border-stone-600 focus:ring-2 focus:ring-stone-950/10" />
              </label>
            </div>
            <div className="text-sm text-stone-500">{visibleItems.length} Fälle sichtbar</div>
          </section>

          {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div> : null}
          {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

          {loading && !items.length ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-600">E-Mail-Reviews werden geladen …</div>
          ) : visibleItems.length ? (
            <section className="grid gap-4">
              {visibleItems.map((item) => (
                <ReviewCard
                  key={item.logId}
                  item={item}
                  operatorName={operatorName}
                  note={item.feedbackId === null ? "" : notes[item.feedbackId] || ""}
                  selectedReasons={item.feedbackId === null ? [] : reasonCodes[item.feedbackId] || []}
                  saving={item.feedbackId !== null && savingId === item.feedbackId}
                  onNoteChange={(value) => item.feedbackId !== null && setNotes((current) => ({ ...current, [item.feedbackId!]: value }))}
                  onReasonToggle={(value) => item.feedbackId !== null && setReasonCodes((current) => {
                    const existing = current[item.feedbackId!] || [];
                    const next = existing.includes(value) ? existing.filter((reason) => reason !== value) : [...existing, value].slice(0, 8);
                    return { ...current, [item.feedbackId!]: next };
                  })}
                  onDecision={(decision) => decide(item, decision)}
                />
              ))}
            </section>
          ) : (
            <div className="rounded-[24px] border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
              <MailCheck className="mx-auto h-8 w-8 text-stone-400" />
              <h2 className="mt-3 text-lg font-semibold text-stone-950">Keine Fälle in dieser Ansicht</h2>
              <p className="mt-1 text-sm text-stone-600">Wähle einen anderen Filter oder aktualisiere die Übersicht.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
