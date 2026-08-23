"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  CheckCircle2,
  FileText,
  LockKeyhole,
  Pencil,
  ReceiptText,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

type PortalPayload = {
  ok: boolean;
  billingCase?: Record<string, any>;
  documents?: Array<Record<string, any>>;
  changes?: Array<Record<string, any>>;
  readOnly?: boolean;
  error?: string;
};

type InvoiceForm = {
  company: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  deliveryCompany: string;
  deliveryName: string;
  deliveryStreet: string;
  deliveryZip: string;
  deliveryCity: string;
  deliveryCountry: string;
  vatId: string;
  invoiceEmail: string;
  projectNumber: string;
};

type VatCheck = {
  status: "idle" | "checking" | "valid" | "invalid" | "unavailable";
  normalizedVatId?: string;
  name?: string | null;
  address?: string | null;
  identityComparison?: "MATCH" | "MISMATCH" | "NOT_AVAILABLE";
};

const EMPTY_FORM: InvoiceForm = {
  company: "",
  street: "",
  zip: "",
  city: "",
  country: "",
  deliveryCompany: "",
  deliveryName: "",
  deliveryStreet: "",
  deliveryZip: "",
  deliveryCity: "",
  deliveryCountry: "",
  vatId: "",
  invoiceEmail: "",
  projectNumber: "",
};

const COUNTRY_OPTIONS = [
  ["DE", "Deutschland"],
  ["AT", "Österreich"],
  ["CH", "Schweiz"],
  ["BE", "Belgien"],
  ["BG", "Bulgarien"],
  ["DK", "Dänemark"],
  ["EE", "Estland"],
  ["FI", "Finnland"],
  ["FR", "Frankreich"],
  ["GR", "Griechenland"],
  ["IE", "Irland"],
  ["IT", "Italien"],
  ["HR", "Kroatien"],
  ["LV", "Lettland"],
  ["LT", "Litauen"],
  ["LU", "Luxemburg"],
  ["MT", "Malta"],
  ["NL", "Niederlande"],
  ["PL", "Polen"],
  ["PT", "Portugal"],
  ["RO", "Rumänien"],
  ["SE", "Schweden"],
  ["SK", "Slowakei"],
  ["SI", "Slowenien"],
  ["ES", "Spanien"],
  ["CZ", "Tschechien"],
  ["HU", "Ungarn"],
  ["CY", "Zypern"],
  ["GB", "Vereinigtes Königreich"],
  ["NO", "Norwegen"],
  ["US", "USA"],
] as const;

const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

const STATUS_LABELS: Record<string, string> = {
  PROFORMA_PENDING: "Pro-forma wird erstellt",
  MANUAL_REVIEW: "Prüfung durch NEONTRIP",
  PAYMENT_PENDING: "Zahlung ausstehend",
  PAID: "Bezahlt",
  DELIVERED: "Zugestellt",
  INVOICE_PENDING: "Rechnung wird erstellt",
  INVOICED: "Rechnung erstellt",
  CANCELLED: "Storniert",
  SYNC_BLOCKED: "Klärung erforderlich",
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  PROFORMA: "Pro-forma-Rechnung",
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift",
  CANCELLATION: "Stornobeleg",
};

const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  FINALIZED: "Erstellt",
  SENT: "Versendet",
  CANCELLED: "Storniert",
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
  }).format(Number(cents || 0) / 100);
}

function normalizeCountry(value: unknown) {
  const country = String(value || "").trim();
  const upper = country.toUpperCase();
  const aliases: Record<string, string> = {
    DEUTSCHLAND: "DE",
    GERMANY: "DE",
    ÖSTERREICH: "AT",
    OESTERREICH: "AT",
    AUSTRIA: "AT",
    SCHWEIZ: "CH",
    SWITZERLAND: "CH",
  };
  return aliases[upper] || (upper.length === 2 ? upper : "");
}

function countryLabel(value: unknown) {
  const code = normalizeCountry(value);
  return COUNTRY_OPTIONS.find(([optionCode]) => optionCode === code)?.[1] || String(value || "–");
}

