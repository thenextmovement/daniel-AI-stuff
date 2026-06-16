"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, ListChecks, PackageCheck, RefreshCcw, Search, Truck } from "lucide-react";
import type { ShippingBoard, ShippingBoardItem, ShippingIncident, ShippingIncidentSeverity, ShippingStatus } from "@/lib/ops/shipping";
import { OpsLoginCard } from "../../ops-login-card";
import { OpsPageHeader } from "../../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../../ops-design";

type ShippingApiResponse = {
  ok: boolean;
  board?: ShippingBoard;
  error?: string;
  issues?: string[];
};
type ShippingIncidentAction = "create_task" | "acknowledge" | "resolve" | "ignore";

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Keine Angabe";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: ShippingStatus) {
  const labels: Record<ShippingStatus, string> = {
    created: "angelegt",
    tracking_missing: "Tracking fehlt",
    label_created: "Label erstellt",
    carrier_not_found: "nicht gefunden",
    in_transit: "unterwegs",
    out_for_delivery: "in Zustellung",
    pickup_available: "Abholung",
    delivery_failed: "Zustellung fehlgeschlagen",
    delivered: "zugestellt",
    returning: "kommt zurück",
    returned: "zurück",
    lost_or_stale: "unklar",
    closed: "geschlossen",
  };
  return labels[status] || status;
}

function severityTone(severity: ShippingIncidentSeverity) {
  if (severity === "urgent") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "high") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function incidentKindLabel(incident: ShippingIncident) {
  if (incident.incidentType === "pickup_available") return "Kundenhinweis";
  if (["delivery_failed", "return_to_sender", "returned"].includes(incident.incidentType)) return "Fehlermeldung";
  return "Prüfung";
}

function leadIncident(item: ShippingBoardItem) {
  return item.incidents.find((incident) => incident.status === "open") || item.incidents[0] || null;
}

function confirmIncidentAction(incident: ShippingIncident, action: ShippingIncidentAction) {
  if (action === "resolve") {
    return window.confirm(`Incident "${incident.title}" wirklich als erledigt markieren?`);
  }
  if (action === "ignore") {
    return window.confirm(`Incident "${incident.title}" wirklich ignorieren?`);
  }
  return true;
}

function incidentActionLabel(incident: ShippingIncident, action: ShippingIncidentAction) {
  if (action === "create_task") return `Aufgabe für ${incident.title} anlegen`;
  if (action === "acknowledge") return `Incident ${incident.title} als gesehen markieren`;
  if (action === "resolve") return `Incident ${incident.title} als erledigt markieren`;
  return `Incident ${incident.title} ignorieren`;
}

function incidentActionMessage(action: ShippingIncidentAction) {
  if (action === "create_task") return "Aufgabe wurde angelegt oder war bereits verknüpft.";
  if (action === "acknowledge") return "Incident wurde als gesehen markiert.";
  if (action === "resolve") return "Incident wurde erledigt.";
  return "Incident wurde ignoriert.";
}

