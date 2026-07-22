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
  Timer,
  Zap,
} from "lucide-react";
import {
  supplierSaleCompletionHideAt,
  supplierSaleReadyForProduction,
  supplierSaleShopifyConfirmed,
  supplierSaleTrelloConfirmed,
  supplierSaleVisibleInActiveOverview,
} from "@/lib/ops/supplier-sale-completion";
import {
  type SupplierSale,
  type SupplierSaleBoard,
  type SupplierSalePaymentDecision,
} from "@/lib/ops/supplier-sales";
import { defaultSupplierSelection, shouldSuggestSaeid, type SupplierSelection } from "@/lib/ops/supplier-selection";
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
  orderConfirmationEmail?: {
    status: "sent" | "failed" | "skipped";
    recipientEmail: string | null;
    providerMessageId: string | null;
    error: string | null;
  };
  completedOffersSync?: {
    status: "synced" | "partial" | "skipped" | "failed";
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
type UrgencyFilter = "all" | "rush" | "standard";
type QuickFilter = "all" | "paid_priority" | "prior_paid_customer" | "missing_payment_link" | "sync_issue" | "deadline";

const BOARD_PAGE_SIZE = 50;

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function formatUnknownError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function replaceBoardSale(board: SupplierSaleBoard | null, sale: SupplierSale | undefined) {
  if (!board || !sale) return board;
  return {
    ...board,
    items: board.items.map((item) => (item.id === sale.id ? sale : item)),
  };
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
  if (value === "special") return special || "Weitere Supplier";
  if (value === "manual_review") return "Pruefen";
  return "Unklar";
}

function paymentTone(sale: SupplierSale) {
  if (sale.paymentDecisionStatus === "manual_approved_unpaid") return "border-amber-200 bg-amber-50 text-amber-900";
  if (sale.shopifyPaymentStatus === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (sale.assignmentStatus === "payment_open") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function paidAssignmentPriority(sale: SupplierSale) {
  return (
    sale.shopifyPaymentStatus === "paid" &&
    !sale.assignedSupplier &&
    !["assigned", "in_production", "completed", "canceled"].includes(sale.assignmentStatus)
  );
}

function priorPaidCustomerPriority(sale: SupplierSale) {
  return (
    sale.priorPaidCustomer.hasPriorPaidOrder &&
    sale.shopifyPaymentStatus !== "paid" &&
    sale.paymentDecisionStatus !== "paid_confirmed" &&
    !["assigned", "in_production", "completed", "canceled"].includes(sale.assignmentStatus)
  );
}

function priorPaidCustomerBasisLabel(sale: SupplierSale) {
  if (sale.priorPaidCustomer.matchBasis === "company_domain") return "Firmendomain";
  if (sale.priorPaidCustomer.matchBasis === "customer_name") return "Name";
  if (sale.priorPaidCustomer.matchBasis === "exact_email") return "E-Mail";
  return "Historie";
}

function missingPaymentLinkIssue(sale: SupplierSale) {
  if (sale.shopifyPaymentStatus === "paid") return false;
  if (["assigned", "in_production", "completed", "canceled"].includes(sale.assignmentStatus)) return false;
  return !sale.paymentLink;
}

function paymentLinkLabel(sale: SupplierSale) {
  if (sale.paymentLink) return "Bezahllink vorhanden";
  if (sale.shopifyPaymentStatus === "paid") return "Bezahlt - Link nicht relevant";
  if (sale.shopifyOrderId || sale.shopifyOrderName) return "Shopify verknuepft, Bezahllink fehlt";
  return "Shopify-Match fehlt";
}

function paymentLinkTone(sale: SupplierSale) {
  if (sale.paymentLink) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (sale.shopifyPaymentStatus === "paid") return "border-stone-200 bg-stone-50 text-stone-700";
  return "border-rose-200 bg-rose-50 text-rose-900";
}

function hasSyncIssue(sale: SupplierSale) {
  return [sale.shopifyTagSyncStatus, sale.trelloProjectionStatus, sale.taskSyncStatus].includes("failed");
}

function isDeadlineRelevant(sale: SupplierSale) {
  const dueDate = sale.supplierDueDate || sale.customerDueDate;
  if (!dueDate || ["completed", "canceled"].includes(sale.assignmentStatus)) return false;
  const dueSoon = new Date();
  dueSoon.setUTCDate(dueSoon.getUTCDate() + 7);
  return dueDate <= dueSoon.toISOString().slice(0, 10);
}

function syncHealthLabel(sale: SupplierSale) {
  if (hasSyncIssue(sale)) return "Sync-Fehler";
  if ([sale.shopifyTagSyncStatus, sale.trelloProjectionStatus, sale.taskSyncStatus].includes("pending")) return "Sync laeuft";
  if ([sale.shopifyTagSyncStatus, sale.trelloProjectionStatus].includes("skipped")) return "Teil-Sync uebersprungen";
  return "Sync OK";
}

function syncHealthTone(sale: SupplierSale) {
  if (hasSyncIssue(sale)) return "border-rose-200 bg-rose-50 text-rose-900";
  if ([sale.shopifyTagSyncStatus, sale.trelloProjectionStatus, sale.taskSyncStatus].includes("pending")) return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
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

function assignmentBlockReason(
  sale: SupplierSale,
  supplier: SupplierSelection,
  deliveryDate: string,
  paymentDecision: SupplierSalePaymentDecision,
  specialSupplierName: string,
  shopifySupplierTagConfirmed: boolean,
) {
  if (!supplier) return "Supplier fehlt.";
  if (supplier === "special" && !specialSupplierName.trim()) return "Name des weiteren Suppliers fehlt.";
  if (supplier === "special" && !shopifySupplierTagConfirmed) return "Shopify-Supplier-Tag muss bestaetigt werden.";
  if (!deliveryDate) return "Lieferdatum fehlt.";
  if (sale.shopifyPaymentStatus !== "paid" && paymentDecision === "wait_for_payment") return "Zahlungsentscheidung steht auf Auf Zahlung warten.";
  return null;
}

function formatPostOrderCountdown(ms: number) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatCompletionCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function postOrderRemainingMs(sale: SupplierSale, now: number) {
  const expiresAt = sale.postOrderReview.expiresAt ? new Date(sale.postOrderReview.expiresAt).getTime() : NaN;
  return Number.isFinite(expiresAt) ? Math.max(0, expiresAt - now) : 0;
}

function postOrderReviewBlocksAssignment(sale: SupplierSale) {
  if (sale.postOrderReview.status === "change_requested") return true;
  return false;
}

function postOrderReviewWindowOpen(sale: SupplierSale, now: number) {
  if (sale.postOrderReview.status !== "open") return false;
  return postOrderRemainingMs(sale, now) > 0;
}

function postOrderReviewBadgeLabel(sale: SupplierSale, now: number) {
  if (sale.postOrderReview.status === "change_requested") return "Kunden-Aenderung gemeldet";
  if (postOrderReviewWindowOpen(sale, now)) return `24h Fenster ${formatPostOrderCountdown(postOrderRemainingMs(sale, now))}`;
  if (sale.postOrderReview.status === "closed") return "24h Pruefung abgeschlossen";
  return null;
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

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Anfrage abgebrochen: Sync dauert zu lange. Bitte erneut versuchen oder Live-Abgleich pruefen.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
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
  if (action === "acknowledge_post_order_change") return "Kunden-Aenderung wurde als geprueft markiert. Vergabe ist wieder moeglich.";
  if (action === "retry_shopify_tag") {
    if (payload?.sale?.shopifyTagSyncStatus === "synced") return "Shopify-Tag wurde gesetzt.";
    return "Shopify-Tag erneut geprueft. Bitte Sync-Status pruefen.";
  }
  if (action === "retry_trello_projection") {
    if (payload?.sale?.trelloProjectionStatus === "synced") return "Trello-Karte wurde gefunden und aktualisiert.";
    return "Trello-Karte erneut geprueft. Bitte Sync-Status pruefen.";
  }
  if (action === "mark_in_production") return "Zur Produktion gegeben. Die Karte verschwindet in 10 Minuten aus der aktiven Uebersicht.";
  if (action === "update_payment_decision") return "Zahlungsentscheidung gespeichert.";
  if (action === "request_payment_reminder") return "Zahlungserinnerung verarbeitet. Bitte Status pruefen, falls kein Versand bestaetigt ist.";
  if (action === "send_order_confirmation_email") {
    const email = payload?.orderConfirmationEmail;
    if (email?.status === "sent") return `Auftragsbestaetigung wurde an ${email.recipientEmail || "den Kunden"} gesendet.`;
    if (email?.status === "skipped") return email.error || "Auftragsbestaetigung wurde bereits fuer diesen Stand verarbeitet.";
    return `Auftragsbestaetigung nicht gesendet: ${email?.error || "Bitte Webhook-Konfiguration pruefen."}`;
  }
  if (action === "apply_no_payment_reminder_tag") {
    const tag = payload?.noPaymentReminderTag;
    if (tag?.status === "synced") return "Shopify-Tag Keine Zahlungserinnerung n8n wurde gesetzt.";
    return `Shopify-Tag Keine Zahlungserinnerung n8n nicht gesetzt: ${tag?.error || "Bitte Sync-Status pruefen."}`;
  }
  if (action === "sync_completed_offers") {
    const sync = payload?.completedOffersSync;
    if (!sync) return "Completed Offers wurden geprueft.";
    if (sync.status === "skipped") return "Completed-Offers-Sync uebersprungen: Konfiguration fehlt.";
    if (sync.status === "partial") return `Completed-Offers-Sync teilweise: ${sync.upserted} importiert/aktualisiert, ${sync.failed} Nebenfehler.`;
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
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} anzeigen`}
      aria-pressed={active}
      title={`${label} anzeigen`}
      className={`block w-full cursor-pointer rounded-[0.5rem] text-left transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-stone-950/30 ${active ? "ring-2 ring-stone-950/30" : ""}`}
    >
      {children}
    </button>
  );
}

function QuickFilterButton({
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
      aria-pressed={active}
      className={`inline-flex min-h-9 items-center gap-2 rounded-[0.5rem] border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-stone-950/25 ${
        active
          ? "border-stone-950 bg-stone-950 text-white"
          : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
      }`}
    >
      {children}
    </button>
  );
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

function supplierSalesPdfUrl(saleId: string, action: "snapshot_pdf" | "order_confirmation_pdf") {
  return `/api/ops/supplier-sales?action=${action}&saleId=${encodeURIComponent(saleId)}`;
}

function itemKind(item: SupplierSale["items"][number]) {
  const text = [item.title, item.productType, item.variantTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(liefer|versand|delivery|termin)/.test(text)) return "delivery";
  if (/(zusatz|extra|addon|option|dimmer|rgb|wandmontage|netzteil|kabel|fernbedienung|garantie|kleber|adhesive|hanging set|power plug|radseil|deckenabh)/.test(text)) return "addon";
  return "product";
}

function splitSelectionDetail(detail: string) {
  const [label, ...rest] = detail.split(":");
  const value = rest.join(":").trim();
  return { label: label.trim(), value };
}

function ProductSelectionDetails({ item }: { item: SupplierSale["items"][number] }) {
  const details = item.selectionDetails
    .map((detail) => ({ detail, ...splitSelectionDetail(detail) }))
    .filter(({ value }) => Boolean(value));
  return (
    <>
      {item.description ? (
        <p className="mt-1 text-xs leading-5 text-stone-600">{item.description}</p>
      ) : null}
      {details.length ? (
        <div className="mt-2 grid gap-1 text-xs leading-5 text-stone-800 sm:grid-cols-2">
          {details.map(({ detail, label, value }) => (
            <p key={detail} className="min-w-0 break-words">
              <span className="font-semibold text-stone-950">{label}:</span> {value}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

function SnapshotSelectionGroup({
  title,
  items,
  renderDetails,
}: {
  title: string;
  items: SupplierSale["items"];
  renderDetails: (item: SupplierSale["items"][number]) => ReactNode;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-stone-500">{title}</p>
      <div className="mt-1 divide-y divide-stone-100">
        {items.map((item) => (
          <div key={item.id} className="py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-stone-950">{item.title}</p>
                {item.variantTitle ? <p className="mt-0.5 text-xs text-stone-500">{item.variantTitle}</p> : null}
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.5rem] border border-stone-300 bg-white px-2.5 py-1 text-xs font-black text-stone-950">
                <span className="text-[10px] uppercase tracking-[0.08em] text-stone-500">Menge</span>
                {item.quantity}x
              </span>
            </div>
            {renderDetails(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

function SnapshotSelection({ sale }: { sale: SupplierSale }) {
  const productItems = sale.items.filter((item) => itemKind(item) === "product");
  const addonItems = sale.items.filter((item) => itemKind(item) === "addon");
  const deliveryItems = sale.items.filter((item) => itemKind(item) === "delivery");
  if (!productItems.length && !addonItems.length && !deliveryItems.length) return null;
  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      <p className="text-xs font-semibold uppercase text-stone-500">Kundenauswahl</p>
      <div className="mt-2">
        <SnapshotSelectionGroup
          title="Leuchtschilder"
          items={productItems}
          renderDetails={(item) => <ProductSelectionDetails item={item} />}
        />
        <SnapshotSelectionGroup
          title="Zusatzoptionen"
          items={addonItems}
          renderDetails={(item) => <ProductSelectionDetails item={item} />}
        />
        <SnapshotSelectionGroup
          title="Liefertermin"
          items={deliveryItems}
          renderDetails={() => (
            <p className="mt-1 text-xs leading-5 text-stone-600">
              Gewaehlt: {formatDate(sale.customerDueDate || sale.supplierDueDate)}
            </p>
          )}
        />
      </div>
    </div>
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
          <p className="text-sm font-semibold text-stone-950">Live-Abgleich Angebote {"->"} Produktion</p>
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
  const [supplier, setSupplier] = useState<SupplierSelection>(defaultSupplierSelection(sale));
  const [specialSupplierName, setSpecialSupplierName] = useState(sale.specialSupplierName || "");
  const [shopifySupplierTagConfirmed, setShopifySupplierTagConfirmed] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(sale.supplierDueDate || sale.customerDueDate || "");
  const [paymentDecision, setPaymentDecision] = useState<SupplierSalePaymentDecision>(defaultPaymentDecision(sale));
  const [assignmentNote, setAssignmentNote] = useState("");
  const [reminderLink, setReminderLink] = useState(sale.paymentLink || sale.shopifyOrderUrl || "");
  const [reviewNow, setReviewNow] = useState(() => Date.now());
  const [completionNow, setCompletionNow] = useState(() => Date.now());
  useEffect(() => {
    setSupplier(defaultSupplierSelection(sale));
    setSpecialSupplierName(sale.specialSupplierName || "");
    setShopifySupplierTagConfirmed(false);
    setDeliveryDate(sale.supplierDueDate || sale.customerDueDate || "");
    setPaymentDecision(defaultPaymentDecision(sale));
    setReminderLink(sale.paymentLink || sale.shopifyOrderUrl || "");
  }, [sale.id, sale.assignedSupplier, sale.recommendedSupplier, sale.productSummary, sale.items, sale.supplierDueDate, sale.customerDueDate, sale.shopifyPaymentStatus, sale.paymentDecisionStatus, sale.paymentLink, sale.shopifyOrderUrl]);

  useEffect(() => {
    if (sale.postOrderReview.status !== "open") return;
    const timer = window.setInterval(() => setReviewNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [sale.postOrderReview.status, sale.postOrderReview.expiresAt]);

  useEffect(() => {
    if (sale.assignmentStatus !== "in_production" || !sale.productionConfirmedAt) return;
    const timer = window.setInterval(() => setCompletionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sale.assignmentStatus, sale.productionConfirmedAt]);

  const isOverdue = sale.supplierDueDate && sale.supplierDueDate < todayDate() && !["completed", "canceled"].includes(sale.assignmentStatus);
  const needsManualPaymentRelease = sale.shopifyPaymentStatus !== "paid";
  const canRetryShopifyTag = sale.assignmentStatus === "assigned" && sale.assignedSupplier !== "special" && sale.shopifyTagSyncStatus !== "synced";
  const canRetryTrello = sale.assignmentStatus === "assigned" && !supplierSaleTrelloConfirmed(sale);
  const shopifyConfirmed = supplierSaleShopifyConfirmed(sale);
  const trelloConfirmed = supplierSaleTrelloConfirmed(sale);
  const readyForProduction = supplierSaleReadyForProduction(sale);
  const productionHideAt = supplierSaleCompletionHideAt(sale);
  const productionRemainingMs = productionHideAt ? Math.max(0, new Date(productionHideAt).getTime() - completionNow) : null;
  const assignmentSaved = sale.assignmentStatus === "assigned" || sale.assignmentStatus === "in_production";
  const lastOrderConfirmationEmail = sale.orderConfirmationEmail;
  const reviewBlocksAssignment = postOrderReviewBlocksAssignment(sale);
  const reviewWindowOpen = postOrderReviewWindowOpen(sale, reviewNow);
  const reviewBadge = postOrderReviewBadgeLabel(sale, reviewNow);
  const paidPriority = paidAssignmentPriority(sale);
  const priorPaidPriority = priorPaidCustomerPriority(sale);
  const saeidSuggestion = !sale.assignedSupplier && shouldSuggestSaeid(sale);
  const assignBlockReason = assignmentBlockReason(sale, supplier, deliveryDate, paymentDecision, specialSupplierName, shopifySupplierTagConfirmed);
  const directTrelloCardUrl = sale.supplierTrelloCardUrl || sale.sourceTrelloCardUrl;
  const trelloSearchFallbackUrl = directTrelloCardUrl ? null : sale.quentinTrelloSearchUrl || sale.quentinTrelloBoardUrl;
  const reminderBlockReason = !sale.customerEmail
    ? "Kunden-E-Mail fehlt."
    : !reminderLink
      ? "Bezahllink fehlt. Erst Sync laden oder Link manuell eintragen."
      : null;

  return (
    <article className={`rounded-[0.5rem] border bg-white p-4 shadow-sm ${paidPriority ? "border-emerald-300 ring-2 ring-emerald-100" : priorPaidPriority ? "border-amber-300 ring-2 ring-amber-100" : "border-stone-200"}`}>
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
          {paidPriority ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[0.5rem] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-950">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              Bezahlt - sofort vergeben
              {reviewWindowOpen ? <span className="text-xs font-medium text-emerald-800">24h-Fenster offen</span> : null}
            </div>
          ) : null}
          {priorPaidPriority ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[0.5rem] border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
              <BadgeCheck className="h-4 w-4 text-amber-700" />
              Bestandskunde - frueher bezahlt, ggf. vor Zahlung freigeben
              <span className="text-xs font-medium text-amber-900">
                {sale.priorPaidCustomer.lastPaidOrderName ? `Beleg: ${sale.priorPaidCustomer.lastPaidOrderName}` : "Bezahlte Historie gefunden"} · Match: {priorPaidCustomerBasisLabel(sale)}
              </span>
              {sale.priorPaidCustomer.lastPaidOrderUrl ? (
                <a
                  href={sale.priorPaidCustomer.lastPaidOrderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-[0.5rem] border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold text-amber-950 hover:border-amber-700"
                >
                  Shopify-Beleg
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentTone(sale)}`}>
              {paymentLabel(sale.shopifyPaymentStatus)}
            </span>
            <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[11px] font-medium text-fuchsia-900">
              Standard: Quentin
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(sale)}`}>
              {sale.assignmentStatus}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentLinkTone(sale)}`}>
              <CreditCard className="h-3.5 w-3.5" />
              {paymentLinkLabel(sale)}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${syncHealthTone(sale)}`}>
              <RefreshCcw className="h-3.5 w-3.5" />
              {syncHealthLabel(sale)}
            </span>
            {isOverdue ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                ueberfaellig
              </span>
            ) : null}
            {sale.rushOrder ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900">
                <Zap className="h-3.5 w-3.5" />
                Eil/Express
              </span>
            ) : null}
            {priorPaidPriority ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-950">
                <BadgeCheck className="h-3.5 w-3.5" />
                Bestandskunde bezahlt
              </span>
            ) : null}
            {reviewBadge ? (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${sale.postOrderReview.status === "change_requested" ? "border-rose-200 bg-rose-50 text-rose-900" : reviewWindowOpen ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                <AlertTriangle className="h-3.5 w-3.5" />
                {reviewBadge}
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
          <SnapshotSelection sale={sale} />

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
            <div className="inline-flex items-center gap-2">
              <RefreshCcw className="h-4 w-4 text-stone-400" />
              Aktualisiert {formatDateTime(sale.updatedAt)}
            </div>
            <div className="inline-flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-stone-400" />
              {sale.shopifyOrderName || sale.shopifyOrderId ? `Shopify ${sale.shopifyOrderName || sale.shopifyOrderId}` : "noch kein Shopify-Match"}
            </div>
          </div>

          {missingPaymentLinkIssue(sale) ? (
            <div className="mt-3 rounded-[0.5rem] border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
              Bezahllink fehlt. Der automatische Completed-Offers/Shopify-Sync laeuft alle 10 Minuten; wenn dieser Hinweis bleibt, ist die Shopify-Order wahrscheinlich nicht eindeutig gematcht.
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <QuickLink href={sale.offerPublicUrl} label="Angebot" />
            <QuickLink href={supplierSalesPdfUrl(sale.id, "snapshot_pdf")} label="Snapshot" />
            <QuickLink href={sale.finalPdfUrl} label="Original-PDF" />
            <QuickLink href={supplierSalesPdfUrl(sale.id, "order_confirmation_pdf")} label="AB-PDF" />
            <QuickLink href={sale.shopifyOrderUrl} label="Shopify" />
            <QuickLink href={sale.paymentLink} label="Bezahlen" />
            <QuickLink href={directTrelloCardUrl} label="Trello-Karte oeffnen" />
            <QuickLink href={trelloSearchFallbackUrl} label={sale.requestId ? "Trello per Request-ID finden" : "Trello-Karte finden"} />
            {sale.requestId ? <QuickLink href={`/ops/customer-records?query=${encodeURIComponent(sale.requestId)}`} label="Kundenakte" /> : null}
          </div>
        </div>

        <div className="min-w-0 rounded-[0.5rem] border border-stone-200 bg-stone-50 p-3">
          <div className="grid gap-3">
            {sale.postOrderReview.status === "change_requested" ? (
              <div className="rounded-[0.5rem] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                <p className="font-semibold">Kunde hat nach Bestellung eine Aenderung gemeldet.</p>
                <p className="mt-1 whitespace-pre-line text-xs leading-5">{sale.postOrderReview.message || "Bitte Kundenmeldung im Angebot/Aktivitaetsverlauf pruefen."}</p>
                {sale.postOrderReview.changeRequestedAt ? (
                  <p className="mt-2 text-xs text-rose-800">Gemeldet: {formatDateTime(sale.postOrderReview.changeRequestedAt)}</p>
                ) : null}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (!confirmAction("Bestaetigen, dass die Kunden-Aenderung geprueft und in den Produktionsdaten eingetragen wurde? Danach kann die Sale vergeben werden.")) return;
                    void onAction({
                      action: "acknowledge_post_order_change",
                      saleId: sale.id,
                      reviewNote: assignmentNote,
                      operatorName,
                    });
                  }}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[0.5rem] border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-900 transition hover:border-rose-500 disabled:cursor-not-allowed disabled:bg-rose-100"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Aenderung geprueft/eingetragen
                </button>
              </div>
            ) : reviewWindowOpen ? (
              <div className="rounded-[0.5rem] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">Hinweis: 24h-Aenderungsfenster laeuft.</p>
                <p className="mt-1 text-xs leading-5">Restzeit: {formatPostOrderCountdown(postOrderRemainingMs(sale, reviewNow))}. Vergabe ist trotzdem moeglich, wenn ihr die Produktion bewusst freigeben wollt.</p>
              </div>
            ) : sale.postOrderReview.status === "closed" ? (
              <div className="rounded-[0.5rem] border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900">
                24h-Aenderungsfenster abgeschlossen. Keine gemeldete Abweichung im aktuellen Stand.
              </div>
            ) : null}

            {assignmentSaved ? (
              <div className="grid gap-2 rounded-[0.5rem] border border-stone-200 bg-white p-3">
                <p className="text-sm font-semibold text-stone-950">Vergabe-Bestaetigung</p>
                <div className={`flex items-start gap-2 rounded-[0.5rem] border px-3 py-2 text-xs font-medium ${shopifyConfirmed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                  {shopifyConfirmed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>
                    {shopifyConfirmed
                      ? sale.assignedSupplier === "special" ? "Shopify Supplier-Tag manuell bestaetigt." : "Shopify Supplier-Tag gesetzt."
                      : sale.shopifyTagSyncStatus === "failed" ? "Shopify Supplier-Tag fehlgeschlagen." : "Shopify Supplier-Tag noch offen."}
                  </span>
                </div>
                <div className={`flex items-start gap-2 rounded-[0.5rem] border px-3 py-2 text-xs font-medium ${trelloConfirmed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                  {trelloConfirmed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>
                    {trelloConfirmed
                      ? "Trello-Karte gefunden und aktualisiert."
                      : sale.trelloProjectionStatus === "failed" ? "Trello-Aktualisierung fehlgeschlagen." : "Trello-Aktualisierung noch offen."}
                  </span>
                </div>
                {sale.assignmentStatus === "in_production" && sale.productionConfirmedAt ? (
                  <div className="rounded-[0.5rem] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>Zur Produktion gegeben{sale.productionConfirmedBy ? ` von ${sale.productionConfirmedBy}` : ""}.</span>
                    </div>
                    {productionRemainingMs !== null ? (
                      <div className="mt-2 flex items-center gap-2 text-emerald-800">
                        <Timer className="h-4 w-4" />
                        Verschwindet aus Aktive Sales in {formatCompletionCountdown(productionRemainingMs)}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={saving || !readyForProduction}
                    title={readyForProduction ? "Produktionsstart bestaetigen" : "Erst Shopify und Trello vollstaendig bestaetigen."}
                    onClick={() => {
                      if (!confirmAction("Bestaetigen, dass der Auftrag vollstaendig an den Supplier uebergeben und zur Produktion gegeben wurde? Danach bleibt er noch 10 Minuten sichtbar.")) return;
                      void onAction({ action: "mark_in_production", saleId: sale.id, operatorName });
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  >
                    <Factory className="h-4 w-4" />
                    Zur Produktion gegeben
                  </button>
                )}
              </div>
            ) : null}

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-stone-600">Wann soll geliefert werden?</span>
              <input
                type="date"
                disabled={assignmentSaved}
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                aria-label="Lieferdatum"
                className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm"
              />
            </label>

            <label className="grid min-w-0 gap-1.5">
              <span className="text-xs font-medium text-stone-600">Supplier</span>
              <select
                disabled={assignmentSaved}
                value={supplier}
                onChange={(event) => {
                  setSupplier(event.target.value as SupplierSelection);
                  setShopifySupplierTagConfirmed(false);
                }}
                aria-label="Supplier auswaehlen"
                className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm"
              >
                <option value="quentin">Quentin</option>
                <option value="said">Saeid</option>
                <option value="special">Weitere Supplier</option>
              </select>
            </label>

            {saeidSuggestion ? (
              <div className="flex items-center justify-between gap-3 rounded-[0.5rem] border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <span className="inline-flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                  Saeid pruefen: einfarbiges Indoor-Neon-Flex ueber 1.000 EUR.
                </span>
                <button
                  type="button"
                  onClick={() => setSupplier("said")}
                  className="shrink-0 rounded-[0.5rem] border border-amber-400 bg-white px-2.5 py-1 font-semibold hover:border-amber-700"
                >
                  Saeid waehlen
                </button>
              </div>
            ) : null}

            {supplier === "special" ? (
              <div className="grid gap-2 rounded-[0.5rem] border border-amber-300 bg-amber-50 p-3">
                <input
                  disabled={assignmentSaved}
                  value={specialSupplierName}
                  onChange={(event) => setSpecialSupplierName(event.target.value)}
                  aria-label="Name weiterer Supplier"
                  className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm"
                  placeholder="Name weiterer Supplier"
                />
                <p className="text-xs font-semibold text-amber-950">Bitte in Shopify den Supplier als Tag eintragen.</p>
                <label className="flex items-start gap-2 text-xs text-amber-950">
                  <input
                    type="checkbox"
                    disabled={assignmentSaved}
                    checked={shopifySupplierTagConfirmed}
                    onChange={(event) => setShopifySupplierTagConfirmed(event.target.checked)}
                    aria-label="Shopify-Supplier-Tag bestaetigt"
                    className="mt-0.5 h-4 w-4 rounded border-amber-400"
                  />
                  Supplier-Tag wurde in Shopify eingetragen.
                </label>
              </div>
            ) : null}

            {needsManualPaymentRelease ? (
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-stone-600">Zahlungsentscheidung</span>
                <select disabled={assignmentSaved} value={paymentDecision} onChange={(event) => setPaymentDecision(event.target.value as SupplierSalePaymentDecision)} aria-label="Zahlungsentscheidung" className="h-10 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 text-sm">
                  <option value="manual_approved_unpaid">Trotz offener Zahlung vergeben</option>
                  <option value="wait_for_payment">Auf Zahlung warten</option>
                </select>
              </label>
            ) : null}

            <textarea
              disabled={assignmentSaved}
              value={assignmentNote}
              onChange={(event) => setAssignmentNote(event.target.value)}
              aria-label="Notiz fuer Vergabe"
              className="min-h-16 w-full min-w-0 rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm"
              placeholder="Notiz fuer Vergabe"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || assignmentSaved || Boolean(assignBlockReason)}
                title={assignmentSaved ? "Sale ist bereits vergeben." : assignBlockReason || "Sale vergeben"}
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
                    shopifySupplierTagConfirmed,
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
              {canRetryTrello ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (!confirmAction("Trello-Karte fuer diese vergebene Sale erneut finden und aktualisieren?")) return;
                    void onAction({ action: "retry_trello_projection", saleId: sale.id, operatorName });
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Trello erneut
                </button>
              ) : null}
              <button
                type="button"
                disabled={saving || !sale.customerEmail}
                title={!sale.customerEmail ? "Kunden-E-Mail fehlt." : "Auftragsbestaetigung senden"}
                onClick={() => {
                  const recipient = sale.customerEmail || "";
                  if (!confirmAction(`Auftragsbestaetigung als PDF per Outlook/n8n an ${recipient} senden? Der Versand wird protokolliert und bei gleichem PDF-Stand nicht doppelt ausgefuehrt.`)) return;
                  void onAction({
                    action: "send_order_confirmation_email",
                    saleId: sale.id,
                    recipientEmail: recipient,
                    operatorName,
                  });
                }}
                className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
              >
                <Mail className="h-4 w-4" />
                AB senden
              </button>
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
                  disabled={saving || Boolean(reminderBlockReason)}
                  title={reminderBlockReason || "Zahlungserinnerung senden"}
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

            {lastOrderConfirmationEmail ? (
              <p className={`rounded-[0.5rem] border px-3 py-2 text-xs ${lastOrderConfirmationEmail.status === "sent" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                AB-Mail: {lastOrderConfirmationEmail.status === "sent" ? `gesendet an ${lastOrderConfirmationEmail.recipientEmail || "Kunde"}` : lastOrderConfirmationEmail.error || lastOrderConfirmationEmail.status}
              </p>
            ) : null}

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
                  className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                >
                  <Mail className="h-4 w-4" />
                  Erinnerung
                </button>
                {reminderBlockReason ? (
                  <p className="rounded-[0.5rem] border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-amber-900">
                    Erinnerung blockiert: {reminderBlockReason}
                  </p>
                ) : null}
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
  const [urgency, setUrgency] = useState<UrgencyFilter>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(BOARD_PAGE_SIZE);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingSaleId, setSavingSaleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [liveCheck, setLiveCheck] = useState<SupplierSalesLiveCheck | null>(null);
  const [boardNow, setBoardNow] = useState(() => Date.now());
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
  }, [hasSession, localMode, scope, supplier, payment, urgency, visibleLimit]);

  const boardItems = useMemo(() => board?.items || [], [board]);
  useEffect(() => {
    if (scope !== "active" || !boardItems.some((sale) => sale.assignmentStatus === "in_production")) return;
    const timer = window.setInterval(() => setBoardNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [scope, boardItems]);

  const items = useMemo(
    () => scope === "active"
      ? boardItems.filter((sale) => supplierSaleVisibleInActiveOverview(sale, new Date(boardNow)))
      : boardItems,
    [boardItems, scope, boardNow],
  );
  const visibleItems = useMemo(() => {
    if (quickFilter === "paid_priority") return items.filter(paidAssignmentPriority);
    if (quickFilter === "prior_paid_customer") return items.filter(priorPaidCustomerPriority);
    if (quickFilter === "missing_payment_link") return items.filter(missingPaymentLinkIssue);
    if (quickFilter === "sync_issue") return items.filter(hasSyncIssue);
    if (quickFilter === "deadline") return items.filter(isDeadlineRelevant);
    return items;
  }, [items, quickFilter]);

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
    const syncResponse = await fetchWithTimeout("/api/ops/supplier-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_completed_offers", limit: Math.min(Math.max(visibleLimit, BOARD_PAGE_SIZE), 100), operatorName }),
    }, 30_000);
    const syncPayload = (await syncResponse.json().catch(() => null)) as SupplierSalesApiResponse | null;
    if (!syncResponse.ok || !syncPayload?.ok) {
      return { message: null, warning: `Completed-Offers-Sync fehlgeschlagen: ${formatApiError(syncPayload)}` };
    }
    const sync = syncPayload.completedOffersSync;
    if (sync?.status === "failed") {
      return { message: null, warning: `Completed-Offers-Sync fehlgeschlagen: ${sync.errors[0]?.error || "unbekannter Fehler"}` };
    }
    if (sync?.status === "partial") {
      return {
        message: `Completed-Offers-Sync teilweise: ${sync.upserted} importiert/aktualisiert, ${sync.failed} Nebenfehler.`,
        warning: sync.errors[0]?.error || "Ein Nebenabgleich ist fehlgeschlagen.",
      };
    }
    if (sync?.status === "skipped") {
      return { message: null, warning: sync.warnings[0] || "Completed-Offers-Sync uebersprungen." };
    }
    if (sync && sync.upserted > 0) {
      return { message: `Completed-Offers-Sync: ${sync.upserted} Angebote importiert/aktualisiert.`, warning: null };
    }
    return { message: "Completed-Offers-Sync: keine neuen Angebote.", warning: null };
  }

  async function fetchCurrentBoard() {
    const params = new URLSearchParams();
    params.set("scope", scope);
    params.set("supplier", supplier);
    params.set("payment", payment);
    params.set("urgency", urgency);
    params.set("limit", String(visibleLimit));
    if (query.trim()) params.set("q", query.trim());
    const response = await fetchWithTimeout(`/api/ops/supplier-sales?${params.toString()}`, undefined, 20_000);
    const payload = (await response.json().catch(() => null)) as SupplierSalesApiResponse | null;
    if (!response.ok || !payload?.ok || !payload.board) throw new Error(formatApiError(payload));
    return payload.board;
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

      setBoard(await fetchCurrentBoard());
      setMessage(nextMessage);
      setError(nextError);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Produktion konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function runSaleAction(saleId: string, body: Record<string, unknown>) {
    setSavingSaleId(saleId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/ops/supplier-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, operatorName }),
      }, 30_000);
      const payload = (await response.json().catch(() => null)) as SupplierSalesApiResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));
      setMessage(actionMessage(body.action, payload));
      if (payload.sale) setBoard((current) => replaceBoardSale(current, payload.sale));
      try {
        setBoard(await fetchCurrentBoard());
      } catch (refreshError) {
        setError(`Aktion gespeichert, aber Liste konnte nicht aktualisiert werden: ${formatUnknownError(refreshError, "Bitte neu laden.")}`);
      }
    } catch (actionError) {
      setError(formatUnknownError(actionError, "Aktion fehlgeschlagen."));
    } finally {
      setSavingSaleId(null);
    }
  }

  async function runLiveCheck() {
    setSavingSaleId("live-check");
    setError(null);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/ops/supplier-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diagnose_sales_flow", limit: 10, operatorName }),
      }, 30_000);
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

  function selectScope(nextScope: ScopeFilter) {
    setVisibleLimit(BOARD_PAGE_SIZE);
    setQuickFilter("all");
    setScope(nextScope);
  }

  function selectSupplier(nextSupplier: SupplierFilter) {
    setVisibleLimit(BOARD_PAGE_SIZE);
    setQuickFilter("all");
    setSupplier(nextSupplier);
  }

  function selectPayment(nextPayment: PaymentFilter) {
    setVisibleLimit(BOARD_PAGE_SIZE);
    setQuickFilter("all");
    setPayment(nextPayment);
  }

  function selectUrgency(nextUrgency: UrgencyFilter) {
    setVisibleLimit(BOARD_PAGE_SIZE);
    setQuickFilter("all");
    setUrgency(nextUrgency);
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Produktion"
        title="Produktion anmelden"
        description="Melde dich fuer die interne Produktionsuebersicht an. Supplier-Entscheidungen, Zahlungsausnahmen und Sync-Fehler bleiben protokolliert."
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
        <OpsPageHeader active="supplierSales" label="Produktion" />

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
              if (!confirmAction("Alle automatisch erzeugten Produktionsaufgaben archivieren und die Task-Verknuepfung an den Sales entfernen?")) return;
              void runSaleAction("assignment-task-cleanup", { action: "cleanup_supplier_assignment_tasks", operatorName });
            }}
            className="inline-flex items-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            <ClipboardList className="h-4 w-4" />
                Produktionsaufgaben bereinigen
          </button>
          {savingSaleId === "assignment-task-cleanup" ? <span className="text-sm text-stone-500">Bereinigung laeuft...</span> : null}
        </section>

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-9">
          <StatFilterButton
            active={scope === "active" && payment === "paid"}
            label="Bezahlte offene Sales"
            onClick={() => {
              selectScope("active");
              selectPayment("paid");
            }}
          >
            <OpsStatCard label="Bezahlt offen" value={board?.counts.paidUnassigned || 0} tone="success" icon={<CheckCircle2 className="h-5 w-5" />} detail="Sofort vergeben." />
          </StatFilterButton>
          <StatFilterButton active={scope === "ready"} label="Bereite Sales" onClick={() => selectScope("ready")}>
            <OpsStatCard label="Bereit" value={board?.counts.readyToAssign || 0} tone="info" icon={<BadgeCheck className="h-5 w-5" />} detail="Bezahlt oder freigegeben." />
          </StatFilterButton>
          <StatFilterButton
            active={quickFilter === "prior_paid_customer"}
            label="Bestandskunden mit offener Zahlung"
            onClick={() => {
              selectScope("active");
              setQuickFilter("prior_paid_customer");
            }}
          >
            <OpsStatCard label="Bestandskunde" value={board?.counts.priorPaidCustomerOpen || 0} tone="info" icon={<BadgeCheck className="h-5 w-5" />} detail="Frueher bezahlt, jetzt offen." />
          </StatFilterButton>
          <StatFilterButton active={scope === "payment"} label="Offene Zahlungen" onClick={() => selectScope("payment")}>
            <OpsStatCard label="Zahlung" value={board?.counts.paymentOpen || 0} tone="warning" icon={<CreditCard className="h-5 w-5" />} detail="Offen oder Entscheidung fehlt." />
          </StatFilterButton>
          <StatFilterButton
            active={quickFilter === "missing_payment_link"}
            label="Fehlende Bezahllinks"
            onClick={() => {
              selectScope("active");
              setQuickFilter("missing_payment_link");
            }}
          >
            <OpsStatCard label="Link fehlt" value={board?.counts.missingPaymentLinks || 0} tone="danger" icon={<AlertTriangle className="h-5 w-5" />} detail="Shopify-Link fehlt." />
          </StatFilterButton>
          <StatFilterButton active={scope === "assigned"} label="Vergebene Sales" onClick={() => selectScope("assigned")}>
            <OpsStatCard label="Vergeben" value={board?.counts.assigned || 0} tone="success" icon={<Factory className="h-5 w-5" />} detail="Supplier gesetzt." />
          </StatFilterButton>
          <StatFilterButton active={scope === "deadline"} label="Deadline Sales" onClick={() => selectScope("deadline")}>
            <OpsStatCard label="Deadline" value={(board?.counts.dueSoon || 0) + (board?.counts.overdue || 0)} tone="info" icon={<CalendarClock className="h-5 w-5" />} detail="In 7 Tagen faellig oder ueberfaellig." />
          </StatFilterButton>
          <StatFilterButton active={scope === "sync"} label="Sync-Fehler" onClick={() => selectScope("sync")}>
            <OpsStatCard label="Sync" value={board?.counts.syncIssues || 0} tone="danger" icon={<AlertTriangle className="h-5 w-5" />} detail="Shopify/Trello/Aufgabe fehlerhaft." />
          </StatFilterButton>
          <StatFilterButton
            active={urgency === "rush"}
            label="Eil- und Express-Auftraege"
            onClick={() => {
              selectScope("active");
              selectUrgency(urgency === "rush" ? "all" : "rush");
            }}
          >
            <OpsStatCard label="Eil" value={board?.counts.rushOrders || 0} tone="warning" icon={<Zap className="h-5 w-5" />} detail="Express oder Eilauftrag." />
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
          <div className="grid gap-3 lg:grid-cols-[1fr_150px_150px_150px_150px_140px]">
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
            <select value={scope} onChange={(event) => selectScope(event.target.value as ScopeFilter)} aria-label="Bereich filtern" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="active">Aktive Sales</option>
              <option value="ready">Bereit</option>
              <option value="payment">Zahlung offen</option>
              <option value="assigned">Vergeben</option>
              <option value="deadline">Deadline</option>
              <option value="sync">Sync-Fehler</option>
              <option value="all">Alle</option>
            </select>
            <select value={supplier} onChange={(event) => selectSupplier(event.target.value as SupplierFilter)} aria-label="Supplier filtern" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="all">Alle Supplier</option>
              <option value="quentin">Quentin</option>
              <option value="said">Saeid</option>
              <option value="special">Weitere Supplier</option>
              <option value="manual_review">Pruefen</option>
            </select>
            <select value={payment} onChange={(event) => selectPayment(event.target.value as PaymentFilter)} aria-label="Zahlungsstatus filtern" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="all">Alle Zahlungen</option>
              <option value="paid">Bezahlt</option>
              <option value="unpaid">Nicht bezahlt</option>
              <option value="pending">Pending</option>
              <option value="authorized">Autorisiert</option>
              <option value="unknown">Unklar</option>
            </select>
            <select value={urgency} onChange={(event) => selectUrgency(event.target.value as UrgencyFilter)} aria-label="Dringlichkeit filtern" className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm">
              <option value="all">Alle Auftraege</option>
              <option value="rush">Eil/Express</option>
              <option value="standard">Ohne Eil</option>
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
            <span className="text-sm text-stone-500">Zeigt max. {visibleLimit} neueste Treffer.</span>
            {message ? <span className="rounded-[0.5rem] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{message}</span> : null}
            {error ? <span className="rounded-[0.5rem] border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{error}</span> : null}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
            <span className="mr-1 text-xs font-semibold uppercase text-stone-500">Schnellfilter</span>
            <QuickFilterButton active={quickFilter === "all"} onClick={() => setQuickFilter("all")}>
              Alle geladenen ({items.length})
            </QuickFilterButton>
            <QuickFilterButton active={quickFilter === "paid_priority"} onClick={() => setQuickFilter("paid_priority")}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Bezahlt sofort ({items.filter(paidAssignmentPriority).length})
            </QuickFilterButton>
            <QuickFilterButton active={quickFilter === "prior_paid_customer"} onClick={() => setQuickFilter("prior_paid_customer")}>
              <BadgeCheck className="h-3.5 w-3.5" />
              Bestandskunde offen ({items.filter(priorPaidCustomerPriority).length})
            </QuickFilterButton>
            <QuickFilterButton active={quickFilter === "missing_payment_link"} onClick={() => setQuickFilter("missing_payment_link")}>
              <AlertTriangle className="h-3.5 w-3.5" />
              Bezahllink fehlt ({items.filter(missingPaymentLinkIssue).length})
            </QuickFilterButton>
            <QuickFilterButton active={quickFilter === "deadline"} onClick={() => setQuickFilter("deadline")}>
              <CalendarClock className="h-3.5 w-3.5" />
              Deadline ({items.filter(isDeadlineRelevant).length})
            </QuickFilterButton>
            <QuickFilterButton active={quickFilter === "sync_issue"} onClick={() => setQuickFilter("sync_issue")}>
              <RefreshCcw className="h-3.5 w-3.5" />
              Sync-Problem ({items.filter(hasSyncIssue).length})
            </QuickFilterButton>
            {quickFilter !== "all" ? (
              <span className="text-xs text-stone-500">
                Zeigt {visibleItems.length} von {items.length} geladenen Treffern.
              </span>
            ) : null}
          </div>
        </section>

        <LiveCheckPanel liveCheck={liveCheck} />

        <section className="grid gap-4">
          {visibleItems.length ? (
            visibleItems.map((sale) => (
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
              <p className="mt-3">
                {items.length && quickFilter !== "all"
                  ? "Keine geladenen Sales passen zu diesem Schnellfilter."
                  : "Keine Sales in dieser Ansicht."}
              </p>
            </div>
          )}
          {items.length >= visibleLimit ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => setVisibleLimit((current) => Math.min(current + BOARD_PAGE_SIZE, 500))}
              className="mx-auto inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw className="h-4 w-4" />
              Weitere {BOARD_PAGE_SIZE} laden
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
