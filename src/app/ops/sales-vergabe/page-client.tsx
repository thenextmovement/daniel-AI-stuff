"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  ExternalLink,
  Factory,
  Mail,
  RefreshCcw,
  Search,
  ShoppingCart,
} from "lucide-react";
import type {
  SupplierSale,
  SupplierSaleBoard,
  SupplierSalePaymentDecision,
  SupplierSaleSupplier,
} from "@/lib/ops/supplier-sales";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../ops-design";

type SupplierSalesApiResponse = {
  ok: boolean;
  board?: SupplierSaleBoard;
  sale?: SupplierSale;
  liveCheck?: SupplierSalesLiveCheck;
  deadlineTasks?: {
    checked: number;
    created: number;
    skipped: number;
    failed: number;
    taskIds: string[];
    errors: Array<{ saleId: string; error: string }>;
  };
  assignmentTaskCleanup?: {
    archivedDedicatedTasks: number;
    closedFallbackTasks: number;
    clearedSales: number;
  };
  noPaymentReminderTag?: {
    status: string;
    tagValue: string | null;
    error: string | null;
  };
  completedOffersSync?: {
    status: "synced" | "skipped" | "failed";
    checked: number;
    upserted: number;
    failed: number;
    errors: Array<{ offerId: string | null; error: string }>;
    warnings: string[];
  };
  warnings?: string[];
  error?: string;
  issues?: string[];
};

type SupplierSalesLiveCheck = {
  status: "ok" | "warning" | "failed" | "skipped";
  checkedAt: string;
  offersFeed: {
    configured: boolean;
    checked: number;
    failed: number;
    warnings: string[];
    errors: Array<{ offerId: string | null; error: string }>;
  };
  latestCompletedOffers: Array<{
    offerId: string | null;
    offerNumber: string | null;
    documentReference: string | null;
    status: string | null;
    acceptedAt: string | null;
    updatedAt: string | null;
    inVergabe: boolean;
    supplierSale: {
      saleId: string;
      source: string;
      createdAt: string;
      updatedAt: string;
      assignmentStatus: string;
      shopifyTagSyncStatus: string;
      shopifyOrderName: string | null;
    } | null;
  }>;
  latestVergabeSales: Array<{
    saleId: string;
    offerId: string | null;
    offerNumber: string | null;
    documentReference: string | null;
    source: string;
    createdAt: string;
    updatedAt: string;
    assignmentStatus: string;
    shopifyTagSyncStatus: string;
    shopifyOrderName: string | null;
  }>;
  missingOfferIds: string[];
  sortCheck: {
    order: "created_at.desc,updated_at.desc";
    latestCompletedOfferId: string | null;
    newestVergabeOfferId: string | null;
    latestCompletedOfferInTopVergabe: boolean | null;
  };
};

