"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { INVOICE_CONSENT_TEXT, INVOICE_CONSENT_VERSION } from "@/lib/ops/billing/portal-invoice";
import {
  BadgeCheck,
  CheckCircle2,
  FileText,
  LockKeyhole,
  MapPin,
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
  billingFirstName: string;
  billingLastName: string;
  deliveryCompany: string;
  deliveryFirstName: string;
  deliveryLastName: string;
  deliveryStreet: string;
  deliveryZip: string;
  deliveryCity: string;
  deliveryCountry: string;
  deliveryInstructions: string;
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
  billingFirstName: "",
  billingLastName: "",
  deliveryCompany: "",
  deliveryFirstName: "",
  deliveryLastName: "",
  deliveryStreet: "",
  deliveryZip: "",
  deliveryCity: "",
  deliveryCountry: "",
  deliveryInstructions: "",
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

function personName(address: Record<string, any>, fallback = "") {
  const firstName = firstNonEmptyText(address.firstName);
  const lastName = firstNonEmptyText(address.lastName);
  if (firstName || lastName) return { firstName, lastName };
  const parts = firstNonEmptyText(address.name, address.contactName, fallback).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] || "" };
}

function portalChanges(payload: PortalPayload) {
  return Array.isArray(payload.changes) ? payload.changes : [];
}

function portalDocuments(payload: PortalPayload) {
  return Array.isArray(payload.documents) ? payload.documents : [];
}

function formFromBilling(billing: Record<string, any>, requested: Record<string, any> = {}): InvoiceForm {
  const address = { ...(billing.billing_address || {}), ...(requested.billingAddress || {}) };
  const delivery = { ...(billing.delivery_address || {}), ...(requested.deliveryAddress || {}) };
  const billingPerson = personName(address, firstNonEmptyText(billing.customer?.name, billing.customer_name));
  const deliveryPerson = personName(delivery);
  return {
    company: String(address.company || ""),
    street: String(address.street || ""),
    zip: String(address.zip || ""),
    city: String(address.city || ""),
    country: normalizeCountry(address.country) || String(address.country || ""),
    billingFirstName: billingPerson.firstName,
    billingLastName: billingPerson.lastName,
    deliveryCompany: firstNonEmptyText(delivery.company, delivery.contactCompany),
    deliveryFirstName: deliveryPerson.firstName,
    deliveryLastName: deliveryPerson.lastName,
    deliveryStreet: String(delivery.street || delivery.address1 || ""),
    deliveryZip: String(delivery.zip || delivery.zipCode || ""),
    deliveryCity: String(delivery.city || ""),
    deliveryCountry: normalizeCountry(delivery.countryCode || delivery.country) || String(delivery.countryCode || delivery.country || ""),
    deliveryInstructions: firstNonEmptyText(delivery.deliveryInstructions, delivery.instructions, delivery.note),
    vatId: String(requested.vatId ?? billing.vat_id ?? ""),
    invoiceEmail: firstNonEmptyText(requested.invoiceEmail, billing.invoiceEmail, billing.customer_email, billing.customerEmail, address.invoiceEmail, billing.customer?.invoiceEmail, billing.customer?.email),
    projectNumber: String(requested.projectNumber ?? billing.project_number ?? address.projectNumber ?? ""),
  };
}

