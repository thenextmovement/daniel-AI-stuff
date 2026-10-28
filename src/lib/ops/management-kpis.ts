import { countryCode } from "@/lib/ops/billing/domain";
import { Temporal } from "@js-temporal/polyfill";
import { supabaseRequest, SupabaseRestError } from "@/lib/quotes/supabase-rest";
import {
  CX8_TAXONOMY_VERSION,
  formatCustomerSegmentLabel,
  isLegacyCustomerSegment,
} from "@/lib/ops/customer-segments";

type DateLike = string | null | undefined;

export type ManagementRangePreset = "today" | "7d" | "30d" | "month" | "quarter" | "custom";

export type ManagementKpiInput = {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  query?: string | null;
  source?: string | null;
  segment?: string | null;
  country?: string | null;
  customerType?: string | null;
};

export type ManagementKpiCard = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "watch" | "danger";
};

export type ManagementKpiDataQualityItem = {
  key: string;
  label: string;
  status: "good" | "partial" | "missing" | "risk";
  detail: string;
};

export type ManagementRiskItem = {
  key: string;
  label: string;
  detail: string;
  severity: "watch" | "high" | "urgent";
  href?: string | null;
};

export type ManagementTableRow = {
  key: string;
  label: string;
  count: number;
  value?: number | null;
  detail?: string | null;
};

export type ManagementKpiDashboard = {
  generatedAt: string;
  range: {
    preset: ManagementRangePreset;
    from: string;
    to: string;
    label: string;
  };
  filters: {
    query: string | null;
    source: string | null;
    segment: string | null;
    country: string | null;
    customerType: string | null;
  };
  summary: ManagementKpiCard[];
  sales: {
    newRequests: number;
    quoteCreated: number;
    quoteSent: number;
    quoteViewed: number;
    quoteSigned: number;
    orders: number;
    cancelledOrders: number;
    orderValue: number;
    quoteValue: number;
    pipelineValue: number;
    conversionRate: number | null;
    topSources: ManagementTableRow[];
    topSegments: ManagementTableRow[];
  };
  operations: {
    openSalesTasks: number;
    overdueSalesTasks: number;
    completedCalls: number;
    openShippingIncidents: number;
    openInboundIncidents: number;
    riskFeed: ManagementRiskItem[];
  };
  costs: {
    knownAdSpend: number;
    knownAiSpendUsd: number;
    knownVoiceSpendUsd: number;
    knownInboundProductionSpendUsd: number;
    knownInboundShippingSpendUsd: number;
    knownCostCoverage: "partial";
    missingSources: string[];
  };
  dataQuality: ManagementKpiDataQualityItem[];
};

