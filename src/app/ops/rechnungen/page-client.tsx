"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, FileText, Pencil, RefreshCw, Save, Search, ShieldCheck, WalletCards } from "lucide-react";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../ops-design";

type BillingCase = {
  id: string; shopify_order_name: string; customer_email: string | null; customer: Record<string, unknown>;
  project_number?: string | null;
  subtotal_net_cents: number; vat_cents: number; total_gross_cents: number; currency: string; payment_method: string; payment_terms_days: number | null;
  tax_treatment: string; tax_review_status: string; vat_id?: string | null; status: string; updated_at: string;
  vat_validation?: Record<string, unknown> | null; billing_address?: Record<string, unknown>; delivery_address?: Record<string, unknown>;
  paid_at?: string | null; delivered_at?: string | null; final_invoice_at?: string | null; current_revision?: number;
};
type Detail = { billingCase: BillingCase; documents: Array<Record<string, unknown>>; changes: Array<Record<string, unknown>>; events: Array<Record<string, unknown>>; incidents: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>> };
type ChangeForm = { company: string; name: string; street: string; zip: string; city: string; country: string; vatId: string; invoiceEmail: string; projectNumber: string };

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(cents || 0) / 100);
}

function customerName(row: BillingCase) {
  const value = row.customer || {};
  return String(value.company || [value.firstName, value.lastName].filter(Boolean).join(" ") || row.customer_email || "Ohne Kundenname");
}

