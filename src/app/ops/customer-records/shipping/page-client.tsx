"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, ListChecks, PackageCheck, RefreshCcw, Search, Truck } from "lucide-react";
import type { ShippingBoard, ShippingBoardItem, ShippingIncident, ShippingIncidentSeverity, ShippingStatus } from "@/lib/ops/shipping";
import { OpsAppSwitcher } from "../../ops-app-switcher";

type ShippingApiResponse = {
  ok: boolean;
  board?: ShippingBoard;
  error?: string;
  issues?: string[];
};

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
  return "Pruefung";
}

function leadIncident(item: ShippingBoardItem) {
  return item.incidents.find((incident) => incident.status === "open") || item.incidents[0] || null;
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
  const [scope, setScope] = useState<"active" | "problems" | "all">("problems");
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
      setError(loadError instanceof Error ? loadError.message : "Shipping Board konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function runIncidentAction(incident: ShippingIncident, action: "create_task" | "acknowledge" | "resolve" | "ignore") {
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
      setMessage(action === "create_task" ? "Aufgabe wurde angelegt oder war bereits verknüpft." : "Incident wurde aktualisiert.");
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
      <main className="min-h-screen bg-stone-100 p-6 text-stone-900">
        <div className="mx-auto max-w-md rounded-[0.5rem] border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Shipping Ops Login</h1>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="mt-5 w-full rounded-[0.5rem] border border-stone-300 px-3 py-2"
            placeholder="Ops Token"
          />
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          <button onClick={() => void login()} className="mt-5 w-full rounded-[0.5rem] bg-stone-950 px-4 py-3 text-sm font-medium text-white">
            Einloggen
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 text-stone-900 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-[0.5rem] bg-stone-950 px-6 py-6 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase text-stone-400">Customer Records</p>
              <h1 className="mt-2 text-3xl font-semibold">Shipping Ops</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-300">
                Globale Versand-Queue fuer DPD/DHL. Geprueft werden nur aktuelle Sendungen der letzten 60 Tage; Paketshop-Faelle sind Kundenhinweise, echte Fehlermeldungen sind Ruecklauf oder fehlgeschlagene Zustellung.
              </p>
            </div>
            <OpsAppSwitcher active="shipping" tone="dark" />
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-6">
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.actionRequired || 0}</p>
            <p className="text-sm text-stone-500">Echte Fehler</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <Clock3 className="h-5 w-5 text-sky-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.watch || 0}</p>
            <p className="text-sm text-stone-500">Beobachten</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <Truck className="h-5 w-5 text-stone-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.inTransit || 0}</p>
            <p className="text-sm text-stone-500">unterwegs</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <PackageCheck className="h-5 w-5 text-emerald-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.delivered || 0}</p>
            <p className="text-sm text-stone-500">zugestellt</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <RefreshCcw className="h-5 w-5 text-amber-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.returning || 0}</p>
            <p className="text-sm text-stone-500">Retoure</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <ListChecks className="h-5 w-5 text-violet-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.withOpenTask || 0}</p>
            <p className="text-sm text-stone-500">mit Aufgabe</p>
          </div>
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
              />
            </label>
            <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="problems">Echte Fehler</option>
              <option value="active">Aktive Sendungen</option>
              <option value="all">Alle Sendungen</option>
            </select>
            <select value={carrier} onChange={(event) => setCarrier(event.target.value as typeof carrier)} className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="all">Alle Carrier</option>
              <option value="dpd">DPD</option>
              <option value="dhl">DHL</option>
            </select>
            <button onClick={() => void loadBoard()} className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-2 text-sm font-medium text-white">
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
            />
            {loading ? <span className="text-sm text-stone-500">Shipping wird geladen...</span> : null}
            {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
            {error ? <span className="text-sm text-rose-700">{error}</span> : null}
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
                              <button disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "create_task")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                Aufgabe
                              </button>
                              <button disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "acknowledge")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                Gesehen
                              </button>
                              <button disabled={savingIncidentId === entry.id} onClick={() => void runIncidentAction(entry, "resolve")} className="rounded-[0.5rem] border border-current/20 bg-white/60 px-3 py-2 text-xs font-medium">
                                Erledigt
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[0.5rem] border border-dashed border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
                      Keine offenen Shipping-Incidents.
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