function firstNonEmptyText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function formFromBilling(billing: Record<string, any>, requested: Record<string, any> = {}): InvoiceForm {
  const address = { ...(billing.billing_address || {}), ...(requested.billingAddress || {}) };
  const delivery = { ...(billing.delivery_address || {}), ...(requested.deliveryAddress || {}) };
  return {
    company: String(address.company || ""),
    street: String(address.street || ""),
    zip: String(address.zip || ""),
    city: String(address.city || ""),
    country: normalizeCountry(address.country) || String(address.country || ""),
    deliveryCompany: firstNonEmptyText(delivery.company, delivery.contactCompany),
    deliveryName: firstNonEmptyText(delivery.name, delivery.contactName, [delivery.firstName, delivery.lastName].filter(Boolean).join(" ")),
    deliveryStreet: String(delivery.street || delivery.address1 || ""),
    deliveryZip: String(delivery.zip || delivery.zipCode || ""),
    deliveryCity: String(delivery.city || ""),
    deliveryCountry: normalizeCountry(delivery.countryCode || delivery.country) || String(delivery.countryCode || delivery.country || ""),
    vatId: String(requested.vatId ?? billing.vat_id ?? ""),
    invoiceEmail: firstNonEmptyText(requested.invoiceEmail, billing.customer_email, billing.customerEmail, address.invoiceEmail, billing.customer?.invoiceEmail, billing.customer?.email),
    projectNumber: String(requested.projectNumber ?? billing.project_number ?? address.projectNumber ?? ""),
  };
}

function pendingChanges(payload: PortalPayload) {
  const pending = payload.changes?.find((change) => ["PENDING", "OPEN"].includes(String(change.status)));
  return pending?.requested_changes && typeof pending.requested_changes === "object" ? pending.requested_changes : {};
}

function normalizedVatInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function invoicePreview(billing: Record<string, any>, form: InvoiceForm, vatCheck: VatCheck) {
  const totals = billing.totals || {};
  const storedGross = Number.isFinite(Number(totals.totalGross))
    ? Math.round(Number(totals.totalGross) * 100)
    : Number(billing.total_gross_cents || 0);
  const storedNet = Number.isFinite(Number(totals.subtotalNet))
    ? Math.round(Number(totals.subtotalNet) * 100)
    : Math.round(storedGross / 1.19);
  const storedVat = Number.isFinite(Number(totals.vatAmount))
    ? Math.round(Number(totals.vatAmount) * 100)
    : Math.max(0, storedGross - storedNet);
  const storedRate = storedNet > 0 && storedVat > 0 ? storedVat / storedNet : 0.19;
  const deliveryCountry = normalizeCountry(form.deliveryCountry);
  const hasVerifiedVatId = vatCheck.status === "valid" && vatCheck.normalizedVatId === normalizedVatInput(form.vatId);
  const isThirdCountry = Boolean(deliveryCountry) && !EU_COUNTRIES.has(deliveryCountry);
  const isEuBusinessPreview = Boolean(deliveryCountry) && deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry) && hasVerifiedVatId;
  const taxExemptPreview = isThirdCountry || isEuBusinessPreview;
  const vat = taxExemptPreview ? 0 : Math.round(storedNet * storedRate);

  return {
    net: storedNet,
    vat,
    gross: storedNet + vat,
    rate: taxExemptPreview ? 0 : storedRate,
    deliveryCountry,
    isEuBusinessPreview,
    isThirdCountry,
  };
}

function percent(value: number) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value * 100);
}

function fieldClass(editing: boolean) {
  return `h-11 rounded-xl border px-3 text-sm font-normal outline-none transition ${
    editing
      ? "border-stone-300 bg-white text-stone-950 focus:border-[#fa31a2] focus:ring-2 focus:ring-[#fa31a2]/10"
      : "cursor-default border-stone-200 bg-stone-50 text-stone-700"
  }`;
}

