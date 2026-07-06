"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  DatabaseZap,
  ExternalLink,
  Filter,
  PhoneCall,
  RefreshCcw,
  Search,
  ShieldAlert,
  TrendingUp,
  Truck,
} from "lucide-react";
import type {
  ManagementKpiCard,
  ManagementKpiDashboard,
  ManagementKpiDataQualityItem,
  ManagementRiskItem,
  ManagementTableRow,
} from "@/lib/ops/management-kpis";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, opsPageContainerClass, opsPageShellClass } from "../ops-design";

type ApiResponse = {
  ok: boolean;
  dashboard?: ManagementKpiDashboard;
  error?: string;
  details?: unknown;
};

type RangePreset = "today" | "7d" | "30d" | "month" | "quarter" | "custom";

const rangeOptions: Array<{ key: RangePreset; label: string }> = [
  { key: "today", label: "Heute" },
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "month", label: "Monat" },
  { key: "quarter", label: "Quartal" },
  { key: "custom", label: "Frei" },
];

function formatApiError(payload: ApiResponse | null) {
  if (!payload) return "Unbekannter Fehler.";
  return payload.error || "Unbekannter Fehler.";
}

function formatMoney(value: number, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function cardTone(card: ManagementKpiCard) {
  if (card.tone === "danger") return "border-rose-200 bg-rose-50 text-rose-950";
  if (card.tone === "watch") return "border-amber-200 bg-amber-50 text-amber-950";
  if (card.tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  return "border-stone-200 bg-white text-stone-950";
}

function qualityTone(item: ManagementKpiDataQualityItem) {
  if (item.status === "risk") return "border-rose-200 bg-rose-50 text-rose-900";
  if (item.status === "missing") return "border-amber-200 bg-amber-50 text-amber-900";
  if (item.status === "partial") return "border-sky-200 bg-sky-50 text-sky-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function riskTone(item: ManagementRiskItem) {
  if (item.severity === "urgent") return "border-rose-200 bg-rose-50 text-rose-900";
  if (item.severity === "high") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function BarRow({ row, maxValue }: { row: ManagementTableRow; maxValue: number }) {
  const width = maxValue ? Math.max(6, Math.round((row.count / maxValue) * 100)) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium text-stone-800">{row.label}</span>
        <span className="shrink-0 text-stone-500">{row.count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-stone-100">
        <div className="h-full rounded bg-stone-950" style={{ width: `${width}%` }} />
      </div>
      {row.value ? <p className="text-xs text-stone-500">{formatMoney(row.value)} Pipeline</p> : null}
    </div>
  );
}

function InsightTable({ title, rows }: { title: string; rows: ManagementTableRow[] }) {
  const maxValue = Math.max(...rows.map((row) => row.count), 0);
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-950">{title}</h2>
      <div className="mt-4 grid gap-3">
        {rows.length ? rows.map((row) => <BarRow key={row.key} row={row} maxValue={maxValue} />) : <p className="text-sm text-stone-500">Keine Daten im Zeitraum.</p>}
      </div>
    </section>
  );
}

function RiskFeed({ risks }: { risks: ManagementRiskItem[] }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-rose-600" />
        <h2 className="text-sm font-semibold text-stone-950">Risiko-Feed</h2>
      </div>
      <div className="mt-4 grid gap-3">
        {risks.length ? risks.map((risk) => (
          <a key={risk.key} href={risk.href || "#"} className={`block rounded-lg border p-3 ${riskTone(risk)}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{risk.label}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">{risk.detail || "Keine Details"}</p>
              </div>
              <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
            </div>
          </a>
        )) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Keine offenen operativen Risiken im gewählten Zeitraum.
          </div>
        )}
      </div>
    </section>
  );
}

export function ManagementKpisClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-management-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [operatorName, setOperatorName] = useState("");
  const [token, setToken] = useState("");
  const [range, setRange] = useState<RangePreset>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [segment, setSegment] = useState("");
  const [country, setCountry] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [dashboard, setDashboard] = useState<ManagementKpiDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(operatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    if (operatorName) window.localStorage.setItem(operatorNameKey, operatorName);
  }, [operatorName]);

  useEffect(() => {
    if (hasSession || localMode) void loadDashboard();
  }, [hasSession, localMode, range]);

  const customRangeEnabled = range === "custom";

  const filterSummary = useMemo(
    () => [query ? `Suche: ${query}` : null, source ? `Quelle: ${source}` : null, segment ? `Segment: ${segment}` : null, country ? `Land: ${country}` : null, customerType ? `Typ: ${customerType}` : null].filter(Boolean).join(" · "),
    [query, source, segment, country, customerType],
  );

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

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("range", range);
      if (customRangeEnabled && from) params.set("from", from);
      if (customRangeEnabled && to) params.set("to", to);
      if (query.trim()) params.set("query", query.trim());
      if (source.trim()) params.set("source", source.trim());
      if (segment.trim()) params.set("segment", segment.trim());
      if (country.trim()) params.set("country", country.trim());
      if (customerType.trim()) params.set("customerType", customerType.trim());

      const response = await fetch(`/api/ops/management-kpis?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.dashboard) throw new Error(formatApiError(payload));
      setDashboard(payload.dashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kennzahlen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Kennzahlen"
        title="Kennzahlen anmelden"
        description="Melde dich für interne Umsatz-, Kosten- und Operations-KPIs an. Sensible Managementdaten bleiben geschützt."
        activeApp="management"
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
      <div className={`${opsPageContainerClass} space-y-6`}>
        <OpsPageHeader active="management" label="Kennzahlen" />

        <OpsPageIntro
          eyebrow="NEONTRIP Ops"
          title="Operative Lage, Kosten und Risiken im Blick."
          description="Pipeline, Arbeit, Kosten und Datenqualität laufen in einer ruhigen Steuerungsansicht zusammen."
        />

        <section>
          <div className="rounded-[18px] border border-[#ded8d0] bg-[#fffdf9] p-3 shadow-[0_10px_34px_rgba(20,16,12,0.05)]">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr_1fr_auto]">
            <div className="flex flex-wrap gap-1.5">
              {rangeOptions.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setRange(option.key)}
                  className={`min-h-10 rounded-lg px-3 text-sm font-medium transition ${range === option.key ? "bg-stone-950 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Kunde, Request, Order, Status"
                className="h-10 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-stone-950"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Quelle" className="h-10 rounded-lg border border-stone-200 px-3 text-sm outline-none focus:border-stone-950" />
              <input value={segment} onChange={(event) => setSegment(event.target.value)} placeholder="Segment" className="h-10 rounded-lg border border-stone-200 px-3 text-sm outline-none focus:border-stone-950" />
            </div>
            <button
              onClick={() => void loadDashboard()}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Laden
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <input disabled={!customRangeEnabled} type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-lg border border-stone-200 px-3 text-sm outline-none disabled:bg-stone-100 disabled:text-stone-400" />
            <input disabled={!customRangeEnabled} type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-lg border border-stone-200 px-3 text-sm outline-none disabled:bg-stone-100 disabled:text-stone-400" />
            <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Land, z. B. DE" className="h-10 rounded-lg border border-stone-200 px-3 text-sm outline-none focus:border-stone-950" />
            <input value={customerType} onChange={(event) => setCustomerType(event.target.value)} placeholder="Kundentyp" className="h-10 rounded-lg border border-stone-200 px-3 text-sm outline-none focus:border-stone-950" />
          </div>
          </div>

        {error ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <Filter className="h-4 w-4" />
          <span>{dashboard ? `${dashboard.range.label}: ${formatDate(dashboard.range.from)} bis ${formatDate(dashboard.range.to)}` : "Zeitraum wird geladen"}</span>
          {filterSummary ? <span>· {filterSummary}</span> : null}
          {dashboard ? <span>· generiert {formatDate(dashboard.generatedAt)}</span> : null}
        </div>

        {dashboard ? (
          <>
            <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {dashboard.summary.map((card) => (
                <article key={card.key} className={`min-h-36 rounded-[18px] border p-4 shadow-[0_10px_30px_rgba(20,16,12,0.05)] ${cardTone(card)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-60">{card.label}</p>
                    {card.key === "revenue" ? <CircleDollarSign className="h-4 w-4" /> : card.key === "risks" ? <ShieldAlert className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
                  </div>
                  <p className="mt-4 text-3xl font-semibold tracking-tight">{card.value}</p>
                  <p className="mt-2 text-xs leading-5 opacity-70">{card.detail}</p>
                </article>
              ))}
            </section>

            <section className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-4">
                <section className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-700" />
                    <h2 className="text-sm font-semibold text-stone-950">Sales Funnel</h2>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      ["Anfragen", dashboard.sales.newRequests],
                      ["Angebote", dashboard.sales.quoteCreated],
                      ["Gesendet", dashboard.sales.quoteSent],
                      ["Angesehen", dashboard.sales.quoteViewed],
                      ["Angenommen", dashboard.sales.quoteSigned],
                      ["Orders", dashboard.sales.orders],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                        <p className="text-xs text-stone-500">{label}</p>
                        <p className="mt-2 text-2xl font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                  <InsightTable title="Top Quellen" rows={dashboard.sales.topSources} />
                  <InsightTable title="Top Segmente" rows={dashboard.sales.topSegments} />
                </div>
              </div>

              <div className="grid gap-4">
                <section className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-stone-700" />
                    <h2 className="text-sm font-semibold text-stone-950">Operations</h2>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <a href="/ops/company-brain" className="rounded-lg border border-stone-100 bg-stone-50 p-3 transition hover:border-stone-300">
                      <BrainCircuit className="h-4 w-4 text-stone-500" />
                      <p className="mt-3 text-2xl font-semibold">Brain</p>
                      <p className="text-xs text-stone-500">Fälle & Belege prüfen</p>
                    </a>
                    <a href="/ops/customer-records/calls" className="rounded-lg border border-stone-100 bg-stone-50 p-3 transition hover:border-stone-300">
                      <PhoneCall className="h-4 w-4 text-stone-500" />
                      <p className="mt-3 text-2xl font-semibold">{dashboard.operations.completedCalls}</p>
                      <p className="text-xs text-stone-500">erledigte Calls</p>
                    </a>
                    <a href="/ops/tasks" className="rounded-lg border border-stone-100 bg-stone-50 p-3 transition hover:border-stone-300">
                      <ClipboardList className="h-4 w-4 text-stone-500" />
                      <p className="mt-3 text-2xl font-semibold">{dashboard.operations.openSalesTasks}</p>
                      <p className="text-xs text-stone-500">{dashboard.operations.overdueSalesTasks} überfällig</p>
                    </a>
                    <a href="/ops/customer-records/shipping" className="rounded-lg border border-stone-100 bg-stone-50 p-3 transition hover:border-stone-300">
                      <Truck className="h-4 w-4 text-stone-500" />
                      <p className="mt-3 text-2xl font-semibold">{dashboard.operations.openShippingIncidents}</p>
                      <p className="text-xs text-stone-500">Shipping-Risiken</p>
                    </a>
                    <a href="/ops/customer-records/inbound-shipping" className="rounded-lg border border-stone-100 bg-stone-50 p-3 transition hover:border-stone-300">
                      <DatabaseZap className="h-4 w-4 text-stone-500" />
                      <p className="mt-3 text-2xl font-semibold">{dashboard.operations.openInboundIncidents}</p>
                      <p className="text-xs text-stone-500">Wareneingang-Risiken</p>
                    </a>
                  </div>
                </section>
                <RiskFeed risks={dashboard.operations.riskFeed} />
              </div>
            </section>

            <section className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <section className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <CircleDollarSign className="h-4 w-4 text-stone-700" />
                  <h2 className="text-sm font-semibold text-stone-950">Kostenstatus</h2>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                    <p className="text-xs text-stone-500">SEA-Kostenbuch</p>
                    <p className="mt-2 text-2xl font-semibold">{formatMoney(dashboard.costs.knownAdSpend)}</p>
                  </div>
                  <div className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                    <p className="text-xs text-stone-500">AI-Kostenbuch</p>
                    <p className="mt-2 text-2xl font-semibold">{formatMoney(dashboard.costs.knownAiSpendUsd, "USD")}</p>
                  </div>
                  <div className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                    <p className="text-xs text-stone-500">Voice-Kostenbuch</p>
                    <p className="mt-2 text-2xl font-semibold">{formatMoney(dashboard.costs.knownVoiceSpendUsd, "USD")}</p>
                  </div>
                  <div className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                    <p className="text-xs text-stone-500">Produktion China</p>
                    <p className="mt-2 text-2xl font-semibold">{formatMoney(dashboard.costs.knownInboundProductionSpendUsd, "USD")}</p>
                  </div>
                  <div className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                    <p className="text-xs text-stone-500">Inbound-Versand</p>
                    <p className="mt-2 text-2xl font-semibold">{formatMoney(dashboard.costs.knownInboundShippingSpendUsd, "USD")}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Marge noch nicht belastbar</p>
                  <p className="mt-1 leading-6">Es fehlen: {dashboard.costs.missingSources.join(", ")}.</p>
                </div>
              </section>

              <section className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <h2 className="text-sm font-semibold text-stone-950">Datenqualität</h2>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {dashboard.dataQuality.map((item) => (
                    <div key={item.key} className={`rounded-lg border p-3 ${qualityTone(item)}`}>
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className="mt-1 text-xs leading-5 opacity-80">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          </>
        ) : (
          <div className="mt-8 rounded-lg border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
            {loading ? "Kennzahlen werden geladen." : "Noch keine KPI-Daten geladen."}
          </div>
        )}
        </section>
      </div>
    </main>
  );
}
