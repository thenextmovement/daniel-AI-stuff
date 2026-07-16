"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Database,
  FilePlus2,
  GitPullRequest,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from "lucide-react";
import type {
  CompanyCorrelationContract,
  CompanyDataQualityIssue,
  CompanyDecision,
  CompanyDecisionOutcome,
  CompanyDecisionScopeType,
  CompanyDecisionStatus,
  CompanyDecisionType,
  CompanySourceRegistryEntry,
  CompanyWorkflowRegistryEntry,
} from "@/lib/ops/company-brain-foundation";
import { OpsLoginCard } from "../../ops-login-card";
import { OpsPageHeader } from "../../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../../ops-design";

type FoundationOverview = {
  generatedAt: string;
  sources: CompanySourceRegistryEntry[];
  correlationContracts: CompanyCorrelationContract[];
  workflows: CompanyWorkflowRegistryEntry[];
  workflowSummary: {
    total: number;
    active: number;
    unreviewed: number;
    aboveNodeLimit: number;
  };
  dataQualityIssues: CompanyDataQualityIssue[];
};

type FoundationResponse = { ok?: boolean; result?: FoundationOverview; error?: string; issues?: string[] };
type DecisionsResponse = { ok?: boolean; decisions?: CompanyDecision[]; error?: string; issues?: string[] };
type DecisionResponse = { ok?: boolean; decision?: CompanyDecision; error?: string; issues?: string[] };
type OutcomesResponse = { ok?: boolean; outcomes?: CompanyDecisionOutcome[]; outcome?: CompanyDecisionOutcome; error?: string; issues?: string[] };

type DecisionForm = {
  decisionKey: string;
  decisionType: CompanyDecisionType;
  title: string;
  scopeType: CompanyDecisionScopeType;
  scopeKey: string;
  ownerTeam: string;
  objective: string;
  problemStatement: string;
  context: string;
  options: string;
  chosenOption: string;
  rationale: string;
  guardrails: string;
  expectedOutcomes: string;
  risks: string;
  rollbackPlan: string;
  reviewAt: string;
};

type ReviewDialog = {
  decision: CompanyDecision;
  action: "submit" | "approve" | "request_changes";
  note: string;
  confirmation: string;
};

type OutcomeDialog = {
  decision: CompanyDecision;
  outcomeKey: string;
  metricKey: string;
  targetValue: string;
  actualValue: string;
  unit: string;
  evaluationStatus: CompanyDecisionOutcome["evaluationStatus"];
  evaluationEnd: string;
  finding: string;
  lessonsLearned: string;
};

const STATUS_OPTIONS: Array<{ value: CompanyDecisionStatus | "all"; label: string }> = [
  { value: "all", label: "Alle" },
  { value: "review", label: "Prüfung offen" },
  { value: "draft", label: "Entwürfe" },
  { value: "approved", label: "Gültig" },
  { value: "superseded", label: "Ersetzt" },
  { value: "reversed", label: "Zurückgenommen" },
  { value: "expired", label: "Abgelaufen" },
];

const STATUS_LABELS: Record<CompanyDecisionStatus, string> = {
  draft: "Entwurf",
  review: "Prüfung offen",
  approved: "Gültig",
  superseded: "Ersetzt",
  reversed: "Zurückgenommen",
  expired: "Abgelaufen",
};

const TYPE_LABELS: Record<CompanyDecisionType, string> = {
  decision: "Entscheidung",
  policy: "Regel",
  architecture: "Architektur",
  incident_resolution: "Problemlösung",
  experiment: "Experiment",
};

const SCOPE_LABELS: Record<CompanyDecisionScopeType, string> = {
  global: "Gesamte Firma",
  team: "Team",
  process: "Prozess",
  entity: "Einzelfall",
  workflow: "Workflow",
  metric: "Kennzahl",
};

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyDecisionForm(): DecisionForm {
  return {
    decisionKey: "",
    decisionType: "decision",
    title: "",
    scopeType: "process",
    scopeKey: "",
    ownerTeam: "",
    objective: "",
    problemStatement: "",
    context: "",
    options: "",
    chosenOption: "",
    rationale: "",
    guardrails: "",
    expectedOutcomes: "",
    risks: "",
    rollbackPlan: "",
    reviewAt: futureDate(30),
  };
}