type MasterRequestRow = {
  id: string;
  request_id: string | null;
  status: string | null;
  deal_status: string | null;
  segment: string | null;
  segment_taxonomy_version?: string | null;
  s_kategorie: string | null;
  customer_type: string | null;
  country: string | null;
  estimated_value: number | string | null;
  final_value: number | string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_page_url: string | null;
  referrer: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type OfferHistoryRow = {
  id: string;
  request_id: string | null;
  offer_status: string | null;
  total_value: number | string | null;
  currency: string | null;
  created_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
};

type MasterOrderRow = {
  id: string;
  request_id: string | null;
  shopify_order_number: string | null;
  order_value: number | string | null;
  subtotal_price: number | string | null;
  total_tax: number | string | null;
  currency: string | null;
  status: string | null;
  cancelled_at: string | null;
  shopify_created_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SeaCampaignDailyRow = {
  date: string;
  cost_eur: number | string | null;
  conversions: number | string | null;
  conversion_value: number | string | null;
  synced_at: string | null;
};

type GoogleAdsDailySpendRow = {
  date: string;
  spend: number | string | null;
  synced_at: string | null;
};

type AnthropicCostRow = {
  cost_date: string;
  total_cost_usd: number | string | null;
  total_cost_cents: number | string | null;
};

type CostEntryRow = {
  id: string;
  cost_key: string;
  source: string;
  category: "ads" | "ai" | "voice" | "shipping" | "production" | "customs" | "tool" | "manual" | "other";
  subcategory: string | null;
  amount: number | string;
  currency: "EUR" | "USD";
  occurred_on: string;
  confidence: "actual" | "derived" | "estimated";
};

type SalesTaskRow = {
  id: string;
  request_id: string;
  status: string;
  task_type: string;
  priority_tier: string;
  assignee_label: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SalesCallResultRow = {
  id: string;
  request_id: string;
  call_done: string;
  call_outcome: string | null;
  next_step: string;
  operator_id: string | null;
  superseded_at: string | null;
  created_at: string;
};

type ShippingIncidentRow = {
  id: string;
  request_id: string | null;
  incident_type: string;
  severity: "watch" | "high" | "urgent";
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type InboundIncidentRow = {
  id: string;
  shipment_id: string;
  incident_type: string;
  severity: "watch" | "high" | "urgent";
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type KpiRows = {
  requests: MasterRequestRow[];
  offers: OfferHistoryRow[];
  orders: MasterOrderRow[];
  seaCampaignDaily: SeaCampaignDailyRow[];
  googleAdsDailySpend: GoogleAdsDailySpendRow[];
  anthropicCosts: AnthropicCostRow[];
  costEntries: CostEntryRow[];
  salesTasks: SalesTaskRow[];
  salesCallResults: SalesCallResultRow[];
  shippingIncidents: ShippingIncidentRow[];
  inboundIncidents: InboundIncidentRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function berlinDay(now: Date) {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO("Europe/Berlin").startOfDay();
}

function startOfBerlinDay(now: Date, daysAgo = 0) {
  return new Date(berlinDay(now).subtract({ days: daysAgo }).epochMilliseconds);
}

function startOfMonth(now: Date) {
  return new Date(berlinDay(now).with({ day: 1 }).epochMilliseconds);
}

function startOfQuarter(now: Date) {
  const day = berlinDay(now);
  return new Date(day.with({ day: 1, month: Math.floor((day.month - 1) / 3) * 3 + 1 }).epochMilliseconds);
}

function parseDateBoundary(value: string | null | undefined, fallback: Date, endOfDay = false) {
  const text = cleanText(value);
  if (!text) return fallback;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const start = Temporal.PlainDate.from(text).toZonedDateTime("Europe/Berlin");
      return new Date(endOfDay ? start.add({ days: 1 }).epochMilliseconds - 1 : start.epochMilliseconds);
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function berlinCalendarDate(date: Date) {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO("Europe/Berlin").toPlainDate().toString();
}

export function resolveManagementRange(input: ManagementKpiInput = {}, now = new Date()) {
  const preset = (cleanText(input.range) || "30d") as ManagementRangePreset;
  const todayStart = startOfBerlinDay(now);
  let from: Date;
  let to = now;
  let label = "Letzte 30 Tage";

  switch (preset) {
    case "today":
      from = todayStart;
      label = "Heute";
      break;
    case "7d":
      from = startOfBerlinDay(now, 6);
      label = "Letzte 7 Tage";
      break;
    case "month":
      from = startOfMonth(now);
      label = "Dieser Monat";
      break;
    case "quarter":
      from = startOfQuarter(now);
      label = "Dieses Quartal";
      break;
    case "custom":
      from = parseDateBoundary(input.from, startOfBerlinDay(now, 29));
      to = parseDateBoundary(input.to, now, true);
      label = "Freier Zeitraum";
      break;
    case "30d":
    default:
      from = startOfBerlinDay(now, 29);
      label = "Letzte 30 Tage";
      break;
  }

  if (from.getTime() > to.getTime()) {
    const previousFrom = from;
    from = to;
    to = previousFrom;
  }

  return {
    preset: ["today", "7d", "30d", "month", "quarter", "custom"].includes(preset) ? preset : "30d",
    from,
    to,
    label,
  };
}

function dateInRange(value: DateLike, from: Date, to: Date) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
}

function anyDateInRange(values: DateLike[], from: Date, to: Date) {
  return values.some((value) => dateInRange(value, from, to));
}

function matchesNeedle(values: unknown[], needle: string | null) {
  if (!needle) return true;
  return values.some((value) => normalized(value).includes(needle));
}

function filterRequestRows(rows: MasterRequestRow[], input: ManagementKpiInput, from: Date, to: Date, restrictDate = true) {
  const query = normalized(input.query) || null;
  const source = normalized(input.source) || null;
  const segment = normalized(input.segment) || null;
  const country = countryCode(input.country) || normalized(input.country) || null;
  const customerType = normalized(input.customerType) || null;

  return rows.filter((row) => {
    if (restrictDate && !dateInRange(row.created_at, from, to)) return false;
    if (source && ![row.utm_source, row.utm_medium, row.utm_campaign, row.landing_page_url, row.referrer].some((entry) => normalized(entry).includes(source))) return false;
    if (segment && ![row.segment, row.s_kategorie].some((entry) => normalized(entry).includes(segment))) return false;
    if (country && (countryCode(row.country) || normalized(row.country)) !== country) return false;
    if (customerType && normalized(row.customer_type) !== customerType) return false;
    return matchesNeedle([row.id, row.request_id, row.status, row.deal_status, row.segment, row.s_kategorie, row.utm_source, row.utm_campaign], query);
  });
}

function requestIdSet(rows: MasterRequestRow[]) {
  return new Set(rows.flatMap((row) => [cleanText(row.id), cleanText(row.request_id)]).filter((value): value is string => Boolean(value)));
}

function hasRequestDimensions(input: ManagementKpiInput) {
  return [input.source, input.segment, input.country, input.customerType].some((value) => Boolean(cleanText(value)));
}

function filterRelatedByRequest<T extends { request_id?: string | null }>(
  rows: T[], dimensionIds: Set<string>, queryIds: Set<string>, query: string | null,
  restrictDimensions: boolean, extraValues: (row: T) => unknown[] = () => [],
) {
  return rows.filter((row) => {
    const requestId = cleanText(row.request_id);
    if (restrictDimensions && (!requestId || !dimensionIds.has(requestId))) return false;
    if (!query) return true;
    return Boolean(requestId && queryIds.has(requestId)) || matchesNeedle([requestId, ...extraValues(row)], query);
  });
}

function sum<T>(rows: T[], pick: (row: T) => unknown) {
  return rows.reduce((total, row) => total + asNumber(pick(row)), 0);
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function money(value: number, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function countBy<T>(
  rows: T[],
  keyOf: (row: T) => string | null | undefined,
  valueOf?: (row: T) => number,
  labelOf: (key: string) => string = (key) => key,
) {
  const map = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const key = cleanText(keyOf(row)) || "Unbekannt";
    const current = map.get(key) || { count: 0, value: 0 };
    current.count += 1;
    current.value += valueOf ? valueOf(row) : 0;
    map.set(key, current);
  }
  return [...map.entries()]
    .map(([key, entry]) => ({ key, label: labelOf(key), count: entry.count, value: entry.value || null }))
    .sort((left, right) => right.count - left.count || (right.value || 0) - (left.value || 0))
    .slice(0, 8);
}

function segmentNameForManagement(rawSegment: string) {
  if (rawSegment === "Ohne Segment" || rawSegment === "Unbekannt") return rawSegment;
  const legacyPrefix = "legacy:";
  if (rawSegment.startsWith(legacyPrefix)) {
    const legacySegment = rawSegment.slice(legacyPrefix.length);
    return `${formatCustomerSegmentLabel(legacySegment) || legacySegment} · Legacy`;
  }
  const ntLabel = formatCustomerSegmentLabel(rawSegment, CX8_TAXONOMY_VERSION);
  if (ntLabel) return ntLabel;
  if (/^s\d+$/i.test(rawSegment)) return `S-Kategorie ${rawSegment.toUpperCase()}`;
  return rawSegment;
}

function segmentKeyForManagement(row: MasterRequestRow) {
  const raw = cleanText(row.segment) || cleanText(row.s_kategorie) || "Ohne Segment";
  if (/^nt-\d+$/i.test(raw)) {
    const normalizedSegment = raw.toUpperCase();
    return isLegacyCustomerSegment(normalizedSegment, row.segment_taxonomy_version)
      ? `legacy:${normalizedSegment}`
      : normalizedSegment;
  }
  if (/^s\d+$/i.test(raw)) return raw.toUpperCase();
  return raw;
}

function latestDate<T>(rows: T[], pick: (row: T) => DateLike) {
  let latest: string | null = null;
  for (const row of rows) {
    const value = pick(row);
    if (!value) continue;
    if (!latest || new Date(value).getTime() > new Date(latest).getTime()) latest = value;
  }
  return latest;
}

function staleDays(date: string | null, now: Date) {
  if (!date) return null;
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / DAY_MS);
}

function statusQuality(status: ManagementKpiDataQualityItem["status"], label: string, detail: string, key: string): ManagementKpiDataQualityItem {
  return { key, label, status, detail };
}

function dateAndFilter(column: string, from: string, to: string) {
  return `(${column}.gte.${from},${column}.lte.${to})`;
}

export function buildManagementKpiDashboardFromRows(rows: KpiRows, input: ManagementKpiInput = {}, now = new Date()): ManagementKpiDashboard {
  const range = resolveManagementRange(input, now);
  const query = normalized(input.query) || null;
  const filteredRequests = filterRequestRows(rows.requests, input, range.from, range.to);
  // An order signed today may belong to an older request. Apply the business
  // dimensions to all request metadata; apply the date to each event itself.
  const restrictDimensions = hasRequestDimensions(input);
  const dimensionIds = requestIdSet(filterRequestRows(rows.requests, { ...input, query: null }, range.from, range.to, false));
  const queryIds = requestIdSet(filterRequestRows(rows.requests, input, range.from, range.to, false));

  const relatedOffers = filterRelatedByRequest(rows.offers, dimensionIds, queryIds, query, restrictDimensions, (row) => [row.offer_status]);
  const offersInRange = relatedOffers.filter((row) => anyDateInRange([row.created_at, row.sent_at, row.viewed_at, row.accepted_at], range.from, range.to));
  const relatedOrders = filterRelatedByRequest(rows.orders, dimensionIds, queryIds, query, restrictDimensions, (row) => [row.shopify_order_number, row.status]);
  const ordersInRange = relatedOrders.filter((row) => dateInRange(row.shopify_created_at || row.created_at, range.from, range.to));
  const relatedTasks = filterRelatedByRequest(rows.salesTasks, dimensionIds, queryIds, query, restrictDimensions, (row) => [row.status, row.task_type, row.assignee_label]);
  const tasksInRange = relatedTasks.filter((row) => anyDateInRange([row.created_at, row.updated_at, row.completed_at, row.due_at], range.from, range.to));
  const relatedCalls = filterRelatedByRequest(rows.salesCallResults, dimensionIds, queryIds, query, restrictDimensions, (row) => [row.call_outcome, row.next_step, row.operator_id]);
  const callsInRange = relatedCalls.filter((row) => dateInRange(row.created_at, range.from, range.to) && !row.superseded_at);
  const relatedShippingIncidents = filterRelatedByRequest(rows.shippingIncidents, dimensionIds, queryIds, query, restrictDimensions, (row) => [row.title, row.incident_type, row.severity, row.status]);
  const shippingIncidentsInRange = relatedShippingIncidents.filter((row) => anyDateInRange([row.created_at, row.updated_at], range.from, range.to));
  const inboundIncidentsInRange = rows.inboundIncidents.filter((row) => anyDateInRange([row.created_at, row.updated_at], range.from, range.to) && matchesNeedle([row.title, row.incident_type, row.severity, row.status], query));

  const quoteCreated = offersInRange.filter((row) => dateInRange(row.created_at, range.from, range.to)).length;
  const quoteSent = offersInRange.filter((row) => dateInRange(row.sent_at, range.from, range.to)).length;
  const quoteViewed = offersInRange.filter((row) => dateInRange(row.viewed_at, range.from, range.to)).length;
  const quoteSigned = offersInRange.filter((row) => dateInRange(row.accepted_at, range.from, range.to)).length;
  const activeOrders = ordersInRange.filter((row) => !row.cancelled_at && !["refunded"].includes(normalized(row.status)));
  const cancelledOrders = ordersInRange.filter((row) => row.cancelled_at || ["refunded", "partially_refunded"].includes(normalized(row.status)));
  const orderValue = sum(activeOrders, (row: MasterOrderRow) => row.order_value);
  const quoteValue = sum(offersInRange, (row: OfferHistoryRow) => row.total_value);
  const pipelineValue = sum(filteredRequests, (row: MasterRequestRow) => row.final_value || row.estimated_value);
  const openSalesTasks = tasksInRange.filter((row) => ["open", "waiting", "blocked"].includes(normalized(row.status))).length;
  const overdueSalesTasks = tasksInRange.filter((row) => ["open", "waiting", "blocked"].includes(normalized(row.status)) && row.due_at && new Date(row.due_at).getTime() < now.getTime()).length;
  const completedCalls = callsInRange.filter((row) => normalized(row.call_done) === "yes").length;
  const openShippingIncidents = shippingIncidentsInRange.filter((row) => ["open", "acknowledged"].includes(normalized(row.status))).length;
  const openInboundIncidents = inboundIncidentsInRange.filter((row) => ["open", "acknowledged"].includes(normalized(row.status))).length;

  const costEntriesInRange = rows.costEntries.filter((row) => dateInRange(row.occurred_on, range.from, range.to));
  const knownAdSpend = sum(costEntriesInRange.filter((row) => row.category === "ads" && row.currency === "EUR"), (row) => row.amount);
  const knownAiSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "ai" && row.currency === "USD"), (row) => row.amount);
  const knownVoiceSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "voice" && row.currency === "USD"), (row) => row.amount);
  const knownInboundProductionSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "production" && row.subcategory === "china_supplier_production" && row.currency === "USD"), (row) => row.amount);
  const knownInboundShippingSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "shipping" && row.subcategory === "china_inbound_shipping" && row.currency === "USD"), (row) => row.amount);
  const legacyAdsLatest = latestDate(rows.googleAdsDailySpend, (row: GoogleAdsDailySpendRow) => row.date);
  const seaAdsLatest = latestDate(rows.seaCampaignDaily, (row: SeaCampaignDailyRow) => row.date);
  const costBookLatest = latestDate(rows.costEntries, (row) => row.occurred_on);
  const shopifyLatest = latestDate(rows.orders, (row: MasterOrderRow) => row.shopify_created_at || row.created_at);
  const clarityProjectId = cleanText(process.env.MICROSOFT_CLARITY_PROJECT_ID || process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID);

  const riskFeed: ManagementRiskItem[] = [
    ...shippingIncidentsInRange
      .filter((row) => ["open", "acknowledged"].includes(normalized(row.status)))
      .map((row) => ({
        key: `shipping:${row.id}`,
        label: row.title,
        detail: [row.request_id, row.incident_type, row.description].filter(Boolean).join(" - "),
        severity: row.severity,
        href: row.request_id ? `/ops/customer-records/shipping?requestId=${encodeURIComponent(row.request_id)}` : "/ops/customer-records/shipping",
      })),
    ...inboundIncidentsInRange
      .filter((row) => ["open", "acknowledged"].includes(normalized(row.status)))
      .map((row) => ({
        key: `inbound:${row.id}`,
        label: row.title,
        detail: [row.incident_type, row.description].filter(Boolean).join(" - "),
        severity: row.severity,
        href: "/ops/customer-records/inbound-shipping",
      })),
    ...(overdueSalesTasks
      ? [{
          key: "sales_tasks:overdue",
          label: "Überfällige Sales-Aufgaben",
          detail: `${overdueSalesTasks} offene Aufgaben sind überfällig.`,
          severity: "high" as const,
          href: "/ops/customer-records/calls",
        }]
      : []),
  ].sort((left, right) => ({ urgent: 3, high: 2, watch: 1 }[right.severity] - { urgent: 3, high: 2, watch: 1 }[left.severity])).slice(0, 12);

  const dataQuality: ManagementKpiDataQualityItem[] = [
    ...(restrictDimensions ? [statusQuality("partial", "Filterabdeckung", "Quelle, Segment, Land und Kundentyp filtern Anfragen sowie zugeordnete Angebote, Aufträge, Aufgaben, Anrufe und Versandfälle. Kosten und eingehende Versandfälle haben keine Anfragezuordnung und bleiben reine Zeitraumwerte.", "filter_coverage")] : []),
    statusQuality("good", "Umsatzdaten", `${activeOrders.length} aktive Shopify-Bestellungen im Zeitraum, ${cancelledOrders.length} stornierte/erstattete Fälle separat gezählt.`, "orders"),
    statusQuality(filteredRequests.filter((row) => row.utm_source || row.utm_campaign || row.landing_page_url).length ? "partial" : "missing", "Attribution", `${filteredRequests.filter((row) => row.utm_source || row.utm_campaign || row.landing_page_url).length} von ${filteredRequests.length} Anfragen haben UTM/Landingpage-Daten.`, "attribution"),
    statusQuality(costBookLatest && staleDays(costBookLatest, now)! <= 2 ? "good" : "partial", "Kostenbuch", `${costEntriesInRange.length} Kostenbuch-Zeilen im Zeitraum. Letzter Kostenbuch-Tag: ${costBookLatest || "unbekannt"}.`, "cost_book"),
    statusQuality(shopifyLatest && staleDays(shopifyLatest, now)! <= 2 ? "good" : activeOrders.length ? "partial" : "missing", "Shopify Orders", `${activeOrders.length} aktive Bestellungen im Zeitraum. Letzter Shopify-Auftrag: ${shopifyLatest || "unbekannt"}.`, "shopify_orders"),
    statusQuality(seaAdsLatest && staleDays(seaAdsLatest, now)! <= 2 ? "good" : "partial", "SEA-Kosten", `Aktuelle Quelle sea_campaign_daily bis ${seaAdsLatest || "unbekannt"}. Legacy google_ads_daily_spend bis ${legacyAdsLatest || "unbekannt"} ist als Legacy-Kostenquelle im Kostenbuch enthalten.`, "ads_costs"),
    statusQuality(clarityProjectId ? "partial" : "missing", "Microsoft Clarity", clarityProjectId ? "Clarity-Projekt ist konfiguriert; Insights/API-Kennzahlen sind noch nicht ins KPI-Modell integriert." : "Nicht konfiguriert. MICROSOFT_CLARITY_PROJECT_ID fehlt; es werden keine Clarity-Zahlen erfunden.", "microsoft_clarity"),
    statusQuality("partial", "Kosten/Marge", "Google Ads, AI-Token, Voice-Schaetzungen sowie Sign-SHIPPED Produktions- und China-Inbound-Versandkosten sind im Kostenbuch. Marge bleibt ohne Outbound-Versand, Zoll/Import und Refunds nur teilweise belastbar.", "margin"),
    statusQuality(openShippingIncidents ? "risk" : "good", "Versand-Risiken", `${openShippingIncidents} offene ausgehende Shipping-Incidents im Zeitraum.`, "shipping"),
    statusQuality("partial", "RLS-Hinweis", "sales_tasks und ops_offer_events muessen per RLS-Migration auf Service-Role/API-Zugriff begrenzt sein. Wenn Supabase weiter warnt, Post-checks ausfuehren.", "rls"),
  ];

  const summary: ManagementKpiCard[] = [
    {
      key: "revenue",
      label: "Shopify-Umsatz",
      value: money(orderValue),
      detail: `${activeOrders.length} aktive Bestellungen, ${cancelledOrders.length} storniert/erstattet separat`,
      tone: orderValue > 0 ? "good" : "neutral",
    },
    {
      key: "pipeline",
      label: "Pipeline-Wert",
      value: money(pipelineValue),
      detail: `${filteredRequests.length} neue Anfragen im Zeitraum`,
      tone: pipelineValue > 0 ? "neutral" : "watch",
    },
    {
      key: "conversion",
      label: "Quote Conversion",
      value: pct(quoteSigned, quoteSent) === null ? "-" : `${pct(quoteSigned, quoteSent)}%`,
      detail: `${quoteSigned} angenommen/signiert von ${quoteSent} gesendet`,
      tone: quoteSent ? "neutral" : "watch",
    },
    {
      key: "risks",
      label: "Akute Risiken",
      value: String(openShippingIncidents + openInboundIncidents + overdueSalesTasks),
      detail: `${openShippingIncidents} Versand, ${openInboundIncidents} Wareneingang, ${overdueSalesTasks} Aufgaben`,
      tone: openShippingIncidents + openInboundIncidents + overdueSalesTasks ? "danger" : "good",
    },
    {
      key: "ad_spend",
      label: "SEA-Kosten",
      value: money(knownAdSpend),
      detail: `${costEntriesInRange.filter((row) => row.category === "ads").length} Kostenbuch-Zeilen im Zeitraum`,
      tone: knownAdSpend > 0 ? "neutral" : "watch",
    },
    {
      key: "ai_cost",
      label: "AI-Kosten",
      value: money(knownAiSpendUsd, "USD"),
      detail: `${costEntriesInRange.filter((row) => row.category === "ai").length} Kostenbuch-Zeilen im Zeitraum`,
      tone: knownAiSpendUsd > 0 ? "neutral" : "watch",
    },
  ];

  return {
    generatedAt: now.toISOString(),
    range: {
      preset: range.preset,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      label: range.label,
    },
    filters: {
      query: cleanText(input.query),
      source: cleanText(input.source),
      segment: cleanText(input.segment),
      country: cleanText(input.country),
      customerType: cleanText(input.customerType),
    },
    summary,
    sales: {
      newRequests: filteredRequests.length,
      quoteCreated,
      quoteSent,
      quoteViewed,
      quoteSigned,
      orders: activeOrders.length,
      cancelledOrders: cancelledOrders.length,
      orderValue,
      quoteValue,
      pipelineValue,
      conversionRate: pct(quoteSigned, quoteSent),
      topSources: countBy(filteredRequests, (row) => row.utm_source || row.referrer || row.landing_page_url, (row) => asNumber(row.final_value || row.estimated_value)),
      topSegments: countBy(
        filteredRequests,
        segmentKeyForManagement,
        (row) => asNumber(row.final_value || row.estimated_value),
        segmentNameForManagement,
      ),
    },
    operations: {
      openSalesTasks,
      overdueSalesTasks,
      completedCalls,
      openShippingIncidents,
      openInboundIncidents,
      riskFeed,
    },
    costs: {
      knownAdSpend,
      knownAiSpendUsd,
      knownVoiceSpendUsd,
      knownInboundProductionSpendUsd,
      knownInboundShippingSpendUsd,
      knownCostCoverage: "partial",
      missingSources: [
        "ausgehende DPD/DHL-Versandkosten je Kundenpaket",
        "Zoll- und Importkosten",
        "Refund-/Chargeback-Kosten",
        "Abo-/Toolkostenplaene",
      ],
    },
    dataQuality,
  };
}