function pendingChanges(payload: PortalPayload) {
  const pending = portalChanges(payload).find((change) => ["PENDING", "OPEN"].includes(String(change.status)));
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
  return `h-11 w-full min-w-0 rounded-xl border px-3 text-sm font-normal outline-none transition ${
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
  const [invoiceConfirmed, setInvoiceConfirmed] = useState(false);
  const [requestingInvoice, setRequestingInvoice] = useState(false);
  const invoiceInFlight = useRef(false);
  const invoiceDialogRef = useRef<HTMLDialogElement>(null);
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceForm>(EMPTY_FORM);
  const [vatCheck, setVatCheck] = useState<VatCheck>({ status: "idle" });
  const effectiveInvoiceEmail = firstNonEmptyText(
    form.invoiceEmail,
    data?.billingCase?.invoiceEmail,
    data?.billingCase?.customer_email,
    data?.billingCase?.customerEmail,
    data?.billingCase?.billing_address?.invoiceEmail,
    data?.billingCase?.customer?.invoiceEmail,
    data?.billingCase?.customer?.email,
  );

  useEffect(() => {
    void load();
  }, [token]);

  async function load() {
    invoiceDialogRef.current?.close();
    setInvoiceConfirmed(false);
    setLoading(true);
    try {
      const response = await fetch(`/api/rechnung/${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({ ok: false, error: "portal_unavailable" }));
      setData(payload);
      if (payload.ok && payload.billingCase) {
        if (payload.readOnly) setEditing(false);
        const requested = pendingChanges(payload);
        const nextForm = formFromBilling(payload.billingCase, requested);
        setForm(nextForm);
        const stored = requested.vatValidation || payload.billingCase.vat_validation;
        setVatCheck(stored?.checked && stored?.valid && stored?.normalizedVatId === normalizedVatInput(nextForm.vatId)
          ? { status: "valid", normalizedVatId: stored.normalizedVatId, name: stored.name || stored.listedName || null, address: stored.address || stored.listedAddress || null, identityComparison: stored.identityComparison }
          : { status: "idle" });
      }
    } catch {
      setData({ ok: false, error: "portal_unavailable" });
    } finally {
      setLoading(false);
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
    let response: Response;
    let payload: any;
    try {
      response = await fetch(`/api/rechnung/${encodeURIComponent(token)}/vat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vatId: form.vatId, company: form.company, deliveryCountry }),
      });
      payload = await response.json().catch(() => null);
    } catch {
      setVatCheck({ status: "unavailable" });
      setMessage("Die USt-IdNr. konnte gerade nicht beim EU-Dienst geprüft werden. Bitte versuchen Sie es erneut.");
      return false;
    }
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
    if (!editing || data?.readOnly || invoiceInFlight.current) return;
    const deliveryCountry = normalizeCountry(form.deliveryCountry);
    const needsVatCheck = Boolean(form.vatId.trim()) && deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry);
    if (needsVatCheck && (vatCheck.status !== "valid" || vatCheck.normalizedVatId !== normalizedVatInput(form.vatId))) {
      setMessage("Bitte prüfen Sie die USt-IdNr., bevor Sie die Rechnungsdaten absenden.");
      return;
    }
    setSending(true);
    setMessage(null);
    const idempotencyKey = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let response: Response;
    let payload: any;
    try {
      response = await fetch(`/api/rechnung/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
        billingAddress: {
          company: form.company,
          name: [form.billingFirstName, form.billingLastName].filter(Boolean).join(" "),
          firstName: form.billingFirstName,
          lastName: form.billingLastName,
          street: form.street,
          zip: form.zip,
          city: form.city,
          country: form.country,
        },
        deliveryAddress: {
          company: form.deliveryCompany,
          name: [form.deliveryFirstName, form.deliveryLastName].filter(Boolean).join(" "),
          firstName: form.deliveryFirstName,
          lastName: form.deliveryLastName,
          street: form.deliveryStreet,
          zip: form.deliveryZip,
          city: form.deliveryCity,
          country: form.deliveryCountry,
          deliveryInstructions: form.deliveryInstructions,
        },
        vatId: deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry) ? form.vatId : "",
        invoiceEmail: effectiveInvoiceEmail,
        projectNumber: form.projectNumber,
        requesterEmail: effectiveInvoiceEmail,
        }),
      });
      payload = await response.json().catch(() => null);
    } catch {
      setSending(false);
      setMessage("Die Rechnungsdaten konnten wegen einer unterbrochenen Verbindung nicht gesendet werden. Bitte versuchen Sie es erneut.");
      return;
    }
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

  function openInvoiceReview() {
    if (editing || sending || data?.readOnly || invoiceInFlight.current) return;
    setInvoiceConfirmed(false);
    setInvoiceMessage(null);
    invoiceDialogRef.current?.showModal();
  }

  async function requestInvoice() {
    if (!invoiceDialogRef.current?.open || !invoiceConfirmed || editing || sending || data?.readOnly || invoiceInFlight.current || !data?.billingCase) return;
    invoiceInFlight.current = true;
    setRequestingInvoice(true);
    setInvoiceMessage(null);
    try {
      const response = await fetch("/api/rechnung/" + encodeURIComponent(token) + "/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          consentVersion: INVOICE_CONSENT_VERSION,
          revision: data.billingCase.current_revision,
          updatedAt: data.billingCase.updated_at,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok) {
        invoiceDialogRef.current?.close();
        setData((current) => current?.billingCase ? {
          ...current,
          readOnly: true,
          billingCase: { ...current.billingCase, invoice_requested_at: payload.invoiceRequestedAt, status: payload.status },
        } : current);
        setEditing(false);
      } else {
        const messages: Record<string, string> = {
          BILLING_INVOICE_STALE: "Die Daten wurden zwischenzeitlich aktualisiert. Bitte prüfen Sie die aktuelle Pro-forma und bestätigen Sie die Angaben erneut.",
          BILLING_INVOICE_CHANGES_PENDING: "NEONTRIP prüft noch eine Änderung. Bitte warten Sie auf die aktualisierte Pro-forma.",
          BILLING_VAT_REVIEW_REQUIRED: "Die steuerlichen Angaben werden noch geprüft. Anschließend können Sie die Rechnung anfordern.",
          BILLING_INVOICE_JOBS_PENDING: "Ein Dokument oder eine Änderung wird bereits verarbeitet. Bitte aktualisieren Sie den Status in Kürze.",
          BILLING_INVOICE_PROFORMA_NOT_READY: "Die aktuelle Pro-forma ist noch nicht verfügbar. Bitte aktualisieren Sie den Status in Kürze.",
          BILLING_INVOICE_DATA_INVALID: "Bitte prüfen und vervollständigen Sie zunächst die Rechnungsdaten einschließlich Rechnungs-E-Mail.",
          BILLING_INVOICE_NOT_READY: "Für diesen Auftrag kann derzeit keine Rechnung angefordert werden. Bitte kontaktieren Sie NEONTRIP.",
          BILLING_PORTAL_READ_ONLY: "Die Rechnung wurde bereits angefordert oder erstellt. Änderungen sind nicht mehr möglich.",
        };
        setInvoiceMessage(messages[payload?.error] || "Die Anforderung konnte nicht bestätigt werden. Bitte prüfen Sie den aktualisierten Status oder kontaktieren Sie NEONTRIP.");
        await load();
      }
    } catch {
      setInvoiceMessage("Die Verbindung wurde unterbrochen. Bitte prüfen Sie den aktualisierten Status, bevor Sie die Rechnung erneut anfordern.");
      await load();
    } finally {
      invoiceInFlight.current = false;
      setRequestingInvoice(false);
      setInvoiceConfirmed(false);
    }
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f4ee] text-stone-600">Rechnungsdaten werden geladen …</main>;
  }

  if (!data?.ok || !data.billingCase) {
    const temporarilyUnavailable = data?.error === "portal_unavailable";
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f4ee] p-6">
        <div className="max-w-md rounded-[24px] border border-stone-200 bg-white p-8 text-center">
          <LockKeyhole className="mx-auto h-8 w-8 text-stone-700" />
          <h1 className="mt-4 text-xl font-semibold">{temporarilyUnavailable ? "Portal vorübergehend nicht erreichbar" : "Link nicht verfügbar"}</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500">{temporarilyUnavailable ? "Bitte laden Sie die Seite erneut, um den aktuellen Stand Ihrer Rechnungsdaten und Dokumente zu prüfen." : "Der Rechnungslink ist ungültig oder wurde von NEONTRIP widerrufen."}</p>
          {temporarilyUnavailable ? <button type="button" onClick={() => window.location.reload()} className="mt-5 h-11 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white">Erneut laden</button> : null}
        </div>
      </main>
    );
  }

  const billing = data.billingCase;
  const currency = String(billing.currency || billing.totals?.currency || "EUR");
  const preview = invoicePreview(billing, form, vatCheck);
  const paymentLabel = billing.payment_method === "VORKASSE" ? "Zahlbar sofort" : `${billing.payment_terms_days || 14} Tage nach Erhalt`;
  const documents = portalDocuments(data);
  const pendingChange = portalChanges(data).find((change) => ["PENDING", "OPEN"].includes(String(change.status)));
  const invoiceRequested = Boolean(billing.invoice_requested_at);
  const invoiceReviewForm = formFromBilling(billing);
  const invoiceDocument = documents.find((document) => document.document_type === "INVOICE");
  const currentProforma = documents.find((document) => document.document_type === "PROFORMA"
    && Number(document.revision) === Number(billing.current_revision)
    && ["FINALIZED", "SENT"].includes(String(document.status)));
  const invoiceBlocked = editing || sending || requestingInvoice || Boolean(pendingChange)
    || billing.tax_review_status === "REVIEW_REQUIRED" || !currentProforma
    || !["PAYMENT_PENDING", "PAID", "DELIVERED"].includes(String(billing.status));
  const taxReviewVerified = String(billing.tax_review_status || "") === "VERIFIED";
  const taxLabel = preview.vat === 0
    ? preview.isThirdCountry
      ? "Steuerfreie Ausfuhr"
      : taxReviewVerified && !pendingChange
        ? "USt-ID geprüft · Reverse Charge"
        : vatCheck.status === "valid" ? "USt-ID geprüft · Freigabe ausstehend" : "USt-ID wird geprüft"
    : `${percent(preview.rate)} % Umsatzsteuer`;

  return (
    <main className="min-h-screen bg-[#f7f4ee] px-4 py-5 text-[#171412] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-[88rem] space-y-5">
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

        <section className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <form onSubmit={submit} className="min-w-0 rounded-[24px] border border-[#ded8d0] bg-[#fffdf9] p-5 shadow-[0_14px_44px_rgba(20,16,12,0.05)] sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b91c73]">Nur Rechnungsdaten</p>
                <h2 className="mt-2 text-2xl font-semibold">Rechnungsempfänger</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">Die Angaben sind zunächst geschützt. Ihr Auftrag und die bestellten Produkte werden durch eine Änderung nicht verändert. NEONTRIP prüft jede eingereichte Änderung vor der Übernahme.</p>
              </div>
              {!data.readOnly && !editing && !requestingInvoice ? (
                <button type="button" onClick={() => { setEditing(true); setMessage(null); setInvoiceConfirmed(false); setInvoiceMessage(null); }} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-[#b91c73]">
                  <Pencil className="h-4 w-4" />
                  Rechnungsdaten bearbeiten
                </button>
              ) : null}
            </div>

            {data.readOnly ? (
              <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">{billing.final_invoice_at ? "Die finale Rechnung wurde erstellt." : "Die verbindliche Rechnung wurde angefordert."} Pro-forma und Rechnungsdaten können nicht mehr geändert werden; der Link bleibt für Dokumente aktiv.</div>
            ) : null}
            {pendingChange ? (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Eine Änderung wird bereits von NEONTRIP geprüft. Sie können die aktuell gespeicherten Daten weiterhin ansehen.</div>
            ) : null}

            <fieldset disabled={Boolean(data.readOnly || requestingInvoice)} className="mt-6 grid min-w-0 gap-4 xl:grid-cols-2">
              <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
                <div className="mb-4 border-b border-stone-200 pb-3">
                  <p className="text-sm font-semibold text-stone-950">Rechnungsadresse</p>
                  <p className="mt-1 text-xs leading-5 text-stone-500">Diese Anschrift erscheint auf Ihren Rechnungsdokumenten.</p>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>label]:min-w-0">
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2"><span>Firma / Rechnungsempfänger</span><input required={editing} value={form.company} readOnly={!editing} onChange={(event) => { setForm({ ...form, company: event.target.value }); setVatCheck({ status: "idle" }); }} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Vorname</span><input value={form.billingFirstName} readOnly={!editing} onChange={(event) => setForm({ ...form, billingFirstName: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Nachname</span><input value={form.billingLastName} readOnly={!editing} onChange={(event) => setForm({ ...form, billingLastName: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2"><span>Straße und Hausnummer</span><input required={editing} value={form.street} readOnly={!editing} onChange={(event) => setForm({ ...form, street: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>PLZ</span><input required={editing} value={form.zip} readOnly={!editing} onChange={(event) => setForm({ ...form, zip: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Ort</span><input required={editing} value={form.city} readOnly={!editing} onChange={(event) => setForm({ ...form, city: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2"><span>Rechnungsland</span><select required={editing} value={form.country} disabled={!editing || Boolean(data.readOnly)} onChange={(event) => setForm({ ...form, country: event.target.value })} className={fieldClass(editing)}><option value="">Land auswählen</option>{COUNTRY_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
                </div>
              </section>

              <section className="min-w-0 rounded-2xl border border-[#f3bddc] bg-[#fff8fc] p-4 sm:p-5">
                <div className="mb-4 flex gap-3 border-b border-[#f3bddc] pb-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#b91c73]" />
                  <div><p className="text-sm font-semibold text-stone-950">Lieferadresse</p><p className="mt-1 text-xs leading-5 text-stone-600">Wird nach Freigabe direkt in Shopify übernommen. Das Lieferland bestimmt die steuerliche Behandlung.</p></div>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>label]:min-w-0">
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2"><span>Firma am Lieferort</span><input value={form.deliveryCompany} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryCompany: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Vorname</span><input value={form.deliveryFirstName} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryFirstName: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Nachname</span><input value={form.deliveryLastName} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryLastName: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2"><span>Straße und Hausnummer</span><input required={editing} value={form.deliveryStreet} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryStreet: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>PLZ</span><input required={editing} value={form.deliveryZip} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryZip: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Ort</span><input required={editing} value={form.deliveryCity} readOnly={!editing} onChange={(event) => setForm({ ...form, deliveryCity: event.target.value })} className={fieldClass(editing)} /></label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2"><span>Lieferland</span><select required={editing} value={form.deliveryCountry} disabled={!editing || Boolean(data.readOnly)} onChange={(event) => { const deliveryCountry = normalizeCountry(event.target.value); setForm({ ...form, deliveryCountry, vatId: deliveryCountry !== "DE" && EU_COUNTRIES.has(deliveryCountry) ? form.vatId : "" }); setVatCheck({ status: "idle" }); }} className={fieldClass(editing)}><option value="">Land auswählen</option>{COUNTRY_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>

                  <div className="rounded-2xl border-2 border-[#e554aa] bg-white p-4 shadow-[0_8px_24px_rgba(185,28,115,0.08)] sm:col-span-2">
                    <div className="flex gap-3"><BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#b91c73]" /><div><p className="text-sm font-semibold text-stone-950">Umsatzsteuer-ID prüfen</p><p className="mt-1 text-xs leading-5 text-stone-600">Die Länderkennung der USt-ID muss zum Lieferland passen. Bei gültiger EU-USt-ID sehen Sie rechts sofort den Betrag ohne Umsatzsteuer.</p></div></div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={form.vatId} readOnly={!editing} onChange={(event) => { setForm({ ...form, vatId: event.target.value }); setVatCheck({ status: "idle" }); }} onBlur={() => { if (editing && form.vatId.trim()) void checkVatId(); }} className={`${fieldClass(editing)} min-w-0 flex-1`} placeholder={form.deliveryCountry === "AT" ? "z. B. ATU12345678" : "USt-IdNr. eingeben"} />{editing && form.vatId.trim() ? <button type="button" disabled={vatCheck.status === "checking"} onClick={() => void checkVatId()} className="h-11 shrink-0 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white disabled:opacity-50">{vatCheck.status === "checking" ? "Prüfung …" : "USt-ID prüfen"}</button> : null}</div>
                    {vatCheck.status === "valid" ? <p className="mt-2 text-xs font-semibold text-emerald-700">✓ USt-IdNr. gültig{vatCheck.name ? ` · Gelistet als ${vatCheck.name}` : ""}</p> : null}
                    {vatCheck.status === "invalid" ? <p className="mt-2 text-xs font-semibold text-red-700">Ungültige Umsatzsteuer-ID für das ausgewählte Lieferland.</p> : null}
                    {vatCheck.status === "valid" && vatCheck.identityComparison === "MISMATCH" ? <p className="mt-2 text-xs leading-5 text-amber-700">Firmierung oder Anschrift weichen vom Registereintrag ab. NEONTRIP erhält dazu einen Prüfhinweis.</p> : null}
                  </div>

                  <label className="grid gap-1.5 text-xs font-semibold text-stone-600 sm:col-span-2"><span>Zusätzliche Lieferhinweise (optional)</span><textarea value={form.deliveryInstructions} readOnly={!editing} maxLength={500} rows={3} onChange={(event) => setForm({ ...form, deliveryInstructions: event.target.value })} className={`${fieldClass(editing)} h-auto min-h-20 resize-y py-3`} placeholder="z. B. Ansprechpartner vor Ort, Anlieferzeit oder Zufahrt" /></label>
                </div>
              </section>

              <section aria-labelledby="invoice-delivery-title" className="grid min-w-0 gap-3 rounded-2xl border border-stone-200 bg-[#f7f4ee] p-4 sm:grid-cols-2 xl:col-span-2 [&>label]:min-w-0">
                <div className="sm:col-span-2"><p id="invoice-delivery-title" className="text-sm font-semibold text-stone-950">Rechnungsversand</p><p className="mt-1 text-xs text-stone-500">Hierhin senden wir Pro-forma-Rechnung und spätere Rechnungsdokumente.</p></div>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Rechnungs-E-Mail</span><input required={editing} type="email" value={effectiveInvoiceEmail} readOnly={!editing} onChange={(event) => setForm({ ...form, invoiceEmail: event.target.value })} className={fieldClass(editing)} /></label>
                <label className="grid gap-1.5 text-xs font-semibold text-stone-600"><span>Projektnummer (optional)</span><input value={form.projectNumber} readOnly={!editing} onChange={(event) => setForm({ ...form, projectNumber: event.target.value })} className={fieldClass(editing)} /></label>
                {!data.readOnly ? (
                  <div className="mt-1 sm:col-span-2">
                    <button type="button" onClick={openInvoiceReview} disabled={editing || sending || requestingInvoice} aria-haspopup="dialog" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-[#b91c73] disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500">
                      <ReceiptText className="h-4 w-4 shrink-0" />
                      Proforma in reguläre Rechnung umwandeln
                    </button>
                    {editing ? <p className="mt-2 text-xs leading-5 text-stone-500">Bitte schließen Sie zuerst die Bearbeitung ab.</p> : null}
                  </div>
                ) : null}
              </section>
            </fieldset>

            {data.readOnly ? (
            <div className="mt-4 space-y-3 text-sm leading-6 text-stone-600" role="status">
              <p>{["SYNC_BLOCKED", "MANUAL_REVIEW"].includes(String(billing.status))
                ? "Erstellung oder Versand benötigen eine Prüfung durch NEONTRIP. Bitte kontaktieren Sie support@neontrip.de. Die bestätigten Daten bleiben gesperrt."
                : invoiceDocument?.status === "SENT"
                ? "Ihre Rechnung wurde per E-Mail versendet. Sie können das PDF auch unter Dokumente öffnen."
                : billing.final_invoice_at
                  ? "Ihre Rechnung wurde erstellt. Der Versand per E-Mail wird vorbereitet."
                  : "Ihre Rechnung wurde angefordert und wird erstellt. Anschließend wird sie automatisch per E-Mail versendet."}</p>
              <p>Pro-forma und Rechnungsdaten sind für Änderungen gesperrt.</p>
              {invoiceRequested && invoiceDocument?.status !== "SENT" ? (
                <button type="button" onClick={() => void load()} className="rounded-xl border border-stone-300 bg-white px-4 py-2 font-semibold text-stone-800">Status aktualisieren</button>
              ) : null}
            </div>
            ) : null}
            {invoiceMessage ? <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{invoiceMessage}</p> : null}

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

          <aside className="min-w-0 rounded-[24px] border border-[#ded8d0] bg-white p-5 shadow-[0_14px_44px_rgba(20,16,12,0.06)] lg:sticky lg:top-6">
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
            <span className="text-xs text-stone-400">{documents.length} verfügbar</span>
          </div>
          <div className="mt-2 divide-y divide-stone-200">
            {documents.length ? documents.map((document) => (
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

        <dialog ref={invoiceDialogRef} aria-labelledby="invoice-review-title" aria-describedby="invoice-review-description" onClose={() => setInvoiceConfirmed(false)} onCancel={(event) => { if (invoiceInFlight.current) event.preventDefault(); }} className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto overscroll-contain rounded-[24px] border border-[#ded8d0] bg-[#fffdf9] p-0 text-[#171412] shadow-2xl backdrop:bg-stone-950/50">
          <div className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b91c73]">{billing.shopify_order_name}</p>
                <h2 id="invoice-review-title" className="mt-2 text-xl font-semibold sm:text-2xl">Reguläre Rechnung erstellen</h2>
              </div>
              <button type="button" autoFocus aria-label="Popup schließen" disabled={requestingInvoice} onClick={() => invoiceDialogRef.current?.close()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 hover:text-stone-950 disabled:opacity-50"><X className="h-5 w-5" /></button>
            </div>
            <p id="invoice-review-description" className="mt-3 text-sm leading-6 text-stone-600">Bitte prüfen Sie Ihre gespeicherten Rechnungsdaten. Nach Ihrer Bestätigung erstellen wir aus der Proforma eine reguläre Rechnung und senden sie per E-Mail. Ihr Zahlungsziel bleibt bestehen.</p>

            <div className="mt-5 grid gap-4 rounded-2xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <h3 className="font-semibold">Rechnungsanschrift</h3>
                <address className="mt-2 break-words not-italic leading-6 text-stone-600">
                  {invoiceReviewForm.company ? <div>{invoiceReviewForm.company}</div> : null}
                  {[invoiceReviewForm.billingFirstName, invoiceReviewForm.billingLastName].filter(Boolean).length ? <div>{[invoiceReviewForm.billingFirstName, invoiceReviewForm.billingLastName].filter(Boolean).join(" ")}</div> : null}
                  <div>{invoiceReviewForm.street}</div>
                  <div>{[invoiceReviewForm.zip, invoiceReviewForm.city].filter(Boolean).join(" ")}</div>
                  <div>{countryLabel(invoiceReviewForm.country)}</div>
                </address>
              </div>
              <dl className="min-w-0 space-y-3">
                <div><dt className="font-semibold">Rechnungs-E-Mail</dt><dd className="mt-2 break-all text-stone-600">{invoiceReviewForm.invoiceEmail || "Nicht hinterlegt"}</dd></div>
                {invoiceReviewForm.projectNumber ? <div><dt className="font-semibold">Projektnummer</dt><dd className="mt-1 break-words text-stone-600">{invoiceReviewForm.projectNumber}</dd></div> : null}
                {invoiceReviewForm.vatId ? <div><dt className="font-semibold">Umsatzsteuer-ID</dt><dd className="mt-1 break-words text-stone-600">{invoiceReviewForm.vatId}</dd></div> : null}
              </dl>
              <div className="border-t border-stone-200 pt-3 sm:col-span-2">
                <h3 className="font-semibold">Positionen</h3>
                <ul className="mt-2 space-y-1 text-stone-600">{(Array.isArray(billing.line_items) ? billing.line_items : []).map((item: Record<string, any>, index: number) => <li key={index} className="break-words">{Number(item.normalizedQuantity || item.quantity || 1)} × {String(item.title || "Position")}</li>)}</ul>
                <div className="mt-3 flex justify-between gap-4 border-t border-stone-200 pt-3 font-semibold"><span>Gesamtbetrag</span><span>{money(Number(billing.total_gross_cents), currency)}</span></div>
                {currentProforma ? <a href={"/api/rechnung/" + encodeURIComponent(token) + "/documents/" + encodeURIComponent(String(currentProforma.id))} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[#b91c73] underline underline-offset-4"><FileText className="h-4 w-4" />Aktuelle Pro-forma prüfen</a> : null}
              </div>
            </div>

            {invoiceBlocked && !requestingInvoice ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{pendingChange
              ? "Eine Änderung wird noch geprüft. Hier sehen Sie die bisher gespeicherten Daten. Die Rechnung kann erst nach Abschluss der Prüfung und Aktualisierung der Pro-forma erstellt werden."
              : "Die aktuelle Pro-forma und alle Prüfungen müssen zuerst abgeschlossen sein. Bitte aktualisieren Sie den Status in Kürze."}</p> : null}
            <label className={"mt-4 flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6 " + (invoiceBlocked ? "text-stone-500" : "cursor-pointer text-stone-800")}>
              <input type="checkbox" checked={invoiceConfirmed} disabled={invoiceBlocked} onChange={(event) => setInvoiceConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#b91c73] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b91c73]" />
              <span>{INVOICE_CONSENT_TEXT}</span>
            </label>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" disabled={requestingInvoice} onClick={() => invoiceDialogRef.current?.close()} className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 disabled:opacity-50">Abbrechen</button>
              <button type="button" onClick={() => void requestInvoice()} disabled={!invoiceConfirmed || invoiceBlocked} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#b91c73] disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500">
                <ReceiptText className="h-4 w-4 shrink-0" />{requestingInvoice ? "Rechnung wird angefordert …" : "Jetzt reguläre Rechnung erstellen"}
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-stone-500">Erstellung und Versand dauern in der Regel wenige Minuten. Danach sind Proforma und Rechnungsdaten über dieses Portal nicht mehr änderbar.</p>
          </div>
        </dialog>

        <footer className="px-2 pb-4 text-center text-xs leading-5 text-stone-400">Der Zugriff ist auf diesen Auftrag begrenzt. Die Bestellnummer ist ausschließlich innerhalb dieses geschützten Portals sichtbar.</footer>
      </div>
    </main>
  );
}