function lines(value: string) {
  return value.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

function arrayText(value: unknown[]) {
  return value.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n");
}

function decisionFormFrom(decision: CompanyDecision): DecisionForm {
  return {
    decisionKey: decision.decisionKey,
    decisionType: decision.decisionType,
    title: decision.title,
    scopeType: decision.scopeType,
    scopeKey: decision.scopeKey,
    ownerTeam: decision.ownerTeam,
    objective: decision.objective,
    problemStatement: decision.problemStatement,
    context: decision.context,
    options: arrayText(decision.options),
    chosenOption: decision.chosenOption || "",
    rationale: decision.rationale || "",
    guardrails: arrayText(decision.guardrails),
    expectedOutcomes: arrayText(decision.expectedOutcomes),
    risks: arrayText(decision.risks),
    rollbackPlan: decision.rollbackPlan || "",
    reviewAt: futureDate(30),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Kein Datum";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

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

function apiError(payload: { error?: string; issues?: string[] } | null, fallback: string) {
  if (payload?.issues?.length) return payload.issues.join(" ");
  return payload?.error || fallback;
}

function statusClass(status: CompanyDecisionStatus) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "review") return "border-sky-200 bg-sky-50 text-sky-900";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function severityClass(severity: CompanyDataQualityIssue["severity"]) {
  if (severity === "critical") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function outcomeStatusLabel(status: CompanyDecisionOutcome["evaluationStatus"]) {
  if (status === "met") return "Ziel erreicht";
  if (status === "missed") return "Ziel verfehlt";
  if (status === "inconclusive") return "Noch unklar";
  if (status === "cancelled") return "Abgebrochen";
  return "Auswertung geplant";
}

function DetailList({ title, values }: { title: string; values: unknown[] }) {
  if (!values.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">{title}</p>
      <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-stone-700">
        {values.map((value, index) => <li key={`${title}-${index}`}>• {typeof value === "string" ? value : JSON.stringify(value)}</li>)}
      </ul>
    </div>
  );
}

function DecisionCard({
  decision,
  outcomes,
  outcomesLoading,
  onLoadOutcomes,
  onNewVersion,
  onReview,
  onOutcome,
}: {
  decision: CompanyDecision;
  outcomes: CompanyDecisionOutcome[] | undefined;
  outcomesLoading: boolean;
  onLoadOutcomes: () => void;
  onNewVersion: () => void;
  onReview: (action: ReviewDialog["action"]) => void;
  onOutcome: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-stone-200 bg-white shadow-[0_10px_30px_rgba(20,16,12,0.05)]">
      <div className="px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(decision.status)}`}>{STATUS_LABELS[decision.status]}</span>
              <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">{TYPE_LABELS[decision.decisionType]}</span>
              <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-500">Version {decision.versionNumber}</span>
            </div>
            <h2 className="mt-3 text-xl font-semibold leading-tight text-stone-950">{decision.title}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{decision.objective}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <span>{SCOPE_LABELS[decision.scopeType]}: {decision.scopeKey}</span>
              <span>Verantwortlich: {decision.ownerTeam}</span>
              <span>Review: {formatDate(decision.reviewAt)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {decision.status === "draft" ? (
              <button type="button" onClick={() => onReview("submit")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-3.5 text-xs font-semibold text-white transition hover:bg-stone-800">
                <GitPullRequest className="h-4 w-4" /> Zur Prüfung
              </button>
            ) : null}
            {decision.status === "review" ? (
              <>
                <button type="button" onClick={() => onReview("request_changes")} className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100">
                  <RotateCcw className="h-4 w-4" /> Änderungen
                </button>
                <button type="button" onClick={() => onReview("approve")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-3.5 text-xs font-semibold text-white transition hover:bg-stone-800">
                  <CheckCircle2 className="h-4 w-4" /> Freigeben
                </button>
              </>
            ) : null}
            {decision.status === "approved" ? (
              <button type="button" onClick={onOutcome} className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 text-xs font-semibold text-stone-800 transition hover:bg-stone-50">
                <CircleDot className="h-4 w-4" /> Ergebnis
              </button>
            ) : null}
            <button type="button" onClick={onNewVersion} className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 text-xs font-semibold text-stone-800 transition hover:bg-stone-50">
              <FilePlus2 className="h-4 w-4" /> Neue Version
            </button>
          </div>
        </div>
      </div>

      <details
        className="group border-t border-stone-200 bg-stone-50/60"
        onToggle={(event) => {
          if ((event.currentTarget as HTMLDetailsElement).open && outcomes === undefined && !outcomesLoading) onLoadOutcomes();
        }}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-stone-700">
          Begründung, Leitplanken und Ergebnisse
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-5 border-t border-stone-200 px-5 py-5 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Problem</p>
              <p className="mt-2 text-sm leading-6 text-stone-700">{decision.problemStatement}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Kontext</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">{decision.context}</p>
            </div>
            {decision.chosenOption ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Gewählte Lösung</p>
                <p className="mt-2 text-sm font-semibold text-emerald-950">{decision.chosenOption}</p>
                {decision.rationale ? <p className="mt-2 text-sm leading-6 text-emerald-900">{decision.rationale}</p> : null}
              </div>
            ) : null}
            <DetailList title="Leitplanken" values={decision.guardrails} />
            <DetailList title="Risiken" values={decision.risks} />
            {decision.rollbackPlan ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Rollback</p>
                <p className="mt-2 text-sm leading-6 text-stone-700">{decision.rollbackPlan}</p>
              </div>
            ) : null}
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Wirkungskontrolle</p>
                <p className="mt-1 text-xs text-stone-500">Was ist nach der Entscheidung tatsächlich passiert?</p>
              </div>
              {outcomesLoading ? <RefreshCcw className="h-4 w-4 animate-spin text-stone-400" /> : null}
            </div>
            <div className="mt-3 grid gap-2">
              {outcomes?.length ? outcomes.map((outcome) => (
                <div key={outcome.id} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-stone-950">{outcome.outcomeKey}</p>
                    <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-600">{outcomeStatusLabel(outcome.evaluationStatus)}</span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">Auswertung bis {formatDate(outcome.evaluationEnd)}</p>
                  {outcome.finding ? <p className="mt-2 text-sm leading-6 text-stone-700">{outcome.finding}</p> : null}
                  {outcome.targetValue !== null || outcome.actualValue !== null ? (
                    <p className="mt-2 text-xs font-medium text-stone-600">
                      Ziel {outcome.targetValue ?? "–"} {outcome.unit || ""} · Ist {outcome.actualValue ?? "–"} {outcome.unit || ""}
                    </p>
                  ) : null}
                  {outcome.lessonsLearned ? <p className="mt-2 text-xs leading-5 text-stone-500">Gelernt: {outcome.lessonsLearned}</p> : null}
                </div>
              )) : outcomes ? (
                <p className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-500">Noch kein Ergebnis erfasst.</p>
              ) : null}
            </div>
          </div>
        </div>
      </details>
    </article>
  );
}

export function CompanyBrainGovernanceClient({
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
  const [foundation, setFoundation] = useState<FoundationOverview | null>(null);
  const [decisions, setDecisions] = useState<CompanyDecision[]>([]);
  const [statusFilter, setStatusFilter] = useState<CompanyDecisionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"decisions" | "health">("decisions");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DecisionForm>(emptyDecisionForm);
  const [reviewDialog, setReviewDialog] = useState<ReviewDialog | null>(null);
  const [outcomeDialog, setOutcomeDialog] = useState<OutcomeDialog | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, CompanyDecisionOutcome[]>>({});
  const [outcomesLoading, setOutcomesLoading] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [foundationResponse, decisionsResponse] = await Promise.all([
        fetch("/api/ops/company-brain/foundation", { cache: "no-store" }),
        fetch("/api/ops/company-brain/decisions", { cache: "no-store" }),
      ]);
      const foundationPayload = (await foundationResponse.json().catch(() => null)) as FoundationResponse | null;
      const decisionsPayload = (await decisionsResponse.json().catch(() => null)) as DecisionsResponse | null;
      if (!foundationResponse.ok || !foundationPayload?.ok || !foundationPayload.result) {
        throw new Error(apiError(foundationPayload, "Wissensstatus konnte nicht geladen werden."));
      }
      if (!decisionsResponse.ok || !decisionsPayload?.ok || !decisionsPayload.decisions) {
        throw new Error(apiError(decisionsPayload, "Entscheidungen konnten nicht geladen werden."));
      }
      setFoundation(foundationPayload.result);
      setDecisions(decisionsPayload.decisions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Wissen konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasSession || localMode) void loadAll();
  }, [hasSession, localMode, loadAll]);

  useEffect(() => {
    if (!reviewDialog && !outcomeDialog) return;
    function closeDialog(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setReviewDialog(null);
      setOutcomeDialog(null);
    }
    window.addEventListener("keydown", closeDialog);
    return () => window.removeEventListener("keydown", closeDialog);
  }, [outcomeDialog, reviewDialog]);

  const stats = useMemo(() => ({
    review: decisions.filter((entry) => entry.status === "review").length,
    approved: decisions.filter((entry) => entry.status === "approved").length,
    drafts: decisions.filter((entry) => entry.status === "draft").length,
    criticalIssues: foundation?.dataQualityIssues.filter((entry) => entry.severity === "critical").length || 0,
  }), [decisions, foundation]);

  const visibleDecisions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return decisions.filter((decision) => {
      const statusMatches = statusFilter === "all" || decision.status === statusFilter;
      const searchMatches = !query || [
        decision.title,
        decision.objective,
        decision.decisionKey,
        decision.scopeKey,
        decision.ownerTeam,
        decision.chosenOption,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      return statusMatches && searchMatches;
    });
  }, [decisions, search, statusFilter]);

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

  function openNewDecision(source?: CompanyDecision) {
    setForm(source ? decisionFormFrom(source) : emptyDecisionForm());
    setFormOpen(true);
    setMessage(null);
    window.setTimeout(() => document.getElementById("decision-draft-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function createDecision(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const decisionKey = form.decisionKey.trim() || slugify(form.title);
      const response = await fetch("/api/ops/company-brain/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          decisionKey,
          options: lines(form.options),
          guardrails: lines(form.guardrails),
          expectedOutcomes: lines(form.expectedOutcomes),
          risks: lines(form.risks),
          constraints: [],
          assumptions: [],
          consequences: [],
          reviewAt: new Date(`${form.reviewAt}T12:00:00`).toISOString(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as DecisionResponse | null;
      if (!response.ok || !payload?.ok || !payload.decision) throw new Error(apiError(payload, "Entwurf konnte nicht erstellt werden."));
      setFormOpen(false);
      setForm(emptyDecisionForm());
      setMessage(`Entwurf „${payload.decision.title}“ als Version ${payload.decision.versionNumber} angelegt.`);
      await loadAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Entwurf konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function executeReview() {
    if (!reviewDialog) return;
    const needsNote = reviewDialog.action === "request_changes";
    if (needsNote && reviewDialog.note.trim().length < 3) {
      setError("Änderungswünsche brauchen eine kurze Begründung.");
      return;
    }
    if (reviewDialog.action === "approve" && reviewDialog.confirmation.trim().toUpperCase() !== "FREIGABE") {
      setError("Für die Freigabe bitte FREIGABE eingeben.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/company-brain/decisions/${reviewDialog.decision.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: reviewDialog.action, note: reviewDialog.note }),
      });
      const payload = (await response.json().catch(() => null)) as DecisionResponse | null;
      if (!response.ok || !payload?.ok || !payload.decision) throw new Error(apiError(payload, "Status konnte nicht geändert werden."));
      const actionLabel = reviewDialog.action === "approve" ? "freigegeben" : reviewDialog.action === "submit" ? "zur Prüfung eingereicht" : "mit Änderungswunsch zurückgegeben";
      setMessage(`„${payload.decision.title}“ wurde ${actionLabel}.`);
      setReviewDialog(null);
      await loadAll();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Status konnte nicht geändert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function loadOutcomes(decisionId: string) {
    setOutcomesLoading(decisionId);
    try {
      const response = await fetch(`/api/ops/company-brain/decisions/${decisionId}/outcomes`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as OutcomesResponse | null;
      if (!response.ok || !payload?.ok || !payload.outcomes) throw new Error(apiError(payload, "Ergebnisse konnten nicht geladen werden."));
      setOutcomes((current) => ({ ...current, [decisionId]: payload.outcomes! }));
    } catch (outcomeError) {
      setError(outcomeError instanceof Error ? outcomeError.message : "Ergebnisse konnten nicht geladen werden.");
    } finally {
      setOutcomesLoading(null);
    }
  }

  function openOutcome(decision: CompanyDecision) {
    setOutcomeDialog({
      decision,
      outcomeKey: `review-${new Date().toISOString().slice(0, 10)}`,
      metricKey: "",
      targetValue: "",
      actualValue: "",
      unit: "",
      evaluationStatus: "pending",
      evaluationEnd: futureDate(30),
      finding: "",
      lessonsLearned: "",
    });
  }

  async function saveOutcome() {
    if (!outcomeDialog) return;
    const completed = outcomeDialog.evaluationStatus !== "pending";
    if (completed && outcomeDialog.finding.trim().length < 3) {
      setError("Eine abgeschlossene Auswertung braucht ein Ergebnis.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/company-brain/decisions/${outcomeDialog.decision.id}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcomeKey: outcomeDialog.outcomeKey,
          metricKey: outcomeDialog.metricKey || null,
          targetValue: outcomeDialog.targetValue || null,
          actualValue: outcomeDialog.actualValue || null,
          unit: outcomeDialog.unit || null,
          evaluationStatus: outcomeDialog.evaluationStatus,
          evaluationEnd: new Date(`${outcomeDialog.evaluationEnd}T12:00:00`).toISOString(),
          observedAt: completed ? new Date().toISOString() : null,
          finding: outcomeDialog.finding || null,
          lessonsLearned: outcomeDialog.lessonsLearned || null,
          evidenceRefs: [],
        }),
      });
      const payload = (await response.json().catch(() => null)) as OutcomesResponse | null;
      if (!response.ok || !payload?.ok || !payload.outcome) throw new Error(apiError(payload, "Ergebnis konnte nicht gespeichert werden."));
      const decisionId = outcomeDialog.decision.id;
      setOutcomeDialog(null);
      setMessage("Wirkungskontrolle gespeichert.");
      await loadOutcomes(decisionId);
    } catch (outcomeError) {
      setError(outcomeError instanceof Error ? outcomeError.message : "Ergebnis konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function syncWorkflows() {
    if (!window.confirm("n8n-Workflow-Inventar jetzt rein lesend aktualisieren? Es werden keine Workflows geändert.")) return;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/company-brain/foundation/workflows/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; result?: { total?: number; active?: number }; error?: string; issues?: string[] } | null;
      if (!response.ok || !payload?.ok) throw new Error(apiError(payload, "Workflow-Inventar konnte nicht aktualisiert werden."));
      setMessage(`${payload.result?.total || 0} Workflows gelesen, davon ${payload.result?.active || 0} aktiv.`);
      await loadAll();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Workflow-Inventar konnte nicht aktualisiert werden.");
    } finally {
      setSyncing(false);
    }
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Wissen"
        title="Wissen & Entscheidungen anmelden"
        description="Regeln, Entscheidungsgründe und Wirkungskontrollen bleiben im geschützten Ops-Bereich."
        activeApp="companyKnowledge"
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
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} px-4 py-4 md:px-6 md:py-6`}>
        <OpsPageHeader active="companyKnowledge" label="Wissen · Regeln, Entscheidungen und Systemgesundheit" />

        <div className="mt-4 grid gap-4">
          <OpsPageIntro
            eyebrow="Company Brain"
            title="Wissen, das Entscheidungen erklärt."
            description="Hier stehen gültige Regeln, offene Prüfungen und die Gründe hinter wichtigen Entscheidungen. Entwürfe werden erst nach einer bewussten Prüfung wirksam."
          >
            <a href="/ops/company-brain" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15">
              Fall prüfen <ArrowRight className="h-4 w-4" />
            </a>
            <button type="button" onClick={() => openNewDecision()} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-stone-100">
              <FilePlus2 className="h-4 w-4" /> Neue Entscheidung
            </button>
          </OpsPageIntro>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OpsStatCard label="Prüfung offen" value={stats.review} tone={stats.review ? "warning" : "success"} icon={<GitPullRequest className="h-5 w-5" />} detail="Entscheidungen warten auf Freigabe" />
            <OpsStatCard label="Gültige Regeln" value={stats.approved} tone="success" icon={<ShieldCheck className="h-5 w-5" />} detail="Aktiv im Company-Brain-Kontext" />
            <OpsStatCard label="Entwürfe" value={stats.drafts} tone="neutral" icon={<BookOpenCheck className="h-5 w-5" />} detail="Noch nicht zur Prüfung eingereicht" />
            <OpsStatCard label="Kritische Datenlücken" value={stats.criticalIssues} tone={stats.criticalIssues ? "danger" : "success"} icon={<AlertTriangle className="h-5 w-5" />} detail="Offene Qualitätsprobleme" />
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex w-fit rounded-xl border border-stone-200 bg-stone-50 p-1" aria-label="Wissensansicht">
              <button type="button" onClick={() => setView("decisions")} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${view === "decisions" ? "bg-stone-950 text-white" : "text-stone-600 hover:bg-white"}`}>Entscheidungen</button>
              <button type="button" onClick={() => setView("health")} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${view === "health" ? "bg-stone-950 text-white" : "text-stone-600 hover:bg-white"}`}>Systemwissen</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadAll()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 text-xs font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50">
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
              </button>
              {view === "health" ? (
                <button type="button" onClick={() => void syncWorkflows()} disabled={syncing} className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-3.5 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50">
                  <Workflow className={`h-4 w-4 ${syncing ? "animate-pulse" : ""}`} /> n8n-Inventar lesen
                </button>
              ) : null}
            </div>
          </section>

          {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div> : null}
          {message ? <div role="status" aria-live="polite" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

          {formOpen ? (
            <form id="decision-draft-form" onSubmit={createDecision} className="rounded-[22px] border border-stone-300 bg-white p-5 shadow-[0_14px_40px_rgba(24,20,16,0.07)] md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Neuer Entwurf</p>
                  <h2 className="mt-2 text-xl font-semibold text-stone-950">{form.decisionKey ? "Neue Version vorbereiten" : "Entscheidung dokumentieren"}</h2>
                  <p className="mt-1 text-sm leading-6 text-stone-600">Der Eintrag bleibt zunächst ein Entwurf und verändert keine operative Logik.</p>
                </div>
                <button type="button" onClick={() => setFormOpen(false)} aria-label="Formular schließen" className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100"><X className="h-4 w-4" /></button>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Titel
                  <input autoFocus required minLength={3} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Was wurde entschieden?" />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Art
                    <select value={form.decisionType} onChange={(event) => setForm((current) => ({ ...current, decisionType: event.target.value as CompanyDecisionType }))} className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200">
                      {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Review am
                    <input required type="date" min={futureDate(1)} value={form.reviewAt} onChange={(event) => setForm((current) => ({ ...current, reviewAt: event.target.value }))} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" />
                  </label>
                </div>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Geltungsbereich
                  <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <select value={form.scopeType} onChange={(event) => setForm((current) => ({ ...current, scopeType: event.target.value as CompanyDecisionScopeType }))} className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200">
                      {Object.entries(SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input required value={form.scopeKey} onChange={(event) => setForm((current) => ({ ...current, scopeKey: event.target.value }))} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="z. B. offer_send" />
                  </div>
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Verantwortliches Team
                  <input required value={form.ownerTeam} onChange={(event) => setForm((current) => ({ ...current, ownerTeam: event.target.value }))} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="z. B. Sales oder Operations" />
                </label>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Ziel
                  <textarea required minLength={10} rows={3} value={form.objective} onChange={(event) => setForm((current) => ({ ...current, objective: event.target.value }))} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Welches Ergebnis soll erreicht werden?" />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Problem
                  <textarea required minLength={10} rows={3} value={form.problemStatement} onChange={(event) => setForm((current) => ({ ...current, problemStatement: event.target.value }))} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Welches konkrete Problem wird gelöst?" />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700 lg:col-span-2">
                  Kontext
                  <textarea required minLength={10} rows={4} value={form.context} onChange={(event) => setForm((current) => ({ ...current, context: event.target.value }))} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Welche Belege, Annahmen oder Auslöser waren relevant?" />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Geprüfte Optionen
                  <textarea required rows={4} value={form.options} onChange={(event) => setForm((current) => ({ ...current, options: event.target.value }))} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder={"Eine Option pro Zeile\nAlternative Lösung"} />
                </label>
                <div className="grid gap-4">
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Gewählte Lösung
                    <input value={form.chosenOption} onChange={(event) => setForm((current) => ({ ...current, chosenOption: event.target.value }))} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Welche Option wurde gewählt?" />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Warum?
                    <textarea rows={2} value={form.rationale} onChange={(event) => setForm((current) => ({ ...current, rationale: event.target.value }))} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Warum ist diese Option besser?" />
                  </label>
                </div>
              </div>

              <details className="mt-4 rounded-xl border border-stone-200 bg-stone-50">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-stone-700">Leitplanken, Erfolgskriterien und technischer Schlüssel</summary>
                <div className="grid gap-4 border-t border-stone-200 p-4 lg:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Leitplanken
                    <textarea rows={3} value={form.guardrails} onChange={(event) => setForm((current) => ({ ...current, guardrails: event.target.value }))} className="resize-y rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Eine Leitplanke pro Zeile" />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Erwartete Ergebnisse
                    <textarea rows={3} value={form.expectedOutcomes} onChange={(event) => setForm((current) => ({ ...current, expectedOutcomes: event.target.value }))} className="resize-y rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Ein Ergebnis pro Zeile" />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Risiken
                    <textarea rows={3} value={form.risks} onChange={(event) => setForm((current) => ({ ...current, risks: event.target.value }))} className="resize-y rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Ein Risiko pro Zeile" />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                    Rollback
                    <textarea rows={3} value={form.rollbackPlan} onChange={(event) => setForm((current) => ({ ...current, rollbackPlan: event.target.value }))} className="resize-y rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Wie wird die Entscheidung sicher zurückgenommen?" />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700 lg:col-span-2">
                    Technischer Schlüssel
                    <input value={form.decisionKey} onChange={(event) => setForm((current) => ({ ...current, decisionKey: event.target.value }))} className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-mono text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Wird aus dem Titel erzeugt; für neue Versionen beibehalten" />
                  </label>
                </div>
              </details>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setFormOpen(false)} className="h-11 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">Abbrechen</button>
                <button type="submit" disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50">
                  <BookOpenCheck className="h-4 w-4" /> {saving ? "Speichert..." : "Entwurf anlegen"}
                </button>
              </div>
            </form>
          ) : null}

          {view === "decisions" ? (
            <>
              <section className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 lg:grid-cols-[minmax(0,1fr)_15rem_auto] lg:items-end">
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Suchen
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-xl border border-stone-300 pl-9 pr-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Titel, Prozess, Team oder Schlüssel" />
                  </div>
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Status
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CompanyDecisionStatus | "all")} className="h-10 rounded-xl border border-stone-300 bg-white px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200">
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <p className="pb-2 text-sm text-stone-500">{visibleDecisions.length} sichtbar</p>
              </section>

              {loading && !decisions.length ? (
                <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-500">Entscheidungen werden geladen...</div>
              ) : visibleDecisions.length ? (
                <section className="grid gap-3">
                  {visibleDecisions.map((decision) => (
                    <DecisionCard
                      key={decision.id}
                      decision={decision}
                      outcomes={outcomes[decision.id]}
                      outcomesLoading={outcomesLoading === decision.id}
                      onLoadOutcomes={() => void loadOutcomes(decision.id)}
                      onNewVersion={() => openNewDecision(decision)}
                      onReview={(action) => setReviewDialog({ decision, action, note: "", confirmation: "" })}
                      onOutcome={() => openOutcome(decision)}
                    />
                  ))}
                </section>
              ) : (
                <div className="rounded-[22px] border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
                  <BookOpenCheck className="mx-auto h-8 w-8 text-stone-400" />
                  <h2 className="mt-3 text-lg font-semibold text-stone-950">Keine Entscheidung in dieser Ansicht</h2>
                  <p className="mt-1 text-sm text-stone-500">Filter ändern oder einen neuen Entwurf anlegen.</p>
                </div>
              )}
            </>
          ) : (
            <section className="grid gap-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <section className="rounded-[22px] border border-stone-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Datenqualität</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Offene Wissenslücken</h2>
                    </div>
                    <Database className="h-5 w-5 text-stone-400" />
                  </div>
                  <div className="mt-4 grid gap-2">
                    {foundation?.dataQualityIssues.length ? foundation.dataQualityIssues.map((issue) => (
                      <details key={issue.id} className={`rounded-xl border ${severityClass(issue.severity)}`}>
                        <summary className="cursor-pointer list-none px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{issue.title}</p>
                              <p className="mt-1 text-xs opacity-65">{issue.sourceKey || "Systemweit"} · erkannt {formatDateTime(issue.lastDetectedAt)}</p>
                            </div>
                            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold">{issue.severity === "critical" ? "Kritisch" : issue.severity === "warning" ? "Warnung" : "Hinweis"}</span>
                          </div>
                        </summary>
                        <p className="border-t border-current/10 px-4 py-3 text-sm leading-6 opacity-85">{issue.detail}</p>
                      </details>
                    )) : (
                      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-900">Keine offene Datenqualitätswarnung.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-[22px] border border-stone-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Workflow-Registry</p>
                      <h2 className="mt-2 text-xl font-semibold text-stone-950">Automationen im Überblick</h2>
                    </div>
                    <Workflow className="h-5 w-5 text-stone-400" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["Gesamt", foundation?.workflowSummary.total || 0],
                      ["Aktiv", foundation?.workflowSummary.active || 0],
                      ["Ungeprüft", foundation?.workflowSummary.unreviewed || 0],
                      ["Zu groß", foundation?.workflowSummary.aboveNodeLimit || 0],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
                        <p className="text-[10px] font-semibold uppercase text-stone-400">{label}</p>
                        <p className="mt-2 text-2xl font-semibold text-stone-950">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid max-h-[28rem] gap-2 overflow-auto pr-1">
                    {foundation?.workflows
                      .filter((workflow) => workflow.active || workflow.lifecycleStatus === "unreviewed" || (workflow.nodeCount || 0) > workflow.maxAllowedNodes)
                      .slice(0, 80)
                      .map((workflow) => {
                        const tooLarge = workflow.nodeCount !== null && workflow.nodeCount > workflow.maxAllowedNodes;
                        return (
                          <div key={workflow.id} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-stone-950">{workflow.workflowName}</p>
                              <div className="flex gap-1.5">
                                {workflow.active ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">Aktiv</span> : null}
                                {tooLarge ? <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-900">Zu groß</span> : null}
                              </div>
                            </div>
                            <p className="mt-1 text-xs text-stone-500">{workflow.nodeCount ?? "?"} Nodes · {workflow.warningCount ?? 0} Warnungen · {workflow.ownerTeam || "Kein Owner"}</p>
                          </div>
                        );
                      })}
                  </div>
                </section>
              </div>

              <section className="rounded-[22px] border border-stone-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Quellenregister</p>
                    <h2 className="mt-2 text-xl font-semibold text-stone-950">Welche Quelle entscheidet?</h2>
                    <p className="mt-1 text-sm text-stone-500">Trello bleibt Projektion. Autoritative Quellen sind sichtbar gekennzeichnet.</p>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-stone-400" />
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {foundation?.sources.map((source) => (
                    <div key={source.sourceKey} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-stone-950">{source.displayName}</p>
                          <p className="mt-1 text-xs text-stone-500">{source.ownerTeam} · {source.sourceKind}</p>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${source.authority === "authoritative" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-white text-stone-600"}`}>
                          {source.authority === "authoritative" ? "Source of Truth" : source.authority}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-stone-600">{source.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          )}
        </div>
      </div>

      {reviewDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="decision-review-title" className="w-full max-w-lg rounded-[22px] border border-stone-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Entscheidungsprüfung</p>
                <h2 id="decision-review-title" className="mt-2 text-xl font-semibold text-stone-950">
                  {reviewDialog.action === "approve" ? "Entscheidung freigeben" : reviewDialog.action === "submit" ? "Zur Prüfung einreichen" : "Änderungen anfordern"}
                </h2>
                <p className="mt-1 text-sm text-stone-600">{reviewDialog.decision.title}</p>
              </div>
              <button type="button" onClick={() => setReviewDialog(null)} aria-label="Dialog schließen" className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100"><X className="h-4 w-4" /></button>
            </div>
            <label className="mt-5 grid gap-1.5 text-xs font-semibold text-stone-700">
              {reviewDialog.action === "request_changes" ? "Begründung" : "Interne Prüfnotiz"}
              <textarea autoFocus rows={4} value={reviewDialog.note} onChange={(event) => setReviewDialog((current) => current ? { ...current, note: event.target.value } : current)} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder={reviewDialog.action === "request_changes" ? "Was muss geändert werden?" : "Optionaler interner Hinweis"} />
            </label>
            {reviewDialog.action === "approve" ? (
              <label className="mt-4 grid gap-1.5 text-xs font-semibold text-stone-700">
                Bestätigung
                <input value={reviewDialog.confirmation} onChange={(event) => setReviewDialog((current) => current ? { ...current, confirmation: event.target.value } : current)} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="FREIGABE" />
                <span className="font-normal leading-5 text-stone-500">Die Entscheidung wird als gültiger Company-Brain-Kontext verwendet und ersetzt eine ältere aktive Version mit demselben Schlüssel.</span>
              </label>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReviewDialog(null)} className="h-10 rounded-xl border border-stone-300 bg-white px-4 text-xs font-semibold text-stone-700">Abbrechen</button>
              <button type="button" onClick={() => void executeReview()} disabled={saving} className="h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Speichert..." : "Bestätigen"}</button>
            </div>
          </section>
        </div>
      ) : null}

      {outcomeDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="decision-outcome-title" className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-[22px] border border-stone-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Wirkungskontrolle</p>
                <h2 id="decision-outcome-title" className="mt-2 text-xl font-semibold text-stone-950">Ergebnis dokumentieren</h2>
                <p className="mt-1 text-sm text-stone-600">{outcomeDialog.decision.title}</p>
              </div>
              <button type="button" onClick={() => setOutcomeDialog(null)} aria-label="Dialog schließen" className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                Ergebnis-Schlüssel
                <input autoFocus value={outcomeDialog.outcomeKey} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, outcomeKey: event.target.value } : current)} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                Auswertung bis
                <input type="date" min={futureDate(1)} value={outcomeDialog.evaluationEnd} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, evaluationEnd: event.target.value } : current)} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                Status
                <select value={outcomeDialog.evaluationStatus} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, evaluationStatus: event.target.value as CompanyDecisionOutcome["evaluationStatus"] } : current)} className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200">
                  <option value="pending">Auswertung geplant</option>
                  <option value="met">Ziel erreicht</option>
                  <option value="missed">Ziel verfehlt</option>
                  <option value="inconclusive">Noch unklar</option>
                  <option value="cancelled">Abgebrochen</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                Kennzahl optional
                <input value={outcomeDialog.metricKey} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, metricKey: event.target.value } : current)} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="z. B. quote_send_success_rate" />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                Zielwert
                <input type="number" step="any" value={outcomeDialog.targetValue} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, targetValue: event.target.value } : current)} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" />
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Istwert
                  <input type="number" step="any" value={outcomeDialog.actualValue} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, actualValue: event.target.value } : current)} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-700">
                  Einheit
                  <input value={outcomeDialog.unit} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, unit: event.target.value } : current)} className="h-11 rounded-xl border border-stone-300 px-3 text-sm font-normal outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="%" />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-700 sm:col-span-2">
                Feststellung
                <textarea rows={3} value={outcomeDialog.finding} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, finding: event.target.value } : current)} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Was ist tatsächlich passiert?" />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-700 sm:col-span-2">
                Was haben wir gelernt?
                <textarea rows={3} value={outcomeDialog.lessonsLearned} onChange={(event) => setOutcomeDialog((current) => current ? { ...current, lessonsLearned: event.target.value } : current)} className="resize-y rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200" placeholder="Welche Konsequenz folgt für die nächste Entscheidung?" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOutcomeDialog(null)} className="h-10 rounded-xl border border-stone-300 bg-white px-4 text-xs font-semibold text-stone-700">Abbrechen</button>
              <button type="button" onClick={() => void saveOutcome()} disabled={saving} className="h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Speichert..." : "Ergebnis speichern"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
