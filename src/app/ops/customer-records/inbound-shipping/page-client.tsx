"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileText, PlaneLanding, RefreshCcw, ShieldAlert, Truck } from "lucide-react";
import type { InboundBoard, InboundBoardItem, InboundIncident, InboundIncidentSeverity, InboundStatus } from "@/lib/ops/inbound-shipping";
import { OpsLoginCard } from "../../ops-login-card";
import { OpsPageHeader } from "../../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../../ops-design";

type InboundApiResponse = {
  ok: boolean;
  board?: InboundBoard;
  error?: string;
  issues?: string[];
};

type InboundBoardScope = "moving" | "active" | "problems" | "label_created" | "all";
type InboundBoardCarrier = "all" | "dhl" | "fedex" | "other" | "unknown";
type InboundIncidentAction = "create_task" | "acknowledge" | "resolve" | "ignore";

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Keine Angabe";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: InboundStatus) {
  const labels: Record<InboundStatus, string> = {
    tracking_created: "Tracking erfasst",
    carrier_not_found: "nicht gefunden",
    label_created: "Label erstellt",
    tendered: "übergeben",
    in_transit: "unterwegs",
    clearance_in_progress: "Zoll läuft",
    clearance_action_required: "Zoll braucht Aktion",
    out_for_delivery: "in Zustellung",
    delivered: "zugestellt",
    exception: "Ausnahme",
    stale: "stale",
    closed: "geschlossen",
  };
  return labels[status] || status;
}

function severityTone(severity: InboundIncidentSeverity) {
  if (severity === "urgent") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "high") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

