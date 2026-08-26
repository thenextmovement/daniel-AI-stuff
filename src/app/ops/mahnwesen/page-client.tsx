"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  Clock3,
  ExternalLink,
  FileWarning,
  Filter,
  Gavel,
  MailCheck,
  MessageSquareReply,
  Phone,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Truck,
  WalletCards,
  X,
} from "lucide-react";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import {
  OpsPageIntro,
  OpsStatCard,
  opsPageContainerClass,
  opsPageShellClass,
} from "../ops-design";
import type {
  DunningActionPreview,
  DunningCaseDetail,
  DunningCaseState,
  DunningCaseSummary,
  DunningDashboard,
} from "@/lib/ops/dunning";
import type { DunningCourtApplicationPreview } from "@/lib/ops/dunning-court-application";
import type {
  DunningCourtProfile,
  DunningCourtRepresentative,
} from "@/lib/ops/dunning-court";
import {
  sortDunningCases,
  type DunningCaseSort,
} from "@/lib/ops/dunning-sort";

type Filters = {
  query: string;
  state: "all" | DunningCaseState;
  stage: string;
  delivery: "all" | "fulfilled" | "tracking" | "delivered" | "evidence_missing";
  insolvency: "all" | "pending" | "checked" | "notice" | "review" | "failed";
  sort: DunningCaseSort;
};

const INITIAL_FILTERS: Filters = {
  query: "",
  state: "all",
  stage: "all",
  delivery: "all",
  insolvency: "all",
  sort: "priority",
};

function normalizedSearchValue(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ")
    .trim();
}

function caseMatchesQuery(entry: DunningCaseSummary, query: string) {
  const normalizedQuery = normalizedSearchValue(query);
  if (!normalizedQuery) return true;
  const corpus = normalizedSearchValue(
    [
      entry.orderNumber,
      entry.shopifyOrderId,
      entry.easybillInvoiceNumber,
      entry.easybillDocumentId,
      entry.customerName,
      entry.company,
      entry.email,
      entry.phone,
      entry.amountCents / 100,
      ...entry.shipments.flatMap((shipment) => [
        shipment.carrier,
        shipment.trackingNumber,
      ]),
      ...entry.courtEvents.flatMap((event) => [
        event.eventLabel,
        event.occurredOn,
        event.sourceReference,
      ]),
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(" "),
  );
  const phoneDigits = String(entry.phone || "").replace(/\D/g, "");
  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((term) => {
      if (corpus.includes(term)) return true;
      const digits = term.replace(/\D/g, "");
      return digits.length >= 3 && phoneDigits.includes(digits);
    });
}

const stateTone: Record<DunningCaseState, string> = {
  action_required: "border-rose-200 bg-rose-50 text-rose-800",
  scheduled: "border-sky-200 bg-sky-50 text-sky-800",
  final_wait: "border-indigo-200 bg-indigo-50 text-indigo-800",
  reply_received: "border-amber-200 bg-amber-50 text-amber-900",
  paused: "border-stone-300 bg-stone-100 text-stone-700",
  court_review: "border-violet-200 bg-violet-50 text-violet-800",
  data_issue: "border-orange-200 bg-orange-50 text-orange-800",
  closed: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

function money(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(
    Number(cents || 0) / 100,
  );
}

function dateLabel(value: string | null, withTime = false) {
  if (!value) return "Nicht belegt";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Nicht belegt";
  return new Intl.DateTimeFormat(
    "de-DE",
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
  ).format(date);
}

function relativeDue(entry: DunningCaseSummary) {
  if (entry.daysOverdue === null)
    return entry.scheduledAt
      ? `Nächste Stufe ${dateLabel(entry.scheduledAt)}`
      : "Keine belegte Fälligkeit";
  if (entry.daysOverdue < 0)
    return `Fällig in ${Math.abs(entry.daysOverdue)} Tagen`;
  if (entry.daysOverdue === 0) return "Heute fällig";
  return `${entry.daysOverdue} Tage überfällig`;
}

function applyFilters(cases: DunningCaseSummary[], filters: Filters) {
  const visible = cases.filter((entry) => {
    if (!caseMatchesQuery(entry, filters.query)) return false;
    if (filters.state !== "all" && entry.state !== filters.state) return false;
    if (filters.stage !== "all" && entry.currentStage !== Number(filters.stage))
      return false;
    if (
      filters.delivery === "fulfilled" &&
      entry.fulfillmentStatus.toLowerCase() !== "fulfilled"
    )
      return false;
    if (filters.delivery === "tracking" && !entry.hasTracking) return false;
    if (filters.delivery === "delivered" && !entry.carrierDeliveryConfirmed)
      return false;
    if (
      filters.delivery === "evidence_missing" &&
      (entry.fulfillmentStatus.toLowerCase() !== "fulfilled" ||
        entry.carrierDeliveryConfirmed)
    )
      return false;
    if (filters.insolvency !== "all") {
      const check = entry.insolvencyCheck;
      const pending =
        entry.courtReview &&
        (!check || check.status === "checking" || check.status === "retryable");
      if (filters.insolvency === "pending" && !pending) return false;
      if (
        filters.insolvency === "checked" &&
        !(
          check?.status === "completed" &&
          check.resultCode === "no_public_notice_found"
        )
      )
        return false;
      if (
        filters.insolvency === "notice" &&
        check?.resultCode !== "public_notice_found"
      )
        return false;
      if (
        filters.insolvency === "review" &&
        !["ambiguous_match", "identity_incomplete"].includes(
          check?.resultCode || "",
        )
      )
        return false;
      if (
        filters.insolvency === "failed" &&
        !check?.status.match(/^(retryable|failed_final)$/)
      )
        return false;
    }
    return true;
  });
  return sortDunningCases(visible, filters.sort);
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-stone-600">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal text-stone-800 outline-none focus:border-[#fa31a2] focus:ring-2 focus:ring-[#fa31a2]/15"
      >
        {children}
      </select>
    </label>
  );
}

function StatusBadge({ entry }: { entry: DunningCaseSummary }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${stateTone[entry.state]}`}
    >
      {entry.stateLabel}
    </span>
  );
}

function InsolvencyCheckButton({
  entry,
  onOpen,
}: {
  entry: DunningCaseSummary;
  onOpen?: (entry: DunningCaseSummary) => void;
}) {
  const check = entry.insolvencyCheck;
  if (!entry.courtReview && !check) return null;
  let label = "Prüfung ausstehend";
  let tone = "border-stone-300 bg-stone-50 text-stone-700";
  if (check?.status === "checking") label = "Prüfung läuft";
  else if (check?.status === "retryable") {
    label = "Wiederholung geplant";
    tone = "border-amber-200 bg-amber-50 text-amber-900";
  } else if (check?.status === "failed_final") {
    label = "Prüfung fehlgeschlagen";
    tone = "border-rose-200 bg-rose-50 text-rose-800";
  } else if (check?.resultCode === "public_notice_found") {
    label = "Insolvenzhinweis";
    tone = "border-rose-300 bg-rose-50 text-rose-900";
  } else if (check?.resultCode === "ambiguous_match") {
    label = "Treffer prüfen";
    tone = "border-amber-300 bg-amber-50 text-amber-900";
  } else if (check?.resultCode === "identity_incomplete") {
    label = "Schuldnerdaten fehlen";
    tone = "border-orange-300 bg-orange-50 text-orange-900";
  } else if (check?.resultCode === "no_public_notice_found") {
    label = "Daten geprüft";
    tone = "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  return (
    <button
      type="button"
      disabled={!check || !onOpen}
      onClick={(event) => {
        event.stopPropagation();
        if (check && onOpen) onOpen(entry);
      }}
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone} disabled:cursor-default`}
    >
      {check?.resultCode === "public_notice_found" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}

function StageBadge({ entry }: { entry: DunningCaseSummary }) {
  return (
    <div>
      <span className="inline-flex rounded-lg bg-stone-950 px-2.5 py-1 text-xs font-semibold text-white">
        Stufe {entry.currentStage}
      </span>
      <p className="mt-1 max-w-[15rem] text-xs leading-4 text-stone-500">
        {entry.currentStageLabel}
      </p>
    </div>
  );
}

function CourtStatusBadge({ entry }: { entry: DunningCaseSummary }) {
  const event = entry.courtEvent;
  if (!event) return null;
  const isDraft = event.eventType === "application_draft_created";
  const tone = isDraft
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : "border-violet-200 bg-violet-50 text-violet-900";
  return (
    <div className="max-w-[16rem]">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}
      >
        <Gavel className="h-3.5 w-3.5 shrink-0" />
        {event.eventLabel}
      </span>
      <p className="mt-1 text-xs font-semibold text-stone-700">
        {dateLabel(event.occurredOn)}
      </p>
      {isDraft ? (
        <p className="mt-1 text-xs leading-4 text-amber-800">
          Noch nicht beim Gericht eingereicht
        </p>
      ) : null}
    </div>
  );
}