export function CustomerShippingClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-shipping-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [board, setBoard] = useState<ShippingBoard | null>(null);
  const [scope, setScope] = useState<"moving" | "active" | "problems" | "label_created" | "all">("moving");
  const [carrier, setCarrier] = useState<"all" | "dpd" | "dhl">("all");
  const [requestId, setRequestId] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingIncidentId, setSavingIncidentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(operatorNameKey);
      if (raw) setOperatorName(raw);
      const params = new URLSearchParams(window.location.search);
      const request = params.get("requestId");
      if (request) setRequestId(request);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    if (operatorName) window.localStorage.setItem(operatorNameKey, operatorName);
  }, [operatorName]);

  useEffect(() => {
    if (hasSession || localMode) void loadBoard();
  }, [hasSession, localMode, scope, carrier]);

  const filteredItems = useMemo(() => board?.items || [], [board]);

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

  async function loadBoard() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      params.set("carrier", carrier);
      if (requestId.trim()) params.set("requestId", requestId.trim());
      const response = await fetch(`/api/ops/customer-records/shipping?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as ShippingApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.board) throw new Error(formatApiError(payload));
      setBoard(payload.board);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Paketversand konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function runIncidentAction(incident: ShippingIncident, action: ShippingIncidentAction) {
    if (!confirmIncidentAction(incident, action)) return;
    setSavingIncidentId(incident.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/customer-records/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, incidentId: incident.id, operatorName }),
      });
      const payload = (await response.json().catch(() => null)) as ShippingApiResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));
      if (payload.board) setBoard(payload.board);
      setMessage(incidentActionMessage(action));
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
        eyebrow="Paketversand"
        title="Paketversand anmelden"
        description="Melde dich für den Kundenversand an. Tracking-Prüfung, Incidents und Aufgaben bleiben geschützt und nachvollziehbar."
        activeApp="shipping"
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
        <OpsPageHeader active="shipping" label="Paketversand" />

        <OpsPageIntro
          eyebrow="Kundenpakete raus"
          title="Sendungen prüfen. Ausnahmen schließen."
          description="Aktuelle DPD/DHL-Sendungen nach Kundenversand mit Fokus auf echte Fehler, Retoure und offene Aufgaben."
        />

        <section className="grid gap-3 md:grid-cols-6">
          <OpsStatCard label="Fehler" value={board?.counts.actionRequired || 0} tone="danger" icon={<AlertTriangle className="h-5 w-5" />} detail="Echte Zustellprobleme." />
          <OpsStatCard label="Watch" value={board?.counts.watch || 0} tone="info" icon={<Clock3 className="h-5 w-5" />} detail="Aktiv beobachten." />
          <OpsStatCard label="Label" value={board?.counts.labelCreated || 0} tone="warning" icon={<Clock3 className="h-5 w-5" />} detail="Noch kein Carrier-Scan." />
          <OpsStatCard label="Unterwegs" value={board?.counts.inTransit || 0} icon={<Truck className="h-5 w-5" />} detail="Echte Carrier-Bewegung." />
          <OpsStatCard label="Zugestellt" value={board?.counts.delivered || 0} tone="success" icon={<PackageCheck className="h-5 w-5" />} detail="Sauber abgeschlossen." />
          <OpsStatCard label="Aufgabe" value={board?.counts.withOpenTask || 0} tone="info" icon={<ListChecks className="h-5 w-5" />} detail="Mit Teamaufgabe." />
        </section>

        <section className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_160px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
              <input
                value={requestId}
                onChange={(event) => setRequestId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void loadBoard();
                }}
                className="w-full rounded-[0.5rem] border border-stone-300 py-2 pl-9 pr-3 text-sm"
                placeholder="Request-ID filtern"
                aria-label="Request-ID Filter"
              />
            </label>
            <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} aria-label="Paketversand-Statusfilter" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="moving">Wirklich unterwegs</option>
              <option value="problems">Echte Fehler</option>
              <option value="label_created">Nur Label erstellt</option>
              <option value="active">Aktive Sendungen</option>
              <option value="all">Alle Sendungen</option>
            </select>
            <select value={carrier} onChange={(event) => setCarrier(event.target.value as typeof carrier)} aria-label="Carrier-Filter" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="all">Alle Carrier</option>
              <option value="dpd">DPD</option>
              <option value="dhl">DHL</option>
            </select>
            <button type="button" onClick={() => void loadBoard()} className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-2 text-sm font-medium text-white">
              <RefreshCcw className="h-4 w-4" />
              Laden
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              value={operatorName}
              onChange={(event) => setOperatorName(event.target.value)}
              className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm"
              placeholder="Operator"
              aria-label="Operator"
            />
            {loading ? <span className="text-sm text-stone-500" role="status" aria-live="polite">Paketversand wird geladen...</span> : null}
            {message ? <span className="text-sm text-emerald-700" role="status" aria-live="polite">{message}</span> : null}
            {error ? <span className="text-sm text-rose-700" role="alert">{error}</span> : null}
          </div>
        </section>

        <section className="grid gap-4">
          {filteredItems.length ? (
            filteredItems.map((item) => {
              return (
                <article key={item.shipment.id} className="rounded-[0.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase text-stone-500">
                        <span>{item.shipment.carrier.toUpperCase()}</span>
                        <span>{item.shipment.trackingNumber}</span>
                        <span>{statusLabel(item.shipment.status)}</span>
                      </div>
                      <h2 className="mt-2 text-xl font-semibold">
                        {item.shipment.shopifyOrderNumber || item.shipment.requestId || item.shipment.customerName || "Sendung ohne Zuordnung"}
                      </h2>
                      <p className="mt-1 text-sm text-stone-500">
                        Letztes Event: {item.latestEvent ? `${formatDate(item.latestEvent.eventTime)} - ${item.latestEvent.carrierStatusText || statusLabel(item.latestEvent.normalizedStatus)}` : "kein Event gespeichert"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.shipment.requestId ? (
                        <a className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50" href={`/ops/customer-records?query=${encodeURIComponent(item.shipment.requestId)}`}>
                          Kundenakte
                        </a>
                      ) : null}
                      {item.shipment.trackingUrl ? (
                        <a className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50" href={item.shipment.trackingUrl} target="_blank" rel="noreferrer">
                          Tracking
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {item.incidents.length ? (
                    <div className="mt-4 grid gap-3">
                      {item.incidents.map((entry) => (
                        <div key={entry.id} className={`rounded-[0.5rem] border px-4 py-3 ${severityTone(entry.severity)}`}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2 text-xs uppercase">
                                <span>{incidentKindLabel(entry)}</span>
                                <span>{entry.severity}</span>
                                <span>{entry.status}</span>
                                {entry.activeTaskId ? <span>Aufgabe verknüpft</span> : null}
                              </div>
                              <div className="mt-1 font-semibold">{entry.title}</div>
                              {entry.description ? <p className="mt-1 text-sm leading-6 opacity-80">{entry.description}</p> : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button type="button" disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "create_task")} aria-label={incidentActionLabel(entry, "create_task")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                Aufgabe
                              </button>
                              <button type="button" disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "acknowledge")} aria-label={incidentActionLabel(entry, "acknowledge")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                Gesehen
                              </button>
                              <button type="button" disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "resolve")} aria-label={incidentActionLabel(entry, "resolve")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                Erledigt
                              </button>
                              <button type="button" disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "ignore")} aria-label={incidentActionLabel(entry, "ignore")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                Ignorieren
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[0.5rem] border border-dashed border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
                      Keine offenen Paketversand-Incidents.
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            <div className="rounded-[0.5rem] border border-stone-200 bg-white p-8 text-center text-stone-500">
              <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
              <p className="mt-3">Keine Sendungen in dieser Ansicht.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
