"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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

const DEFAULT_OFFER_RETRY_SUBJECT = "Ihr aktualisiertes NEONTRIP Angebot";
const DEFAULT_OFFER_RETRY_MESSAGE = [
  "Hallo,",
  "",
  "wie besprochen haben wir Ihr Angebot aktualisiert. Sie können es über den Angebotslink erneut öffnen.",
  "",
  "Viele Grüße",
  "NEONTRIP",
].join("\n");

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

function shortText(value: string | null | undefined, max = 180) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
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
  const sharedOperatorNameKey = "neontrip-ops-operator";

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
        openWatchers: [],
        failedChecks: [],
        reviewChecks: [],
        importantFindings: [],
        primaryActions: [],
      };
    }
    const openWatchers = result.watchers.filter((watcher) => watcher.status === "open");
    const failedChecks = result.crossChecks.filter((check) => check.status === "fail");
    const reviewChecks = result.crossChecks.filter((check) => check.status === "review");
    const importantFindings = [...result.conflicts, ...result.gaps]
      .filter((finding) => finding.severity !== "info")
      .slice(0, 5);
    const primaryActions = result.actionProposals
      .filter((action) => action.enabled || action.riskLevel === "high" || action.approvalRequired)
      .slice(0, 4);
    return { openWatchers, failedChecks, reviewChecks, importantFindings, primaryActions };
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

  async function resolve(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/company-brain/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, question, problemType: problemType || null, limit: 5 }),
      });
      const payload = (await response.json().catch(() => null)) as ResolveApiResponse | null;
      if (response.status === 401) {
        setHasSession(false);
        return;
      }
      if (!response.ok || !payload?.ok || !payload.result) {
        setError(formatApiError(payload));
        return;
      }
      setResult(payload.result);
      setCopyMessage(null);
      setDraftCopyMessage(null);
      setActionCopyMessage(null);
      setActionResultMessage(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Fallprüfung konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

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

  async function executeActionProposal(actionKey: string) {
    const action = result?.actionProposals.find((entry) => entry.key === actionKey);
    const primaryRecord = result?.records[0] || null;
    const primaryOffer = result?.offers[0] || null;
    if (!action || !result?.problemResolution || !primaryRecord) return;
    const newCustomerEmail = actionKey === "correct_customer_email"
      ? window.prompt("Neue Kunden-E-Mail eintragen. Es wird noch kein Angebot gesendet.")
      : null;
    if (actionKey === "correct_customer_email" && !newCustomerEmail?.trim()) {
      setActionResultMessage("Aktion abgebrochen: neue E-Mail fehlt.");
      return;
    }
    const confirmation = window.prompt(`"${action.label}" wirklich intern ausführen? Bitte Freigabe eingeben.`);
    if (confirmation !== "Freigabe") {
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
          confirmationText: confirmation,
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
      setActionResultMessage(created ? `Ausgeführt: ${created}.` : "Aktion ausgeführt.");
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

            <section className="rounded-[2rem] border border-stone-200 bg-white shadow-sm">
              <div className="border-b border-stone-200 px-5 py-4 md:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Fall-Kommandostand</p>
                    <h2 className="mt-1 text-2xl font-semibold text-stone-950">Was ist los, was ist belegt, was ist der nächste Schritt?</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${verdictClass(result.answer.verdict)}`}>
                      {result.answer.verdict === "found" ? "Belegt" : result.answer.verdict === "not_found" ? "Nicht gefunden" : "Prüfen"}
                    </span>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${evidenceScoreClass(result.evidenceScore.status)}`}>
                      Beweis {result.evidenceScore.score}/100
                    </span>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${severityBadgeClass(result.problemResolution.severity)}`}>
                      {result.problemResolution.severity}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
                <div className="border-b border-stone-200 p-5 md:p-6 lg:border-b-0 lg:border-r">
                  <div className="flex items-start gap-3">
                    {result.answer.verdict === "found" ? <CheckCircle2 className="mt-1 h-6 w-6 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-1 h-6 w-6 shrink-0 text-amber-600" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-stone-500">Kurzfazit</p>
                      <h3 className="mt-1 text-xl font-semibold leading-7 text-stone-950">{result.answer.headline}</h3>
                      <div className="mt-4 grid gap-2">
                        {result.answer.bullets.slice(0, 4).map((bullet) => (
                          <p key={bullet} className="text-sm leading-6 text-stone-700">
                            {bullet}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Ursache</p>
                      <p className="mt-2 text-sm leading-6 text-stone-800">{result.problemResolution.rootCause}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Empfohlene Lösung</p>
                      <p className="mt-2 text-sm leading-6 text-stone-800">{result.problemResolution.recommendedResolution}</p>
                    </div>
                  </div>

                  <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                    result.retryAssessment.status === "ready"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : result.retryAssessment.status === "needs_fix"
                        ? "border-amber-200 bg-amber-50 text-amber-950"
                        : "border-stone-200 bg-stone-50 text-stone-800"
                  }`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{result.retryAssessment.label}</p>
                        <p className="mt-1 leading-6 opacity-80">{result.retryAssessment.summary}</p>
                      </div>
                      <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold">
                        {result.retryAssessment.canSendWithConfirmation ? "Retry nach Freigabe möglich" : "Kein sicherer Retry"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <p className="rounded-xl border border-current/15 bg-white/40 px-3 py-2 text-xs">
                        Empfänger: {result.retryAssessment.recipientEmail || "unbekannt"}
                      </p>
                      <p className="rounded-xl border border-current/15 bg-white/40 px-3 py-2 text-xs">
                        Angebot: {result.retryAssessment.offerNumber || result.retryAssessment.offerId || "unbekannt"}
                      </p>
                    </div>
                    {result.retryAssessment.blockers.length ? (
                      <div className="mt-3 grid gap-1 text-xs leading-5">
                        {result.retryAssessment.blockers.slice(0, 3).map((blocker) => <p key={blocker}>Blocker: {blocker}</p>)}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="p-5 md:p-6">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-stone-950">Offen oder kritisch</p>
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-500">
                        {operatorView.openWatchers.length + operatorView.failedChecks.length} offen
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {operatorView.failedChecks.slice(0, 3).map((check) => (
                        <div key={`failed-${check.key}`} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                          <p className="font-semibold">{check.label}</p>
                          <p className="mt-1 leading-5 opacity-80">{shortText(check.summary, 170)}</p>
                        </div>
                      ))}
                      {operatorView.openWatchers.slice(0, 4).map((watcher) => (
                        <div key={`watcher-${watcher.key}`} className={`rounded-2xl border px-4 py-3 text-sm ${watcherClass(watcher.status, watcher.severity)}`}>
                          <p className="font-semibold">{watcher.title}</p>
                          <p className="mt-1 leading-5 opacity-80">{shortText(watcher.detail, 170)}</p>
                        </div>
                      ))}
                      {!operatorView.failedChecks.length && !operatorView.openWatchers.length ? (
                        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">Keine offenen kritischen Wächter.</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-6">
                    <p className="text-sm font-semibold text-stone-950">Nächste sichere Aktion</p>
                    <div className="mt-3 grid gap-2">
                      {result.nextActions.slice(0, 3).map((action) => (
                        <p key={action} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">{action}</p>
                      ))}
                    </div>
                    {operatorView.primaryActions.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {operatorView.primaryActions.map((action) => (
                          <button
                            key={action.key}
                            type="button"
                            onClick={() => void copyActionProposal(action.key)}
                            className={`inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-xs font-semibold transition hover:bg-white ${severityBadgeClass(action.riskLevel)}`}
                          >
                            <ClipboardCopy className="h-3.5 w-3.5" />
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {actionCopyMessage ? <p className="mt-3 text-xs font-medium text-stone-500">{actionCopyMessage}</p> : null}
                  </div>
                </div>
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
                  <div className="mt-4 grid gap-3">
                    {result.actionProposals.map((action) => (
                      <div key={action.key} className={`rounded-2xl border px-4 py-3 text-sm ${riskClass(action.riskLevel)}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{action.label}</p>
                            <p className="mt-1 leading-6 opacity-80">{action.summary}</p>
                          </div>
                          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                            {action.enabled ? "Bereit" : "Vorlage"}
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
                              onClick={() => void executeActionProposal(action.key)}
                              disabled={!action.enabled || actionLoadingKey === action.key}
                              className="inline-flex h-9 items-center gap-2 rounded-xl border border-current/20 bg-white/50 px-3 text-xs font-semibold transition hover:bg-white disabled:opacity-50"
                            >
                              {actionLoadingKey === action.key ? "Führt aus..." : "Mit Freigabe ausführen"}
                            </button>
                          ) : null}
                        </div>
                      </div>
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
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">n8n / Automation</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Run-Status</h2>
                    </div>
                    <Workflow className="h-6 w-6 text-stone-500" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {result.automationRuns.length ? result.automationRuns.slice(0, 10).map((run) => (
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
                      </div>
                    )) : (
                      <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">Keine Workflow-Audit-Einträge für diesen Fall.</p>
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
