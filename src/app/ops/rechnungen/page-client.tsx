"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, Search, ShieldCheck, WalletCards } from "lucide-react";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../ops-design";

type BillingCase = {
  id: string; shopify_order_name: string; customer_email: string | null; customer: Record<string, unknown>;
  project_number?: string | null;
  total_gross_cents: number; currency: string; payment_method: string; payment_terms_days: number | null;
  tax_treatment: string; tax_review_status: string; vat_id?: string | null; status: string; updated_at: string;
  vat_validation?: Record<string, unknown> | null; billing_address?: Record<string, unknown>; delivery_address?: Record<string, unknown>;
  paid_at?: string | null; delivered_at?: string | null; final_invoice_at?: string | null; current_revision?: number;
};
type Detail = { billingCase: BillingCase; documents: Array<Record<string, unknown>>; changes: Array<Record<string, unknown>>; events: Array<Record<string, unknown>>; incidents: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>> };

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(cents || 0) / 100);
}

function customerName(row: BillingCase) {
  const value = row.customer || {};
  return String(value.company || [value.firstName, value.lastName].filter(Boolean).join(" ") || row.customer_email || "Ohne Kundenname");
}

function statusTone(status: string) {
  if (["SYNC_BLOCKED", "MANUAL_REVIEW"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-800";
  if (["INVOICED", "PAID"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export function BillingOpsClient({ initialHasSession, opsEnabled, localMode }: { initialHasSession: boolean; opsEnabled: boolean; localMode: boolean }) {
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [password, setPassword] = useState("");
  const [operatorName, setOperatorName] = useState("");
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

  useEffect(() => { try { setOperatorName(localStorage.getItem("neontrip-billing-operator") || ""); } catch {} }, []);
  useEffect(() => { if (operatorName) localStorage.setItem("neontrip-billing-operator", operatorName); }, [operatorName]);
  useEffect(() => {
    if (!(hasSession || localMode)) return;
    void loadCases();
    const caseId = new URLSearchParams(window.location.search).get("caseId");
    if (caseId && /^[0-9a-f-]{36}$/i.test(caseId)) void loadDetail(caseId);
  }, [hasSession, localMode]);

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
    if (!operatorName.trim()) return setError("Bitte zuerst oben Ihren Namen für das Änderungsprotokoll eintragen.");
    setActionBusy(action); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/ops/billing/${selected.billingCase.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, operatorName: operatorName.trim(), idempotencyKey: `ops:${selected.billingCase.id}:${action}:${crypto.randomUUID()}` }),
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
  if (!hasSession && !localMode) return <OpsLoginCard eyebrow="Rechnungen" title="Rechnungsabteilung anmelden" description="Pro-forma, Rechnungen, Zahlungen und Korrekturen sind nur intern sichtbar." activeApp="billing" operatorName={operatorName} password={password} error={error} buttonLabel="Einloggen" onOperatorNameChange={setOperatorName} onPasswordChange={setPassword} onSubmit={login} />;

  return <main className={`${opsPageShellClass} px-4 py-6 md:px-6`}>
    <div className={`${opsPageContainerClass} space-y-6`}>
      <OpsPageHeader active="billing" label="Rechnungsabteilung" />
      <OpsPageIntro eyebrow="Billing Control" title="Pro-forma, Rechnungen und Korrekturen an einem Ort" description="Shopify ist der Auftragsschlüssel. Jeder finanzielle Schritt wird centgenau mit Easybill und dem BillingCase abgeglichen.">
        <button onClick={() => void loadCases()} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-stone-950"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren</button>
      </OpsPageIntro>
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
          {cases.map((entry) => <button key={entry.id} onClick={() => void loadDetail(entry.id)} className="grid w-full gap-3 p-4 text-left transition hover:bg-[#faf6f1] md:grid-cols-[9rem_minmax(0,1fr)_11rem_10rem] md:items-center">
            <span className="font-semibold text-stone-950">{entry.shopify_order_name}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-medium text-stone-800">{customerName(entry)}</span><span className="block truncate text-xs text-stone-500">{entry.customer_email || "Keine Rechnungs-E-Mail"}{entry.project_number ? ` · Projekt ${entry.project_number}` : ""}</span></span>
            <span className="text-sm font-semibold text-stone-900">{money(entry.total_gross_cents, entry.currency)}</span>
            <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(entry.status)}`}>{entry.status}</span>
          </button>)}
          {!cases.length && !loading ? <p className="p-8 text-center text-sm text-stone-500">Noch keine BillingCases vorhanden.</p> : null}
        </div>
      </section>
      {selected ? <section className="rounded-[22px] border border-stone-200 bg-white p-5 shadow-[0_16px_44px_rgba(20,16,12,0.07)]">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b91c73]">Falldetails</p><h2 className="mt-1 text-2xl font-semibold text-stone-950">{selected.billingCase.shopify_order_name}</h2></div><ShieldCheck className="h-6 w-6 text-emerald-700" /></div>
        <div className="mt-5 grid gap-4 md:grid-cols-4"><div><p className="text-xs text-stone-500">Zahlungsart</p><p className="mt-1 font-semibold">{selected.billingCase.payment_method}{selected.billingCase.payment_terms_days ? ` · ${selected.billingCase.payment_terms_days} Tage` : ""}</p></div><div><p className="text-xs text-stone-500">Rechnungsversand</p><p className="mt-1 break-all font-semibold">{selected.billingCase.customer_email || "Nicht hinterlegt"}</p><p className="text-xs text-stone-500">{selected.billingCase.project_number ? `Projekt ${selected.billingCase.project_number}` : "Keine Projektnummer"}</p></div><div><p className="text-xs text-stone-500">Steuerfall</p><p className="mt-1 font-semibold">{selected.billingCase.tax_treatment}</p><p className="text-xs text-stone-500">{selected.billingCase.tax_review_status}</p></div><div><p className="text-xs text-stone-500">Dokumente / Änderungen</p><p className="mt-1 font-semibold">{selected.documents.length} / {selected.changes.length}</p></div></div>
        {notice ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm font-semibold text-stone-950">Zahlungsart</p>
            <p className="mt-1 text-xs leading-5 text-stone-500">Standard ist Vorkasse. Rechnungskauf wird intern freigegeben; Standardziel sind 14 Tage nach Erhalt der Ware.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={Boolean(actionBusy)} onClick={() => void runAction("SET_PAYMENT_METHOD", { paymentMethod: "VORKASSE" })} className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Vorkasse</button>
              {[7, 14, 30].map((days) => <button key={days} disabled={Boolean(actionBusy)} onClick={() => void runAction("SET_PAYMENT_METHOD", { paymentMethod: "KAUF_AUF_RECHNUNG", paymentTermsDays: days })} className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Rechnung · {days} Tage</button>)}
            </div>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm font-semibold text-stone-950">Steuerprüfung</p>
            <p className="mt-1 text-xs leading-5 text-stone-500">{selected.billingCase.vat_id ? `USt-ID: ${selected.billingCase.vat_id}` : "Für diesen Fall ist keine USt-ID hinterlegt."}</p>
            {vatValidation.name ? <p className="mt-2 text-xs text-stone-600"><strong>Bei VIES gelistet:</strong> {String(vatValidation.name)}</p> : null}
            {vatValidation.address ? <p className="mt-1 whitespace-pre-line text-xs text-stone-600"><strong>Registeranschrift:</strong> {String(vatValidation.address)}</p> : null}
            {vatValidation.identityComparison ? <p className="mt-2 text-xs font-semibold text-stone-700">Datenvergleich: {String(vatValidation.identityComparison)}</p> : null}
            {selected.billingCase.tax_review_status === "REVIEW_REQUIRED" ? <div className="mt-3 flex flex-wrap gap-2"><button disabled={Boolean(actionBusy)} onClick={() => void runAction("CONFIRM_VAT", { taxDecision: "NET", listedName: vatValidation.name, listedAddress: vatValidation.address, note: "Netto intern freigegeben" })} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Als netto freigeben</button><button disabled={Boolean(actionBusy)} onClick={() => void runAction("CONFIRM_VAT", { taxDecision: "GROSS", listedName: vatValidation.name, listedAddress: vatValidation.address, note: "Brutto intern freigegeben" })} className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Als brutto behandeln</button></div> : <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Keine offene Steuerfreigabe</p>}
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-stone-200 p-4">
          <p className="text-sm font-semibold text-stone-950">Manuelle Aktionen</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3"><label className="grid gap-1 text-xs font-semibold text-stone-600">Zugestellt am<input type="datetime-local" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 font-normal" /></label><label className="grid gap-1 text-xs font-semibold text-stone-600">Nachweis<input value={deliveryEvidence} onChange={(event) => setDeliveryEvidence(event.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 font-normal" /></label><label className="grid gap-1 text-xs font-semibold text-stone-600">Pflichtgrund<input value={manualReason} onChange={(event) => setManualReason(event.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 font-normal" /></label></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={Boolean(actionBusy) || Boolean(selected.billingCase.final_invoice_at)} onClick={() => void runAction("CREATE_PROFORMA", { reason: "Manuell in Ops neu erstellt" })} className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">Neue Pro-forma-Version</button>
            <button disabled={Boolean(actionBusy)} onClick={() => void runAction("MARK_PAID")} className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">Zahlung eingegangen</button>
            <button disabled={Boolean(actionBusy)} onClick={() => void runAction("MARK_DELIVERED", { deliveredAt: new Date(deliveredAt).toISOString(), evidenceType: deliveryEvidence, reason: manualReason })} className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">Als vollständig zugestellt markieren</button>
            <button disabled={Boolean(actionBusy) || selected.billingCase.tax_review_status === "REVIEW_REQUIRED" || Boolean(selected.billingCase.final_invoice_at)} onClick={() => void runAction("CREATE_INVOICE", { reason: manualReason })} className="rounded-xl bg-stone-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Rechnung jetzt erstellen</button>
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-500">Jede Aktion erzeugt zuerst einen idempotenten Job. Easybill wird erst durch den später aktivierten Adapter angesprochen; dadurch sind Doppelklicks und Wiederholungen kontrollierbar.</p>
        </div>
        <div className="mt-4 rounded-2xl border border-stone-200 p-4">
          <p className="text-sm font-semibold text-stone-950">Änderungen zur Rechnung</p>
          <div className="mt-3 space-y-3">{selected.changes.length ? selected.changes.map((change) => <div key={String(change.id)} className="rounded-xl border border-stone-200 bg-stone-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-stone-800">{String(change.source)} · {String(change.status)}</p><p className="text-xs text-stone-500">{new Date(String(change.created_at)).toLocaleString("de-DE")}</p></div><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-stone-600">{JSON.stringify(change.requested_changes, null, 2)}</pre>{change.status === "PENDING" ? <div className="mt-3 flex gap-2"><button disabled={Boolean(actionBusy)} onClick={() => void runAction("APPLY_CHANGE_REQUEST", { changeRequestId: change.id, note: "In Ops freigegeben" })} className="rounded-xl bg-stone-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Freigeben</button><button disabled={Boolean(actionBusy)} onClick={() => void runAction("REJECT_CHANGE_REQUEST", { changeRequestId: change.id, note: "In Ops abgelehnt" })} className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Ablehnen</button></div> : null}</div>) : <p className="text-xs text-stone-500">Keine Änderungsanfragen vorhanden.</p>}</div>
        </div>
      </section> : null}
    </div>
  </main>;
}