export function BillingPortalClient({ token }: { token: string }) {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceForm>(EMPTY_FORM);
  const [vatCheck, setVatCheck] = useState<VatCheck>({ status: "idle" });

  useEffect(() => {
    void load();
  }, [token]);

  async function load() {
    const response = await fetch(`/api/rechnung/${encodeURIComponent(token)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({ ok: false }));
    setData(payload);
    setLoading(false);
    if (payload.ok && payload.billingCase) {
      const requested = pendingChanges(payload);
      const nextForm = formFromBilling(payload.billingCase, requested);
      setForm(nextForm);
      const stored = requested.vatValidation || payload.billingCase.vat_validation;
      setVatCheck(stored?.checked && stored?.valid && stored?.normalizedVatId === normalizedVatInput(nextForm.vatId)
        ? { status: "valid", normalizedVatId: stored.normalizedVatId, name: stored.name || stored.listedName || null, address: stored.address || stored.listedAddress || null, identityComparison: stored.identityComparison }
        : { status: "idle" });
    }
  }

  function cancelEditing() {
    if (data?.billingCase) setForm(formFromBilling(data.billingCase, pendingChanges(data)));
    setEditing(false);
    setMessage(null);
  }

  async function checkVatId() {
    const deliveryCountry = normalizeCountry(form.deliveryCountry);
    const needsCheck = Boolean(form.vatId.trim()) && deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry);
    if (!needsCheck) {
      setVatCheck({ status: "idle" });
      return true;
    }
    setVatCheck({ status: "checking" });
    setMessage(null);
    const response = await fetch(`/api/rechnung/${encodeURIComponent(token)}/vat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vatId: form.vatId, company: form.company, deliveryCountry }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.validation?.valid) {
      setVatCheck({
        status: "valid",
        normalizedVatId: payload.validation.normalizedVatId,
        name: payload.validation.name,
        address: payload.validation.address,
        identityComparison: payload.validation.identityComparison,
      });
      setForm((current) => ({ ...current, vatId: payload.validation.normalizedVatId }));
      return true;
    }
    const unavailable = response.status === 503;
    setVatCheck({ status: unavailable ? "unavailable" : "invalid" });
    setMessage(unavailable
      ? "Die USt-IdNr. konnte gerade nicht beim EU-Dienst geprüft werden. Bitte versuchen Sie es erneut."
      : "Diese USt-IdNr. ist für das Lieferland nicht gültig. Bitte prüfen Sie die Eingabe.");
    return false;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || data?.readOnly) return;
    const deliveryCountry = normalizeCountry(form.deliveryCountry);
    const needsVatCheck = Boolean(form.vatId.trim()) && deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry);
    if (needsVatCheck && (vatCheck.status !== "valid" || vatCheck.normalizedVatId !== normalizedVatInput(form.vatId))) {
      setMessage("Bitte prüfen Sie die USt-IdNr., bevor Sie die Rechnungsdaten absenden.");
      return;
    }
    setSending(true);
    setMessage(null);
    const response = await fetch(`/api/rechnung/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        billingAddress: {
          company: form.company,
          street: form.street,
          zip: form.zip,
          city: form.city,
          country: form.country,
        },
        deliveryAddress: {
          company: form.deliveryCompany,
          name: form.deliveryName,
          street: form.deliveryStreet,
          zip: form.deliveryZip,
          city: form.deliveryCity,
          country: form.deliveryCountry,
        },
        vatId: deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry) ? form.vatId : "",
        invoiceEmail: form.invoiceEmail,
        projectNumber: form.projectNumber,
        requesterEmail: form.invoiceEmail,
      }),
    });
    const payload = await response.json().catch(() => null);
    setSending(false);
    if (!response.ok) {
      setMessage(
        payload?.error === "invoice_already_created"
          ? "Die finale Rechnung wurde bereits erstellt. Änderungen sind nicht mehr möglich."
          : payload?.error === "vat_id_invalid" || payload?.error === "vat_id_format_invalid" || payload?.error === "vat_id_country_mismatch"
            ? "Diese USt-IdNr. ist für das Lieferland nicht gültig. Bitte prüfen Sie die Eingabe."
            : payload?.error === "billing_address_invalid" || payload?.error === "delivery_address_invalid"
              ? "Bitte füllen Sie Rechnungs- und Lieferanschrift vollständig aus und wählen Sie jeweils ein Land."
            : payload?.error === "vat_validation_unavailable"
              ? "Die USt-IdNr. konnte gerade nicht beim EU-Dienst geprüft werden. Bitte versuchen Sie es erneut."
              : "Die Rechnungsdaten konnten nicht gesendet werden. Bitte versuchen Sie es erneut oder kontaktieren Sie NEONTRIP.",
      );
      return;
    }
    setEditing(false);
    setMessage("Ihre Rechnungsdaten wurden zur Prüfung an NEONTRIP gesendet.");
    await load();
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f4ee] text-stone-600">Rechnungsdaten werden geladen …</main>;
  }

  if (!data?.ok || !data.billingCase) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f4ee] p-6">
        <div className="max-w-md rounded-[24px] border border-stone-200 bg-white p-8 text-center">
          <LockKeyhole className="mx-auto h-8 w-8 text-stone-700" />
          <h1 className="mt-4 text-xl font-semibold">Link nicht verfügbar</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500">Der Rechnungslink ist ungültig oder wurde von NEONTRIP widerrufen.</p>
        </div>
      </main>
    );
  }

  const billing = data.billingCase;
  const currency = String(billing.currency || billing.totals?.currency || "EUR");
  const preview = invoicePreview(billing, form, vatCheck);
  const paymentLabel = billing.payment_method === "VORKASSE" ? "Zahlbar sofort" : `${billing.payment_terms_days || 14} Tage nach Erhalt`;
  const taxLabel = preview.vat === 0 ? (preview.isThirdCountry ? "Steuerfreie Ausfuhr" : "USt-ID wird geprüft") : `${percent(preview.rate)} % Umsatzsteuer`;
  const pendingChange = data.changes?.find((change) => ["PENDING", "OPEN"].includes(String(change.status)));

  return (
    <main className="min-h-screen bg-[#f7f4ee] px-4 py-5 text-[#171412] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(250,49,162,0.18),transparent_28%),linear-gradient(135deg,#080807_0%,#171311_62%,#24151c_100%)] px-5 py-6 text-white shadow-[0_24px_70px_rgba(18,14,12,0.2)] sm:px-8">
          <div className="flex items-center justify-between gap-4">
            <img src="/assets/logo_weiss_neontrip.png" alt="NEONTRIP" className="h-8 w-auto" />
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/75">Sicheres Rechnungsportal</span>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">{billing.shopify_order_name}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Ihre Rechnungsdaten</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">Prüfen Sie hier Rechnungsanschrift, USt-ID und Rechnungsempfänger. Änderungen betreffen ausschließlich die Rechnung – nicht Ihren Auftrag.</p>
            </div>
            <div className="min-w-44 rounded-2xl border border-white/15 bg-white/[0.07] px-5 py-4">
              <p className="text-xs text-white/45">Bestellung {billing.shopify_order_name}</p>
              <p className="mt-1 text-2xl font-semibold">{money(preview.gross, currency)}</p>
              <p className="mt-1 text-xs text-white/45">inkl. {money(preview.vat, currency)} USt.</p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[20px] border border-[#ded8d0] bg-[#fffdf9] p-5">
            <ShieldCheck className="h-5 w-5 text-emerald-700" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Status</p>
            <p className="mt-1 font-semibold">{STATUS_LABELS[String(billing.status)] || "In Bearbeitung"}</p>
          </div>
          <div className="rounded-[20px] border border-[#ded8d0] bg-[#fffdf9] p-5">
            <CheckCircle2 className="h-5 w-5 text-sky-700" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Zahlungsziel</p>
            <p className="mt-1 font-semibold">{paymentLabel}</p>
          </div>
          <div className="rounded-[20px] border border-[#ded8d0] bg-[#fffdf9] p-5">
            <ReceiptText className="h-5 w-5 text-[#b91c73]" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Steuerstatus</p>
            <p className="mt-1 font-semibold">{taxLabel}</p>
          </div>
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <form onSubmit={submit} className="rounded-[24px] border border-[#ded8d0] bg-[#fffdf9] p-5 shadow-[0_14px_44px_rgba(20,16,12,0.05)] sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b91c73]">Nur Rechnungsdaten</p>
                <h2 className="mt-2 text-2xl font-semibold">Rechnungsempfänger</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">Die Angaben sind zunächst geschützt. Ihr Auftrag und die bestellten Produkte werden durch eine Änderung nicht verändert. NEONTRIP prüft jede eingereichte Änderung vor der Übernahme.</p>
              </div>
              {!data.readOnly && !editing ? (
                <button type="button" onClick={() => { setEditing(true); setMessage(null); }} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-[#b91c73]">
                  <Pencil className="h-4 w-4" />
                  Rechnungsdaten bearbeiten
                </button>
              ) : null}
            </div>

            {data.readOnly ? (
              <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">Die finale Rechnung wurde erstellt. Änderungen sind nicht mehr möglich; der Link bleibt für Dokumente aktiv.</div>
            ) : null}
            {pendingChange ? (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Eine Änderung wird bereits von NEONTRIP geprüft. Sie können die aktuell gespeicherten Daten weiterhin ansehen.</div>
            ) : null}

            <fieldset disabled={Boolean(data.readOnly)} className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2">
                <span>Firma / Rechnungsempfänger</span>
                <input required={editing} value={form.company} readOnly={!editing} onChange={(event) => { setForm({ ...form, company: event.target.value }); setVatCheck({ status: "idle" }); }} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2">
                <span>Straße und Hausnummer</span>
                <input required={editing} value={form.street} readOnly={!editing} onChange={(event) => setForm({ ...form, street: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>PLZ</span>
                <input required={editing} value={form.zip} readOnly={!editing} onChange={(event) => setForm({ ...form, zip: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>Ort</span>
                <input required={editing} value={form.city} readOnly={!editing} onChange={(event) => setForm({ ...form, city: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2">
                <span>Rechnungsland</span>
                <select required={editing} value={form.country} disabled={!editing || Boolean(data.readOnly)} onChange={(event) => setForm({ ...form, country: event.target.value })} className={fieldClass(editing)}>
                  <option value="">Land auswählen</option>
                  {COUNTRY_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>USt-IdNr. (falls vorhanden)</span>
                <div className="flex gap-2">
                  <input value={form.vatId} readOnly={!editing} onChange={(event) => { setForm({ ...form, vatId: event.target.value }); setVatCheck({ status: "idle" }); }} onBlur={() => { if (editing && form.vatId.trim()) void checkVatId(); }} className={`${fieldClass(editing)} min-w-0 flex-1`} />
                  {editing && form.vatId.trim() ? <button type="button" disabled={vatCheck.status === "checking"} onClick={() => void checkVatId()} className="shrink-0 rounded-xl border border-stone-300 bg-white px-3 text-xs font-semibold disabled:opacity-50">{vatCheck.status === "checking" ? "Prüfung …" : "USt-ID prüfen"}</button> : null}
                </div>
                {vatCheck.status === "valid" ? <span className="font-medium text-emerald-700">USt-IdNr. gültig{vatCheck.name ? ` · Gelistet als ${vatCheck.name}` : ""}</span> : null}
                {vatCheck.status === "invalid" ? <span className="font-medium text-red-700">USt-IdNr. ungültig</span> : null}
                {vatCheck.status === "valid" && vatCheck.identityComparison === "MISMATCH" ? <span className="font-normal text-amber-700">Firmenname oder Anschrift weichen vom Registereintrag ab. Die Bestellung kann trotzdem eingereicht werden; NEONTRIP erhält einen Prüfhinweis.</span> : null}
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>Projektnummer (optional)</span>
                <input value={form.projectNumber} readOnly={!editing} onChange={(event) => setForm({ ...form, projectNumber: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2">
                <span>Rechnungs-E-Mail</span>
                <input required={editing} type="email" value={form.invoiceEmail} readOnly={!editing} onChange={(event) => setForm({ ...form, invoiceEmail: event.target.value })} className={fieldClass(editing)} />
              </label>
              <div className="mt-3 border-t border-stone-200 pt-5 sm:col-span-2">
                <p className="text-sm font-semibold text-stone-950">Lieferadresse</p>
                <p className="mt-1 text-xs leading-5 text-stone-500">Das Lieferland bestimmt die steuerliche Behandlung. Eine Änderung wird deshalb gemeinsam mit der USt-ID geprüft.</p>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>Firma am Lieferort</span>
                <input value={form.deliveryCompany} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryCompany: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>Ansprechpartner</span>
                <input value={form.deliveryName} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryName: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2">
                <span>Lieferstraße und Hausnummer</span>
                <input required={editing} value={form.deliveryStreet} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryStreet: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>Liefer-PLZ</span>
                <input required={editing} value={form.deliveryZip} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryZip: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
                <span>Lieferort</span>
                <input required={editing} value={form.deliveryCity} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryCity: event.target.value })} className={fieldClass(editing)} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2">
                <span>Lieferland</span>
                <select required={editing} value={form.deliveryCountry} disabled={!editing || Boolean(data.readOnly)} onChange={(event) => { const deliveryCountry = normalizeCountry(event.target.value); setForm({ ...form, deliveryCountry, vatId: deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry) ? form.vatId : "" }); setVatCheck({ status: "idle" }); }} className={fieldClass(editing)}>
                  <option value="">Land auswählen</option>
                  {COUNTRY_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
            </fieldset>

            {!editing && !data.readOnly ? (
              <div className="mt-5 flex items-center gap-2 text-xs text-stone-500"><LockKeyhole className="h-4 w-4" /> Die Rechnungsdaten sind geschützt.</div>
            ) : null}
            {editing && !data.readOnly ? (
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" onClick={cancelEditing} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:border-stone-500">
                  <X className="h-4 w-4" />
                  Abbrechen
                </button>
                <button disabled={sending || vatCheck.status === "checking" || (Boolean(form.vatId.trim()) && preview.deliveryCountry !== "DE" && EU_COUNTRIES.has(preview.deliveryCountry) && vatCheck.status !== "valid")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-[#b91c73] disabled:opacity-50">
                  <Send className="h-4 w-4" />
                  {sending ? "Wird gesendet …" : "Speichern und zur Prüfung senden"}
                </button>
              </div>
            ) : null}
            {message ? <p aria-live="polite" className="mt-4 rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{message}</p> : null}
          </form>

          <aside className="rounded-[24px] border border-[#ded8d0] bg-white p-5 shadow-[0_14px_44px_rgba(20,16,12,0.06)] lg:sticky lg:top-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b91c73]">Live-Vorschau</p>
            <div className="mt-3 flex items-end justify-between gap-4 border-b border-stone-200 pb-4">
              <div><p className="text-xs text-stone-500">Bestellnummer</p><p className="mt-1 font-semibold">{billing.shopify_order_name}</p></div>
              <ReceiptText className="h-6 w-6 text-stone-300" />
            </div>
            <dl aria-live="polite" className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Nettobetrag</dt><dd className="font-medium">{money(preview.net, currency)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Umsatzsteuer {percent(preview.rate)} %</dt><dd className="font-medium">{money(preview.vat, currency)}</dd></div>
              <div className="flex justify-between gap-4 border-t border-stone-200 pt-4 text-base"><dt className="font-semibold">Gesamtbetrag</dt><dd className="font-semibold">{money(preview.gross, currency)}</dd></div>
            </dl>
            <div className="mt-5 rounded-2xl bg-[#f7f4ee] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Steuerlich maßgeblich</p>
              <p className="mt-2 text-sm font-semibold">Lieferland: {countryLabel(form.deliveryCountry)}</p>
              <p className="mt-2 text-xs leading-5 text-stone-500">Das Lieferland ist für die steuerliche Behandlung maßgeblich, nicht das Rechnungsland.</p>
            </div>
            {preview.isEuBusinessPreview ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">Die USt-IdNr. wurde beim EU-Dienst bestätigt. Nach Freigabe durch NEONTRIP wird die Rechnung ohne Umsatzsteuer ausgestellt.</p> : null}
            {preview.isThirdCountry ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">Für das Lieferland wird aktuell eine steuerfreie Ausfuhr angezeigt.</p> : null}
          </aside>
        </section>

        <section className="rounded-[18px] border border-[#ded8d0] bg-[#fffdf9] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-stone-400" />
              <h2 className="text-sm font-semibold">Dokumente</h2>
            </div>
            <span className="text-xs text-stone-400">{data.documents?.length || 0} verfügbar</span>
          </div>
          <div className="mt-2 divide-y divide-stone-200">
            {data.documents?.length ? data.documents.map((document) => (
              <div key={document.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{document.document_number}</p>
                  <p className="mt-0.5 text-xs text-stone-400">{DOCUMENT_TYPE_LABELS[String(document.document_type)] || "Dokument"} · {DOCUMENT_STATUS_LABELS[String(document.status)] || "In Bearbeitung"}</p>
                </div>
                {["FINALIZED", "SENT"].includes(String(document.status)) ? (
                  <a href={`/api/rechnung/${encodeURIComponent(token)}/documents/${encodeURIComponent(String(document.id))}`} target="_blank" rel="noreferrer" className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 transition hover:border-[#fa31a2] hover:text-[#b91c73]">PDF öffnen</a>
                ) : <span className="shrink-0 text-xs text-stone-400">Wird vorbereitet</span>}
              </div>
            )) : <p className="py-3 text-xs text-stone-500">Die erste Pro-forma-Rechnung wird gerade vorbereitet.</p>}
          </div>
        </section>

        <footer className="px-2 pb-4 text-center text-xs leading-5 text-stone-400">Der Zugriff ist auf diesen Auftrag begrenzt. Die Bestellnummer ist ausschließlich innerhalb dieses geschützten Portals sichtbar.</footer>
      </div>
    </main>
  );
}
