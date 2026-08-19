"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, FileText, LockKeyhole, Send, ShieldCheck } from "lucide-react";

type PortalPayload = { ok: boolean; billingCase?: Record<string, any>; documents?: Array<Record<string, any>>; changes?: Array<Record<string, any>>; readOnly?: boolean; error?: string };

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(cents || 0) / 100);
}

export function BillingPortalClient({ token }: { token: string }) {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ company: "", street: "", zip: "", city: "", country: "", vatId: "", invoiceEmail: "", projectNumber: "" });

  useEffect(() => { void load(); }, [token]);
  async function load() {
    const response = await fetch(`/api/rechnung/${encodeURIComponent(token)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({ ok: false }));
    setData(payload); setLoading(false);
    if (payload.ok && payload.billingCase) {
      const address = payload.billingCase.billing_address || {};
      setForm({ company: String(address.company || ""), street: String(address.street || ""), zip: String(address.zip || ""), city: String(address.city || ""), country: String(address.country || ""), vatId: String(payload.billingCase.vat_id || ""), invoiceEmail: String(payload.billingCase.customer_email || address.invoiceEmail || ""), projectNumber: String(payload.billingCase.project_number || address.projectNumber || "") });
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSending(true); setMessage(null);
    const response = await fetch(`/api/rechnung/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ billingAddress: { company: form.company, street: form.street, zip: form.zip, city: form.city, country: form.country }, vatId: form.vatId, invoiceEmail: form.invoiceEmail, projectNumber: form.projectNumber, requesterEmail: form.invoiceEmail }) });
    const payload = await response.json().catch(() => null); setSending(false);
    if (!response.ok) return setMessage(payload?.error === "invoice_already_created" ? "Die finale Rechnung wurde bereits erstellt. Änderungen sind nicht mehr möglich." : "Änderungsanfrage konnte nicht gesendet werden.");
    setMessage("Änderungsanfrage eingegangen. NEONTRIP prüft sie vor der Übernahme."); await load();
  }
  if (loading) return <main className="grid min-h-screen place-items-center bg-[#f7f4ee] text-stone-600">Rechnungsdaten werden geladen …</main>;
  if (!data?.ok || !data.billingCase) return <main className="grid min-h-screen place-items-center bg-[#f7f4ee] p-6"><div className="max-w-md rounded-[24px] border border-stone-200 bg-white p-8 text-center"><LockKeyhole className="mx-auto h-8 w-8 text-stone-700" /><h1 className="mt-4 text-xl font-semibold">Link nicht verfügbar</h1><p className="mt-2 text-sm leading-6 text-stone-500">Der Rechnungslink ist ungültig oder wurde von NEONTRIP widerrufen.</p></div></main>;
  const billing = data.billingCase;
  return <main className="min-h-screen bg-[#f7f4ee] px-4 py-5 text-[#171412] sm:px-6 sm:py-8">
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(250,49,162,0.18),transparent_28%),linear-gradient(135deg,#080807_0%,#171311_62%,#24151c_100%)] px-5 py-6 text-white shadow-[0_24px_70px_rgba(18,14,12,0.2)] sm:px-8">
        <div className="flex items-center justify-between gap-4"><img src="/assets/logo_weiss_neontrip.png" alt="NEONTRIP" className="h-8 w-auto" /><span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/75">Sicheres Rechnungsportal</span></div>
        <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">{billing.shopify_order_name}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Ihre Rechnungsunterlagen</h1><p className="mt-3 max-w-xl text-sm leading-6 text-white/65">Hier sehen Sie Pro-forma, Zahlungsstatus und spätere Rechnungsbelege. Änderungen betreffen ausschließlich Rechnungsdaten – nicht Ihren Auftrag.</p></div><div className="rounded-2xl border border-white/12 bg-white/[0.07] px-5 py-4"><p className="text-xs text-white/45">Gesamtbetrag</p><p className="mt-1 text-2xl font-semibold">{money(billing.total_gross_cents, billing.currency)}</p></div></div>
      </header>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[20px] border border-[#ded8d0] bg-[#fffdf9] p-5"><ShieldCheck className="h-5 w-5 text-emerald-700" /><p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Status</p><p className="mt-1 font-semibold">{billing.status}</p></div>
        <div className="rounded-[20px] border border-[#ded8d0] bg-[#fffdf9] p-5"><FileText className="h-5 w-5 text-[#b91c73]" /><p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Dokumente</p><p className="mt-1 font-semibold">{data.documents?.length || 0} verfügbar</p></div>
        <div className="rounded-[20px] border border-[#ded8d0] bg-[#fffdf9] p-5"><CheckCircle2 className="h-5 w-5 text-sky-700" /><p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Zahlungsart</p><p className="mt-1 font-semibold">{billing.payment_method === "VORKASSE" ? "Zahlbar sofort" : `${billing.payment_terms_days || 14} Tage nach Erhalt`}</p></div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <div className="rounded-[24px] border border-[#ded8d0] bg-[#fffdf9] p-5 sm:p-6"><h2 className="text-xl font-semibold">Dokumente</h2><div className="mt-4 divide-y divide-stone-200">{data.documents?.length ? data.documents.map((document) => <div key={document.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-semibold">{document.document_number}</p><p className="mt-1 text-xs text-stone-500">{document.document_type} · {document.status}</p></div>{["FINALIZED", "SENT"].includes(String(document.status)) ? <a href={`/api/rechnung/${encodeURIComponent(token)}/documents/${encodeURIComponent(String(document.id))}`} target="_blank" rel="noreferrer" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 transition hover:border-[#fa31a2] hover:text-[#b91c73]">PDF öffnen</a> : <span className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-500">Wird vorbereitet</span>}</div>) : <p className="py-7 text-sm text-stone-500">Die erste Pro-forma wird gerade vorbereitet.</p>}</div></div>
        <form onSubmit={submit} className="rounded-[24px] border border-[#ded8d0] bg-white p-5 shadow-[0_14px_44px_rgba(20,16,12,0.06)] sm:p-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b91c73]">Nur Rechnungsdaten</p><h2 className="mt-2 text-xl font-semibold">Änderungen zur Rechnung anfragen</h2><p className="mt-2 text-sm leading-6 text-stone-500">NEONTRIP prüft jede Anfrage. Ihr Auftrag und die bestellten Produkte werden dadurch nicht verändert.</p>{data.readOnly ? <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">Die finale Rechnung wurde erstellt. Änderungen sind nicht mehr möglich; der Link bleibt für Dokumente aktiv.</div> : <div className="mt-5 grid gap-3">{(["company","street","zip","city","country","vatId","invoiceEmail","projectNumber"] as const).map((field) => <label key={field} className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>{{ company:"Firma",street:"Straße",zip:"PLZ",city:"Ort",country:"Land",vatId:"USt-IdNr.",invoiceEmail:"Rechnungs-E-Mail",projectNumber:"Projektnummer (optional)" }[field]}</span><input value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="h-10 rounded-xl border border-stone-200 px-3 text-sm font-normal text-stone-950 outline-none focus:border-[#fa31a2] focus:ring-2 focus:ring-[#fa31a2]/10" /></label>)}<button disabled={sending} className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" />{sending ? "Wird gesendet …" : "Zur Prüfung senden"}</button></div>}{message ? <p className="mt-4 rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{message}</p> : null}</form>
      </section>
      <footer className="px-2 pb-4 text-center text-xs leading-5 text-stone-400">Der Zugriff ist auf diesen Auftrag begrenzt. Der Link enthält keine offen lesbare Kunden- oder Bestellnummer.</footer>
    </div>
  </main>;
}
