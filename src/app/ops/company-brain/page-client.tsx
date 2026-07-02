"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  ExternalLink,
  FileSearch,
  MailCheck,
  Network,
  RefreshCcw,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { CompanyBrainResolveResult } from "@/lib/ops/company-brain";
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
  const [result, setResult] = useState<CompanyBrainResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
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
  }), [result]);

  const quickQuestions = [
    "Ist das Angebot rausgegangen?",
    "Welche Farbe ist belegt?",
    "Ist es ein 3D-Schild mit zwei Designs?",
    "Gab es eine Kundenbestätigung?",
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
        body: JSON.stringify({ query, question, limit: 5 }),
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
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)_auto] lg:items-end">
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
            <section className="grid gap-4 md:grid-cols-4">
              <OpsStatCard label="Kundenakten" value={stats.records} icon={<BrainCircuit className="h-5 w-5" />} />
              <OpsStatCard label="Angebote" value={stats.offers} tone="info" icon={<FileSearch className="h-5 w-5" />} />
              <OpsStatCard label="Belege" value={stats.evidence} tone="success" icon={<MailCheck className="h-5 w-5" />} />
              <OpsStatCard label="Automationen" value={stats.automations} tone={stats.automations ? "info" : stats.findings ? "warning" : "neutral"} icon={<Workflow className="h-5 w-5" />} />
            </section>

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
                            {run.error ? <p className="mt-1 text-rose-700">{run.error}</p> : null}
                          </div>
                          <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-500">
                            {formatDateTime(run.createdAt)}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-1 text-xs text-stone-500">
                          {run.executionId ? <span>Execution: {run.executionId}</span> : null}
                          {run.correlationId ? <span>Correlation: {run.correlationId}</span> : null}
                          {run.sourceEventId ? <span>Source Event: {run.sourceEventId}</span> : null}
                          {run.targetRecordId ? <span>Target: {run.targetRecordId}</span> : null}
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