function FilterPanel({
  filters,
  setFilters,
  count,
  total,
}: {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  count: number;
  total: number;
}) {
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const advancedCount = [
    filters.state !== "all",
    filters.stage !== "all",
    filters.delivery !== "all",
    filters.insolvency !== "all",
  ].filter(Boolean).length;
  return (
    <section
      aria-label="Mahnfälle filtern"
      className="overflow-hidden rounded-[22px] border border-[#ded8d0] bg-[#fffdf9] shadow-[0_16px_44px_rgba(20,16,12,0.05)]"
    >
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
        <label className="grid min-w-0 flex-1 gap-1.5 text-xs font-semibold text-stone-600">
          <span>Suche</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
            <input
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
              placeholder="Name, Firma, E-Mail, Telefon, Bestellung, Rechnung oder Sendungsnummer"
              className="h-10 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-sm font-normal text-stone-800 outline-none placeholder:text-stone-400 focus:border-[#fa31a2] focus:ring-2 focus:ring-[#fa31a2]/15"
            />
          </span>
        </label>
        <div className="w-full lg:w-[19rem]">
          <SelectField
            label="Sortieren"
            value={filters.sort}
            onChange={(value) => update("sort", value as DunningCaseSort)}
          >
            <option value="priority">Empfohlen: Priorität</option>
            <optgroup label="Offener Betrag">
              <option value="amount_desc">Höchster Betrag zuerst</option>
              <option value="amount_asc">Niedrigster Betrag zuerst</option>
            </optgroup>
            <optgroup label="Mahnstufe">
              <option value="stage_desc">Höchste Mahnstufe zuerst</option>
              <option value="stage_asc">Niedrigste Mahnstufe zuerst</option>
            </optgroup>
            <optgroup label="Nächste Aktion">
              <option value="next_action_asc">Früheste Aktion zuerst</option>
              <option value="next_action_desc">Späteste Aktion zuerst</option>
            </optgroup>
            <optgroup label="Überfälligkeit">
              <option value="overdue_desc">Meiste Tage überfällig</option>
              <option value="overdue_asc">Wenigste Tage überfällig</option>
            </optgroup>
            <optgroup label="Bestellalter">
              <option value="order_oldest">Älteste Bestellung zuerst</option>
              <option value="order_newest">Neueste Bestellung zuerst</option>
            </optgroup>
            <optgroup label="Letzte Aktivität">
              <option value="activity_desc">Neueste Aktivität zuerst</option>
              <option value="activity_asc">Älteste Aktivität zuerst</option>
            </optgroup>
            <optgroup label="Name / Firma">
              <option value="party_asc">Name / Firma: A–Z</option>
              <option value="party_desc">Name / Firma: Z–A</option>
            </optgroup>
          </SelectField>
        </div>
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <Filter className="h-4 w-4" />
          <strong className="text-stone-900">{count}</strong> von {total} Fällen
        </div>
        <button
          type="button"
          onClick={() => setFilters(INITIAL_FILTERS)}
          className="h-10 rounded-xl border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
        >
          Zurücksetzen
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#e6e0d8] px-4 py-3">
        {(
          [
            ["Aktion fällig", "action_required", Send],
            ["Antwort prüfen", "reply_received", MessageSquareReply],
            ["Solvenz/Gericht", "court_review", Gavel],
          ] as const
        ).map(([label, state, Icon]) => (
          <button
            key={state}
            type="button"
            onClick={() =>
              update("state", filters.state === state ? "all" : state)
            }
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filters.state === state ? "border-stone-950 bg-stone-950 text-white" : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-stone-500">
          Bezahlte Fälle sind ausgeblendet. Ausnahme: Shopify-Tag „WARTEN AUF
          ZA(HLUNG)“.
        </span>
      </div>
      <details className="border-t border-[#e6e0d8]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-stone-700 marker:content-none">
          <Filter className="h-4 w-4" />
          Weitere Filter
          {advancedCount ? (
            <span className="rounded-full bg-stone-950 px-2 py-0.5 text-xs text-white">
              {advancedCount}
            </span>
          ) : null}
        </summary>
        <div className="grid gap-3 border-t border-[#eee8df] bg-[#faf7f2] p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Arbeitsstatus"
            value={filters.state}
            onChange={(value) => update("state", value as Filters["state"])}
          >
            <option value="all">Alle Status</option>
            <option value="action_required">Aktion fällig</option>
            <option value="reply_received">Antwort prüfen</option>
            <option value="final_wait">Letzte Frist läuft</option>
            <option value="court_review">Solvenz/Gericht prüfen</option>
            <option value="data_issue">Daten prüfen</option>
            <option value="scheduled">Termin geplant</option>
            <option value="paused">Pausiert</option>
          </SelectField>
          <SelectField
            label="Mahnstufe"
            value={filters.stage}
            onChange={(value) => update("stage", value)}
          >
            <option value="all">Alle Stufen</option>
            {Array.from({ length: 7 }, (_, stage) => (
              <option key={stage} value={stage}>
                Stufe {stage}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Versandnachweis"
            value={filters.delivery}
            onChange={(value) =>
              update("delivery", value as Filters["delivery"])
            }
          >
            <option value="all">Alle Versandstatus</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="tracking">Sendungsnummer vorhanden</option>
            <option value="delivered">Carrier-Zustellung bestätigt</option>
            <option value="evidence_missing">
              Fulfilled, Zustellbeleg fehlt
            </option>
          </SelectField>
          <SelectField
            label="Insolvenzprüfung"
            value={filters.insolvency}
            onChange={(value) =>
              update("insolvency", value as Filters["insolvency"])
            }
          >
            <option value="all">Alle Prüfstatus</option>
            <option value="pending">Prüfung ausstehend</option>
            <option value="checked">Daten geprüft – kein Hinweis</option>
            <option value="notice">Amtlicher Hinweis gefunden</option>
            <option value="review">Treffer oder Daten prüfen</option>
            <option value="failed">Technischer Fehler</option>
          </SelectField>
        </div>
      </details>
    </section>
  );
}

function NextActionSchedule({ entry }: { entry: DunningCaseSummary }) {
  if (!entry.nextActionAt)
    return (
      <p className="mt-1 text-xs text-stone-500">
        Kein automatischer Versand geplant
      </p>
    );
  return (
    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-stone-600">
      <Clock3 className="h-3.5 w-3.5 shrink-0" />
      {entry.nextActionKind === "customer_email" ? "Geplant" : "Fällig"}:{" "}
      {dateLabel(entry.nextActionAt, true)}
    </p>
  );
}

function ShipmentSummary({ entry }: { entry: DunningCaseSummary }) {
  const shipment = entry.shipments[0];
  return (
    <div className="max-w-[17rem]">
      <div className="flex items-center gap-2 text-xs font-semibold text-stone-700">
        <Truck className="h-3.5 w-3.5 shrink-0 text-stone-400" />
        {entry.fulfillmentStatus}
      </div>
      {shipment?.trackingNumber ? (
        <div className="mt-2">
          {shipment.trackingUrl ? (
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 break-all text-xs font-semibold text-stone-800 underline decoration-stone-300 underline-offset-2"
            >
              {shipment.carrier.toUpperCase()} {shipment.trackingNumber}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <p className="break-all text-xs font-semibold text-stone-800">
              {shipment.carrier.toUpperCase()} {shipment.trackingNumber}
            </p>
          )}
          {shipment.deliveredAt ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Carrier-Zustellung {dateLabel(shipment.deliveredAt, true)}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-4 text-amber-700">
              Tracking vorhanden, Zustellung noch nicht belegt
            </p>
          )}
          {entry.shipments.length > 1 ? (
            <p className="mt-1 text-xs text-stone-500">
              + {entry.shipments.length - 1} weitere Sendung(en)
            </p>
          ) : null}
        </div>
      ) : entry.fulfillmentStatus.toLowerCase() === "fulfilled" ? (
        <p className="mt-2 text-xs font-semibold leading-4 text-amber-700">
          Fulfilled, aber keine Sendungsnummer in der Versandakte
        </p>
      ) : (
        <p className="mt-2 text-xs text-stone-500">Noch keine Sendung</p>
      )}
    </div>
  );
}

function CaseTable({
  cases,
  onOpen,
  onInsolvencyOpen,
  loadingKey,
}: {
  cases: DunningCaseSummary[];
  onOpen: (entry: DunningCaseSummary) => void;
  onInsolvencyOpen: (entry: DunningCaseSummary) => void;
  loadingKey: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-[22px] border border-[#ded8d0] bg-white shadow-[0_16px_44px_rgba(20,16,12,0.05)]">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[1480px] border-collapse text-left">
          <thead className="bg-[#f5f1ea] text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
            <tr>
              <th className="px-4 py-3">Bestellung</th>
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Offen</th>
              <th className="px-4 py-3">Versand / Zustellung</th>
              <th className="px-4 py-3">Mahnstufe</th>
              <th className="px-4 py-3">Nächste Aktion</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {cases.map((entry) => (
              <tr
                key={entry.key}
                className="align-top transition hover:bg-[#fcfaf7]"
              >
                <td className="px-4 py-4">
                  <button
                    onClick={() => onOpen(entry)}
                    className="font-semibold text-stone-950 underline-offset-4 hover:underline"
                  >
                    {entry.orderNumber}
                  </button>
                  <p className="mt-1 text-xs text-stone-500">
                    {dateLabel(entry.orderCreatedAt)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-stone-600">
                    Rechnung {entry.easybillInvoiceNumber || "nicht zugeordnet"}
                  </p>
                </td>
                <td className="max-w-[18rem] px-4 py-4">
                  <p className="truncate text-sm font-semibold text-stone-850">
                    {entry.company || entry.customerName || "Kunde unbekannt"}
                  </p>
                  {entry.company &&
                  entry.customerName &&
                  entry.customerName !== entry.company ? (
                    <p className="truncate text-xs text-stone-500">
                      {entry.customerName}
                    </p>
                  ) : null}
                  <p className="mt-1 truncate text-xs text-stone-500">
                    {entry.email || "Keine E-Mail"}
                  </p>
                  <p className="mt-1 flex items-center gap-1 truncate text-xs text-stone-500">
                    <Phone className="h-3 w-3 shrink-0" />
                    {entry.phone || "Keine Telefonnummer"}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <p className="whitespace-nowrap text-sm font-semibold text-stone-950">
                    {money(entry.amountCents, entry.currency)}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {relativeDue(entry)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <ShipmentSummary entry={entry} />
                  <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
                    <WalletCards className="h-3.5 w-3.5" />
                    {entry.financialStatus}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <StageBadge entry={entry} />
                </td>
                <td className="px-4 py-4">
                  <p className="max-w-[16rem] text-xs font-semibold leading-5 text-stone-800">
                    {entry.nextActionLabel}
                  </p>
                  <NextActionSchedule entry={entry} />
                  <p className="mt-1 text-xs text-stone-500">
                    Letzter Kontakt {dateLabel(entry.lastContactAt, true)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2">
                    <InsolvencyCheckButton
                      entry={entry}
                      onOpen={onInsolvencyOpen}
                    />
                  </div>
                  <StatusBadge entry={entry} />
                  {entry.courtEvent ? (
                    <div className="mt-2">
                      <CourtStatusBadge entry={entry} />
                    </div>
                  ) : null}
                  {entry.customerReplied ? (
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-800">
                      <MessageSquareReply className="h-3.5 w-3.5" /> Antwort
                      vorhanden
                    </p>
                  ) : null}
                  {entry.state === "data_issue" && entry.primaryBlocker ? (
                    <p className="mt-2 max-w-[14rem] text-xs leading-4 text-orange-800">
                      {entry.primaryBlocker}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-4 text-right">
                  <button
                    onClick={() => onOpen(entry)}
                    disabled={loadingKey === entry.key}
                    className="inline-flex items-center gap-1 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 transition hover:border-stone-500 disabled:opacity-50"
                  >
                    {entry.paymentException
                      ? "Klärfall öffnen"
                      : entry.legalReviewReady
                        ? "Prüfung öffnen"
                        : entry.nextStage
                          ? "Nächste Stufe"
                          : "Details"}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-stone-100 lg:hidden">
        {cases.map((entry) => (
          <article key={entry.key} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <button
                  onClick={() => onOpen(entry)}
                  className="text-left text-base font-semibold text-stone-950"
                >
                  {entry.orderNumber}
                </button>
                <p className="mt-1 text-sm text-stone-700">
                  {entry.company || entry.customerName || "Kunde unbekannt"}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {entry.email || "Keine E-Mail"}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {entry.phone || "Keine Telefonnummer"}
                </p>
              </div>
              <div className="grid justify-items-end gap-2">
                <StatusBadge entry={entry} />
                <CourtStatusBadge entry={entry} />
                <InsolvencyCheckButton
                  entry={entry}
                  onOpen={onInsolvencyOpen}
                />
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-stone-200 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                Nächste Aktion
              </p>
              <p className="mt-1 text-sm font-semibold text-stone-800">
                {entry.nextActionLabel}
              </p>
              <NextActionSchedule entry={entry} />
              <p className="mt-1 text-xs text-stone-500">
                Rechnung {entry.easybillInvoiceNumber || "nicht zugeordnet"}
              </p>
            </div>
            <div className="mt-3 rounded-xl border border-stone-200 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                Versand / Zustellung
              </p>
              <div className="mt-2">
                <ShipmentSummary entry={entry} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#f8f5f0] p-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                  Offen
                </p>
                <p className="mt-1 font-semibold text-stone-950">
                  {money(entry.amountCents, entry.currency)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                  Stufe
                </p>
                <p className="mt-1 text-sm font-semibold text-stone-800">
                  {entry.currentStage}: {entry.currentStageLabel}
                </p>
              </div>
            </div>
            <button
              onClick={() => onOpen(entry)}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Fall öffnen
              <ChevronRight className="h-4 w-4" />
            </button>
          </article>
        ))}
      </div>
      {!cases.length ? (
        <div className="p-10 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-700" />
          <p className="mt-3 text-sm font-semibold text-stone-800">
            Keine Fälle für diese Filter
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Filter ändern oder zurücksetzen.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function InsolvencyCheckModal({
  entry,
  onClose,
}: {
  entry: DunningCaseSummary;
  onClose: () => void;
}) {
  const check = entry.insolvencyCheck;
  if (!check) return null;
  const identityLabel =
    check.identity.kind === "company"
      ? check.identity.companyName
      : [check.identity.firstName, check.identity.lastName]
          .filter(Boolean)
          .join(" ");
  const warningTone =
    check.resultCode === "public_notice_found"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : check.resultCode === "no_public_notice_found"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-stone-950/55 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="insolvency-check-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[24px] bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-xs font-semibold text-[#b91c73]">
              Amtliche Insolvenzprüfung
            </p>
            <h2
              id="insolvency-check-title"
              className="mt-1 text-xl font-semibold text-stone-950"
            >
              {entry.orderNumber} · {check.resultLabel}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Prüfdetails schließen"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-300 text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div className={`rounded-2xl border p-4 ${warningTone}`}>
            <p className="font-semibold">{check.resultLabel}</p>
            <p className="mt-1 text-sm leading-6">
              {check.resultCode === "no_public_notice_found"
                ? "Zum Prüfzeitpunkt wurde unter den verwendeten Schuldnerdaten kein öffentlicher Insolvenzhinweis gefunden. Das beweist keine Zahlungsfähigkeit."
                : check.resultCode === "public_notice_found"
                  ? "Es wurde mindestens eine exakt zu Firma/Person und Ort passende amtliche Veröffentlichung gefunden. Vor jedem weiteren Schritt manuell prüfen."
                  : "Das Ergebnis ist nicht eindeutig oder konnte technisch nicht abschließend ermittelt werden. Keine gerichtliche Aktion automatisch auslösen."}
            </p>
          </div>
          <dl className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                Geprüfte Schuldnerdaten
              </dt>
              <dd className="mt-1 font-semibold text-stone-900">
                {identityLabel || "Unvollständig"}
                {check.identity.locality ? ` · ${check.identity.locality}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                Geprüft am
              </dt>
              <dd className="mt-1 font-semibold text-stone-900">
                {dateLabel(check.checkedAt || check.updatedAt, true)}
              </dd>
            </div>
          </dl>
          {check.matches.length ? (
            <div className="overflow-hidden rounded-2xl border border-stone-200">
              <div className="border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-900">
                Amtliche Veröffentlichungen ({check.matchCount})
              </div>
              <div className="divide-y divide-stone-200">
                {check.matches.map((match) => (
                  <article
                    key={`${match.court}:${match.fileNumber}:${match.publicationDate}`}
                    className="grid gap-2 p-4 text-sm sm:grid-cols-2"
                  >
                    <p>
                      <strong>{match.subjectName}</strong>
                      <br />
                      {match.locality}
                    </p>
                    <p>
                      {match.court}
                      <br />
                      Az. {match.fileNumber}
                    </p>
                    <p>Veröffentlicht: {match.publicationDate}</p>
                    <p>{match.register || "Kein Registereintrag angegeben"}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 p-4">
            <p className="max-w-xl text-xs leading-5 text-stone-500">
              Quelle: deutsche Insolvenzgerichte. Veröffentlichungen werden nach
              gesetzlichen Fristen gelöscht; der Abruf ist deshalb keine
              vollständige Bonitätsauskunft. Es wurde weder ein Mahnantrag
              gestellt noch eine Kundenmail versendet.
            </p>
            <a
              href={check.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800"
            >
              Amtliche Quelle <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

const COURT_LEGAL_FORMS = [
  "GmbH",
  "UG (haftungsbeschränkt)",
  "AG",
  "eG",
  "GmbH & Co KG",
  "GmbH & Co OHG",
  "KG",
  "OHG",
  "Partnerschaft",
  "Partnerschaft mbB",
  "SE",
] as const;

const COURT_REPRESENTATIVE_FUNCTIONS: DunningCourtRepresentative["function"][] =
  [
    "Geschäftsführer",
    "Geschäftsführerin",
    "Geschäftsführender Gesellschafter",
    "Geschäftsführende Gesellschafterin",
    "Managing Director",
  ];

type CourtProfileForm = {
  legalName: string;
  legalForm: string;
  street: string;
  postalCode: string;
  city: string;
  representatives: DunningCourtRepresentative[];
  registerCourt: string;
  registerType: string;
  registerNumber: string;
  sourceUrl: string;
  communicationReviewed: boolean;
};

function courtProfileForm(
  profile: DunningCourtProfile | null,
): CourtProfileForm {
  return {
    legalName: profile?.legalName || "",
    legalForm: profile?.legalForm || "GmbH",
    street: profile?.street || "",
    postalCode: profile?.postalCode || "",
    city: profile?.city || "",
    representatives: profile?.representatives.length
      ? profile.representatives
      : [{ function: "Geschäftsführer", name: "" }],
    registerCourt: profile?.registerCourt || "",
    registerType: profile?.registerType || "HRB",
    registerNumber: profile?.registerNumber || "",
    sourceUrl: profile?.sourceUrl || "https://www.unternehmensregister.de/",
    communicationReviewed: false,
  };
}

function CourtProfileModal({
  detail,
  onClose,
  onSaved,
}: {
  detail: DunningCaseDetail;
  onClose: () => void;
  onSaved: (profile: DunningCourtProfile) => void;
}) {
  const [form, setForm] = useState(() => courtProfileForm(detail.courtProfile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRepresentative(
    index: number,
    patch: Partial<DunningCourtRepresentative>,
  ) {
    setForm((current) => ({
      ...current,
      representatives: current.representatives.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/ops/dunning/${encodeURIComponent(detail.case.key)}/court-profile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify_profile",
            ...form,
            communicationReviewed: form.communicationReviewed || undefined,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(
          payload.error || "Gerichtsdaten konnten nicht gespeichert werden.",
        );
      onSaved(payload.profile);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Gerichtsdaten konnten nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-stone-950/50 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="court-profile-title"
        className="my-6 w-full max-w-3xl rounded-[24px] bg-[#f7f4ee] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-stone-200 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
              Gerichtliche Vorbereitung
            </p>
            <h2 id="court-profile-title" className="mt-1 text-xl font-semibold">
              Schuldnerdaten amtlich prüfen
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {detail.case.orderNumber}: Firmenname ohne Rechtsform eingeben.
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-300 bg-white"
            aria-label="Gerichtsdaten schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="grid gap-5 p-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Übernimm Firma, Zustellanschrift und Vertretungsberechtigte aus dem
            aktuellen Handels- oder Unternehmensregister. Diese Prüfung ist
            Voraussetzung; der Button reicht noch nichts beim Gericht ein.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Firma ohne Rechtsform
              <input
                value={form.legalName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    legalName: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Rechtsform
              <select
                value={form.legalForm}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    legalForm: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              >
                {COURT_LEGAL_FORMS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700 sm:col-span-2">
              Zustellfähige Straße und Hausnummer
              <input
                value={form.street}
                onChange={(event) =>
                  setForm((current) => ({ ...current, street: event.target.value }))
                }
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              PLZ
              <input
                value={form.postalCode}
                inputMode="numeric"
                maxLength={5}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    postalCode: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Ort
              <input
                value={form.city}
                onChange={(event) =>
                  setForm((current) => ({ ...current, city: event.target.value }))
                }
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              />
            </label>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Vertretungsberechtigte</h3>
              <button
                type="button"
                disabled={form.representatives.length >= 6}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    representatives: [
                      ...current.representatives,
                      { function: "Geschäftsführer", name: "" },
                    ],
                  }))
                }
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              >
                Person hinzufügen
              </button>
            </div>
            <div className="mt-3 grid gap-3">
              {form.representatives.map((representative, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-xl border border-stone-200 bg-white p-3 sm:grid-cols-[0.9fr_1.1fr_auto]"
                >
                  <select
                    aria-label={`Funktion Person ${index + 1}`}
                    value={representative.function}
                    onChange={(event) =>
                      updateRepresentative(index, {
                        function: event.target
                          .value as DunningCourtRepresentative["function"],
                      })
                    }
                    className="h-11 rounded-lg border border-stone-300 px-3 text-sm"
                  >
                    {COURT_REPRESENTATIVE_FUNCTIONS.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <input
                    aria-label={`Name Person ${index + 1}`}
                    value={representative.name}
                    onChange={(event) =>
                      updateRepresentative(index, { name: event.target.value })
                    }
                    placeholder="Vor- und Nachname"
                    className="h-11 rounded-lg border border-stone-300 px-3 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={`Person ${index + 1} entfernen`}
                    disabled={form.representatives.length === 1}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        representatives: current.representatives.filter(
                          (_, entryIndex) => entryIndex !== index,
                        ),
                      }))
                    }
                    className="h-11 rounded-lg border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40"
                  >
                    Entfernen
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Registergericht
              <input
                value={form.registerCourt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    registerCourt: event.target.value,
                  }))
                }
                placeholder="Amtsgericht Essen"
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Registerart
              <select
                value={form.registerType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    registerType: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              >
                {["HRB", "HRA", "GnR", "PR", "VR"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Registernummer
              <input
                value={form.registerNumber}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    registerNumber: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Amtlicher Register-Link
            <input
              type="url"
              value={form.sourceUrl}
              onChange={(event) =>
                setForm((current) => ({ ...current, sourceUrl: event.target.value }))
              }
              className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
            />
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-700">
            <input
              type="checkbox"
              checked={form.communicationReviewed}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  communicationReviewed: event.target.checked,
                }))
              }
              className="mt-1 h-4 w-4"
            />
            <span>
              Ich habe den vollständigen E-Mail-Verlauf und mögliche Einwände
              geprüft. Es gibt keinen ungeklärten Widerspruch zur Forderung.
            </span>
          </label>
          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="h-11 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold"
            >
              Abbrechen
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || !form.communicationReviewed}
              className="h-11 rounded-xl bg-violet-800 px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Prüfung wird gespeichert" : "Daten geprüft speichern"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function DetailDrawer({
  detail,
  preview,
  courtPreview,
  loading,
  actionBusy,
  sendConfigured,
  confirmation,
  courtConfirmation,
  note,
  error,
  notice,
  onClose,
  onPreview,
  onSend,
  onCourtProfileOpen,
  onCourtPreview,
  onCourtPrepare,
  onInsolvencyOpen,
  setConfirmation,
  setCourtConfirmation,
  setNote,
}: {
  detail: DunningCaseDetail;
  preview: DunningActionPreview | null;
  courtPreview: DunningCourtApplicationPreview | null;
  loading: boolean;
  actionBusy: boolean;
  sendConfigured: boolean;
  confirmation: string;
  courtConfirmation: string;
  note: string;
  error: string | null;
  notice: string | null;
  onClose: () => void;
  onPreview: () => void;
  onSend: () => void;
  onCourtProfileOpen: () => void;
  onCourtPreview: () => void;
  onCourtPrepare: () => void;
  onInsolvencyOpen: (entry: DunningCaseSummary) => void;
  setConfirmation: (value: string) => void;
  setCourtConfirmation: (value: string) => void;
  setNote: (value: string) => void;
}) {
  const entry = detail.case;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-stone-950/40 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dunning-detail-title"
        className="h-full w-full max-w-3xl overflow-y-auto bg-[#f7f4ee] shadow-2xl"
      >
        <header className="sticky top-0 z-10 border-b border-stone-200 bg-[#f7f4ee]/95 px-5 py-4 backdrop-blur md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-[#b91c73]">Mahnfall</p>
              <h2
                id="dunning-detail-title"
                className="mt-1 text-2xl font-semibold text-stone-950"
              >
                {entry.orderNumber}
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                {entry.company || entry.customerName || "Kunde unbekannt"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-700"
              aria-label="Fall schließen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="space-y-5 p-5 md:p-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">Offener Betrag</p>
              <p className="mt-2 text-xl font-semibold">
                {money(entry.amountCents, entry.currency)}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">Aktuelle Stufe</p>
              <p className="mt-2 text-sm font-semibold">
                {entry.currentStage}: {entry.currentStageLabel}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">Fälligkeit</p>
              <p className="mt-2 text-sm font-semibold">
                {entry.dueDate ? dateLabel(entry.dueDate) : "Nicht belegt"}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">Arbeitsstatus</p>
              <div className="mt-2">
                <StatusBadge entry={entry} />
              </div>
            </div>
          </section>
          <section className="grid gap-3 rounded-[22px] border border-stone-200 bg-white p-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                Kunde und Kontakt
              </p>
              <p className="mt-2 text-sm font-semibold text-stone-950">
                {entry.company || "Keine Firma"}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {entry.customerName || "Keine Kontaktperson"}
              </p>
              <p className="mt-2 break-all text-sm text-stone-600">
                {entry.email || "Keine E-Mail"}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {entry.phone || "Keine Telefonnummer"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                Forderung und Fristen
              </p>
              <p className="mt-2 flex items-center gap-2 text-sm text-stone-700">
                <ReceiptText className="h-4 w-4 text-stone-400" />
                {entry.easybillInvoiceNumber || "Keine Rechnungsnummer"}
              </p>
              <p className="mt-2 text-sm text-stone-700">
                Lieferung: {entry.fulfillmentStatus} · Zahlung:{" "}
                {entry.financialStatus}
              </p>
              <p className="mt-2 text-sm font-semibold text-stone-900">
                {entry.nextActionLabel}
              </p>
              <NextActionSchedule entry={entry} />
              <p className="mt-1 text-xs text-stone-500">
                Letzter Kontakt {dateLabel(entry.lastContactAt, true)}
              </p>
            </div>
          </section>
          {entry.paymentException ? (
            <section className="rounded-[22px] border border-amber-200 bg-amber-50 p-5 text-amber-950">
              <h3 className="font-semibold">Bezahlter Shopify-Ausnahmefall</h3>
              <p className="mt-1 text-sm leading-6">
                Die Forderung ist ausgeglichen, aber der Tag „
                {entry.paymentExceptionTag}“ ist gesetzt. Der Fall bleibt nur
                zur manuellen Datenprüfung sichtbar; es wird keine weitere
                Mahn-E-Mail geplant.
              </p>
            </section>
          ) : null}
          <section className="rounded-[22px] border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-stone-950">
                  Versand- und Zustellnachweis
                </h3>
                <p className="mt-1 max-w-xl text-sm leading-6 text-stone-500">
                  Eine Sendungsnummer belegt den Versandweg. Erst ein
                  gespeicherter Carrier-Zustellzeitpunkt belegt in dieser Akte
                  die Zustellung; ein separates POD-Dokument ist damit noch
                  nicht archiviert.
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${entry.carrierDeliveryConfirmed ? "border-emerald-200 bg-emerald-50 text-emerald-800" : entry.hasTracking ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-200 bg-stone-50 text-stone-600"}`}
              >
                {entry.carrierDeliveryConfirmed
                  ? "Carrier-Zustellung bestätigt"
                  : entry.hasTracking
                    ? "Nur Tracking vorhanden"
                    : "Kein Tracking hinterlegt"}
              </span>
            </div>
            {entry.shipments.length ? (
              <div className="mt-4 grid gap-3">
                {entry.shipments.map((shipment) => (
                  <article
                    key={shipment.id}
                    className="rounded-2xl border border-stone-200 bg-[#faf8f4] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                          {shipment.carrier}
                        </p>
                        {shipment.trackingNumber ? (
                          <p className="mt-1 break-all font-semibold text-stone-950">
                            {shipment.trackingNumber}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-stone-600">
                            Keine Sendungsnummer
                          </p>
                        )}
                      </div>
                      {shipment.trackingUrl ? (
                        <a
                          href={shipment.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800"
                        >
                          Tracking öffnen{" "}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-stone-500">Versandt</dt>
                        <dd className="mt-1 font-semibold text-stone-800">
                          {dateLabel(shipment.shippedAt, true)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-stone-500">Zugestellt</dt>
                        <dd className="mt-1 font-semibold text-stone-800">
                          {dateLabel(shipment.deliveredAt, true)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-stone-500">
                          Letzter Carrier-Abgleich
                        </dt>
                        <dd className="mt-1 font-semibold text-stone-800">
                          {dateLabel(shipment.lastCarrierSyncAt, true)}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {entry.fulfillmentStatus.toLowerCase() === "fulfilled"
                  ? "Shopify meldet Fulfilled, aber in der Versandakte fehlt noch eine Sendungsnummer."
                  : "Für diese Bestellung ist noch keine Sendung in der Versandakte vorhanden."}
              </p>
            )}
            <p className="mt-4 text-xs leading-5 text-stone-500">
              Empfohlen für die nächste Ausbaustufe: Carrier-POD oder
              Zustell-PDF automatisch abrufen und dauerhaft an dieser Fallakte
              archivieren, bevor der Carrier-Link abläuft.
            </p>
          </section>
          {entry.courtEvent ? (
            <section className="rounded-[22px] border border-violet-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                    Offizielles gerichtliches Mahnverfahren
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-stone-950">
                    Aktueller Verfahrensstand
                  </h3>
                </div>
                <CourtStatusBadge entry={entry} />
              </div>
              {entry.courtEvent.eventType === "application_draft_created" ? (
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                  Der amtliche Barcode-PDF-Antrag wurde erstellt. Er wurde noch
                  nicht beim Mahngericht eingereicht, noch nicht gerichtlich
                  geprüft und noch nicht als gelber Brief zugestellt.
                </p>
              ) : (
                <p className="mt-4 text-sm leading-6 text-stone-600">
                  Der Verfahrensstand wird getrennt von Mahnstufe,
                  Insolvenzprüfung und Kunden-E-Mails geführt. Dadurch wird ein
                  Entwurf niemals mit Einreichung oder Zustellung verwechselt.
                </p>
              )}
              <p className="mt-3 text-xs text-stone-500">
                Erfasst am {dateLabel(entry.courtEvent.occurredOn)}
                {entry.courtEvent.sourceReference
                  ? ` · Nachweis ${entry.courtEvent.sourceReference}`
                  : ""}
              </p>
              {entry.courtEvent.note ? (
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {entry.courtEvent.note}
                </p>
              ) : null}
            </section>
          ) : null}
          {entry.courtReview || entry.insolvencyCheck ? (
            <section className="rounded-[22px] border border-violet-200 bg-violet-50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-violet-950">
                    Amtliche Insolvenzprüfung
                  </h3>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-violet-800">
                    Beim Status „Gericht prüfen“ wird die kostenlose amtliche
                    Insolvenzbekanntmachung automatisch als Einzelabruf geprüft.
                    Das Ergebnis entscheidet nicht automatisch über einen
                    gerichtlichen Mahnantrag.
                  </p>
                </div>
                <InsolvencyCheckButton
                  entry={entry}
                  onOpen={onInsolvencyOpen}
                />
              </div>
            </section>
          ) : null}
          {entry.courtReview ? (
            <section className="rounded-[22px] border border-violet-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                    Amtlicher Barcode-Antrag
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-stone-950">
                    Gerichtlichen Mahnantrag vorbereiten
                  </h3>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-stone-600">
                    Der Ein-Klick-Ablauf füllt online-mahnantrag.de aus, prüft
                    die amtliche PDF und sendet sie ausschließlich intern zur
                    Unterschrift. Er reicht nichts beim Gericht ein und
                    versendet keine Kundenmail.
                  </p>
                </div>
                {!entry.courtEvent ? (
                  <button
                    onClick={onCourtProfileOpen}
                    disabled={actionBusy}
                    className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-900 disabled:opacity-50"
                  >
                    Gerichtsdaten prüfen
                  </button>
                ) : null}
              </div>
              {detail.courtProfile ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                  <p className="font-semibold">
                    Daten geprüft: {detail.courtProfile.legalName}{" "}
                    {detail.courtProfile.legalForm}
                  </p>
                  <p className="mt-1">
                    {detail.courtProfile.street}, {detail.courtProfile.postalCode}{" "}
                    {detail.courtProfile.city} · {detail.courtProfile.registerCourt}{" "}
                    {detail.courtProfile.registerType}{" "}
                    {detail.courtProfile.registerNumber}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">
                    Geprüft am {dateLabel(detail.courtProfile.verifiedAt, true)} ·{" "}
                    {detail.courtProfile.representatives
                      .map((person) => `${person.function} ${person.name}`)
                      .join("; ")}
                  </p>
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  Aktuelle Registeranschrift, Rechtsform und Vertretung sind
                  noch nicht als geprüft gespeichert.
                </p>
              )}
              {detail.courtDraftJob ? (
                <p className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                  Letzter PDF-Auftrag: {detail.courtDraftJob.status} ·{" "}
                  {dateLabel(detail.courtDraftJob.updatedAt, true)}
                  {detail.courtDraftJob.pdfFilename
                    ? ` · ${detail.courtDraftJob.pdfFilename}`
                    : ""}
                </p>
              ) : null}
              {detail.courtProfile && !entry.courtEvent ? (
                <button
                  onClick={onCourtPreview}
                  disabled={actionBusy}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Gavel className="h-4 w-4" />
                  {actionBusy
                    ? "Vorprüfung läuft"
                    : "Amtlichen Antrag vorbereiten"}
                </button>
              ) : null}
              {courtPreview ? (
                <div className="mt-4 grid gap-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-violet-700">Antragsgegner</p>
                      <p className="mt-1 font-semibold">{courtPreview.debtorLabel}</p>
                    </div>
                    <div>
                      <p className="text-xs text-violet-700">Hauptforderung</p>
                      <p className="mt-1 font-semibold">
                        {money(courtPreview.amountCents, courtPreview.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-violet-700">Rechnung</p>
                      <p className="mt-1 font-semibold">
                        {courtPreview.invoiceNumber} vom{" "}
                        {dateLabel(courtPreview.invoiceDate)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-violet-700">Interner Empfänger</p>
                      <p className="mt-1 break-all font-semibold">
                        {courtPreview.internalRecipient || "Nicht konfiguriert"}
                      </p>
                    </div>
                  </div>
                  {courtPreview.warnings.length ? (
                    <ul className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                      {courtPreview.warnings.map((warning) => (
                        <li key={warning}>- {warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {courtPreview.blockers.length ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                      <p className="font-semibold">Vorbereitung ist blockiert</p>
                      <ul className="mt-2 grid gap-1">
                        {courtPreview.blockers.map((blocker) => (
                          <li key={blocker}>- {blocker}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                      Vorprüfung bestanden. Nach Bestätigung wird ausschließlich
                      die amtliche PDF erzeugt und intern versendet.
                    </div>
                  )}
                  {courtPreview.allowed ? (
                    <div className="grid gap-3">
                      <label className="grid gap-1.5 text-sm font-semibold text-stone-700">
                        Zur Bestätigung exakt eingeben
                        <code className="w-fit rounded-lg bg-stone-950 px-2 py-1 text-xs text-white">
                          {courtPreview.confirmationPhrase}
                        </code>
                        <input
                          value={courtConfirmation}
                          onChange={(event) =>
                            setCourtConfirmation(event.target.value)
                          }
                          autoComplete="off"
                          className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal"
                        />
                      </label>
                      <button
                        onClick={onCourtPrepare}
                        disabled={
                          actionBusy ||
                          courtConfirmation !== courtPreview.confirmationPhrase
                        }
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        <MailCheck className="h-4 w-4" />
                        {actionBusy
                          ? "Amtliche PDF wird erstellt"
                          : "PDF erstellen und intern senden"}
                      </button>
                      <p className="text-xs leading-5 text-violet-800">
                        Danach: PDF prüfen, einseitig ausdrucken, unterschreiben
                        und per Post an das im Antrag genannte Amtsgericht Hagen
                        senden. Erst das Gericht kann den gelben Brief zustellen.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
          <section className="rounded-[22px] border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-stone-950">
                  Nächste Aktion
                </h3>
                <p className="mt-1 text-sm text-stone-500">
                  Vor jedem Versand werden Shopify, Easybill, Sperren, Antworten
                  und der Einmal-Schlüssel erneut geprüft.
                </p>
              </div>
              {entry.nextStage && sendConfigured ? (
                <button
                  onClick={onPreview}
                  disabled={loading || actionBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50"
                >
                  <ShieldAlert className="h-4 w-4" />
                  {loading
                    ? "Prüfung läuft"
                    : `Stufe ${entry.nextStage} prüfen`}
                </button>
              ) : null}
            </div>
            <div
              className={`mt-4 rounded-xl border p-4 text-sm ${entry.legalReviewReady ? "border-violet-200 bg-violet-50 text-violet-900" : entry.finalReminderWaiting ? "border-indigo-200 bg-indigo-50 text-indigo-900" : "border-stone-200 bg-stone-50 text-stone-700"}`}
            >
              <p className="font-semibold">{entry.nextActionLabel}</p>
              <NextActionSchedule entry={entry} />
              {entry.legalReviewReady ? (
                <p className="mt-1">
                  Die letzte Mahnstufe liegt mindestens sieben Tage zurück. Die
                  amtliche Insolvenzbekanntmachung wird automatisch geprüft.
                  Zahlung, Forderungsbelege und der gerichtliche Mahnantrag
                  bleiben eine bewusste manuelle Entscheidung.
                </p>
              ) : entry.finalReminderWaiting ? (
                <p className="mt-1">
                  Die letzte Frist läuft bis{" "}
                  {dateLabel(entry.legalReviewDueAt, true)}. Bis dahin ist noch
                  keine gerichtliche Prüfung fällig.
                </p>
              ) : entry.nextStage ? (
                <p className="mt-1">
                  Der bestehende TICKET-099-Sender übernimmt die nächste Stufe
                  automatisch zum belegten Termin. Ein manueller Sonderversand
                  ist nur bei gesonderter Freischaltung möglich.
                </p>
              ) : (
                <p className="mt-1">
                  Für diesen Fall ist keine weitere automatische E-Mail-Stufe
                  bestimmbar. Sperren und Datenhinweise in der Fallakte prüfen.
                </p>
              )}
            </div>
            {preview ? (
              <div className="mt-4 space-y-4 rounded-2xl border border-stone-200 bg-[#faf8f4] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-stone-500">Nächster Schritt</p>
                    <p className="mt-1 font-semibold text-stone-900">
                      Stufe {preview.nextStage}: {preview.nextStageLabel}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500">Empfänger</p>
                    <p className="mt-1 break-all font-semibold text-stone-900">
                      {preview.recipient}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500">Geplanter Termin</p>
                    <p className="mt-1 font-semibold text-stone-900">
                      {dateLabel(preview.scheduledAt, true)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500">Anlage</p>
                    <p className="mt-1 font-semibold text-stone-900">
                      {preview.attachmentRequired
                        ? "Easybill-Rechnung erforderlich"
                        : "Keine Anlage"}
                    </p>
                  </div>
                </div>
                {preview.blockers.length ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-900">
                      Versand ist blockiert
                    </p>
                    <ul className="mt-2 grid gap-1 text-sm text-amber-900">
                      {preview.blockers.map((blocker) => (
                        <li key={blocker}>- {blocker}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    Vorprüfung bestanden. Der Versand-Workflow prüft die
                    Live-Daten unmittelbar vor der E-Mail noch einmal.
                  </div>
                )}
                {preview.allowed ? (
                  <div className="grid gap-3">
                    <label className="grid gap-1.5 text-sm font-semibold text-stone-700">
                      <span>Optionale interne Notiz</span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={500}
                        rows={2}
                        className="rounded-xl border border-stone-300 bg-white px-3 py-2 font-normal outline-none focus:border-[#fa31a2]"
                        placeholder="Warum wird diese Stufe jetzt manuell angestoßen?"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-stone-700">
                      <span>Zur Bestätigung exakt eingeben</span>
                      <code className="w-fit rounded-lg bg-stone-950 px-2 py-1 text-xs text-white">
                        {preview.confirmationPhrase}
                      </code>
                      <input
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                        className="h-11 rounded-xl border border-stone-300 bg-white px-3 font-normal outline-none focus:border-[#fa31a2]"
                        autoComplete="off"
                      />
                    </label>
                    <button
                      onClick={onSend}
                      disabled={
                        actionBusy ||
                        confirmation !== preview.confirmationPhrase ||
                        !sendConfigured
                      }
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send className="h-4 w-4" />
                      {actionBusy
                        ? "Versand wird geprüft"
                        : `Stufe ${preview.nextStage} jetzt senden`}
                    </button>
                    {!sendConfigured ? (
                      <p className="text-xs leading-5 text-amber-800">
                        Der geschützte manuelle Versandkanal ist in dieser
                        Umgebung noch nicht freigeschaltet. Vorschau und alle
                        Prüfungen funktionieren bereits; ohne Freigabe kann
                        keine Kundenmail ausgelöst werden.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p
                aria-live="polite"
                className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
              >
                {notice}
              </p>
            ) : null}
          </section>
          <section className="rounded-[22px] border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-stone-950">
                  Fallakte
                </h3>
                <p className="mt-1 text-sm text-stone-500">
                  Chronologisch aus Shopify, Easybill, Outlook und
                  Mahnnachweisen.
                </p>
              </div>
              <div className="flex gap-2">
                {entry.shopifyUrl ? (
                  <a
                    href={entry.shopifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold"
                  >
                    Shopify
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                {entry.easybillUrl ? (
                  <a
                    href={entry.easybillUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold"
                  >
                    Easybill
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
            <ol className="mt-5 space-y-0">
              {detail.timeline.map((item, index) => (
                <li
                  key={item.id}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3"
                >
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 h-3 w-3 rounded-full ${item.direction === "inbound" ? "bg-amber-500" : item.direction === "outbound" ? "bg-[#fa31a2]" : "bg-stone-400"}`}
                    />
                    {index < detail.timeline.length - 1 ? (
                      <span className="min-h-14 w-px flex-1 bg-stone-200" />
                    ) : null}
                  </div>
                  <div className="pb-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-stone-900">
                        {item.title}
                      </p>
                      <time className="text-xs text-stone-500">
                        {dateLabel(item.occurredAt, true)}
                      </time>
                    </div>
                    {item.detail ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-600">
                        {item.detail}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-stone-400">
                      {item.source}
                      {item.stage ? ` - Stufe ${item.stage}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {!detail.timeline.length ? (
              <p className="mt-4 text-sm text-stone-500">
                Noch keine Verlaufseinträge.
              </p>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}

export function DunningOpsClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [password, setPassword] = useState("");
  const [dashboard, setDashboard] = useState<DunningDashboard | null>(null);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DunningCaseDetail | null>(null);
  const [insolvencyCase, setInsolvencyCase] =
    useState<DunningCaseSummary | null>(null);
  const [detailLoadingKey, setDetailLoadingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<DunningActionPreview | null>(null);
  const [courtPreview, setCourtPreview] =
    useState<DunningCourtApplicationPreview | null>(null);
  const [courtProfileOpen, setCourtProfileOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [courtConfirmation, setCourtConfirmation] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (hasSession || localMode) void loadDashboard();
  }, [hasSession, localMode]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("q")?.trim();
    if (query) setFilters((current) => ({ ...current, query }));
  }, []);
  const visibleCases = useMemo(
    () => applyFilters(dashboard?.cases || [], filters),
    [dashboard, filters],
  );

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: password }),
    });
    if (!response.ok) return setError("Ops-Login fehlgeschlagen.");
    setHasSession(true);
    setPassword("");
  }

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/dunning", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(
          payload.error || "Mahnwesen konnte nicht geladen werden.",
        );
      setDashboard(payload.dashboard);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unbekannter Fehler.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openCase(entry: DunningCaseSummary) {
    setDetailLoadingKey(entry.key);
    setActionError(null);
    setNotice(null);
    setPreview(null);
    setCourtPreview(null);
    setCourtProfileOpen(false);
    setConfirmation("");
    setCourtConfirmation("");
    setNote("");
    try {
      const response = await fetch(
        `/api/ops/dunning/${encodeURIComponent(entry.key)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(
          payload.error || "Fallakte konnte nicht geladen werden.",
        );
      setSelected(payload.detail);
    } catch (detailError) {
      setError(
        detailError instanceof Error
          ? detailError.message
          : "Fallakte konnte nicht geladen werden.",
      );
    } finally {
      setDetailLoadingKey(null);
    }
  }

  async function previewNextStage() {
    if (!selected) return;
    setActionBusy(true);
    setActionError(null);
    setNotice(null);
    setConfirmation("");
    try {
      const response = await fetch(
        `/api/ops/dunning/${encodeURIComponent(selected.case.key)}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview_next_stage" }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(
          payload.blockers?.join("; ") ||
            payload.error ||
            "Nächste Stufe konnte nicht geprüft werden.",
        );
      setPreview(payload.preview);
    } catch (previewError) {
      setActionError(
        previewError instanceof Error
          ? previewError.message
          : "Vorprüfung fehlgeschlagen.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function sendNextStage() {
    if (!selected || !preview) return;
    setActionBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const idempotencyKey = `ops-dunning:${selected.case.shopifyOrderId}:S${preview.nextStage}:${crypto.randomUUID()}`;
      const response = await fetch(
        `/api/ops/dunning/${encodeURIComponent(selected.case.key)}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_next_stage",
            confirmation,
            expectedStage: preview.nextStage,
            expectedSnapshotHash: preview.snapshotHash,
            idempotencyKey,
            note,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(
          payload.error || "Versand konnte nicht gestartet werden.",
        );
      setNotice(
        "Versandprüfung wurde angenommen. Die Live-Gates und der Versandnachweis laufen jetzt im Mahnworkflow.",
      );
      setPreview(null);
      setConfirmation("");
      setNote("");
      await Promise.all([loadDashboard(), openCase(selected.case)]);
    } catch (sendError) {
      setActionError(
        sendError instanceof Error
          ? sendError.message
          : "Versand fehlgeschlagen.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function previewCourtApplication() {
    if (!selected) return;
    setActionBusy(true);
    setActionError(null);
    setNotice(null);
    setCourtConfirmation("");
    try {
      const response = await fetch(
        `/api/ops/dunning/${encodeURIComponent(selected.case.key)}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview_court_application" }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(
          payload.error || "Gerichtlicher Antrag konnte nicht geprüft werden.",
        );
      setCourtPreview(payload.preview);
    } catch (previewError) {
      setActionError(
        previewError instanceof Error
          ? previewError.message
          : "Gerichtliche Vorprüfung fehlgeschlagen.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function prepareCourtApplication() {
    if (!selected || !courtPreview) return;
    setActionBusy(true);
    setActionError(null);
    setNotice(null);
    const selectedCase = selected.case;
    try {
      const idempotencyKey = `ops-court:${selectedCase.shopifyOrderId || selectedCase.orderNumber}:${crypto.randomUUID()}`;
      const response = await fetch(
        `/api/ops/dunning/${encodeURIComponent(selectedCase.key)}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare_court_application",
            confirmation: courtConfirmation,
            expectedSnapshotHash: courtPreview.snapshotHash,
            idempotencyKey,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(
          payload.error || "Amtliche PDF konnte nicht vorbereitet werden.",
        );
      setCourtPreview(null);
      setCourtConfirmation("");
      await Promise.all([loadDashboard(), openCase(selectedCase)]);
      setNotice(
        "Die amtliche Barcode-PDF wurde intern zur Unterschrift versendet. Sie ist noch nicht beim Gericht eingereicht.",
      );
    } catch (prepareError) {
      setActionError(
        prepareError instanceof Error
          ? prepareError.message
          : "Amtliche PDF konnte nicht vorbereitet werden.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  if (!opsEnabled)
    return (
      <main className="min-h-screen bg-stone-100 p-8 text-stone-700">
        Ops Portal ist nicht konfiguriert.
      </main>
    );
  if (!hasSession && !localMode)
    return (
      <OpsLoginCard
        eyebrow="Mahnwesen"
        title="Forderungsmanagement anmelden"
        description="Melde dich mit deinem internen Zugang an. Mahnaktionen werden serverseitig geprüft und protokolliert."
        activeApp="dunning"
        showOperatorName={false}
        password={password}
        error={error}
        buttonLabel="Einloggen"
        onPasswordChange={setPassword}
        onSubmit={login}
      />
    );

  return (
    <main className={`${opsPageShellClass} px-4 py-6 md:px-6`}>
      <div className={`${opsPageContainerClass} space-y-6`}>
        <OpsPageHeader active="dunning" label="Forderungsmanagement" />
        <OpsPageIntro
          eyebrow="Mahnwesen"
          title="Offene Forderungen vom ersten Hinweis bis zum Gericht"
          description="Shopify-Saldo, Easybill-Fälligkeit, E-Mail-Verlauf und Versandnachweise werden je Bestellung in einer Fallakte zusammengeführt."
        >
          <button
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </button>
        </OpsPageIntro>
        {dashboard ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
              <OpsStatCard
                label="Offene Fälle"
                value={dashboard.stats.open}
                icon={<WalletCards className="h-5 w-5" />}
                detail={money(dashboard.stats.totalOutstandingCents)}
              />
              <OpsStatCard
                label="Versand fällig"
                value={dashboard.stats.actionRequired}
                tone={dashboard.stats.actionRequired ? "danger" : "success"}
                icon={<Send className="h-5 w-5" />}
              />
              <OpsStatCard
                label="Antworten"
                value={dashboard.stats.replies}
                tone={dashboard.stats.replies ? "warning" : "neutral"}
                icon={<MessageSquareReply className="h-5 w-5" />}
              />
              <OpsStatCard
                label="Letzte Frist"
                value={dashboard.stats.finalReminderWaiting}
                tone={dashboard.stats.finalReminderWaiting ? "info" : "neutral"}
                icon={<Clock3 className="h-5 w-5" />}
              />
              <OpsStatCard
                label="Solvenz/Gericht"
                value={dashboard.stats.courtReview}
                tone={dashboard.stats.courtReview ? "info" : "neutral"}
                icon={<Gavel className="h-5 w-5" />}
              />
              <OpsStatCard
                label="Pausiert"
                value={dashboard.stats.paused}
                tone="neutral"
                icon={<CirclePause className="h-5 w-5" />}
              />
              <OpsStatCard
                label="Daten prüfen"
                value={dashboard.stats.dataIssues}
                tone={dashboard.stats.dataIssues ? "warning" : "success"}
                icon={<FileWarning className="h-5 w-5" />}
              />
            </section>
            <section
              className={`flex flex-col gap-3 rounded-[18px] border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${dashboard.sourceHealth.intakeFresh ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
            >
              <div className="flex items-start gap-2">
                {dashboard.sourceHealth.intakeFresh ? (
                  <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div>
                  <p className="font-semibold">
                    {dashboard.sourceHealth.intakeFresh
                      ? "Live-Daten vollständig und frisch"
                      : "Versand bleibt wegen nicht frischer Live-Daten blockiert"}
                  </p>
                  <p className="mt-0.5 text-xs opacity-75">
                    Letzter T099-Stand{" "}
                    {dateLabel(dashboard.sourceHealth.intakeObservedAt, true)} -{" "}
                    {dashboard.sourceHealth.candidateCount} Live-Kandidaten -
                    Altbestand zuletzt{" "}
                    {dateLabel(dashboard.sourceHealth.legacyUpdatedAt)}
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold">
                Manueller Sonderversand:{" "}
                {dashboard.sendConfigured ? "freigeschaltet" : "gesperrt"}
              </span>
            </section>
            <FilterPanel
              filters={filters}
              setFilters={setFilters}
              count={visibleCases.length}
              total={dashboard.cases.length}
            />
            <CaseTable
              cases={visibleCases}
              onOpen={(entry) => void openCase(entry)}
              onInsolvencyOpen={setInsolvencyCase}
              loadingKey={detailLoadingKey}
            />
          </>
        ) : null}
        {loading && !dashboard ? (
          <section className="grid gap-3">
            <div className="h-24 animate-pulse rounded-[22px] bg-stone-200" />
            <div className="h-96 animate-pulse rounded-[22px] bg-stone-200" />
          </section>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </p>
        ) : null}
        {selected ? (
          <DetailDrawer
            detail={selected}
            preview={preview}
            courtPreview={courtPreview}
            loading={actionBusy}
            actionBusy={actionBusy}
            sendConfigured={Boolean(dashboard?.sendConfigured)}
            confirmation={confirmation}
            courtConfirmation={courtConfirmation}
            note={note}
            error={actionError}
            notice={notice}
            onClose={() => {
              setSelected(null);
              setPreview(null);
              setCourtPreview(null);
              setCourtProfileOpen(false);
            }}
            onInsolvencyOpen={setInsolvencyCase}
            onPreview={() => void previewNextStage()}
            onSend={() => void sendNextStage()}
            onCourtProfileOpen={() => setCourtProfileOpen(true)}
            onCourtPreview={() => void previewCourtApplication()}
            onCourtPrepare={() => void prepareCourtApplication()}
            setConfirmation={setConfirmation}
            setCourtConfirmation={setCourtConfirmation}
            setNote={setNote}
          />
        ) : null}
        {selected && courtProfileOpen ? (
          <CourtProfileModal
            detail={selected}
            onClose={() => setCourtProfileOpen(false)}
            onSaved={(profile) => {
              setSelected((current) =>
                current ? { ...current, courtProfile: profile } : current,
              );
              setCourtProfileOpen(false);
              setCourtPreview(null);
              setCourtConfirmation("");
              setNotice(
                "Gerichtsdaten und E-Mail-Prüfung wurden für diesen Fall gespeichert.",
              );
            }}
          />
        ) : null}
        {insolvencyCase ? (
          <InsolvencyCheckModal
            entry={insolvencyCase}
            onClose={() => setInsolvencyCase(null)}
          />
        ) : null}
      </div>
    </main>
  );
}