// A short response is not proof of completeness: Supabase may enforce a lower
// server-side page cap. Continue to an empty page and fail closed on budgets.
async function fetchAllKpiRows<T>(path: string, query: Record<string, string | number>, signal: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 200; page += 1) {
    signal.throwIfAborted();
    const batch = await supabaseRequest<T[]>(path, { signal }, { ...query, limit: 500, offset: rows.length });
    if (!Array.isArray(batch)) throw new SupabaseRestError("Unvollständige KPI-Daten: ungültige Antwort.", 502);
    if (!batch.length) return rows;
    rows.push(...batch);
  }
  throw new SupabaseRestError("KPI-Abfrage zu groß; bitte den Zeitraum oder die Filter eingrenzen. Keine Teilsumme berechnet.", 422);
}

async function fetchKpiRows(input: ManagementKpiInput): Promise<KpiRows> {
  const range = resolveManagementRange(input);
  const signal = AbortSignal.timeout(25_000);
  const [requests, offers, orders, seaCampaignDaily, googleAdsDailySpend, anthropicCosts, costEntries, salesTasks, salesCallResults, shippingIncidents, inboundIncidents] = await Promise.all([
    fetchAllKpiRows<MasterRequestRow>("master_requests", {
      select: "id,request_id,status,deal_status,segment,segment_taxonomy_version,s_kategorie,customer_type,country,estimated_value,final_value,utm_source,utm_medium,utm_campaign,landing_page_url,referrer,created_at,updated_at",
      ...(hasRequestDimensions(input) || cleanText(input.query) ? {} : { and: dateAndFilter("created_at", range.from.toISOString(), range.to.toISOString()) }),
      order: "created_at.desc,id.desc",
    }, signal),
    fetchAllKpiRows<OfferHistoryRow>("v_offer_history", {
      select: "id,request_id,offer_status,total_value,currency,created_at,sent_at,viewed_at,accepted_at",
      order: "created_at.desc,id.desc",
    }, signal),
    fetchAllKpiRows<MasterOrderRow>("master_orders", {
      select: "id,request_id,shopify_order_number,order_value,subtotal_price,total_tax,currency,status,cancelled_at,shopify_created_at,created_at,updated_at",
      order: "created_at.desc,id.desc",
    }, signal),
    fetchAllKpiRows<SeaCampaignDailyRow>("sea_campaign_daily", {
      select: "date,cost_eur,conversions,conversion_value,synced_at",
      and: dateAndFilter("date", berlinCalendarDate(range.from), berlinCalendarDate(range.to)),
      order: "date.desc,campaign_id.desc",
    }, signal),
    fetchAllKpiRows<GoogleAdsDailySpendRow>("google_ads_daily_spend", {
      select: "date,spend,synced_at",
      order: "date.desc",
    }, signal),
    fetchAllKpiRows<AnthropicCostRow>("anthropic_api_daily_costs", {
      select: "cost_date,total_cost_usd,total_cost_cents",
      and: dateAndFilter("cost_date", berlinCalendarDate(range.from), berlinCalendarDate(range.to)),
      order: "cost_date.desc",
    }, signal),
    fetchAllKpiRows<CostEntryRow>("ops_cost_entries", {
      select: "id,cost_key,source,category,subcategory,amount,currency,occurred_on,confidence",
      and: dateAndFilter("occurred_on", berlinCalendarDate(range.from), berlinCalendarDate(range.to)),
      order: "occurred_on.desc,id.desc",
    }, signal),
    fetchAllKpiRows<SalesTaskRow>("sales_tasks", {
      select: "id,request_id,status,task_type,priority_tier,assignee_label,due_at,completed_at,created_at,updated_at",
      order: "updated_at.desc,id.desc",
    }, signal),
    fetchAllKpiRows<SalesCallResultRow>("sales_call_results", {
      select: "id,request_id,call_done,call_outcome,next_step,operator_id,superseded_at,created_at",
      and: dateAndFilter("created_at", range.from.toISOString(), range.to.toISOString()),
      order: "created_at.desc,id.desc",
    }, signal),
    fetchAllKpiRows<ShippingIncidentRow>("shipping_incidents", {
      select: "id,request_id,incident_type,severity,status,title,description,created_at,updated_at",
      order: "updated_at.desc,id.desc",
    }, signal),
    fetchAllKpiRows<InboundIncidentRow>("inbound_incidents", {
      select: "id,shipment_id,incident_type,severity,status,title,description,created_at,updated_at",
      order: "updated_at.desc,id.desc",
    }, signal),
  ]);

  return {
    requests,
    offers,
    orders,
    seaCampaignDaily,
    googleAdsDailySpend,
    anthropicCosts,
    costEntries,
    salesTasks,
    salesCallResults,
    shippingIncidents,
    inboundIncidents,
  };
}

export async function getManagementKpiDashboard(input: ManagementKpiInput = {}) {
  const rows = await fetchKpiRows(input);
  return buildManagementKpiDashboardFromRows(rows, input);
}