function statusTone(status: string) {
  if (["SYNC_BLOCKED", "MANUAL_REVIEW", "REJECTED"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-800";
  if (["INVOICED", "PAID", "APPLIED", "APPROVED"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function paymentValue(row: BillingCase) {
  return row.payment_method === "KAUF_AUF_RECHNUNG" ? `RECHNUNG_${row.payment_terms_days || 14}` : "VORKASSE";
}

function taxTreatmentLabel(value: string) {
  const labels: Record<string, string> = {
    DE_STANDARD: "Deutschland · 19 % Umsatzsteuer",
    EU_B2B_REVERSE_CHARGE: "EU-Ausland · Reverse Charge",
    EU_B2C_OSS: "EU-Ausland · Umsatzsteuer",
    THIRD_COUNTRY_EXPORT: "Drittland · steuerfrei",
  };
  return labels[value] || value;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Offen", APPLIED: "Akzeptiert", REJECTED: "Abgelehnt", APPROVED: "Freigegeben",
  PAYMENT_PENDING: "Zahlung ausstehend", MANUAL_REVIEW: "Prüfung erforderlich", SYNC_BLOCKED: "Synchronisierung blockiert",
  PAID: "Bezahlt", INVOICED: "Rechnung erstellt", CANCELLED: "Storniert", REFUNDED: "Erstattet",
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function changeForm(change: Record<string, unknown>, billingCase: BillingCase): ChangeForm {
  const requested = record(change.ops_draft_changes || change.requested_changes);
  const requestedAddress = record(requested.billingAddress);
  const currentAddress = record(billingCase.billing_address);
  return {
    company: String(requestedAddress.company ?? currentAddress.company ?? ""),
    name: String(requestedAddress.name ?? currentAddress.name ?? ""),
    street: String(requestedAddress.street ?? currentAddress.street ?? ""),
    zip: String(requestedAddress.zip ?? currentAddress.zip ?? ""),
    city: String(requestedAddress.city ?? currentAddress.city ?? ""),
    country: String(requestedAddress.country ?? currentAddress.country ?? ""),
    vatId: String(requested.vatId ?? billingCase.vat_id ?? ""),
    invoiceEmail: String(requested.invoiceEmail ?? billingCase.customer_email ?? ""),
    projectNumber: String(requested.projectNumber ?? billingCase.project_number ?? ""),
  };
}

function changePayload(form: ChangeForm) {
  return {
    billingAddress: { company: form.company, name: form.name, street: form.street, zip: form.zip, city: form.city, country: form.country },
    vatId: form.vatId,
    invoiceEmail: form.invoiceEmail,
    projectNumber: form.projectNumber,
  };
}

function AddressSummary({ value }: { value: Record<string, unknown> }) {
  return <span>{[value.company || value.name, value.street, [value.zip, value.city].filter(Boolean).join(" "), value.country].filter(Boolean).map(String).join(", ") || "–"}</span>;
}

function ComparisonRow({ label, previous, next, nextLabel }: { label: string; previous: ReactNode; next: ReactNode; nextLabel: string }) {
  return <div className="grid gap-3 border-b border-stone-100 px-4 py-4 last:border-b-0 md:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
    <strong className="text-xs font-semibold text-stone-950">{label}</strong>
    <div className="min-w-0 break-words text-sm text-stone-600"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 md:hidden">Bisher</span>{previous}</div>
    <div className="min-w-0 break-words text-sm font-medium text-stone-950"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b91c73] md:hidden">{nextLabel}</span>{next}</div>
  </div>;
}

function ChangeRequestReview({ change, billingCase, busy, onAction }: {
  change: Record<string, unknown>;
  billingCase: BillingCase;
  busy: string | null;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ChangeForm>(() => changeForm(change, billingCase));
  useEffect(() => setForm(changeForm(change, billingCase)), [change, billingCase]);
  const requested = record(change.requested_changes);
  const draft = record(change.ops_draft_changes);
  const applied = record(change.applied_changes);
  const currentAddress = record(billingCase.billing_address);
  const requestedAddress = record(requested.billingAddress);
  const status = String(change.status || "PENDING");
  const finalValues = Object.keys(applied).length ? applied : Object.keys(draft).length ? draft : requested;
  const field = "h-10 rounded-xl border border-stone-300 bg-white px-3 text-sm outline-none focus:border-[#fa31a2] focus:ring-2 focus:ring-[#fa31a2]/10";

  async function save(event: FormEvent) {
    event.preventDefault();
    await onAction("SAVE_CHANGE_REQUEST_DRAFT", { changeRequestId: change.id, changes: changePayload(form) });
    setEditing(false);
  }

  const decisionLabel = status === "PENDING" ? "Gewünscht" : "Entschieden";

  return <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_8px_24px_rgba(28,25,23,0.04)]">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-stone-950">Anfrage vom {new Date(String(change.created_at)).toLocaleString("de-DE")}</p>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(status)}`}>{STATUS_LABELS[status] || status}</span>
        </div>
        {change.reviewed_by ? <p className="mt-1 text-xs text-stone-500">Bearbeitet von {String(change.reviewed_by)}</p> : <p className="mt-1 text-xs text-stone-500">Bitte Änderungen prüfen und anschließend entscheiden.</p>}
      </div>
      {status === "PENDING" ? <button type="button" onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 transition hover:border-stone-400"><Pencil className="h-4 w-4" /> {editing ? "Bearbeitung schließen" : "Anfrage anpassen"}</button> : null}
    </div>
    {!editing ? <div>
      <div className="hidden grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-stone-200 bg-[#faf8f5] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500 md:grid"><span>Feld</span><span>Bisher</span><span>{decisionLabel}</span></div>
      <ComparisonRow label="Rechnungsanschrift" previous={<AddressSummary value={currentAddress} />} next={<AddressSummary value={record(finalValues.billingAddress || requestedAddress)} />} nextLabel={decisionLabel} />
      <ComparisonRow label="Rechnungs-E-Mail" previous={billingCase.customer_email || "–"} next={String(finalValues.invoiceEmail ?? requested.invoiceEmail ?? billingCase.customer_email ?? "–")} nextLabel={decisionLabel} />
      <ComparisonRow label="USt-ID" previous={billingCase.vat_id || "–"} next={String(finalValues.vatId ?? requested.vatId ?? billingCase.vat_id ?? "–") || "–"} nextLabel={decisionLabel} />
      <ComparisonRow label="Projektnummer" previous={billingCase.project_number || "–"} next={String(finalValues.projectNumber ?? requested.projectNumber ?? billingCase.project_number ?? "–") || "–"} nextLabel={decisionLabel} />
    </div> : <form onSubmit={save} className="grid gap-3 bg-[#faf8f5] p-5 md:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold text-stone-600">Firma<input className={field} value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">Name<input className={field} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600 md:col-span-2">Straße und Hausnummer<input className={field} value={form.street} onChange={(event) => setForm({ ...form, street: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">PLZ<input className={field} value={form.zip} onChange={(event) => setForm({ ...form, zip: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">Ort<input className={field} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">Land<input className={field} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">Umsatzsteuer-ID<input className={field} value={form.vatId} onChange={(event) => setForm({ ...form, vatId: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">Rechnungs-E-Mail<input type="email" required className={field} value={form.invoiceEmail} onChange={(event) => setForm({ ...form, invoiceEmail: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">Projektnummer<input className={field} value={form.projectNumber} onChange={(event) => setForm({ ...form, projectNumber: event.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4 md:col-span-2"><button disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" /> Intern speichern</button><p className="text-xs text-stone-500">Beim internen Speichern wird keine E-Mail versendet.</p></div>
    </form>}
    {status === "PENDING" ? <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-white px-5 py-4">
      <button disabled={Boolean(busy)} onClick={() => void onAction("APPLY_CHANGE_REQUEST", { changeRequestId: change.id, approvedChanges: changePayload(form), note: "In Ops akzeptiert" })} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">Akzeptieren</button>
      <button disabled={Boolean(busy)} onClick={() => void onAction("REJECT_CHANGE_REQUEST", { changeRequestId: change.id, note: "In Ops abgelehnt" })} className="rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800 transition hover:bg-rose-50 disabled:opacity-50">Ablehnen</button>
      <p className="w-full text-xs leading-5 text-stone-500">Erst diese endgültige Entscheidung versendet genau eine E-Mail an den Kunden.</p>
    </div> : null}
  </article>;
}

export function BillingOpsClient({ initialHasSession, opsEnabled, localMode, detailCaseId }: { initialHasSession: boolean; opsEnabled: boolean; localMode: boolean; detailCaseId?: string }) {
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [password, setPassword] = useState("");
  const [cases, setCases] = useState<BillingCase[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deliveryEvidence, setDeliveryEvidence] = useState("Shopify/DHL/DPD-Protokoll geprüft");
  const [manualReason, setManualReason] = useState("Manuelle Freigabe durch Rechnungsabteilung");
  const [deliveredAt, setDeliveredAt] = useState(() => new Date().toISOString().slice(0, 16));

  useEffect(() => {
    if (!(hasSession || localMode)) return;
    if (detailCaseId) {
      void loadDetail(detailCaseId);
      return;
    }
    void loadCases();
    const caseId = new URLSearchParams(window.location.search).get("caseId");
    if (caseId && /^[0-9a-f-]{36}$/i.test(caseId)) window.location.replace(`/ops/rechnungen/${caseId}`);
  }, [hasSession, localMode, detailCaseId]);

  const openIncidents = useMemo(() => cases.filter((entry) => ["SYNC_BLOCKED", "MANUAL_REVIEW"].includes(entry.status)).length, [cases]);
  const waiting = useMemo(() => cases.filter((entry) => !["INVOICED", "CANCELLED", "REFUNDED"].includes(entry.status)).length, [cases]);
  const vatValidation = selected?.billingCase.vat_validation || {};

  async function login() {
    const response = await fetch("/api/ops/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: password }) });
    if (!response.ok) return setError("Ops-Login fehlgeschlagen.");
    setHasSession(true); setPassword("");
  }

  async function loadCases() {
    setLoading(true); setError(null);
    const params = new URLSearchParams(); if (query.trim()) params.set("query", query.trim());
    try {
      const response = await fetch(`/api/ops/billing?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Rechnungsfälle konnten nicht geladen werden.");
      setCases(payload.cases || []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unbekannter Fehler."); }
    finally { setLoading(false); }
  }

  async function loadDetail(id: string) {
    setError(null);
    const response = await fetch(`/api/ops/billing/${id}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) return setError(payload.error || "Details konnten nicht geladen werden.");
    setSelected(payload);
  }

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    if (!selected) return;
    setActionBusy(action); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/ops/billing/${selected.billingCase.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, idempotencyKey: `ops:${selected.billingCase.id}:${action}:${crypto.randomUUID()}` }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Aktion konnte nicht gespeichert werden.");
      setNotice("Aktion gespeichert und im Audit-Log protokolliert.");
      await Promise.all([loadDetail(selected.billingCase.id), loadCases()]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unbekannter Fehler.");
    } finally { setActionBusy(null); }
  }

  if (!opsEnabled) return <main className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</main>;
  if (!hasSession && !localMode) return <OpsLoginCard eyebrow="Rechnungen" title="Rechnungsabteilung anmelden" description="Melde dich mit deinem persönlichen internen Zugang an. Aktionen werden automatisch deinem Login zugeordnet." activeApp="billing" showOperatorName={false} password={password} error={error} buttonLabel="Einloggen" onPasswordChange={setPassword} onSubmit={login} />;

  return <main className={`${opsPageShellClass} px-4 py-6 md:px-6`}>
    <div className={`${opsPageContainerClass} space-y-6`}>
      <OpsPageHeader active="billing" label="Rechnungsabteilung" />
      {!detailCaseId ? <OpsPageIntro eyebrow="Billing Control" title="Pro-forma, Rechnungen und Korrekturen an einem Ort" description="Shopify ist der Auftragsschlüssel. Jeder finanzielle Schritt wird centgenau mit Easybill und dem BillingCase abgeglichen.">
        <button onClick={() => void loadCases()} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-stone-950"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren</button>
      </OpsPageIntro> : null}
      {!detailCaseId ? <>
      <section className="grid gap-3 md:grid-cols-3">
        <OpsStatCard label="Fälle" value={cases.length} icon={<FileText className="h-5 w-5" />} />
        <OpsStatCard label="Offen" value={waiting} tone="warning" icon={<WalletCards className="h-5 w-5" />} />
        <OpsStatCard label="Prüfen" value={openIncidents} tone={openIncidents ? "danger" : "success"} icon={openIncidents ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />} />
      </section>
      <section className="rounded-[22px] border border-[#ded8d0] bg-[#fffdf9] shadow-[0_16px_44px_rgba(20,16,12,0.06)]">
        <div className="flex flex-col gap-3 border-b border-[#e6e0d8] p-4 sm:flex-row">
          <label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-stone-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadCases(); }} placeholder="Bestellnummer oder E-Mail" className="h-10 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-[#fa31a2]" /></label>
          <button onClick={() => void loadCases()} className="rounded-xl bg-stone-950 px-4 py-2 text-sm font-semibold text-white">Suchen</button>
        </div>
        {error ? <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
        <div className="divide-y divide-[#eee8e0]">
          {cases.map((entry) => <a key={entry.id} href={`/ops/rechnungen/${entry.id}`} className="grid w-full gap-3 p-4 text-left transition hover:bg-[#faf6f1] md:grid-cols-[9rem_minmax(0,1fr)_11rem_10rem] md:items-center">
            <span className="font-semibold text-stone-950">{entry.shopify_order_name}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-medium text-stone-800">{customerName(entry)}</span><span className="block truncate text-xs text-stone-500">{entry.customer_email || "Keine Rechnungs-E-Mail"}{entry.project_number ? ` · Projekt ${entry.project_number}` : ""}</span></span>
            <span className="text-sm font-semibold text-stone-900">{money(entry.total_gross_cents, entry.currency)}</span>
            <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(entry.status)}`}>{STATUS_LABELS[entry.status] || entry.status}</span>
          </a>)}
          {!cases.length && !loading ? <p className="p-8 text-center text-sm text-stone-500">Noch keine BillingCases vorhanden.</p> : null}
        </div>
      </section></> : null}
      {detailCaseId && error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
      {detailCaseId && !selected && !error ? <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">Bestellung wird geladen …</div> : null}
      {selected ? <section aria-labelledby="billing-case-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <a href="/ops/rechnungen" className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-stone-800 shadow-sm transition hover:border-stone-400 hover:bg-stone-50"><ArrowLeft className="h-4 w-4" /> Zur Rechnungsübersicht</a>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(selected.billingCase.status)}`}>{STATUS_LABELS[selected.billingCase.status] || selected.billingCase.status}</span>
        </div>
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b91c73]">Rechnungsfall</p>
          <h1 id="billing-case-title" className="mt-1 text-2xl font-semibold tracking-tight text-stone-950 md:text-3xl">{selected.billingCase.shopify_order_name}</h1>
          <p className="mt-1 text-sm text-stone-500">{customerName(selected.billingCase)}</p>
        </div>
        {notice ? <p aria-live="polite" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-[22px] border border-stone-200 bg-[#fffdf9] p-4 shadow-[0_14px_36px_rgba(28,25,23,0.05)] md:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b91c73]">Prüfung</p><h2 className="mt-1 text-xl font-semibold text-stone-950">Änderungen zur Rechnung</h2></div>
                <p className="text-xs text-stone-500">{selected.changes.length} {selected.changes.length === 1 ? "Anfrage" : "Anfragen"}</p>
              </div>
              <div className="mt-4 space-y-3">{selected.changes.length ? selected.changes.map((change) => <ChangeRequestReview key={String(change.id)} change={change} billingCase={selected.billingCase} busy={actionBusy} onAction={runAction} />) : <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center"><CheckCircle2 className="mx-auto h-5 w-5 text-emerald-700" /><p className="mt-2 text-sm font-medium text-stone-800">Keine Änderungsanfrage offen</p></div>}</div>
            </section>

            <section className="rounded-[22px] border border-stone-200 bg-white p-4 md:p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700" /><h2 className="text-base font-semibold text-stone-950">Steuerprüfung</h2></div>
              <p className="mt-2 text-sm leading-6 text-stone-600">{selected.billingCase.vat_id ? `USt-ID: ${selected.billingCase.vat_id}` : "Für diesen Fall ist keine USt-ID hinterlegt."}</p>
              {vatValidation.name ? <p className="mt-2 text-sm text-stone-600"><strong className="text-stone-800">Bei VIES gelistet:</strong> {String(vatValidation.name)}</p> : null}
              {vatValidation.address ? <p className="mt-1 whitespace-pre-line text-sm text-stone-600"><strong className="text-stone-800">Registeranschrift:</strong> {String(vatValidation.address)}</p> : null}
              {vatValidation.identityComparison ? <p className="mt-2 text-sm font-semibold text-stone-700">Datenvergleich: {String(vatValidation.identityComparison)}</p> : null}
              {selected.billingCase.tax_review_status === "REVIEW_REQUIRED" ? <div className="mt-4 flex flex-wrap gap-2"><button disabled={Boolean(actionBusy)} onClick={() => void runAction("CONFIRM_VAT", { taxDecision: "NET", listedName: vatValidation.name, listedAddress: vatValidation.address, note: "Netto intern freigegeben" })} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Als netto freigeben</button><button disabled={Boolean(actionBusy)} onClick={() => void runAction("CONFIRM_VAT", { taxDecision: "GROSS", listedName: vatValidation.name, listedAddress: vatValidation.address, note: "Brutto intern freigegeben" })} className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Als brutto behandeln</button></div> : <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Keine offene Steuerfreigabe</p>}
            </section>

            <details className="group rounded-[22px] border border-stone-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-stone-800 marker:hidden"><span>Weitere interne Aktionen</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary>
              <div className="border-t border-stone-200 p-5">
                <div className="grid gap-3 md:grid-cols-3"><label className="grid gap-1 text-xs font-semibold text-stone-600">Zugestellt am<input type="datetime-local" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 font-normal" /></label><label className="grid gap-1 text-xs font-semibold text-stone-600">Nachweis<input value={deliveryEvidence} onChange={(event) => setDeliveryEvidence(event.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 font-normal" /></label><label className="grid gap-1 text-xs font-semibold text-stone-600">Pflichtgrund<input value={manualReason} onChange={(event) => setManualReason(event.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 font-normal" /></label></div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button disabled={Boolean(actionBusy) || Boolean(selected.billingCase.final_invoice_at)} onClick={() => void runAction("CREATE_PROFORMA", { reason: "Manuell in Ops neu erstellt" })} className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">Neue Pro-forma-Version</button>
                  <button disabled={Boolean(actionBusy)} onClick={() => void runAction("MARK_PAID")} className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">Zahlung eingegangen</button>
                  <button disabled={Boolean(actionBusy)} onClick={() => void runAction("MARK_DELIVERED", { deliveredAt: new Date(deliveredAt).toISOString(), evidenceType: deliveryEvidence, reason: manualReason })} className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">Als vollständig zugestellt markieren</button>
                  <button disabled={Boolean(actionBusy) || selected.billingCase.tax_review_status === "REVIEW_REQUIRED" || Boolean(selected.billingCase.final_invoice_at)} onClick={() => void runAction("CREATE_INVOICE", { reason: manualReason })} className="rounded-xl bg-stone-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Rechnung jetzt erstellen</button>
                </div>
                <p className="mt-3 text-xs leading-5 text-stone-500">Alle Aktionen werden im Audit-Log protokolliert und gegen Doppelausführung geschützt.</p>
              </div>
            </details>
          </div>

          <aside className="rounded-[22px] border border-stone-200 bg-white p-5 shadow-[0_16px_44px_rgba(20,16,12,0.07)] lg:sticky lg:top-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Bestellung</p><p className="mt-1 text-lg font-semibold text-stone-950">{selected.billingCase.shopify_order_name}</p></div><ShieldCheck className="h-5 w-5 text-emerald-700" /></div>
            <div className="mt-5 rounded-2xl bg-stone-950 p-4 text-white">
              <p className="text-xs text-stone-400">Gesamtbetrag</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{money(selected.billingCase.total_gross_cents, selected.billingCase.currency)}</p>
              <dl className="mt-4 space-y-2 border-t border-white/15 pt-3 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-stone-400">Netto</dt><dd>{money(selected.billingCase.subtotal_net_cents, selected.billingCase.currency)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-stone-400">Umsatzsteuer</dt><dd>{money(selected.billingCase.vat_cents, selected.billingCase.currency)}</dd></div>
              </dl>
            </div>

            <label className="mt-5 block text-xs font-semibold text-stone-700" htmlFor="billing-payment-method">Zahlungsart</label>
            <div className="relative mt-2">
              <select id="billing-payment-method" value={paymentValue(selected.billingCase)} disabled={Boolean(actionBusy)} onChange={(event) => {
                const value = event.target.value;
                if (value === "VORKASSE") void runAction("SET_PAYMENT_METHOD", { paymentMethod: "VORKASSE" });
                else void runAction("SET_PAYMENT_METHOD", { paymentMethod: "KAUF_AUF_RECHNUNG", paymentTermsDays: Number(value.replace("RECHNUNG_", "")) });
              }} className="h-11 w-full appearance-none rounded-xl border border-stone-300 bg-white px-3 pr-10 text-sm font-semibold text-stone-900 outline-none transition focus:border-[#fa31a2] focus:ring-2 focus:ring-[#fa31a2]/10 disabled:opacity-50">
                <option value="VORKASSE">Vorkasse</option>
                {[7, 14, 30].map((days) => <option key={days} value={`RECHNUNG_${days}`}>Rechnung · {days} Tage</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-stone-500" />
            </div>
            <p className="mt-2 text-xs leading-5 text-stone-500">Standard ist Vorkasse. Rechnungskauf wird intern freigegeben.</p>

            <dl className="mt-5 divide-y divide-stone-100 border-y border-stone-100 text-sm">
              <div className="py-3"><dt className="text-xs text-stone-500">Rechnungs-E-Mail</dt><dd className="mt-1 break-all font-medium text-stone-900">{selected.billingCase.customer_email || "Nicht hinterlegt"}</dd></div>
              <div className="py-3"><dt className="text-xs text-stone-500">Projektnummer</dt><dd className="mt-1 font-medium text-stone-900">{selected.billingCase.project_number || "Nicht hinterlegt"}</dd></div>
              <div className="py-3"><dt className="text-xs text-stone-500">Steuerfall</dt><dd className="mt-1 font-medium text-stone-900">{taxTreatmentLabel(selected.billingCase.tax_treatment)}</dd></div>
              <div className="py-3"><dt className="text-xs text-stone-500">Dokumente · Änderungen</dt><dd className="mt-1 font-medium text-stone-900">{selected.documents.length} · {selected.changes.length}</dd></div>
            </dl>
          </aside>
        </div>
      </section> : null}
    </div>
  </main>;
}