type ScopeFilter = "active" | "ready" | "payment" | "assigned" | "deadline" | "sync" | "all";
type SupplierFilter = "all" | "quentin" | "said" | "special" | "manual_review";
type PaymentFilter = "all" | "paid" | "unpaid" | "pending" | "authorized" | "partially_paid" | "unknown";

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Keine Deadline";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Keine Deadline";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number | null, currency: string) {
  if (value === null) return "-";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function paymentLabel(status: string) {
  const labels: Record<string, string> = {
    paid: "bezahlt",
    pending: "offen",
    authorized: "autorisiert",
    partially_paid: "teilbezahlt",
    refunded: "erstattet",
    partially_refunded: "teilerstattet",
    voided: "storniert",
    expired: "abgelaufen",
    unknown: "unklar",
  };
  return labels[status] || status;
}

function decisionLabel(status: string) {
  const labels: Record<string, string> = {
    paid_confirmed: "Zahlung bestaetigt",
    manual_approved_unpaid: "unbezahlt freigegeben",
    wait_for_payment: "wartet auf Zahlung",
    pending: "Entscheidung offen",
    refunded: "erstattet",
    canceled: "storniert",
  };
  return labels[status] || status;
}

function supplierLabel(value: string | null | undefined, special?: string | null) {
  if (value === "quentin") return "Quentin";
  if (value === "said") return "Saeid";
  if (value === "special") return special || "Sonder-Supplier";
  if (value === "manual_review") return "Pruefen";
  return "Unklar";
}

function paymentTone(sale: SupplierSale) {
  if (sale.paymentDecisionStatus === "manual_approved_unpaid") return "border-amber-200 bg-amber-50 text-amber-900";
  if (sale.shopifyPaymentStatus === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (sale.assignmentStatus === "payment_open") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function supplierTone(sale: SupplierSale) {
  if (sale.recommendedSupplier === "quentin") return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900";
  if (sale.recommendedSupplier === "said") return "border-sky-200 bg-sky-50 text-sky-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function statusTone(sale: SupplierSale) {
  if (sale.assignmentStatus === "assigned" || sale.assignmentStatus === "in_production") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (sale.assignmentStatus === "ready_to_assign") return "border-sky-200 bg-sky-50 text-sky-900";
  if (sale.assignmentStatus === "payment_open") return "border-amber-200 bg-amber-50 text-amber-900";
  if (sale.assignmentStatus === "canceled" || sale.assignmentStatus === "blocked") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function syncSummary(sale: SupplierSale) {
  const parts = [
    `Shopify ${sale.shopifyTagSyncStatus}`,
    `Trello ${sale.trelloProjectionStatus}`,
    `Aufgabe ${sale.taskSyncStatus}`,
  ];
  return parts.join(" · ");
}

function diagnosticTone(status: string) {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "missing") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function liveCheckTone(status: string) {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function confirmAction(message: string) {
  if (typeof window === "undefined") return true;
  return window.confirm(message);
}

function assignmentMessage(sale: SupplierSale | undefined) {
  if (!sale) return "Vergabe gespeichert. Sync-Status wurde aktualisiert.";
  const syncStatuses = [sale.shopifyTagSyncStatus, sale.trelloProjectionStatus, sale.taskSyncStatus];
  if (syncStatuses.includes("failed")) return "Vergabe gespeichert, aber mindestens ein Sync ist fehlgeschlagen. Bitte Sync-Status pruefen.";
  if (syncStatuses.includes("pending")) return "Vergabe gespeichert. Mindestens ein Sync ist noch offen.";
  return "Vergabe gespeichert. Sync-Status wurde aktualisiert.";
}

function actionMessage(action: unknown, payload: SupplierSalesApiResponse | null) {
  if (action === "assign_supplier") return assignmentMessage(payload?.sale);
  if (action === "retry_shopify_tag") {
    if (payload?.sale?.shopifyTagSyncStatus === "synced") return "Shopify-Tag wurde gesetzt.";
    return "Shopify-Tag erneut geprueft. Bitte Sync-Status pruefen.";
  }
  if (action === "update_payment_decision") return "Zahlungsentscheidung gespeichert.";
  if (action === "request_payment_reminder") return "Zahlungserinnerung verarbeitet. Bitte Status pruefen, falls kein Versand bestaetigt ist.";
  if (action === "apply_no_payment_reminder_tag") {
    const tag = payload?.noPaymentReminderTag;
    if (tag?.status === "synced") return "Shopify-Tag Keine Zahlungserinnerung n8n wurde gesetzt.";
    return `Shopify-Tag Keine Zahlungserinnerung n8n nicht gesetzt: ${tag?.error || "Bitte Sync-Status pruefen."}`;
  }
  if (action === "sync_completed_offers") {
    const sync = payload?.completedOffersSync;
    if (!sync) return "Completed Offers wurden geprueft.";
    if (sync.status === "skipped") return "Completed-Offers-Sync uebersprungen: Konfiguration fehlt.";
    if (sync.failed) return `Completed-Offers-Sync mit Fehlern: ${sync.upserted} importiert, ${sync.failed} Fehler.`;
    return `Completed-Offers-Sync: ${sync.upserted} von ${sync.checked} Angeboten importiert/aktualisiert.`;
  }
  if (action === "create_deadline_tasks") {
    const tasks = payload?.deadlineTasks;
    if (!tasks) return "Deadline-Aufgaben wurden geprueft.";
    return `Deadline-Aufgaben geprueft: ${tasks.created} neu, ${tasks.skipped} bereits erledigt/uebersprungen, ${tasks.failed} Fehler.`;
  }
  if (action === "cleanup_supplier_assignment_tasks") {
    const cleanup = payload?.assignmentTaskCleanup;
    if (!cleanup) return "Vergabe-Aufgaben wurden bereinigt.";
    return `Vergabe-Aufgaben bereinigt: ${cleanup.archivedDedicatedTasks + cleanup.closedFallbackTasks} Aufgaben entfernt, ${cleanup.clearedSales} Sales geloest.`;
  }
  return "Sale wurde aktualisiert.";
}

function StatFilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block rounded-[18px] text-left transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-stone-950/30 ${active ? "ring-2 ring-stone-950/25" : ""}`}
    >
      {children}
    </button>
  );
}

function defaultSupplier(sale: SupplierSale): SupplierSaleSupplier {
  if (sale.assignedSupplier) return sale.assignedSupplier;
  if (sale.recommendedSupplier === "quentin") return "quentin";
  if (sale.recommendedSupplier === "said") return "said";
  return "said";
}

function defaultPaymentDecision(sale: SupplierSale): SupplierSalePaymentDecision {
  if (sale.shopifyPaymentStatus === "paid") return "paid_confirmed";
  if (sale.paymentDecisionStatus === "manual_approved_unpaid") return "manual_approved_unpaid";
  return "manual_approved_unpaid";
}

function QuickLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-[0.5rem] border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function LiveCheckPanel({ liveCheck }: { liveCheck: SupplierSalesLiveCheck | null }) {
  if (!liveCheck) return null;
  const matched = liveCheck.latestCompletedOffers.filter((entry) => entry.inVergabe).length;
  const sortOk = liveCheck.sortCheck.latestCompletedOfferInTopVergabe;
  return (
    <section className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-950">Live-Abgleich Angebote {"->"} Sales-Vergabe</p>
          <p className="mt-1 text-sm text-stone-500">
            Geprueft {formatDateTime(liveCheck.checkedAt)} · {matched}/{liveCheck.latestCompletedOffers.length} neueste Completed Offers in der Vergabe gefunden.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${liveCheckTone(liveCheck.status)}`}>
          {liveCheck.status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[0.5rem] border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase text-stone-500">Offers Feed</p>
          <p className="mt-2 text-2xl font-semibold text-stone-950">{liveCheck.offersFeed.checked}</p>
          <p className="text-xs text-stone-500">{liveCheck.offersFeed.configured ? "konfiguriert" : "nicht konfiguriert"}</p>
        </div>
        <div className="rounded-[0.5rem] border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase text-stone-500">Fehlend</p>
          <p className="mt-2 text-2xl font-semibold text-stone-950">{liveCheck.missingOfferIds.length}</p>
          <p className="text-xs text-stone-500">Completed Offers ohne Vergabe-Sale</p>
        </div>
        <div className="rounded-[0.5rem] border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase text-stone-500">Sortierung</p>
          <p className="mt-2 text-sm font-semibold text-stone-950">{sortOk === null ? "Keine Offers" : sortOk ? "Neuester Offer ist oben sichtbar" : "Neuester Offer fehlt oben"}</p>
          <p className="text-xs text-stone-500">{liveCheck.sortCheck.order}</p>
        </div>
      </div>

      {liveCheck.offersFeed.errors.length || liveCheck.offersFeed.warnings.length ? (
        <div className="mt-4 rounded-[0.5rem] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {[...liveCheck.offersFeed.errors.map((entry) => entry.error), ...liveCheck.offersFeed.warnings].slice(0, 3).join(" ")}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-stone-500">
            <tr>
              <th className="py-2 pr-4">Completed Offer</th>
              <th className="py-2 pr-4">Accepted</th>
              <th className="py-2 pr-4">Vergabe</th>
              <th className="py-2 pr-4">Sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {liveCheck.latestCompletedOffers.map((entry) => (
              <tr key={entry.offerId || `${entry.documentReference}-${entry.acceptedAt}`}>
                <td className="py-2 pr-4">
                  <div className="font-medium text-stone-950">{entry.documentReference || entry.offerNumber || entry.offerId || "Offer"}</div>
                  <div className="text-xs text-stone-500">{entry.status || "completed"}</div>
                </td>
                <td className="py-2 pr-4 text-stone-600">{formatDateTime(entry.acceptedAt || entry.updatedAt)}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${entry.inVergabe ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                    {entry.inVergabe ? "gefunden" : "fehlt"}
                  </span>
                </td>
                <td className="py-2 pr-4 text-stone-600">
                  {entry.supplierSale ? `${entry.supplierSale.assignmentStatus} · Shopify ${entry.supplierSale.shopifyTagSyncStatus}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SaleCard({
  sale,
  operatorName,
  onAction,
  saving,
}: {
  sale: SupplierSale;
  operatorName: string;
  saving: boolean;
  onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [supplier, setSupplier] = useState<SupplierSaleSupplier>(defaultSupplier(sale));
  const [specialSupplierName, setSpecialSupplierName] = useState(sale.specialSupplierName || "");
  const [deliveryDate, setDeliveryDate] = useState(sale.supplierDueDate || sale.customerDueDate || "");
  const [paymentDecision, setPaymentDecision] = useState<SupplierSalePaymentDecision>(defaultPaymentDecision(sale));
  const [assignmentNote, setAssignmentNote] = useState("");
  const [reminderLink, setReminderLink] = useState(sale.paymentLink || sale.shopifyOrderUrl || "");

  useEffect(() => {
    setSupplier(defaultSupplier(sale));
    setSpecialSupplierName(sale.specialSupplierName || "");
    setDeliveryDate(sale.supplierDueDate || sale.customerDueDate || "");
    setPaymentDecision(defaultPaymentDecision(sale));
    setReminderLink(sale.paymentLink || sale.shopifyOrderUrl || "");
  }, [sale.id, sale.assignedSupplier, sale.recommendedSupplier, sale.supplierDueDate, sale.customerDueDate, sale.shopifyPaymentStatus, sale.paymentDecisionStatus, sale.paymentLink, sale.shopifyOrderUrl]);

  const isOverdue = sale.supplierDueDate && sale.supplierDueDate < todayDate() && !["completed", "canceled"].includes(sale.assignmentStatus);
  const needsManualPaymentRelease = sale.shopifyPaymentStatus !== "paid";
  const canRetryShopifyTag = sale.assignmentStatus === "assigned" && sale.shopifyTagSyncStatus !== "synced";

  return (
    <article className="rounded-[0.5rem] border border-stone-200 bg-white p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[7rem_minmax(0,1fr)_minmax(20rem,0.78fr)]">
        <div className="h-28 overflow-hidden rounded-[0.5rem] border border-stone-200 bg-stone-100">
          {sale.primaryImageUrl ? (
            <img src={sale.primaryImageUrl} alt={sale.productSummary || "Produktbild"} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-stone-400">
              <ShoppingCart className="h-7 w-7" />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentTone(sale)}`}>
              {paymentLabel(sale.shopifyPaymentStatus)}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${supplierTone(sale)}`}>
              Empfehlung: {supplierLabel(sale.recommendedSupplier)}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(sale)}`}>
              {sale.assignmentStatus}
            </span>
            {isOverdue ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                ueberfaellig
              </span>
            ) : null}
          </div>

          <h2 className="mt-3 truncate text-xl font-semibold text-stone-950">
            {sale.shopifyOrderName || sale.offerNumber || sale.documentReference || sale.customerName || sale.saleKey}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {sale.customerName || "Kunde ohne Namen"} · {sale.customerEmail || "keine E-Mail"} · {formatMoney(sale.totalPrice, sale.currency)}
          </p>
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-600">
            {sale.productSummary || sale.items.map((item) => item.title).join(", ") || "Keine Produktzusammenfassung"}
          </p>

          <div className="mt-4 grid gap-2 text-xs text-stone-500 sm:grid-cols-2">
            <div className="inline-flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-stone-400" />
              Kunde braucht es bis {formatDate(sale.customerDueDate)}
            </div>
            <div className="inline-flex items-center gap-2">
              <Factory className="h-4 w-4 text-stone-400" />
              {sale.assignedSupplier ? `vergeben an ${supplierLabel(sale.assignedSupplier, sale.specialSupplierName)}` : "noch nicht vergeben"}
            </div>
            <div className="inline-flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-stone-400" />
              {decisionLabel(sale.paymentDecisionStatus)}
            </div>
            <div className="inline-flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-stone-400" />
              {syncSummary(sale)}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <QuickLink href={sale.offerPublicUrl} label="Angebot" />
            <QuickLink href={sale.finalPdfUrl} label="Snapshot" />
            <QuickLink href={`/api/ops/supplier-sales?action=order_confirmation_pdf&saleId=${encodeURIComponent(sale.id)}`} label="AB-PDF" />
            <QuickLink href={sale.shopifyOrderUrl} label="Shopify" />
            <QuickLink href={sale.paymentLink} label="Bezahlen" />
            <QuickLink href={sale.supplierTrelloCardUrl} label="Supplier-Karte" />
            {sale.requestId ? <QuickLink href={`/ops/customer-records?query=${encodeURIComponent(sale.requestId)}`} label="Kundenakte" /> : null}
          </div>
        </div>

        <div className="min-w-0 rounded-[0.5rem] border border-stone-200 bg-stone-50 p-3">
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-stone-600">Wann soll geliefert werden?</span>
              <input
                type="date"
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                aria-label="Lieferdatum"
                className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm"
              />
            </label>

            <label className="grid min-w-0 gap-1.5">
              <span className="text-xs font-medium text-stone-600">Supplier</span>
              <select value={supplier} onChange={(event) => setSupplier(event.target.value as SupplierSaleSupplier)} aria-label="Supplier auswaehlen" className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm">
                <option value="quentin">Quentin</option>
                <option value="said">Saeid</option>
                <option value="special">Sonder</option>
              </select>
            </label>

            {supplier === "special" ? (
              <input
                value={specialSupplierName}
                onChange={(event) => setSpecialSupplierName(event.target.value)}
                aria-label="Name Sonder-Supplier"
                className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm"
                placeholder="Name Sonder-Supplier"
              />
            ) : null}

            {needsManualPaymentRelease ? (
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-stone-600">Zahlungsentscheidung</span>
                <select value={paymentDecision} onChange={(event) => setPaymentDecision(event.target.value as SupplierSalePaymentDecision)} aria-label="Zahlungsentscheidung" className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm">
                  <option value="manual_approved_unpaid">Trotz offener Zahlung vergeben</option>
                  <option value="wait_for_payment">Auf Zahlung warten</option>
                </select>
              </label>
            ) : null}

            <textarea
              value={assignmentNote}
              onChange={(event) => setAssignmentNote(event.target.value)}
              aria-label="Notiz fuer Vergabe"
              className="min-h-16 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm"
              placeholder="Notiz fuer Vergabe"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || !deliveryDate || (needsManualPaymentRelease && paymentDecision === "wait_for_payment")}
                onClick={() => {
                  const selectedSupplier = supplierLabel(supplier, specialSupplierName);
                  const confirmationMessage =
                    needsManualPaymentRelease && paymentDecision === "manual_approved_unpaid"
                      ? `Diese Sale ist noch nicht bezahlt. Trotzdem an ${selectedSupplier} vergeben und interne Syncs ausloesen?`
                      : `Sale an ${selectedSupplier} vergeben und Shopify/Trello/Aufgabe synchronisieren?`;
                  if (!confirmAction(confirmationMessage)) return;
                  void onAction({
                    action: "assign_supplier",
                    saleId: sale.id,
                    supplier,
                    requestedDeliveryDate: deliveryDate,
                    specialSupplierName,
                    assignmentNote,
                    paymentDecisionStatus: needsManualPaymentRelease ? paymentDecision : "paid_confirmed",
                    operatorName,
                  });
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                <BadgeCheck className="h-4 w-4" />
                Vergeben
              </button>
              {canRetryShopifyTag ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (!confirmAction("Shopify-Tag fuer diese vergebene Sale erneut suchen und setzen?")) return;
                    void onAction({
                      action: "retry_shopify_tag",
                      saleId: sale.id,
                      operatorName,
                    });
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Shopify erneut
                </button>
              ) : null}
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (!confirmAction("Shopify-Tag 'Keine Zahlungserinnerung n8n' setzen, damit n8n keine Zahlungserinnerung sendet?")) return;
                  void onAction({
                    action: "apply_no_payment_reminder_tag",
                    saleId: sale.id,
                    operatorName,
                  });
                }}
                className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700"
              >
                <Mail className="h-4 w-4" />
                N8N-Mail stoppen
              </button>
              {needsManualPaymentRelease ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (!confirmAction("Sale auf Zahlung warten setzen und Vergabe vorerst stoppen?")) return;
                    void onAction({
                      action: "update_payment_decision",
                      saleId: sale.id,
                      paymentDecisionStatus: "wait_for_payment",
                      operatorName,
                    });
                  }}
                  className="rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700"
                >
                  Warten
                </button>
              ) : null}
            </div>

            {needsManualPaymentRelease ? (
              <div className="grid gap-2 border-t border-stone-200 pt-3">
                <input
                  value={reminderLink}
                  onChange={(event) => setReminderLink(event.target.value)}
                  aria-label="Bezahl-Link fuer Erinnerung"
                  className="h-9 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-xs"
                  placeholder="Bezahl-Link"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const recipient = sale.customerEmail ? `an ${sale.customerEmail}` : "ohne Kunden-E-Mail";
                    if (!confirmAction(`Zahlungserinnerung ${recipient} verarbeiten?`)) return;
                    void onAction({
                      action: "request_payment_reminder",
                      saleId: sale.id,
                      recipientEmail: sale.customerEmail,
                      paymentLink: reminderLink,
                      operatorName,
                    });
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
                >
                  <Mail className="h-4 w-4" />
                  Erinnerung
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function SupplierSalesClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-supplier-sales-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [board, setBoard] = useState<SupplierSaleBoard | null>(null);
  const [scope, setScope] = useState<ScopeFilter>("active");
  const [supplier, setSupplier] = useState<SupplierFilter>("all");
  const [payment, setPayment] = useState<PaymentFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingSaleId, setSavingSaleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [liveCheck, setLiveCheck] = useState<SupplierSalesLiveCheck | null>(null);
  const canRunDeadlineTasks = Boolean(board) && !loading && savingSaleId !== "deadline-tasks";
  const canCleanupAssignmentTasks = Boolean(board) && !loading && savingSaleId !== "assignment-task-cleanup";

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
    if (hasSession || localMode) void loadBoard();
  }, [hasSession, localMode, scope, supplier, payment]);

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

  async function syncCompletedOffers() {
    const syncResponse = await fetch("/api/ops/supplier-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_completed_offers", limit: 50, operatorName }),
    });
    const syncPayload = (await syncResponse.json().catch(() => null)) as SupplierSalesApiResponse | null;
    if (!syncResponse.ok || !syncPayload?.ok) {
      return { message: null, warning: `Completed-Offers-Sync fehlgeschlagen: ${formatApiError(syncPayload)}` };
    }
    const sync = syncPayload.completedOffersSync;
    if (sync?.status === "failed") {
      return { message: null, warning: `Completed-Offers-Sync fehlgeschlagen: ${sync.errors[0]?.error || "unbekannter Fehler"}` };
    }
    if (sync?.status === "skipped") {
      return { message: null, warning: sync.warnings[0] || "Completed-Offers-Sync uebersprungen." };
    }
    if (sync && sync.upserted > 0) {
      return { message: `Completed-Offers-Sync: ${sync.upserted} Angebote importiert/aktualisiert.`, warning: null };
    }
    return { message: "Completed-Offers-Sync: keine neuen Angebote.", warning: null };
  }

  async function loadBoard(options?: { syncCompletedOffers?: boolean }) {
    setLoading(true);
    setError(null);
    let nextMessage: string | null = null;
    let nextError: string | null = null;
    try {
      if (options?.syncCompletedOffers) {
        const syncResult = await syncCompletedOffers();
        nextMessage = syncResult.message;
        nextError = syncResult.warning;
      }

      const params = new URLSearchParams();
      params.set("scope", scope);
      params.set("supplier", supplier);
      params.set("payment", payment);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/ops/supplier-sales?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as SupplierSalesApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.board) throw new Error(formatApiError(payload));
      setBoard(payload.board);
      setMessage(nextMessage);
      setError(nextError);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Sales-Vergabe konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function runSaleAction(saleId: string, body: Record<string, unknown>) {
    setSavingSaleId(saleId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/supplier-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, operatorName }),
      });
      const payload = (await response.json().catch(() => null)) as SupplierSalesApiResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));
      if (payload.board) setBoard(payload.board);
      setMessage(actionMessage(body.action, payload));
      if (body.action === "assign_supplier") setScope("assigned");
      if (body.action === "retry_shopify_tag") setScope("sync");
      if (body.action === "create_deadline_tasks") setScope("deadline");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
    } finally {
      setSavingSaleId(null);
    }
  }

  async function runLiveCheck() {
    setSavingSaleId("live-check");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/supplier-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diagnose_sales_flow", limit: 10, operatorName }),
      });
      const payload = (await response.json().catch(() => null)) as SupplierSalesApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.liveCheck) throw new Error(formatApiError(payload));
      setLiveCheck(payload.liveCheck);
      if (payload.board) setBoard(payload.board);
      const missing = payload.liveCheck.missingOfferIds.length;
      setMessage(missing ? `Live-Abgleich: ${missing} neueste Completed Offers fehlen in der Vergabe.` : "Live-Abgleich: neueste Completed Offers sind in der Vergabe vorhanden.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Live-Abgleich fehlgeschlagen.");
    } finally {
      setSavingSaleId(null);
    }
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Sales-Vergabe"
        title="Sales-Vergabe anmelden"
        description="Melde dich fuer die interne Vergabeuebersicht an. Supplier-Entscheidungen, Zahlungsausnahmen und Sync-Fehler bleiben protokolliert."
        activeApp="supplierSales"
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
        <OpsPageHeader active="supplierSales" label="Sales-Vergabe" />

        <OpsPageIntro
          eyebrow="Shopify Sales"
          title="Bezahlstatus, Deadline und Supplier an einem Ort."
          description="Sales werden aus Shopify oder dem abgeschlossenen Angebot erfasst, mit Quentin/Saeid-Regeln bewertet und erst nach bestaetigtem Lieferdatum vergeben."
        />

        <section className="flex flex-wrap items-center gap-3 rounded-[0.5rem] border border-stone-200 bg-white p-4">
          <button
            type="button"
            disabled={!canCleanupAssignmentTasks}
            onClick={() => {
              if (!confirmAction("Alle automatisch erzeugten Sales-Vergabe-Aufgaben archivieren und die Task-Verknuepfung an den Sales entfernen?")) return;
              void runSaleAction("assignment-task-cleanup", { action: "cleanup_supplier_assignment_tasks", operatorName });
            }}
            className="inline-flex items-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            <ClipboardList className="h-4 w-4" />
            Vergabe-Aufgaben bereinigen
          </button>
          {savingSaleId === "assignment-task-cleanup" ? <span className="text-sm text-stone-500">Bereinigung laeuft...</span> : null}
        </section>

        <section className="grid gap-3 md:grid-cols-5">
          <StatFilterButton active={scope === "ready"} onClick={() => setScope("ready")}>
            <OpsStatCard label="Bereit" value={board?.counts.readyToAssign || 0} tone="info" icon={<BadgeCheck className="h-5 w-5" />} detail="Bezahlt oder freigegeben." />
          </StatFilterButton>
          <StatFilterButton active={scope === "payment"} onClick={() => setScope("payment")}>
            <OpsStatCard label="Zahlung" value={board?.counts.paymentOpen || 0} tone="warning" icon={<CreditCard className="h-5 w-5" />} detail="Offen oder Entscheidung fehlt." />
          </StatFilterButton>
          <StatFilterButton active={scope === "assigned"} onClick={() => setScope("assigned")}>
            <OpsStatCard label="Vergeben" value={board?.counts.assigned || 0} tone="success" icon={<Factory className="h-5 w-5" />} detail="Supplier gesetzt." />
          </StatFilterButton>
          <StatFilterButton active={scope === "deadline"} onClick={() => setScope("deadline")}>
            <OpsStatCard label="Deadline" value={(board?.counts.dueSoon || 0) + (board?.counts.overdue || 0)} tone="info" icon={<CalendarClock className="h-5 w-5" />} detail="In 7 Tagen faellig oder ueberfaellig." />
          </StatFilterButton>
          <StatFilterButton active={scope === "sync"} onClick={() => setScope("sync")}>
            <OpsStatCard label="Sync" value={board?.counts.syncIssues || 0} tone="danger" icon={<AlertTriangle className="h-5 w-5" />} detail="Shopify/Trello/Aufgabe fehlerhaft." />
          </StatFilterButton>
        </section>

        {board?.diagnostics?.items?.length ? (
          <section className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-stone-950">Integrationen</p>
                <p className="mt-1 text-sm text-stone-500">
                  {board.diagnostics.ready ? "Automatischer Import und Pflicht-Syncs sind konfiguriert." : "Es fehlen noch Pflichtwerte fuer den Go-live."}
                </p>
              </div>
              {!board.diagnostics.ready ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {board.diagnostics.missing.length} Pflichtpunkt{board.diagnostics.missing.length === 1 ? "" : "e"} offen
                </span>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {board.diagnostics.items.map((item) => (
                <div key={item.key} className={`rounded-[0.5rem] border p-3 ${diagnosticTone(item.status)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{item.label}</p>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold uppercase">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 opacity-90">{item.detail}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_160px_160px_160px_140px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void loadBoard();
                }}
                aria-label="Sales suchen"
                className="w-full rounded-[0.5rem] border border-stone-300 py-2 pl-9 pr-3 text-sm"
                placeholder="Kunde, Shopify, Angebot..."
              />
            </label>
            <select value={scope} onChange={(event) => setScope(event.target.value as ScopeFilter)} aria-label="Bereich filtern" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="active">Aktive Sales</option>
              <option value="ready">Bereit</option>
              <option value="payment">Zahlung offen</option>
              <option value="assigned">Vergeben</option>
              <option value="deadline">Deadline</option>
              <option value="sync">Sync-Fehler</option>
              <option value="all">Alle</option>
            </select>
            <select value={supplier} onChange={(event) => setSupplier(event.target.value as SupplierFilter)} aria-label="Supplier filtern" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="all">Alle Supplier</option>
              <option value="quentin">Quentin</option>
              <option value="said">Saeid</option>
              <option value="special">Sonder</option>
              <option value="manual_review">Pruefen</option>
            </select>
            <select value={payment} onChange={(event) => setPayment(event.target.value as PaymentFilter)} aria-label="Zahlungsstatus filtern" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="all">Alle Zahlungen</option>
              <option value="paid">Bezahlt</option>
              <option value="unpaid">Nicht bezahlt</option>
              <option value="pending">Pending</option>
              <option value="authorized">Autorisiert</option>
              <option value="unknown">Unklar</option>
            </select>
            <button type="button" disabled={loading} onClick={() => void loadBoard({ syncCompletedOffers: true })} className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-stone-300">
              <RefreshCcw className="h-4 w-4" />
              Sync + Laden
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              value={operatorName}
              onChange={(event) => setOperatorName(event.target.value)}
              aria-label="Operator"
              className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm"
              placeholder="Operator"
            />
            <button
              type="button"
              disabled={!canRunDeadlineTasks}
              onClick={() => {
                if (!confirmAction("Deadline-Aufgaben jetzt pruefen und fehlende interne Aufgaben erstellen?")) return;
                void runSaleAction("deadline-tasks", { action: "create_deadline_tasks", operatorName });
              }}
              className="inline-flex items-center gap-2 rounded-[0.5rem] border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <AlertTriangle className="h-4 w-4" />
              Deadline-Aufgaben pruefen
            </button>
            <button
              type="button"
              disabled={loading || savingSaleId === "live-check"}
              onClick={() => void runLiveCheck()}
              className="inline-flex items-center gap-2 rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              Live-Abgleich testen
            </button>
            {loading ? <span className="text-sm text-stone-500">Sales werden geladen...</span> : null}
            {savingSaleId === "live-check" ? <span className="text-sm text-stone-500">Live-Abgleich laeuft...</span> : null}
            {message ? <span className="rounded-[0.5rem] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{message}</span> : null}
            {error ? <span className="rounded-[0.5rem] border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{error}</span> : null}
          </div>
        </section>

        <LiveCheckPanel liveCheck={liveCheck} />

        <section className="grid gap-4">
          {items.length ? (
            items.map((sale) => (
              <SaleCard
                key={sale.id}
                sale={sale}
                operatorName={operatorName}
                saving={savingSaleId === sale.id}
                onAction={(body) => runSaleAction(sale.id, body)}
              />
            ))
          ) : (
            <div className="rounded-[0.5rem] border border-stone-200 bg-white p-8 text-center text-stone-500">
              <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
              <p className="mt-3">Keine Sales in dieser Ansicht.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