export function InboundShippingClient({
  initialHasSession,
  initialRequestId,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  initialRequestId?: string;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-inbound-shipping-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [board, setBoard] = useState<InboundBoard | null>(null);
  const [scope, setScope] = useState<InboundBoardScope>("active");
  const [carrier, setCarrier] = useState<InboundBoardCarrier>("all");
  const [requestIdDraft, setRequestIdDraft] = useState(initialRequestId || "");
  const [appliedRequestId, setAppliedRequestId] = useState((initialRequestId || "").trim());
  const [loading, setLoading] = useState(false);
  const [savingIncidentId, setSavingIncidentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const loadRequestSeq = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(operatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    try {
      if (operatorName) window.localStorage.setItem(operatorNameKey, operatorName);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, [operatorName]);

  useEffect(() => {
    if (hasSession || localMode) void loadBoard();
  }, [hasSession, localMode, scope, carrier, appliedRequestId]);

  useEffect(() => {
    return () => loadAbortRef.current?.abort();
  }, []);

  const items = useMemo(() => board?.items || [], [board]);

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

  async function loadBoard(requestIdOverride = appliedRequestId) {
    const sequence = loadRequestSeq.current + 1;
    loadRequestSeq.current = sequence;
    loadAbortRef.current?.abort();
    const abortController = new AbortController();
    loadAbortRef.current = abortController;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      params.set("carrier", carrier);
      if (requestIdOverride.trim()) params.set("requestId", requestIdOverride.trim());
      const response = await fetch(`/api/ops/customer-records/inbound-shipping?${params.toString()}`, { signal: abortController.signal });
      const payload = (await response.json().catch(() => null)) as InboundApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.board) throw new Error(formatApiError(payload));
      if (sequence !== loadRequestSeq.current) return;
      setBoard(payload.board);
    } catch (loadError) {
      if (abortController.signal.aborted) return;
      if (sequence !== loadRequestSeq.current) return;
      setError(loadError instanceof Error ? loadError.message : "Wareneingang konnte nicht geladen werden.");
    } finally {
      if (sequence === loadRequestSeq.current) {
        setLoading(false);
        if (loadAbortRef.current === abortController) loadAbortRef.current = null;
      }
    }
  }

  function applyRequestFilter() {
    const nextRequestId = requestIdDraft.trim();
    if (nextRequestId === appliedRequestId) {
      void loadBoard(nextRequestId);
      return;
    }
    setAppliedRequestId(nextRequestId);
  }

  function confirmIncidentAction(incident: InboundIncident, action: InboundIncidentAction) {
    if (action === "resolve") {
      return window.confirm(`Incident "${incident.title}" wirklich als erledigt markieren?`);
    }
    if (action === "ignore") {
      return window.confirm(`Incident "${incident.title}" wirklich ignorieren?`);
    }
    return true;
  }

  function incidentActionLabel(incident: InboundIncident, action: InboundIncidentAction) {
    if (action === "create_task") return `Aufgabe für ${incident.title} anlegen`;
    if (action === "acknowledge") return `Incident ${incident.title} als gesehen markieren`;
    if (action === "resolve") return `Incident ${incident.title} als erledigt markieren`;
    return `Incident ${incident.title} ignorieren`;
  }

  async function runIncidentAction(incident: InboundIncident, action: InboundIncidentAction) {
    if (!confirmIncidentAction(incident, action)) return;
    setSavingIncidentId(incident.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/customer-records/inbound-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, incidentId: incident.id, operatorName, scope, carrier, requestId: appliedRequestId }),
      });
      const payload = (await response.json().catch(() => null)) as InboundApiResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));
      if (payload.board) setBoard(payload.board);
      if (action === "create_task") setMessage("Aufgabe wurde angelegt oder war bereits verknüpft.");
      else if (action === "ignore") setMessage("Incident wurde ignoriert.");
      else if (action === "resolve") setMessage("Incident wurde erledigt.");
      else setMessage("Incident wurde aktualisiert.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
    } finally {
      setSavingIncidentId(null);
    }
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Wareneingang"
        title="Wareneingang anmelden"
        description="Melde dich für eingehende China-Sendungen an. Carrier-Status, Clearance-Hinweise und Aufgaben bleiben geschützt und nachvollziehbar."
        activeApp="inboundShipping"
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
    <main className={`${opsPageShellClass} px-4 py-6 md:px-6`}>
      <div className={`${opsPageContainerClass} flex flex-col gap-6`}>
        <OpsPageHeader active="inboundShipping" label="Wareneingang" />

        <OpsPageIntro
          eyebrow="Inbound Ops"
          title="Inbound-Sendungen verfolgen. Risiken früh erkennen."
          description="China-Sendungen, Carrier-Status und Clearance-Hinweise in einer kompakten Arbeitsansicht."
        />

        <section className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          <OpsStatCard label="Label" value={board?.counts.labelCreated || 0} tone="warning" icon={<Clock3 className="h-5 w-5" />} detail="Nur angekündigt." />
          <OpsStatCard label="Übergeben" value={board?.counts.acceptedByCarrier || 0} icon={<Truck className="h-5 w-5" />} detail="Carrier hat übernommen." />
          <OpsStatCard label="Aktion" value={board?.counts.actionRequired || 0} tone="danger" icon={<AlertTriangle className="h-5 w-5" />} detail="Handlungsbedarf." />
          <OpsStatCard label="Clearance" value={board?.counts.clearance || 0} tone="warning" icon={<ShieldAlert className="h-5 w-5" />} detail="Zoll im Blick." />
          <OpsStatCard label="Zustellung" value={board?.counts.outForDelivery || 0} tone="success" icon={<PlaneLanding className="h-5 w-5" />} detail="Heute relevant." />
          <OpsStatCard label="Problem" value={board?.counts.exception || 0} tone="danger" icon={<AlertTriangle className="h-5 w-5" />} detail="Exception/Unbekannt." />
          <OpsStatCard label="Erledigt" value={board?.counts.delivered || 0} tone="success" icon={<CheckCircle2 className="h-5 w-5" />} detail="Zugestellt." />
        </section>

        <section className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[180px_180px_160px_minmax(0,1fr)_minmax(0,1fr)]">
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as InboundBoardScope)}
              className="w-full min-w-0 rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm"
              aria-label="Wareneingang-Statusfilter"
            >
              <option value="active">Aktive Sendungen</option>
              <option value="problems">Problemfälle</option>
              <option value="moving">Wirklich unterwegs</option>
              <option value="label_created">Nur Label erstellt</option>
              <option value="all">Alle Sendungen</option>
            </select>
            <select
              value={carrier}
              onChange={(event) => setCarrier(event.target.value as InboundBoardCarrier)}
              className="w-full min-w-0 rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm"
              aria-label="Carrier-Filter"
            >
              <option value="all">Alle Carrier</option>
              <option value="dhl">DHL Express</option>
              <option value="fedex">FedEx</option>
              <option value="other">Sonstige Carrier</option>
              <option value="unknown">Unbekannt</option>
            </select>
            <button onClick={applyRequestFilter} className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-2 text-sm font-medium text-white">
              <RefreshCcw className="h-4 w-4" />
              Laden
            </button>
            <input
              value={requestIdDraft}
              onChange={(event) => setRequestIdDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyRequestFilter();
              }}
              className="w-full min-w-0 rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm"
              placeholder="Request-ID Filter"
              aria-label="Request-ID Filter"
            />
            <input
              value={operatorName}
              onChange={(event) => setOperatorName(event.target.value)}
              className="w-full min-w-0 rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm"
              placeholder="Operator"
              aria-label="Operator"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {loading ? <span className="text-sm text-stone-500" role="status" aria-live="polite">Wareneingang wird geladen...</span> : null}
            {message ? <span className="text-sm text-emerald-700" role="status" aria-live="polite">{message}</span> : null}
            {error ? <span className="text-sm text-rose-700" role="alert">{error}</span> : null}
          </div>
        </section>

        <section className="grid gap-4">
          {items.length ? (
            items.map((item: InboundBoardItem) => (
              <article key={item.shipment.id} className="rounded-[0.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                <div className="grid gap-4 md:grid-cols-[7rem_1fr]">
                  {item.visual ? (
                    <a
                      className="block aspect-[4/3] overflow-hidden rounded-[0.5rem] border border-stone-200 bg-stone-100 outline-none focus-visible:ring-2 focus-visible:ring-stone-900 md:aspect-square"
                      href={item.visual.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${item.visual.sourceLabel}: ${item.visual.label}`}
                    >
                      <img
                        src={item.visual.url}
                        alt={item.visual.label}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : null}

                  <div className={item.visual ? "" : "md:col-span-2"}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs uppercase text-stone-500">
                          <span>{item.shipment.carrier.toUpperCase()}</span>
                          <span>{item.shipment.trackingNumber}</span>
                          <span>{statusLabel(item.shipment.status)}</span>
                          {item.visual ? <span>{item.visual.sourceLabel}</span> : null}
                        </div>
                        <h2 className="mt-2 text-xl font-semibold">{item.shipment.trelloCardName || "Wareneingang ohne Trello-Titel"}</h2>
                        <p className="mt-1 text-sm text-stone-500">
                          Letztes Event: {item.latestEvent ? `${formatDate(item.latestEvent.eventTime)} - ${item.latestEvent.carrierStatusText || statusLabel(item.latestEvent.normalizedStatus)}` : "kein Carrier-Event gespeichert"}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">
                          Tracking erfasst: {formatDate(item.shipment.trackingFirstSeenAt)} | letzte Prüfung: {formatDate(item.shipment.lastCheckedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.shipment.trelloCardUrl ? (
                          <a className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50" href={item.shipment.trelloCardUrl} target="_blank" rel="noreferrer">
                            Trello
                          </a>
                        ) : null}
                        <a className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50" href={`https://www.google.com/search?q=${encodeURIComponent(`${item.shipment.carrier} ${item.shipment.trackingNumber}`)}`} target="_blank" rel="noreferrer">
                          Tracking
                        </a>
                      </div>
                    </div>

                    {item.incidents.length ? (
                      <div className="mt-4 grid gap-3">
                        {item.incidents.map((entry) => (
                          <div key={entry.id} className={`rounded-[0.5rem] border px-4 py-3 ${severityTone(entry.severity)}`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2 text-xs uppercase">
                                  <span>{entry.severity}</span>
                                  <span>{entry.status}</span>
                                  {entry.activeTaskId ? <span>Aufgabe verknüpft</span> : null}
                                </div>
                                <div className="mt-1 font-semibold">{entry.title}</div>
                                {entry.description ? <p className="mt-1 text-sm leading-6 opacity-80">{entry.description}</p> : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "create_task")} aria-label={incidentActionLabel(entry, "create_task")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                  {savingIncidentId === entry.id ? "Speichert..." : "Aufgabe"}
                                </button>
                                <button disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "acknowledge")} aria-label={incidentActionLabel(entry, "acknowledge")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                  Gesehen
                                </button>
                                <button disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "resolve")} aria-label={incidentActionLabel(entry, "resolve")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                  Erledigt
                                </button>
                                <button disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "ignore")} aria-label={incidentActionLabel(entry, "ignore")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                  Ignorieren
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-[0.5rem] border border-dashed border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
                        Keine offenen Wareneingang-Hinweise.
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-[0.5rem] border border-stone-200 bg-white p-8 text-center text-stone-500">
              <FileText className="mx-auto h-7 w-7 text-emerald-600" />
              <p className="mt-3">Keine eingehenden Sendungen in dieser Ansicht.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
